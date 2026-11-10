import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createPreferences} from '../preferences.js';
import {createPreview,previewText} from '../preview.js';
import {readAgentStream} from '../stream.js';
import {createServiceClient} from '../client.js';
import {createMessageHandler} from '../handlers.js';
import {createMessenger} from '../messenger.js';
import {createTrace} from '../trace.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'ribo-telegram-'));try{return fn(root);}finally{fs.rmSync(root,{recursive:true,force:true});}}

test('voice and preview settings persist per user and reject corrupt/symlinked data',()=>fixture(root=>{
 const prefs=createPreferences(root);assert.deepEqual(prefs.get('alice'),{voice:true,preview:true});
 prefs.set('alice','voice',false);assert.equal(createPreferences(root).get('alice').voice,false);
 assert.equal(prefs.get('bob').voice,true);assert.throws(()=>prefs.get('../escape'));
 const file=path.join(root,'users/alice/telegram-settings.json');fs.writeFileSync(file,'{broken');
 assert.throws(()=>prefs.set('alice','voice',true));assert.equal(fs.readFileSync(file,'utf8'),'{broken');
 fs.mkdirSync(path.join(root,'users/bob'),{recursive:true});fs.symlinkSync(file,path.join(root,'users/bob/telegram-settings.json'));
 assert.throws(()=>prefs.get('bob'));
}));

test('SSE survives one-byte UTF-8 chunks and exposes only text deltas',async()=>{
 const deltas=[];
 const encoded=new TextEncoder().encode('data: {"thinking":"private"}\n\ndata: {"delta":"Grüße"}\n\ndata: {"tool_call":{"name":"private"}}\n\ndata: {"done":true,"full_text":"Grüße"}\n\ndata: [DONE]\n\n');
 const body=new ReadableStream({start(c){for(const byte of encoded)c.enqueue(Uint8Array.of(byte));c.close();}});
 assert.equal((await readAgentStream(new Response(body),delta=>deltas.push(delta))).response,'Grüße');
 assert.deepEqual(deltas,['Grüße']);
 await assert.rejects(readAgentStream(new Response('data: {"delta":"partial"}\n\n')),/Abschluss/);
 await assert.rejects(readAgentStream(new Response('data: {"error":"safe failure"}\n\n')));
});

test('preview uses ephemeral throttled drafts, hides markers and never sends persistent messages',async()=>{
 let clock=0,next=1;const timers=new Map(),sent=[];
 const bot={api:{async sendMessageDraft(value){sent.push(value);}}};
 const preview=createPreview({bot,chatId:1,now:()=>clock,interval:1200,startDelay:0,
  schedule:fn=>{const id=next++;timers.set(id,fn);return id;},unschedule:id=>timers.delete(id)});
 const fire=async()=>{const entry=timers.entries().next().value;if(entry){timers.delete(entry[0]);entry[1]();await tick();}};
 preview.push('One');preview.push(' two');assert.equal(timers.size,1);await fire();assert.equal(sent[0].text,'One two');
 preview.push(' three');preview.push(' four');assert.equal(timers.size,1);clock=1200;await fire();assert.equal(sent[1].text,'One two three four');
 preview.push(' five');await preview.close();assert.equal(timers.size,0);assert.equal(sent.length,2);
 assert.equal(previewText('Visible [FILE:alice:private/path]'),'Visible');
 assert.equal(previewText('Visible [IM'),'Visible');
 assert.equal(previewText('<thinking>secret</thinking>Public'),'Public');
});

test('short answers cancel pending preview and draft failure cannot fail the final answer',async()=>{
 let draft=0;const bot={api:{async sendMessageDraft(){draft++;throw Error('unsupported');}}};
 const short=createPreview({bot,chatId:1,startDelay:10000});short.push('answer');await short.close();assert.equal(draft,0);
 const preview=createPreview({bot,chatId:1,startDelay:0});preview.push('answer');await new Promise(r=>setTimeout(r,10));await preview.close();assert.equal(draft,1);
});

test('interactive transport streams with correlation while scheduled calls remain JSON',async()=>{
 const requests=[];
 const client=createServiceClient({internalToken:'test',agentUrl:'http://agent',agentTimeout:1000},{fetchImpl:async(url,options)=>{
  requests.push(options);return JSON.parse(options.body).stream ? new Response('data: {"delta":"Hello"}\n\ndata: {"done":true,"full_text":"Hello"}\n\n',{headers:{'content-type':'text/event-stream'}}) : new Response('{"response":"summary","deliveries":["full"]}');
 }});
 const deltas=[];
 assert.equal(await client.sendToAgent('test','alice',null,{requestId:'opaque-id',onDelta:x=>deltas.push(x)}),'Hello');
 assert.equal(requests[0].headers['X-Request-ID'],'opaque-id');assert.deepEqual(deltas,['Hello']);
 assert.deepEqual(await client.sendToAgent('test','alice',null,{scheduled:true}),{response:'summary',deliveries:['full']});
 assert.equal(JSON.parse(requests[1].body).stream,undefined);client.close();
});

