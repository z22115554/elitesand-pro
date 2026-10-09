#!/usr/bin/env node
'use strict';
// CPU microbenchmark of real state-sync code; excludes disk/network/GPU latency.
const fs=require('fs'),cp=require('child_process'),assert=require('assert/strict'),{performance}=require('perf_hooks');
const {loadState,loadDisplay}=require('../tests/helpers/runtime-audit-fixtures');
const root=require('path').resolve(__dirname,'..');process.chdir(root);
const baseline=process.argv[2]||'fb49009ca9a2a70618734150454e5e9fc29fc813';
const before=cp.execFileSync('git',['show',`${baseline}:server/state/app-state.js`],{encoding:'utf8'});
const after=fs.readFileSync('server/state/app-state.js','utf8');
const results=[];
for(const n of [100,500,2000]){
 const fixtures=[loadState(before),loadState(after)];
 const tracks=Array.from({length:n},(_,i)=>({id:`track-${i}`,entryId:`entry-${i}`,title:`歌曲 ${i}`,artist:'測試歌手',duration:240,filename:`${i}.mp3`,url:'https://example.test/audio',cover:'https://example.test/cover',lyrics:'[00:01]'+ '歌詞'.repeat(400),lyricsType:'lrc',parsedLyrics:Array.from({length:80},(_,j)=>({time:j*3000,text:'歌詞示範'})),artistCandidates:['歌手'],originalName:'音檔.mp3',source:'youtube',originalArtist:'歌手',performer:'翻唱',createdAt:1234,sectionsStatus:'done',sections:[{start:0,end:30,type:'intro'}],separationStatus:'done',vocalsFile:'vocals.wav',instrumentalFile:'instrumental.wav',loudnessLufs:-14,lyricsDurationVerified:false}));
 for(const f of fixtures){f.state.playState.playlist=tracks;f.state.playState.currentTrack=tracks[0];f.state.broadcastState();}
 assert.deepEqual(JSON.parse(JSON.stringify(fixtures[0].emitted)),JSON.parse(JSON.stringify(fixtures[1].emitted)));
 fixtures.forEach(f=>{for(let i=0;i<100;i++){f.state.broadcastState();f.emitted.length=0;}});
 const times=[[],[]];for(let round=0;round<8;round++){for(const i of round%2?[1,0]:[0,1]){const f=fixtures[i];const t=performance.now();for(let k=0;k<100;k++){f.state.broadcastState();f.emitted.length=0;}times[i].push((performance.now()-t)/100);}}
 const median=a=>a.slice().sort((x,y)=>x-y)[Math.floor(a.length/2)];const b=median(times[0]),a=median(times[1]);results.push({tracks:n,beforeMs:b,afterMs:a,reductionPercent:(b-a)/b*100,batchTimes:times,payloadBytes:fixtures[1].state.getStateSyncMetrics().lastBytes});
}
const oldDisplay=cp.execFileSync('git',['show',`${baseline}:public/js/display.js`],{encoding:'utf8'});const clocks=[loadDisplay(oldDisplay),loadDisplay()];
const clock=clocks.map(f=>{f.emit('state:sync',{isPlaying:true,currentTime:10,serverTimestamp:100000,playbackRate:1});f.advance(200);f.emit('speed:update',1.5);return f.clock();});assert.deepEqual(clock,[10300,10200]);
const output=process.env.ELITESAND_AUDIT_BENCHMARK_OUTPUT||require('path').join(require('os').tmpdir(),'elitesand-runtime-benchmark.json');
fs.writeFileSync(output,JSON.stringify({node:process.version,platform:process.platform,method:'same-process VM, real app-state source, mocked audio lookup/logger/I/O, 100 warmup + 8 alternating batches of 100 calls; equality checked for both role payloads',results,clockRegression:{before:clock[0],after:clock[1],expected:10200}},null,2));console.log(JSON.stringify({results:results.map(({batchTimes,...r})=>r),clock},null,2));
