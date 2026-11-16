'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRetiredEventCleanup } = require('../server/services/retired-event-cleanup');

function fixture(t, saved = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-retired-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  if (saved) {
    fs.writeFileSync(path.join(directory, 'halloween-cauldron.json'), JSON.stringify({ schemaVersion:1, rewardIds:{ candy:'reward-001' }, votes:{ candy:123 } }));
    fs.writeFileSync(path.join(directory, 'moon-event.json'), '{archive data is deliberately not read}');
  }
  return directory;
}

test('retired production socket wiring loads no archived campaign modules even with an old clock', () => {
  const stdout = execFileSync(process.execPath, ['-e', `
    Date.now=()=>Date.parse('2026-09-01');
    require('./server/routes/socket-handler');
    const s=require('./server/services/retired-seasonal-events');
    const handlers={};s.registerHalloweenEventHandlers({}, {clientType:'controller',on:(name,fn)=>handlers[name]=fn});
    let reply;handlers['halloween:donate']({name:'x',amount:1},r=>reply=r);
    console.log('RESULT:'+JSON.stringify({active:s.halloweenEvent.isActive(),reply,
      loaded:Object.keys(require.cache).filter(p=>/[/\\\\](?:seasonal-event|moon-event|halloween-event|halloween-interactions|halloween-cauldron)\\.js$/.test(p))}));
  `], { cwd:path.join(__dirname,'..'), encoding:'utf8' });
  const r=JSON.parse(stdout.split('RESULT:')[1].split('\n')[0]);
  assert.equal(r.active,false);assert.deepEqual(r.reply,{ok:false,inactive:true});assert.deepEqual(r.loaded,[]);
});

test('cleanup only pauses saved rewards and refunds paginated outstanding redemptions without writing archives', async t => {
  const directory=fixture(t), file=path.join(directory,'halloween-cauldron.json'), before=fs.readFileSync(file);
  const calls=[], refunds=[]; let page=0;
  const twitch={auth:{userId:'channel'},requireRedemptionAuthorization:async()=>{},
    helix:async(url,options)=>{calls.push({url,options});if(options) return {ok:true};
      return {ok:true,json:async()=>++page===1?{data:[{id:'pending-001'}],pagination:{cursor:'page-two'}}:{data:[{id:'pending-002'}],pagination:{}}};},
    updateRewardRedemptionStatus:async(r,status)=>{assert.equal(page,2,'collect all pages before changing filtered results');refunds.push({...r,status});return {confirmed:true};}};
  const cleanup=createRetiredEventCleanup({twitch,directory});t.after(()=>cleanup.stop());
  await Promise.all([cleanup.run(),cleanup.run()]);
  assert.equal(calls.length,3);assert.deepEqual(calls[0].options,{method:'PATCH',body:{is_paused:true}});
  assert.ok(calls[2].url.includes('after=page-two'));
  assert.deepEqual(refunds.map(r=>r.id),['pending-001','pending-002']);assert.ok(refunds.every(r=>r.rewardId==='reward-001'&&r.status==='CANCELED'));
  assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(fs.readdirSync(directory).sort(),['halloween-cauldron.json','moon-event.json']);
  assert.equal(await cleanup.handleRedemption({reward:{id:'unrelated-001'},id:'pending-003'}),false);
});

test('failed or unconfirmed cleanup retries and stop cancels its timer', async t => {
  const directory=fixture(t), callbacks=new Map();let next=0, attempt=0;
  const timers={setTimeout:fn=>{callbacks.set(++next,fn);return next;},clearTimeout:id=>callbacks.delete(id)};
  const twitch={auth:{userId:'channel'},requireRedemptionAuthorization:async()=>{},
    helix:async(_url,options)=>options?{ok:true}:{ok:true,json:async()=>({data:[{id:'pending-001'}]})},
    updateRewardRedemptionStatus:async()=>({confirmed:++attempt>1})};
  const cleanup=createRetiredEventCleanup({twitch,directory,timers});
  await cleanup.run();assert.equal(callbacks.size,1);await cleanup.run();assert.equal(callbacks.size,0);assert.equal(attempt,2);
  assert.equal(await cleanup.handleRedemption({reward:{id:'reward-001'},id:'pending-002',status:'FULFILLED'}),true);
  cleanup.stop();await cleanup.run();assert.equal(attempt,2);assert.equal(callbacks.size,0);
});

test('an unused campaign causes no Twitch requests or timers', async t => {
  const directory=fixture(t,false);
  const cleanup=createRetiredEventCleanup({directory,twitch:{requireRedemptionAuthorization:()=>{throw Error('unexpected network');}},
    timers:{setTimeout:()=>{throw Error('unexpected timer');},clearTimeout(){}}});
  cleanup.start();await cleanup.run();assert.equal(cleanup.hasRewards(),false);cleanup.stop();
});
