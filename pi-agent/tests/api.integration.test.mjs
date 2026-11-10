if (process.env.RIBO_TEST_ISOLATED !== '1') throw new Error('Tests nur in isolierten Containern mit tmpfs /workspace und RIBO_TEST_ISOLATED=1 ausführen');
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

test('real API denies unauthenticated downloads, traversal and identity changes', async () => {
  fs.mkdirSync('/workspace/users/enrico', { recursive: true });
  fs.mkdirSync('/workspace/users/bob', { recursive: true });
  fs.writeFileSync('/workspace/users/enrico/test.txt', 'own-file');
  fs.writeFileSync('/workspace/users/bob/test.txt', 'other-file');
  fs.writeFileSync('/tmp/test-users.json', JSON.stringify({ users: { enrico: { permissions: ['admin'] }, bob: { permissions: [] } }, groups: {} }));
  if(process.env.RIBO_LOCAL_MODEL_TEST==='1' && fs.existsSync('/app/plugins/send_message.js')) {
    fs.mkdirSync('/workspace/plugins',{recursive:true});
    fs.writeFileSync('/workspace/plugins/send_message.js','export {default} from "/app/plugins/send_message.js";');
    fs.writeFileSync('/workspace/plugins/send_message.meta.json',JSON.stringify({allowed_users:['enrico']}));
  }
  const token = 's'.repeat(48), password = 'p'.repeat(24);
  const child = spawn(process.execPath, ['/app/server.js'], { env: { ...process.env,
    USERS_CONFIG_PATH: '/tmp/test-users.json', RIBO_INTERNAL_TOKEN: token,
    RIBO_WEB_USER: 'enrico', RIBO_WEB_PASSWORD: password }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', x => { logs += x; }); child.stderr.on('data', x => { logs += x; });
  const root = 'http://127.0.0.1:8080';
  const headers = { Authorization: 'Basic ' + Buffer.from('enrico:' + password).toString('base64') };
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(logs);
      try { ready = (await fetch(root + '/health')).ok; } catch {}
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, logs);
    assert.equal((await fetch(root + '/files/enrico/test.txt')).status, 401);
    assert.equal(await (await fetch(root + '/files/enrico/test.txt', { headers })).text(), 'own-file');
    assert.equal((await fetch(root + '/files/bob/test.txt', { headers })).status, 403);
    assert.equal((await fetch(root + '/files/..%2F..%2F..%2Fetc/os-release', { headers })).status, 403);
    const post = (body, extra = {}) => ({ method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
    assert.equal((await fetch(root + '/reset', post({ user_id: 'bob' }))).status, 403);
    assert.equal((await fetch(root + '/reset', post({}, { Origin: 'https://evil.invalid' }))).status, 403);
    assert.equal((await fetch(root + '/prompt', post({ message: 'test', user_id: 'bob' }))).status, 403);
    assert.equal((await fetch(root + '/prompt', post({}))).status, 400);
    const invalid = await fetch(root + '/prompt', post({message:'test',thinking_level:'invalid'}));
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).request_id, invalid.headers.get('x-request-id'));
    assert.equal((await fetch(root + '/reset', post({}))).status, 200);
    const correlation='11111111-1111-4111-8111-111111111111';
    const correlated=await fetch(root+'/reset',post({user_id:'enrico'},{Authorization:`Bearer ${token}`,'X-Request-ID':correlation}));
    assert.equal(correlated.headers.get('x-request-id'),correlation);
    const browserCorrelation=await fetch(root+'/reset',post({},{'X-Request-ID':correlation}));
    assert.notEqual(browserCorrelation.headers.get('x-request-id'),correlation);

    assert.equal((await fetch(root + '/files/bob/test.txt', { headers: { Authorization: `Bearer ${token}` } })).status, 200);
    if (process.env.RIBO_LOCAL_MODEL_TEST === '1') {
      const response = await fetch(root + '/prompt', { ...post({ message: 'Antworte ausschließlich mit OK. Verwende keine Werkzeuge.' }), signal: AbortSignal.timeout(300000) });
      assert.equal(response.status, 200, await response.clone().text());
      const result = await response.json();
      assert.match(result.response.trim(), /^OK[.!]?$/i);
      if(fs.existsSync('/app/plugins/send_message.js')) {
        const scheduled=await fetch(root+'/prompt',{...post({message:'Lokaler Funktionstest: Rufe zwingend das Tool send_message mit user enrico und text TEST-NUR-LOKAL auf. Antworte danach kurz.',user_id:'enrico',delivery_mode:'scheduler'},{Authorization:`Bearer ${token}`}),signal:AbortSignal.timeout(300000)});
        assert.equal(scheduled.status,200,await scheduled.clone().text());
        const deferred=(await scheduled.json()).deliveries;
        assert.equal(deferred.length,1);assert.match(deferred[0],/(?:^|\n)TEST-NUR-LOKAL$/);
      }
      const image = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==';
      const vision = await fetch(root + '/prompt', { ...post({ message: 'Welche Farbe siehst du? Antworte kurz.', image_base64: image }), signal: AbortSignal.timeout(300000) });
      assert.equal(vision.status, 200, await vision.clone().text());
      assert.match((await vision.json()).response, /\brot(?:e[nsrm]?)?\b|\bred\b/i);
      const streamed = await fetch(root + '/prompt', { ...post({ message: 'Welche Farbe hat das Bild? Kurz, ohne Werkzeuge.', image_base64: image, stream: true }), signal: AbortSignal.timeout(300000) });
      assert.match(streamed.headers.get('content-type'), /text\/event-stream/);
      const events = (await streamed.text()).split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
      assert.ok(events.some(event => event.done));
      assert.match(events.find(event => event.done).full_text, /\brot(?:e[nsrm]?)?\b|\bred\b/i);
      const followup = await fetch(root + '/prompt', { ...post({ message: 'Antworte nur OK, ohne Werkzeuge.' }), signal: AbortSignal.timeout(300000) });
      assert.equal(followup.status, 200, await followup.clone().text());
      assert.match((await followup.json()).response.trim(), /^OK[.!]?$/i);
    }
    const html = await (await fetch(root + '/', { headers })).text();
    new Function(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  } finally { child.kill('SIGTERM'); }
});
