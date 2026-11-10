import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestQueue } from '../services/request-queue.js';
import { createChatService } from '../services/chat.js';
import { collectResponse, stripThinking } from '../services/response.js';
import { loadConfig } from '../config.js';
import { validatePrompt } from '../http/chat-routes.js';
import { clientError, HttpError, redact } from '/shared/errors.js';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('per-user queue preserves FIFO, isolates users, and cleans up after release', async () => {
  const queue = new RequestQueue(3);
  const first = await queue.acquire('alice');
  const order = [];
  const second = queue.acquire('alice').then(release => { order.push(2); return release; });
  const third = queue.acquire('alice').then(release => { order.push(3); return release; });
  const other = await queue.acquire('bob');
  assert.equal(queue.pending('alice'), 3);
  await assert.rejects(queue.acquire('alice'), error => error.status === 429);
  other(); first(); first();
  const releaseSecond = await second;
  assert.deepEqual(order, [2]);
  releaseSecond(); (await third)();
  assert.deepEqual(order, [2, 3]);
  assert.equal(queue.pending('alice'), 0);
  assert.equal(queue.pending('bob'), 0);
});

test('shutdown rejects queued and new requests without leaving queue entries', async () => {
  const queue = new RequestQueue();
  const release = await queue.acquire('alice');
  const waiting = assert.rejects(queue.acquire('alice'), error => error.status === 503);
  queue.close(); release();
  await waiting;
  await assert.rejects(queue.acquire('bob'), error => error.status === 503);
  assert.equal(queue.pending('alice'), 0);
});

