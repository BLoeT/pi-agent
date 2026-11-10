import test from 'node:test';
import assert from 'node:assert/strict';
import {RequestQueue} from '../services/request-queue.js';
import {configureModelRequests} from '../services/model-requests.js';
import {loadConfig} from '../config.js';

test('foreground overtakes queued background without starving background jobs', async()=>{
 const q=new RequestQueue(10),order=[];
 const active=await q.acquire('same');
 const acquire=(name,background=false)=>q.acquire('same',{background}).then(release=>{order.push(name);return release;});
 const bg=acquire('background',true),a=acquire('a'),b=acquire('b'),c=acquire('c');
 active();(await a)();(await b)();(await bg)();(await c)();
 assert.deepEqual(order,['a','b','background','c']);assert.equal(q.pending('same'),0);
});

test('aborted queued work releases capacity immediately and cannot bypass active work',async()=>{
 const q=new RequestQueue(2),active=await q.acquire('one');
 const controller=new AbortController();
 const cancelled=assert.rejects(q.acquire('one',{signal:controller.signal}),e=>e.name==='AbortError');
 controller.abort();await cancelled;assert.equal(q.pending('one'),1);
 let entered=false;const waiting=q.acquire('one').then(release=>{entered=true;return release;});
 await Promise.resolve();assert.equal(entered,false);active();(await waiting)();assert.equal(q.pending('one'),0);
});

test('model gate releases on stream completion, keeps smaller limits and prioritizes chat',async()=>{
 const q=new RequestQueue(8),calls=[],finish=[];
 const runtime={async streamSimple(model,context,options){calls.push(options);let resolve;const done=new Promise(r=>resolve=r);finish.push(resolve);return {result:()=>done};}};
 let background=false;
 configureModelRequests(runtime,q,8192,{meta:()=>({scheduled:background}),log(){}});
 const first=await runtime.streamSimple({maxTokens:16384},{},{});
 background=true;const bg=runtime.streamSimple({maxTokens:16384},{},{});
 background=false;const fg=runtime.streamSimple({maxTokens:16384},{},{maxTokens:128});
 assert.equal(calls.length,1);finish[0]();await fg;
 assert.equal(calls[1].maxTokens,128);finish[1]();await bg;
 assert.equal(calls[2].maxTokens,8192);finish[2]();await first.result();
});

test('failed model setup releases the gate and config rejects invalid output limits',async()=>{
 const runtime={async streamSimple(){throw Error('synthetic setup');}};
 const q=new RequestQueue(2);configureModelRequests(runtime,q,4096,{meta:()=>({scheduled:false}),log(){}});
 await assert.rejects(runtime.streamSimple({},{},{}),/synthetic/);assert.equal(q.pending('model'),0);
 const env={RIBO_INTERNAL_TOKEN:'i'.repeat(48),RIBO_WEB_PASSWORD:'p'.repeat(24)};
 assert.equal(loadConfig(env).maxOutputTokens,8192);
 assert.throws(()=>loadConfig({...env,RIBO_MAX_OUTPUT_TOKENS:'no'}));
 assert.throws(()=>loadConfig({...env,RIBO_MAX_OUTPUT_TOKENS:'0'}));
});

test('a genuinely exhausted output limit is visible instead of silently returning a partial answer',async()=>{
 const {collectResponse}=await import('../services/response.js');let listener;const events=[];
 const session={subscribe(fn){listener=fn;return ()=>{};},async prompt(){
  listener({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'Partial'}});
  listener({type:'message_end',message:{role:'assistant',stopReason:'length',content:[{type:'text',text:'Partial'}]}});
 }};
 const result=await collectResponse(session,'test',{onEvent:event=>events.push(event)});
 assert.equal(result.truncated,true);assert.match(result.response,/Antwortlimit erreicht/);assert.match(events.at(-1).delta,/Antwortlimit/);
});

test('negative or invalid provider limits cannot bypass the configured ceiling',async()=>{
 const optionsSeen=[];
 const runtime={async streamSimple(_model,_context,options){optionsSeen.push(options);return {result:()=>Promise.resolve()};}};
 configureModelRequests(runtime,new RequestQueue(4),8192,{meta:()=>({scheduled:false}),log(){}});
 await runtime.streamSimple({maxTokens:-1},{},{maxTokens:-1});
 await runtime.streamSimple({maxTokens:4096},{},{maxTokens:NaN});
 assert.equal(optionsSeen[0].maxTokens,8192);assert.equal(optionsSeen[1].maxTokens,4096);
});
