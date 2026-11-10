import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServiceClient } from '../client.js';
import { createMessenger } from '../messenger.js';
import { createMessageHandler } from '../handlers.js';
import { loadConfig } from '../config.js';
import { savePhoto } from '../inbox.js';

const config = loadConfig({ TELEGRAM_BOT_TOKEN: 'synthetic-token', RIBO_INTERNAL_TOKEN: 'i'.repeat(48) });
class InputFile { constructor(data, meta) { this.data = data; this.meta = meta; } }
const fakeBot = () => {
  const sent = [];
  const api = Object.fromEntries(['sendMessage', 'sendDocument', 'sendPhoto', 'sendVoice', 'sendChatAction'].map(name => [name, async value => sent.push({ name, ...value })]));
  api.getFile = async () => ({ file_path: 'photos/test.jpg', file_size: 3 });
  return { api, sent };
};

test('transport preserves scheduled delivery and only attaches internal credentials to own services', async () => {
  const bot = fakeBot(), requests = [];
  const client = createServiceClient(config, { bot, fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return new Response(url.includes('api.telegram.org') ? 'abc' : JSON.stringify({ response: 'summary', deliveries: ['full'] }));
  } });
  assert.deepEqual(await client.sendToAgent('test', 'alice', null, { scheduled: true }), { response: 'summary', deliveries: ['full'] });
  assert.equal(JSON.parse(requests[0].options.body).delivery_mode, 'scheduler');
  assert.match(requests[0].options.headers.Authorization, /^Bearer /);
  assert.equal((await client.downloadTelegramFile('file')).toString(), 'abc');
  assert.equal(requests[1].options.headers?.Authorization, undefined);
  client.close();
  assert.equal(client.closed, true);
  assert.equal(requests[0].options.signal.aborted, true);
});

test('large replies are one correctly named document and cross-user markers are not downloaded', async () => {
  const bot = fakeBot(); let downloads = 0;
  const client = { closed: false, async downloadAttachment() { downloads++; return Buffer.from('x'); }, async textToSpeech() { throw Error('synthetic offline'); } };
  const messenger = createMessenger({ bot, client, InputFile, getUserIdForChat: () => 'alice' });
  await messenger.scheduled({ chat_id: 1 }, 'a'.repeat(5000));
  assert.equal(bot.sent.length, 1);
  assert.equal(bot.sent[0].name, 'sendDocument');
  assert.equal(bot.sent[0].document.meta.filename, 'Ribo-Nachricht.txt');
  await messenger.reply(1, 'Hello [FILE:bob:private.txt]', 2);
  assert.equal(downloads, 0);
  assert.equal(bot.sent.filter(item => item.name === 'sendMessage').length, 1);
  await messenger.reply(1, '[IMAGE:alice:generated-images/test.png]', 3);
  assert.equal(downloads, 1);
  assert.equal(bot.sent.some(item => item.name === 'sendPhoto'), true);
});

test('handlers authorize before agent work and route reset/mode through injected services', async () => {
  const bot = fakeBot(); let prompts = 0, resets = 0;
  const client = { closed: false, thinkingModes: new Map(), async sendToAgent() { prompts++; return 'answer'; }, async reset() { resets++; } };
  const users = { isAuthorized: chat => chat === 1, getUserIdForChat: () => 'alice', getUserByChatId: () => ({ name: 'Alice' }) };
  const handler = createMessageHandler({ bot, users, client, messenger: { reply: async () => {} }, checkHabitConfirmation: () => false });
  await handler({ message: { text: 'private', message_id: 1 }, chat: { id: 2 } });
  assert.equal(prompts, 0);
  await handler({ message: { text: '/modus gruendlich', message_id: 2 }, chat: { id: 1 } });
  assert.equal(client.thinkingModes.get('alice'), 'medium');
  await handler({ message: { text: '/modus schnell', message_id: 3 }, chat: { id: 1 } });
  assert.equal(client.thinkingModes.get('alice'), 'off');
  await handler({ message: { text: '/reset', message_id: 3 }, chat: { id: 1 } });
  assert.equal(resets, 1);
  await handler({ message: { text: 'hello', message_id: 4 }, chat: { id: 1 } });
  assert.equal(prompts, 1);
});

test('inbox rejects traversal and symlinks; filenames do not collide', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ribo-inbox-'));
  try {
    const first = savePhoto('alice', Buffer.from('photo'), root);
    const second = savePhoto('alice', Buffer.from('photo'), root);
    assert.notEqual(first, second);
    assert.throws(() => savePhoto('../bob', Buffer.from('photo'), root));
    fs.mkdirSync(path.join(root, 'users/bob'));
    fs.symlinkSync(path.join(root, 'users/alice/telegram-inbox'), path.join(root, 'users/bob/telegram-inbox'));
    assert.throws(() => savePhoto('bob', Buffer.from('photo'), root));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