test('response adapter emits text/tools and always removes its subscription', async () => {
  let listener, removed = 0, attachment;
  const events = [];
  const session = {
    subscribe(fn) { listener = fn; return () => removed++; },
    async prompt(_text, options) {
      attachment = options;
      listener({ type: 'tool_execution_start', toolName: 'notes', args: { action: 'list' } });
      listener({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'reason' } });
      listener({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Answer' } });
    },
  };
  const result = await collectResponse(session, 'test', { image: 'iVBORsynthetic', onEvent: event => events.push(event) });
  assert.equal(result.response, 'Answer');
  assert.equal(result.thinking, 'reason');
  assert.equal(attachment.images[0].mimeType, 'image/png');
  assert.equal(events[0].tool_call.name, 'notes');
  assert.equal(removed, 1);
  session.prompt = async () => { throw Error('synthetic failure'); };
  await assert.rejects(collectResponse(session, 'test'), /synthetic/);
  assert.equal(removed, 2);
  assert.equal(stripThinking('<thinking>private</thinking>Public'), 'Public');
});

test('chat cancellation releases the session and shutdown blocks further work', async () => {
  let resolvePrompt, entered, disposed = false;
  const ready = new Promise(resolve => { entered = resolve; });
  const session = {
    agent: { state: { messages: [] } },
    subscribe() { return () => {}; },
    prompt() { entered(); return new Promise(resolve => { resolvePrompt = resolve; }); },
    async abort() { resolvePrompt(); },
  };
  const chat = createChatService({
    sessions: { get: async () => session, reset() {}, dispose() { disposed = true; } },
    prepare: (_id, text) => text,
    log() {},
  });
  const failed = assert.rejects(chat.prompt({ userId: 'alice', message: 'test' }), error => error.name === 'AbortError');
  await ready;
  assert.throws(() => chat.reset('alice'), error => error.status === 409);
  assert.equal(await chat.cancel('alice'), true);
  await failed;
  assert.equal(await chat.cancel('alice'), false);
  chat.reset('alice');
  await chat.close();
  assert.equal(disposed, true);
  await assert.rejects(chat.prompt({ userId: 'alice', message: 'test' }), error => error.status === 503);
});

test('configuration and prompt validation reject bad values before model work', () => {
  const env = { RIBO_INTERNAL_TOKEN: 't'.repeat(48), RIBO_WEB_PASSWORD: 'p'.repeat(24) };
  const config = loadConfig(env);
  assert.equal(config.model, 'qwen3.8-27b-64k:latest');
  assert.equal(config.thinkingLevel, 'low');
  assert.equal(Object.isFrozen(config), true);
  assert.throws(() => loadConfig({ ...env, RIBO_AGENT_PORT: 'NaN' }));
  assert.throws(() => loadConfig({ ...env, LLM_PROVIDER: 'unknown' }));
  assert.throws(() => loadConfig({ ...env, LLM_PROVIDER: 'anthropic' }));
  assert.throws(() => validatePrompt({ message: 'test', stream: 'true' }, config));
  assert.throws(() => validatePrompt({ message: 'test', image_base64: '../escape' }, config));
  assert.equal(validatePrompt({ message: 'test' }, config).stream, false);
  assert.equal(validatePrompt({ message: 'test', thinking_level: 'off' }, config).thinkingLevel, 'off');
  assert.equal(validatePrompt({ message: 'test', thinking_level: 'medium' }, config).thinkingLevel, 'medium');
});

test('public errors do not expose internal details or credentials', () => {
  assert.equal(clientError(Error('/private/internal/path')).body.error.includes('/private'), false);
  assert.equal(clientError(new HttpError(429, 'busy')).status, 429);
  assert.equal(redact('https://api.telegram.org/bot123:ABC/sendMessage Bearer SECRET'), 'https://api.telegram.org/bot[REDACTED]/sendMessage Bearer [REDACTED]');
});

test('chat telemetry separates queue, session, thinking, text and tool time without content', async () => {
  let clock = 0, listener;
  const logs = [];
  const session = {
    agent: { state: { messages: [] } },
    subscribe(fn) { listener = fn; return () => {}; },
    async prompt() {
      clock += 3;
      listener({ type: 'message_start', message: { role: 'assistant' } });
      listener({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'private reasoning' } });
      clock += 7;
      listener({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'private answer' } });
      listener({ type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'secret-tool', args: { secret: 'private input' } });
      clock += 20;
      listener({ type: 'tool_execution_end', toolCallId: 'call-1', result: 'private result' });
    },
  };
  const chat = createChatService({
    sessions: { async get() { clock += 10; return session; }, dispose() {} },
    prepare: (_id, text) => text, now: () => clock, log: line => logs.push(line),
  });
  await chat.prompt({ userId: 'alice', requestId: 'request-1', message: 'private prompt' });
  const event = JSON.parse(logs[0]);
  assert.equal(event.queue_ms, 0);
  assert.equal(event.session_ms, 10);
  assert.equal(event.first_thinking_ms, 13);
  assert.equal(event.first_text_ms, 20);
  assert.equal(event.tool_ms, 20);
  assert.equal(event.total_ms, 40);
  assert.equal(event.model_rounds, 1);
  assert.equal(event.tool_calls, 1);
  assert.equal(event.outcome, 'ok');
  assert.equal(event.request_id, 'request-1');
  assert.doesNotMatch(logs[0], /private|secret-tool|alice/);
  await chat.close();
});

test('queued time contributes to total latency and broken telemetry cannot break replies', async () => {
  let clock = 0, finish, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  let calls = 0;
  const logs = [];
  const session = { agent: { state: { messages: [] } }, subscribe() { return () => {}; },
    async prompt() { if (++calls === 1) { entered(); await new Promise(resolve => { finish = resolve; }); } } };
  const chat = createChatService({ sessions: { get: async () => session, dispose() {} },
    prepare: (_id, text) => text, now: () => clock,
    log(line) { logs.push(JSON.parse(line)); throw Error('synthetic logging failure'); } });
  const first = chat.prompt({ userId: 'alice', message: 'first' });
  await ready;
  const second = chat.prompt({ userId: 'alice', message: 'second' });
  clock = 50;
  finish();
  await Promise.all([first, second]);
  assert.equal(logs[1].queue_ms, 50);
  assert.equal(logs[1].total_ms, 50);
  assert.equal(logs[1].ms, 0);
  await chat.close();
});
