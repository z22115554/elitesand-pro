'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifySignedChecksums } = require('../server/services/ytdlp-signature-trust');
const { stageVerifiedRelease } = require('../server/services/ytdlp-verified-release');
const fixture = path.join(__dirname,'fixtures/ytdlp');
const checksums = fs.readFileSync(path.join(fixture,'SHA2-256SUMS'));
const signature = Buffer.from(fs.readFileSync(path.join(fixture,'SHA2-256SUMS.sig.base64'),'utf8'),'base64');
const officialDigest = '85c8d440422108bee7ecd11e584d56cc04fb3bd1a0b3200bdc8a66d5c5a985fc';

test('official nightly detached signature verifies against the app-pinned public key', async () => {
  assert.equal(await verifySignedChecksums(checksums,signature),officialDigest);
});

test('a changed signed checksum list or detached signature is rejected', async () => {
  const altered = Buffer.from(checksums); altered[0] ^= 1;
  await assert.rejects(verifySignedChecksums(altered,signature));
  const badSignature = Buffer.from(signature); badSignature[badSignature.length-1] ^= 1;
  await assert.rejects(verifySignedChecksums(checksums,badSignature));
});

test('upstream checksum tampering is rejected before binary download or execution', async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'elitesand-ytdlp-signature-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const target=path.join(directory,'yt-dlp.exe');fs.writeFileSync(target,'trusted-old');
  const version='2026.11.04.232659';let binaries=0,executions=0;
  const changed=Buffer.from(checksums);changed[0]^=1;
  await assert.rejects(stageVerifiedRelease(target,{version,url:`https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/${version}/yt-dlp.exe`,
    digest:officialDigest,size:23587638,publishedAt:Date.parse('2026-11-05')},{
    fetchImpl:async url=>({ok:true,buffer:async()=>url.endsWith('.sig')?signature:url.endsWith('SHA2-256SUMS')?changed:(binaries++,Buffer.alloc(0))}),
    execImpl:async()=>{executions++;return {stdout:version};},
  }));
  assert.equal(binaries,0);assert.equal(executions,0);
  assert.equal(fs.readFileSync(target,'utf8'),'trusted-old');assert.deepEqual(fs.readdirSync(directory),['yt-dlp.exe']);
});