test('voice off skips TTS, text is delivered once and timings contain no message content',async()=>{
 let clock=0,tts=0;const logs=[],sent=[];
 const bot={api:{async sendMessage(x){clock+=2;sent.push(x);},async sendChatAction(){}}};
 const client={closed:false,thinkingModes:new Map(),async sendToAgent(_message,_user,_image,options){clock+=10;options.onDelta('PRIVATE-ANSWER');return 'PRIVATE-ANSWER';},async textToSpeech(){tts++;return Buffer.from('audio');}};
 const trace=createTrace('text',{now:()=>clock,log:x=>logs.push(x)});
 const messenger=createMessenger({bot,client,InputFile:class {},getUserIdForChat:()=> 'alice'});
 await messenger.reply(1,'PRIVATE-ANSWER',2,{voice:false,trace});trace.finish();
 assert.equal(tts,0);assert.equal(sent.length,1);assert.doesNotMatch(logs[0],/PRIVATE-ANSWER|alice/);
 const prefs={value:{voice:true,preview:true},get(){return this.value;},set(_id,key,value){this.value[key]=value;return this.value;}};
 const handler=createMessageHandler({bot,client,messenger,preferences:prefs,users:{isAuthorized:()=>true,getUserIdForChat:()=> 'alice'},checkHabitConfirmation:()=>false,traceOptions:{log:x=>logs.push(x),now:()=>clock}});
 await handler({chat:{id:1,type:'private'},message:{message_id:3,text:'/audio aus'}});
 assert.equal(prefs.value.voice,false);
 await handler({chat:{id:1,type:'private'},message:{message_id:4,text:'PRIVATE-QUESTION'}});
 assert.equal(tts,0);assert.equal(sent.filter(x=>x.text==='PRIVATE-ANSWER').length,2);
 const timing=JSON.parse(logs.at(-1));assert.equal(timing.agent_ms,10);assert.equal(timing.first_text_delta_ms,10);
 assert.doesNotMatch(logs.at(-1),/PRIVATE-QUESTION|PRIVATE-ANSWER|alice/);
});

test('unauthorized chats cannot change audio or preview settings',async()=>{
 let writes=0;
 const handler=createMessageHandler({bot:{api:{async sendMessage(){}}},client:{closed:false},messenger:{},
  users:{isAuthorized:()=>false},preferences:{set(){writes++;}},checkHabitConfirmation:()=>false});
 await handler({chat:{id:999,type:'private'},message:{text:'/audio aus',message_id:1}});
 await handler({chat:{id:999,type:'private'},message:{text:'/vorschau aus',message_id:2}});
 assert.equal(writes,0);
});

test('composed Telegram flow correlates transport with first text, final delivery and total duration',async()=>{
 let clock=0;const logs=[],requests=[],messages=[];
 const bot={api:{async sendChatAction(){},async sendMessage(value){clock+=2;messages.push(value);}}};
 const client=createServiceClient({internalToken:'synthetic',agentUrl:'http://agent',agentTimeout:1000},{bot,fetchImpl:async(_url,options)=>{
  requests.push(options);clock+=5;
  return new Response('data: {"thinking":"private"}\n\ndata: {"delta":"Ready"}\n\ndata: {"done":true,"full_text":"Ready"}\n\n',{headers:{'content-type':'text/event-stream'}});
 }});
 const messenger=createMessenger({bot,client,InputFile:class{},getUserIdForChat:()=> 'alice'});
 const handler=createMessageHandler({bot,client,messenger,users:{isAuthorized:()=>true,getUserIdForChat:()=> 'alice'},
  preferences:{get:()=>({voice:false,preview:false})},checkHabitConfirmation:()=>false,traceOptions:{now:()=>clock,log:value=>logs.push(JSON.parse(value))}});
 await handler({chat:{id:1,type:'private'},message:{text:'synthetic prompt',message_id:1}});
 assert.equal(messages.length,1);assert.equal(messages[0].text,'Ready');assert.equal(requests.length,1);
 assert.equal(requests[0].headers['X-Request-ID'],logs[0].request_id);
 assert.equal(logs[0].first_text_delta_ms,5);assert.equal(logs[0].agent_ms,5);assert.equal(logs[0].text_sent_ms,7);assert.equal(logs[0].total_ms,7);
 assert.doesNotMatch(JSON.stringify(logs),/private|synthetic prompt|alice/);client.close();
});
