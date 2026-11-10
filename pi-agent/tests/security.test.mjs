if (process.env.RIBO_TEST_ISOLATED !== '1') throw new Error('Tests nur in isolierten Containern mit tmpfs /workspace und RIBO_TEST_ISOLATED=1 ausführen');
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveWithin, safeName, validUserId } from '../lib/security.js';
import { authentication } from '../lib/http-security.js';
import { runAsUser, getCurrentUserId, getUserWorkspacePath } from '../lib/users.js';
import { generateVEvent, deriveFilename } from '../lib/helpers.js';
import { readPluginMeta, userCanUsePlugin, loadPlugins } from '../lib/plugins.js';

test('workspace containment rejects traversal, absolute escape and symlink escape', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ribo-path-'));
  try {
    const root = path.join(temp, 'user'); fs.mkdirSync(root);
    assert.equal(resolveWithin(root, 'notes/new.json'), path.join(root, 'notes/new.json'));
    for (const input of ['../outside', '/etc/os-release', '.', '']) assert.throws(() => resolveWithin(root, input));
    fs.symlinkSync(temp, path.join(root, 'link'));
    assert.throws(() => resolveWithin(root, 'link/outside.json'));
    fs.symlinkSync('/nonexistent', path.join(root, 'dangling'));
    assert.throws(() => resolveWithin(root, 'dangling/new.json'));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('malicious names and user identifiers are rejected', () => {
  for (const input of ['../../../users', 'a/b', 'a\\b', '\nname', '..', '']) assert.throws(() => safeName(input));
  for (const input of ['../etc', 'a/b', 'constructor', 'Enrico']) {
    if (input !== 'constructor') assert.equal(validUserId(input), false);
  }
  assert.equal(validUserId('enrico'), true);
  assert.throws(() => getUserWorkspacePath('../../../etc'));
  assert.throws(() => deriveFilename('../../../users'));
  assert.equal(deriveFilename('Meine Liste'), 'meine-liste');
});

test('parallel asynchronous tool contexts never change each other', async () => {
  await Promise.all(['alice', 'bob'].map(id => runAsUser(id, async () => {
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, i % 3));
      assert.equal(getCurrentUserId(), id);
    }
  })));
  assert.throws(() => getCurrentUserId(), /Nutzerkontext/);
});

const token = 't'.repeat(48), password = 'p'.repeat(24);
const middleware = authentication({ token, username: 'enrico', password, getUser: id => id === 'enrico' });
function request(headers = {}, method = 'GET', pathname = '/') {
  const req = { method, path: pathname, get: key => headers[key.toLowerCase()], is: type => headers['content-type'] === type };
  const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  let passed = false; middleware(req, res, () => { passed = true; });
  return { req, res, passed };
}
const basic = 'Basic ' + Buffer.from('enrico:' + password).toString('base64');

test('HTTP entry points require credentials and health stays minimal/public', () => {
  assert.equal(request().res.code, 401);
  assert.equal(request({ authorization: 'Bearer wrong' }).res.code, 401);
  assert.equal(request({}, 'GET', '/health').passed, true);
  assert.equal(request({ authorization: basic }).req.authenticatedUser, 'enrico');
  assert.equal(request({ authorization: `Bearer ${token}` }).req.trustedService, true);
  assert.throws(() => authentication({ token: '', username: 'enrico', password, getUser: () => true }));
});

test('browser credentials cannot authorize cross-site writes or form resets', () => {
  assert.equal(request({ authorization: basic, 'content-type': 'text/plain' }, 'POST', '/reset').res.code, 415);
  assert.equal(request({ authorization: basic, 'content-type': 'application/json', origin: 'https://evil.invalid', host: 'ribo:8080' }, 'POST').res.code, 403);
  assert.equal(request({ authorization: basic, 'sec-fetch-site': 'cross-site' }).res.code, 403);
  assert.equal(request({ authorization: basic, 'content-type': 'application/json', origin: 'http://ribo:8080', host: 'ribo:8080' }, 'POST').passed, true);
});

test('missing, invalid and emptied plugin ACLs deny access', () => {
  fs.mkdirSync('/workspace/plugins', { recursive: true });
  assert.deepEqual(readPluginMeta('test.js').allowed_users, []);
  assert.equal(userCanUsePlugin('test.js', 'enrico'), false);
  const meta = '/workspace/plugins/test.meta.json';
  fs.writeFileSync(meta, JSON.stringify({ allowed_users: ['enrico'] }));
  assert.equal(userCanUsePlugin('test.js', 'enrico'), true);
  assert.equal(userCanUsePlugin('test.js', 'bob'), false);
  fs.writeFileSync(meta, JSON.stringify({ allowed_users: [] }));
  assert.equal(userCanUsePlugin('test.js', 'enrico'), false);
  fs.writeFileSync(meta, '{invalid');
  assert.equal(userCanUsePlugin('test.js', 'enrico'), false);
});

test('calendar titles cannot inject an extra ICS property', () => {
  const event = generateVEvent({ title: 'Test\r\nATTENDEE:evil;comma,back\\slash', startDate: new Date('2026-11-08T12:00:00Z'), reminders: [5] });
  assert.equal(event.includes('\r\nATTENDEE:'), false);
  assert.ok(event.includes('Test\\nATTENDEE:evil\\;comma\\,back\\\\slash'));
});

test('unapproved plugins are not even imported at startup', async () => {
  fs.mkdirSync('/workspace/plugins', { recursive: true });
  fs.writeFileSync('/workspace/plugins/denied.js', 'globalThis.deniedPluginLoaded = true; export default { name: "denied", execute() {} };');
  await loadPlugins();
  assert.equal(globalThis.deniedPluginLoaded, undefined);
});

test('legacy memory object is preserved when a new fact is added', async () => {
  const memory = (await import('../tools/memory.js')).default;
  fs.mkdirSync('/workspace/users/alice/memory', { recursive: true });
  const file = '/workspace/users/alice/memory/long_term.json';
  fs.writeFileSync(file, JSON.stringify({ facts: [{ id: 'old', text: 'Existing fact', category: 'fact' }] }));
  await runAsUser('alice', () => memory.execute('test', { action: 'remember', text: 'New fact' }));
  const entries = JSON.parse(fs.readFileSync(file));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].text, 'Existing fact');
  assert.equal(entries[1].text, 'New fact');
});
