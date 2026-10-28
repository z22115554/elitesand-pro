'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const test = require('node:test');
const policy = require('../server/utils/socket-origin');

test('HTTP, CORS and WebSocket reject DNS names resembling private addresses', () => {
  for (const host of ['10.attacker.example', '192.168.attacker.example', '172.16.attacker.example',
    '169.254.attacker.example', 'fc-attacker.example', 'fd.attacker.example',
    'fe80.attacker.example', 'fea.attacker.example', 'feb.attacker.example', 'example.com']) {
    const authority = `${host}:3000`;
    assert.equal(policy.isPrivateAddress(host), false, host);
    assert.equal(policy.isAllowedHttpHost(authority), false, host);
    assert.equal(policy.isAllowedCorsOrigin(`http://${authority}`), false, host);
    assert.equal(policy.isAllowedSocketRequest({ headers: { host: authority, origin: `http://${authority}` } }), false, host);
    assert.equal(policy.isAllowedSocketRequest({ headers: { host: authority } }), false, host);
  }
});

test('valid loopback, private IPs, link-local IPs and machine names remain usable', () => {
  for (const host of ['localhost', '127.0.0.1', '127.0.0.2', '10.23.4.5', '192.168.0.1',
    '172.16.0.1', '172.31.255.254', '169.254.1.2', '[::1]', '[fc00::1]', '[fd12::abcd]', '[fe80::1]',
    os.hostname(), `${os.hostname()}.local`]) {
    const authority = `${host}:3000`;
    assert.equal(policy.isAllowedHttpHost(authority), true, host);
    assert.equal(policy.isAllowedCorsOrigin(`http://${authority}`), true, host);
    assert.equal(policy.isAllowedSocketRequest({ headers: { host: authority, origin: `http://${authority}` } }), true, host);
    assert.equal(policy.isAllowedSocketRequest({ headers: { host: authority } }), true, host);
  }
});

test('public IPs, malformed addresses and host parsing tricks stay rejected', () => {
  for (const host of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.1.1', '[2001:4860::1]',
    '10.999.0.1', '10.1.2.3.evil.example', 'evil@localhost', 'localhost/evil', 'localhost?evil']) {
    assert.equal(policy.isAllowedHttpHost(host), false, host);
  }
  assert.equal(policy.isAllowedSocketRequest({ headers: { host: 'localhost:3000', origin: 'http://localhost:3001' } }), false);
});
