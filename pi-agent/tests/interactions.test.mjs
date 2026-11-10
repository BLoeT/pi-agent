if (process.env.RIBO_TEST_ISOLATED !== '1') throw Error('Isolated workspace required');
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runAsUser } from '../lib/users.js';
import { recordInteraction } from '../lib/interactions.js';
import { wrapTool } from '../services/tool-execution.js';

test('automatic habit log preserves ownership, bounded history and corrupt originals', async () => {
  const name = 'perfhabits';
  const directory = `/workspace/users/${name}/memory`;
  fs.mkdirSync(directory, { recursive: true });
  const file = `${directory}/habits_log.json`;
  fs.writeFileSync(file, JSON.stringify(Array.from({length:500}, () => ({ tool: 'notes' }))));
  await runAsUser(name, async () => recordInteraction('weather', new Date('2026-11-09T08:00:00Z')));
  const log = JSON.parse(fs.readFileSync(file));
  assert.equal(log.length, 500);
  assert.equal(log.at(-1).tool, 'weather');
  assert.equal(log.at(-1).timestamp, '2026-11-09T08:00:00.000Z');
  assert.deepEqual(Object.keys(log.at(-1)).sort(), ['hour','timestamp','tool','weekday']);
  fs.writeFileSync(file, '{broken');
  await assert.rejects(runAsUser(name, async () => recordInteraction('notes')));
  assert.equal(fs.readFileSync(file,'utf8'), '{broken');
  await assert.rejects(runAsUser('otherperf', async () => recordInteraction('../escape')));
});

test('tool wrapper logs once without a model call and logging failure cannot repeat an action', async () => {
  let executions = 0;
  const names = [];
  const tool = { name:'weather', async execute() { executions++; return {content:[{type:'text',text:'synthetic weather'}]}; } };
  const wrapped = wrapTool(tool,'perfwrap', name => names.push(name));
  const result = await wrapped.execute('id',{},new AbortController().signal);
  assert.equal(result.content[0].text, 'synthetic weather');
  assert.deepEqual(names,['weather']);
  await wrapTool(tool,'perfwrap', () => { throw Error('synthetic write failure'); }).execute('id',{});
  assert.equal(executions,2);
  await wrapTool({...tool,name:'memory'},'perfwrap', () => { throw Error('must not run'); }).execute('id',{});
  await assert.rejects(wrapTool({...tool,async execute(){throw Error('tool failure');}},'perfwrap', () => names.push('failed')).execute('id',{}));
  assert.deepEqual(names,['weather']);
});
