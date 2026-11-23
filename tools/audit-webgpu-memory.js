'use strict';
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {loadDspWorker}=require('../tests/helpers/webgpu-dsp-fixture');
async function main(){
 const args=process.argv.slice(2),baseline=args.find(v=>v.startsWith('--baseline-root='))?.slice(16);
 const seconds=Number(args.find(v=>v.startsWith('--seconds='))?.slice(10)||60);
 if(!Number.isInteger(seconds)||seconds<1||seconds>60)throw Error('Use --seconds=1..60; this probe is not GPU acceptance.');
 const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
 let previous=null;
 if(baseline)previous=await loadDspWorker({root:path.resolve(baseline),seconds}).run();
 const current=await loadDspWorker({seconds}).run();
 if(previous){assert.deepEqual(current.vocals,previous.vocals);assert.deepEqual(current.instrumental,previous.instrumental);}
 const report={seconds,sampleRate:44100,baselineSongArrayBytes:previous?.songArrayBytes,
  currentSongArrayBytes:current.songArrayBytes,reduction:previous?1-current.songArrayBytes/previous.songArrayBytes:undefined,
  vocalsSha256:hash(current.vocals),instrumentalSha256:hash(current.instrumental),
  outputMatch:previous?'byte-identical':'baseline not supplied',
  scope:'production worker CPU buffer allocations; deterministic decoder/FFT/inference fixtures; excludes GPU, decoder internals, RSS and real browser peak'};
 process.stdout.write(JSON.stringify(report,null,2)+'\n');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
