/** Opt-in real Ollama/SDK check. Only disposable workspace and inert tools. */
if(process.env.RIBO_TEST_ISOLATED!=='1'||process.env.RIBO_MODEL_SWITCH_TEST!=='1')throw Error('Explicit isolated model test required');
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createSessionStore} from '/app/services/sessions.js';
import {createChatService} from '/app/services/chat.js';
import {loadConfig} from '/app/config.js';
import {runAsUser} from '/app/lib/users.js';
const initial='qwen3.8-27b-64k:latest',alternative='qwen3.8:27b-mlx',userId='modeltest';
fs.writeFileSync('/workspace/users.json',JSON.stringify({users:{[userId]:{permissions:[]}},groups:{}}));
const native=globalThis.fetch,wire=[];
globalThis.fetch=async(url,options={})=>{
 const parsed=new URL(String(url));
 if(parsed.hostname!=='host.docker.internal'||parsed.port!=='11434')throw Error('Only local Ollama allowed');
 if(parsed.pathname==='/api/chat')wire.push(JSON.parse(options.body).model);
 return native(url,options);
};
const sessions=createSessionStore(loadConfig(),[],{baseTools:[]});
const chat=createChatService({sessions,prepare:(_id,text)=>text,log(){}});
try{
 const list=await sessions.listModels(userId,true);
 assert.ok(list.models.some(m=>m.id===initial));assert.ok(list.models.some(m=>m.id===alternative));
 const prompt=message=>runAsUser(userId,()=>chat.prompt({userId,message,thinkingLevel:'off',signal:AbortSignal.timeout(180000)}));
 await prompt('Die Testzahl für diesen Chat ist 314159. Antworte nur OK. Verwende keine Werkzeuge.');
 const before=await sessions.get(userId);const history=structuredClone(before.agent.state.messages);
 await chat.setModel(userId,alternative);
 assert.equal(await sessions.get(userId),before);assert.deepEqual(before.agent.state.messages,history);
 const answer=await prompt('Welche Testzahl habe ich dir gerade genannt? Antworte nur mit der Zahl.');
 assert.match(answer.response,/314159/);assert.equal(wire.at(-1),alternative);assert.equal(wire[0],initial);
 await chat.setModel(userId,initial);
 console.log(JSON.stringify({real_ollama_switch_verified:true,history_preserved:true,followup_recalled_test_number:true,models:[initial,alternative],only_synthetic_user:true}));
}finally{await chat.close();globalThis.fetch=native;}
