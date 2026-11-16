'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const trust=require('../server/services/python-package-trust');
function temporary(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'elitesand-python-trust-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}

test('all dependency locks pin versions and hashes, including MuQ and practice prerequisites',()=>{
  for(const name of ['bootstrap','ai','section','practice-pitch']){
    const lines=trust.readLock(name).toString().replace(/\\\r?\n/g,' ').split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'));
    for(const line of lines){assert.match(line,/^[A-Za-z0-9_.-]+==[^\s]+\s+/);assert.match(line,/--hash=sha256:[a-f0-9]{64}/);assert.ok(!line.includes(' @ '));}
  }
  const section=trust.readLock('section').toString();
  for(const name of ['nnaudio','easydict','x-clip'])assert.match(section,new RegExp(`^${name}==`,'m'));
  const ai=trust.readLock('ai').toString();
  for(const name of ['librosa','resampy','scipy','torch','torchaudio','tqdm'])assert.match(ai,new RegExp(`^${name}==`,'m'));
  assert.match(ai,/^torch==2\.6\.0\+cu124 /m);
});

test('changed packaged locks and bootstrap wheels fail before any execution',async t=>{
  const bytes=Buffer.from(trust.readLock('ai'));bytes[0]^=1;
  assert.throws(()=>trust.readLock('ai',()=>bytes),/SHA-256/);
  assert.throws(()=>trust.readLock('../ai'),/Unknown/);
  const directory=temporary(t);let executed=false;
  await assert.rejects(trust.bootstrapPackages(directory,async()=>Buffer.from('tampered'),async()=>{executed=true;}),/SHA-256/);
  assert.equal(executed,false);assert.deepEqual(fs.readdirSync(directory),[]);
});

test('cancellation and local source installation cannot fetch unchecked packages',async t=>{
  const directory=temporary(t),controller=new AbortController();controller.abort();let fetched=false;
  await assert.rejects(trust.bootstrapPackages(directory,async()=>{fetched=true;},async()=>{}, {abortSignal:controller.signal}),{code:'CANCELLED'});
  assert.equal(fetched,false);
  const local=trust.installLocalArgs(path.join(directory,'MuQ'));
  for(const flag of ['--no-index','--no-deps','--no-build-isolation','--isolated'])assert.ok(local.includes(flag));
  for(const name of ['ai','section','practice-pitch']){
    const args=trust.installArgs(name,directory);
    for(const flag of ['--require-hashes','--no-build-isolation','--isolated'])assert.ok(args.includes(flag));
    assert.deepEqual(fs.readFileSync(args.at(-1)),trust.readLock(name));
  }
});

test('real pip rejects changed wheel bytes in an offline disposable target',t=>{
  const python=process.env.PYTHON||'python';
  const probe=spawnSync(python,['-m','pip','--version'],{encoding:'utf8',timeout:10000,windowsHide:true});
  if(probe.error||probe.status!==0){t.skip('Python with pip unavailable');return;}
  const dir=temporary(t),target=path.join(dir,'target'),file=path.join(dir,'codex_audit_fixture-1.0.0-py3-none-any.whl');
  function build(payload){const zip=new(require('adm-zip'))();
    zip.addFile('codex_audit_fixture.py',Buffer.from(payload));
    zip.addFile('codex_audit_fixture-1.0.0.dist-info/METADATA',Buffer.from('Metadata-Version: 2.1\nName: codex-audit-fixture\nVersion: 1.0.0\n'));
    zip.addFile('codex_audit_fixture-1.0.0.dist-info/WHEEL',Buffer.from('Wheel-Version: 1.0\nGenerator: audit-test\nRoot-Is-Purelib: true\nTag: py3-none-any\n'));
    zip.addFile('codex_audit_fixture-1.0.0.dist-info/RECORD',Buffer.from(''));return zip.toBuffer();}
  const approved=build('value=1\n'),changed=build('value=2\n'),hash=crypto.createHash('sha256').update(approved).digest('hex');
  fs.writeFileSync(file,changed);const req=path.join(dir,'requirements.txt');fs.writeFileSync(req,`codex-audit-fixture==1.0.0 --hash=sha256:${hash}\n`);
  const r=spawnSync(python,['-m','pip','--isolated','install','--no-index','--no-deps','--no-cache-dir','--find-links',dir,'--require-hashes','--target',target,'-r',req],{encoding:'utf8',timeout:30000,windowsHide:true});
  assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/hashes|hash mismatch/i);assert.equal(fs.existsSync(path.join(target,'codex_audit_fixture.py')),false);
});
