/** Opt-in real Qwen evaluation. ONLY disposable container, tmpfs /workspace, no production tokens. */
if(process.env.RIBO_TEST_ISOLATED!=='1' || process.env.RIBO_TOOL_EVAL!=='1') throw Error('Explicit isolated model evaluation required');
import fs from 'node:fs';
import assert from 'node:assert/strict';
import ical from 'node-ical';
import {createSessionStore} from '/app/services/sessions.js';
import {createChatService} from '/app/services/chat.js';
import {loadConfig} from '/app/config.js';
import {coreTools} from '/app/tools/index.js';
import reminders from '/app/plugins/reminders.js';
import sendMessage from '/app/plugins/send_message.js';
import {runAsUser,ensureUserWorkspace} from '/app/lib/users.js';

const modes=(process.env.RIBO_EVAL_MODES || 'off,low').split(',');
if(modes.some(mode=>!['off','low'].includes(mode)))throw Error('Invalid evaluation mode');
const selected=process.env.RIBO_EVAL_CASES?.split(',');
const allowed=new Set(['lists','calendar','memory','flashcards','files']);
const results=[],requests=[],wire=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=(url,options)=>{
 const target=new URL(String(url));
 if(target.hostname!=='host.docker.internal' || target.port!=='11434')throw Error('External network forbidden in evaluation');
 if(target.pathname==='/api/chat' && options?.body){const body=JSON.parse(options.body);wire.push({num_predict:body.options?.num_predict,think:body.think});}
 return originalFetch(url,options);
};
const baseTools=coreTools.map(tool=>allowed.has(tool.name)?tool:{...tool,execute:async()=>{throw Error('Unexpected external/action tool blocked by evaluation');}});
const users={};for(const mode of modes)users[`quality${mode}`]={permissions:coreTools.map(t=>t.name).concat('admin'),personality:'Antworte kurz und sachlich.'};
fs.writeFileSync('/workspace/users.json',JSON.stringify({users,groups:{}}));
const sessions=createSessionStore(loadConfig(),[{allowed_users:Object.keys(users),tool:reminders},{allowed_users:Object.keys(users),tool:sendMessage}],{baseTools});
const chat=createChatService({sessions,log(){}});
const execute=async(user,name,args)=>runAsUser(user,async()=>{
 const result=await coreTools.find(tool=>tool.name===name).execute('fixture',args);
 const data=JSON.parse(result.content[0].text);if(data.error)throw Error('Fixture setup failed');return data;
});
const ask=async(user,mode,message,scheduled=false)=>{
 const calls=[];let studyExpected;const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),180000);
 try {
  const result=await runAsUser(user,()=>chat.prompt({userId:user,thinkingLevel:mode,message,scheduled,signal:controller.signal,onEvent:event=>{
   if(event.tool_result?.name==='flashcards') {
    try {const data=JSON.parse(event.tool_result.result.content[0].text);if(data.expected)studyExpected=data.expected;}catch{}
   }
   if(event.tool_call){calls.push(event.tool_call);if(calls.length>24)controller.abort();}
  }}),{scheduled});
  requests.push({mode,calls:calls.map(call=>({name:call.name,action:call.input?.action}))});
  return {...result,studyExpected};
 } finally {clearTimeout(timer);}
};
const check=async(mode,name,fn)=>{
 if(selected && !selected.includes(name))return;
 const start=performance.now();const before=requests.length;
 try {await fn();results.push({mode,name,ok:true,ms:Math.round(performance.now()-start),requests:requests.slice(before)});}
 catch(error){results.push({mode,name,ok:false,reason:error.message.slice(0,180),ms:Math.round(performance.now()-start),requests:requests.slice(before)});}
 console.log('TOOL_EVAL '+JSON.stringify(results.at(-1)));
};
try {
 for(const mode of modes) {
  const user=`quality${mode}`,root=`/workspace/users/${user}`;ensureUserWorkspace(user);
  await check(mode,'list_create_and_correct',async()=>{
   await ask(user,mode,'Erstelle eine Einkaufsliste namens Laborliste und setze genau 2 Äpfel darauf.');
   let data=await execute(user,'lists',{action:'show_list',list_name:'Laborliste'});
   assert.equal(data.items.length,1);assert.match(data.items[0].item,/äpfel|apfel/i);assert.equal(data.items[0].quantity,2);
   await ask(user,mode,'Ändere die Menge der Äpfel auf der Laborliste auf genau 5, nicht um weitere 5 erhöhen.');
   data=await execute(user,'lists',{action:'show_list',list_name:'Laborliste'});assert.equal(data.items[0].quantity,5);
  });chat.reset(user);
  await check(mode,'calendar_edit_preserves_other_event',async()=>{
   await execute(user,'calendar',{action:'add',title:'Test Alpha',date:'15.01.2030',time:'10:00'});
   await execute(user,'calendar',{action:'add',title:'Test Beta',date:'15.01.2030',time:'11:00'});
   const before=Object.values(ical.sync.parseICS(fs.readFileSync(root+'/calendar.ics','utf8'))).filter(e=>e.type==='VEVENT');
   await ask(user,mode,'Verschiebe nur den Termin Test Alpha vom 15.01.2030 auf den 16.01.2030 um 14:00. Test Beta muss unverändert bleiben.');
   const after=Object.values(ical.sync.parseICS(fs.readFileSync(root+'/calendar.ics','utf8'))).filter(e=>e.type==='VEVENT');
   assert.equal(after.length,2);
   const a=after.find(e=>e.summary==='Test Alpha'),b=after.find(e=>e.summary==='Test Beta');
   assert.equal(a.uid,before.find(e=>e.summary==='Test Alpha').uid);assert.equal(a.start.getDate(),16);assert.equal(a.start.getHours(),14);
   assert.equal(b.start.toISOString(),before.find(e=>e.summary==='Test Beta').start.toISOString());
  });chat.reset(user);
  await check(mode,'memory_remember_correct_forget',async()=>{
   await ask(user,mode,'Speichere als Grundwissen: Meine synthetische Lieblingsfarbe ist Blau.');
   const memory=()=>JSON.parse(fs.readFileSync(root+'/memory/long_term.json','utf8'));
   const remembered=memory().find(e=>e.core===true && /blau/i.test(e.text));assert.ok(remembered);
   await ask(user,mode,'Korrigiere diese gespeicherte Lieblingsfarbe: Sie ist jetzt Grün. Ersetze die alte Angabe im Grundwissen.');
   assert.ok(memory().some(e=>e.core===true && /grün|gruen/i.test(e.text)));assert.ok(!memory().some(e=>/blau/i.test(e.text)));
   await ask(user,mode,'Vergiss meine gespeicherte Lieblingsfarbe vollständig.');assert.ok(!memory().some(e=>e.id===remembered.id || /lieblingsfarbe/i.test(e.text)));
  });chat.reset(user);
  await check(mode,'flashcard_waits_for_answer_then_records_it',async()=>{
   await execute(user,'flashcards',{action:'add_card',deck:'LaborSpanisch',front:'Danke',back:'Gracias'});
   const question=await ask(user,mode,'Frag mich jetzt eine Karte aus LaborSpanisch ab. Warte danach auf meine Antwort.');
   assert.ok(question.studyExpected,'Study tool must provide the expected answer');
   const first=JSON.parse(fs.readFileSync(root+'/flashcards/laborspanisch.json','utf8'));assert.equal(first.cards[0].streak,0);
   await ask(user,mode,question.studyExpected);
   const after=JSON.parse(fs.readFileSync(root+'/flashcards/laborspanisch.json','utf8'));assert.equal(after.cards[0].streak,1);
  });chat.reset(user);
  await check(mode,'file_marker_retained',async()=>{
   fs.writeFileSync(root+'/labor-notiz.txt','synthetic content');
   const result=await ask(user,mode,'Schicke mir meine Datei labor-notiz.txt aus meinem Workspace.');
   assert.ok(result.response.includes(`[FILE:${user}:labor-notiz.txt]`));
  });chat.reset(user);
  await check(mode,'reminder_has_real_due_time',async()=>{
   await ask(user,mode,'Erinnere mich am 20.01.2030 um 09:00 daran: Laborpflanze gießen.');
   const data=JSON.parse(fs.readFileSync('/workspace/data/reminders.json','utf8')).filter(e=>e.user===user && e.active);
   assert.equal(data.length,1);assert.ok(data[0].due_at);assert.equal(new Date(data[0].due_at).getFullYear(),2030);
  });chat.reset(user);
  await check(mode,'scheduled_outbox_single_full_delivery',async()=>{
   const result=await ask(user,mode,`Rufe ausdrücklich send_message für Nutzer ${user} mit Text LABOR-VOLLSTAENDIG auf.`,true);
   assert.equal(result.deliveries.length,1);assert.match(result.deliveries[0],/(?:^|\n)LABOR-VOLLSTAENDIG$/);
  });chat.reset(user);
 }
 console.log('TOOL_EVAL_SUMMARY '+JSON.stringify({results,wire,passed:results.filter(x=>x.ok).length,total:results.length}));
} finally {await chat.close();}
