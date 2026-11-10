if(process.env.RIBO_TEST_ISOLATED!=='1') throw Error('isolated test only');
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createSessionStore} from '/app/services/sessions.js';
import {createChatService} from '/app/services/chat.js';
import {loadConfig} from '/app/config.js';
fs.writeFileSync('/workspace/users.json',JSON.stringify({users:{memorylab:{personality:'Antworte knapp.'},othermemory:{}},groups:{}}));
fs.mkdirSync('/workspace/users/memorylab/memory',{recursive:true});
const file='/workspace/users/memorylab/memory/long_term.json';
fs.writeFileSync(file,JSON.stringify([{id:'core',text:'Die synthetische Prüfnummer ist BLAU-718.',core:true}]));
const original=globalThis.fetch;
const payloads=[];
globalThis.fetch=(url,options)=>{
 if(String(url).endsWith('/api/chat')&&options?.body){const body=JSON.parse(options.body);if(body.options?.num_predict!==1)payloads.push(body);}
 return original(url,options);
};
const sessions=createSessionStore(loadConfig());
const chat=createChatService({sessions,log(){}});
try {
 const prompt=async userId=>chat.prompt({userId,message:'Welche synthetische Prüfnummer ist gespeichert? Antworte nur mit der Nummer; keine Werkzeuge.',thinkingLevel:'off'});
 const first=await prompt('memorylab');assert.match(first.response,/BLAU-718/);
 const initial=await sessions.get('memorylab');
 assert.doesNotMatch(JSON.stringify(initial.agent.state.messages),/Die synthetische Prüfnummer ist BLAU-718/);
 await prompt('memorylab');
 const requests=payloads.filter(p=>JSON.stringify(p.messages).includes('BLAU-718'));
 assert.ok(requests.length>=2);
 for(const body of requests){
  const systems=body.messages.filter(m=>m.role==='system');
  assert.equal(systems.length,1);
  assert.equal(systems[0].content.split('Die synthetische Prüfnummer ist BLAU-718.').length-1,1);
  const user=body.messages.findLast(m=>m.role==='user');
  assert.doesNotMatch(JSON.stringify(user),/BLAU-718|Aktueller Nutzerkontext/);
 }
 chat.reset('memorylab'); // Simulates another fresh session, durable facts unchanged.
 assert.match((await prompt('memorylab')).response,/BLAU-718/);
 fs.writeFileSync(file,JSON.stringify([{id:'core',text:'Die synthetische Prüfnummer ist GRUEN-935.',core:true}]));
 assert.match((await prompt('memorylab')).response,/GRUEN-935/);
 fs.writeFileSync(file,'[]');
 await prompt('memorylab');
 assert.doesNotMatch(JSON.stringify(payloads.at(-1).messages.filter(m=>m.role==='system')),/BLAU-718|GRUEN-935/);
 await chat.prompt({userId:'othermemory',message:'Antworte nur OK, ohne Werkzeuge.',thinkingLevel:'off'});
 assert.doesNotMatch(JSON.stringify(payloads.at(-1)),/BLAU-718|GRUEN-935/);
 console.log(JSON.stringify({session_memory_verified:true,new_session_retains_core:true,updates_refreshed:true,deleted_core_removed_from_current_context:true,user_isolation:true,repeated_context_in_user_turns:false}));
} finally {await chat.close();}
