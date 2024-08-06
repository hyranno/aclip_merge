import { readFileSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

import ffmpeg from 'fluent-ffmpeg'


interface AudioClip {
  actor: string,
  file: string,
  startAt: number, // milliseconds
}
type AudioList = {
  clips: AudioClip[],
}


async function main(): Promise<void[]> {
  let [,, input, dest] = process.argv;
  if (!dest) {
    console.log("node aclip_merge <inputFile> <destDir>");
    process.exit(0);
  }

  let dir = path.dirname(input);
  let aclips: AudioClip[] = loadClips(input);

  return Promise.all([...(Map.groupBy(aclips, clip => clip.actor))].map(([actor, clipGroup]) =>
    clipGroup.map(clip =>
      new Promise<AudioClip>((resolve) => resolve(clip))
    ).reduce((pbase, pclip) =>
      Promise.all([pbase, pclip]).then(([base, clip]) =>
        merge(dir, base, clip)
      ),
      zeroAudio(path.join(dir, aclips[0].file))
    ).then(res =>
      copyFileSync(res.file, path.join(dest, res.actor + ".wav"))
    )
  ));
}


function merge(dir: string, base: AudioClip, clip: AudioClip): Promise<AudioClip> {
  let dest: AudioClip = {
    actor: clip.actor,
    startAt: 0,
    file: tempFileName(".wav"),
  };
  let promise = new Promise<AudioClip>((resolve, reject) => ffmpeg()
    .on("end", () => {
      console.log(`merged : ${base.file} + ${clip.file} -> ${dest.file}`);
      resolve(dest);
    })
    .on("error", (err: any) => {
      console.log(err);
      reject(err);
    })
    .input(base.file)
    .input(path.join(dir, clip.file))
    .complexFilter([
        { filter: "adelay", options: { delays: clip.startAt, all: true }, inputs: ['1'], outputs: ['clip']},
        { filter: "amix", options: { dropout_transition: 0, normalize: false }, inputs: ['0', 'clip'], outputs: ['outputs']},
    ], 'outputs')
    .save(dest.file)
  );
  return promise;
}

function zeroAudio(basefile: string): Promise<AudioClip> {
  let dest: AudioClip = {
    actor: "dummy",
    startAt: 0,
    file: tempFileName(".wav"),
  };
  let promise = new Promise<AudioClip>((resolve, reject) => ffmpeg()
    .on("end", () => {
      console.log(`zero trim : ${basefile} -> ${dest.file}`);
      resolve(dest);
    })
    .on("error", (err: any) => {
      console.log(err);
      reject(err);
    })
    .input(basefile)
      .audioFilter([
        { filter: "atrim", options: {end_sample: 0} },
      ])
    .save(dest.file)
  );
  return promise;
}


function* tempFileNameGen(roll: number): Generator<string, never, never> {
  while(true) {
    for (var i=0; i<roll; i++) yield "tmp" + i;
  }
}
let tempDir = mkdtempSync(path.join(tmpdir(), 'aclip_merge-'));
let tempFileNameIter = tempFileNameGen(64);
function tempFileName(suffix: string): string {
  return path.join(tempDir, tempFileNameIter.next().value + suffix)
}


function loadClips(filename: string): AudioClip[] {
  let data = JSON.parse(readFileSync(filename, "utf8")) as AudioList;
  return data.clips
}


await main();
rmSync(tempDir, {recursive: true});
