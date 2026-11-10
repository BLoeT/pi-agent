import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, trimHistory, limitToolResult } from '../lib/context.js';

test('context trims large tool turns at user boundaries', () => {
  const history = [{role:'user',content:'old'}, {role:'assistant',content:[{type:'toolCall',id:'1'}]},
    {role:'toolResult',toolCallId:'1',content:'x'.repeat(15000)}, {role:'user',content:'recent'}, {role:'assistant',content:'ok'}];
  assert.deepEqual(trimHistory(history, 1000), history.slice(3));
  assert.equal(trimHistory(history, 10000), history);
});
test('image bytes do not inflate text estimate and images still count', () => {
  const small = [{role:'user',content:[{type:'image',data:'x'}]}];
  const big = [{role:'user',content:[{type:'image',data:'x'.repeat(100000)}]}];
  assert.equal(estimateTokens(small), estimateTokens(big));
  assert.ok(estimateTokens(big) > 4096);
});
test('single oversized latest turn is preserved', () => {
  const history = [{role:'user',content:'x'.repeat(30000)}];
  assert.equal(trimHistory(history, 1000), history);
});

test('large multi-part tool results stay bounded and keep the output tail', () => {
  const result = { content: [{type:'text',text:'a'.repeat(30000)+'END'}, {type:'text',text:'b'.repeat(30000)}] };
  const limited = limitToolResult(result, 1000);
  assert.ok(limited.content.reduce((n,p)=>n+p.text.length,0) <= 1000);
  assert.match(limited.content[0].text, /END$/);
  assert.equal(result.content[0].text.length, 30003);
});

test('request budget includes system/tools and preserves whole rounds and declarations', async () => {
  const { contextBudget, installContextBudget } = await import('../lib/context.js');
  const system = {role:'system',content:'Rules',toolsAdded:[{name:'example',parameters:{description:'x'.repeat(1200)}}]};
  const history = [system,{role:'user',content:'old '.repeat(1000)},
    {role:'assistant',content:[{type:'toolCall',id:'a'}]},
    {role:'toolResult',toolCallId:'a',content:'large '.repeat(1000)},
    {role:'user',content:'new question'},{role:'assistant',content:'answer'}];
  let delegated = false;
  const session = {model:{contextWindow:4096,maxTokens:2048},agent:{async transformContext(messages){delegated=true;return messages;}}};
  installContextBudget(session, () => {});
  const kept = await session.agent.transformContext(history);
  assert.equal(delegated,true);
  assert.equal(contextBudget(session.model),1024);
  assert.deepEqual(kept,[system,...history.slice(4)]);
  assert.equal(history.length,6);
  assert.equal(kept[0],system);
});

test('text fields named data count toward budget while image bytes do not', () => {
  const small=[{role:'toolResult',content:[{type:'text',text:'ok'}],details:{data:'x'}}];
  const large=[{...small[0],details:{data:'x'.repeat(12000)}}];
  assert.ok(estimateTokens(large)>estimateTokens(small)+3000);
});
