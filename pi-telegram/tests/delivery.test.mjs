import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startBackgroundServices} from '../scheduler.js';
import {parseReminderTime} from '../../shared/reminders.js';
const fixture=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ribo-delivery-'));
const config={users:{alice:{chat_id:1},bob:{chat_id:2}},groups:{}};
function rules(workspace,list){fs.writeFileSync(path.join(workspace,'proactive_rules.json'),JSON.stringify(list));}
function due(userId='alice'){const now=new Date();return {id:'same',userId,enabled:true,hour:now.getHours(),minute:now.getMinutes(),prompt:'Get data and send it',name:'Test'};}

test('scheduled full delivery wins over summary and overlap sends once',async()=>{
 const workspace=fixture();rules(workspace,[due()]);const sent=[];let scheduled=false;
 const setup={workspace,start:false,loadUsersConfig:()=>config,bot:{api:{sendMessage:async value=>sent.push(value)}},sendToAgent:async(_prompt,_user,_image,options)=>{scheduled=options.scheduled;await new Promise(r=>setTimeout(r,15));return {response:'Short summary',deliveries:['Full detailed answer','Full detailed answer']};}};
 const first=startBackgroundServices(setup),second=startBackgroundServices(setup);
 try{await Promise.all([first.checkProactiveRules(),second.checkProactiveRules()]);await first.checkProactiveRules();assert.equal(scheduled,true);assert.equal(sent.length,1);assert.match(sent[0].text,/Full detailed answer/);assert.doesNotMatch(sent[0].text,/Short summary/);}finally{first.stop();second.stop();fs.rmSync(workspace,{recursive:true,force:true});}
});
test('legacy same IDs belonging to different users each deliver',async()=>{
 const workspace=fixture();rules(workspace,[due(),due('bob')]);const sent=[];
 const scheduler=startBackgroundServices({workspace,start:false,loadUsersConfig:()=>config,bot:{api:{sendMessage:async value=>sent.push(value)}},sendToAgent:async()=>({response:'Test',deliveries:[]})});
 try{await scheduler.checkProactiveRules();assert.deepEqual(sent.map(value=>value.chat_id),[1,2]);}finally{scheduler.stop();fs.rmSync(workspace,{recursive:true,force:true});}
});
test('habit analysis preserves a rule added while sending its suggestion',async()=>{
 const workspace=fixture();rules(workspace,[]);fs.mkdirSync(path.join(workspace,'users/alice/memory'),{recursive:true});fs.writeFileSync(path.join(workspace,'users/alice/memory/habits_log.json'),JSON.stringify(Array.from({length:14},()=>({tool:'weather',weekday:'montag',hour:8}))));
 const scheduler=startBackgroundServices({workspace,start:false,loadUsersConfig:()=>config,sendToAgent:async()=>'',bot:{api:{sendMessage:async()=>rules(workspace,[{id:'concurrent',userId:'alice',name:'Keep me'}])}}});
 try{await scheduler.analyzeHabits();const after=JSON.parse(fs.readFileSync(path.join(workspace,'proactive_rules.json'),'utf8'));assert.ok(after.some(rule=>rule.id==='concurrent'));assert.ok(after.some(rule=>rule.pending_confirmation));}finally{scheduler.stop();fs.rmSync(workspace,{recursive:true,force:true});}
});
test('plugin reminders send once, advance recurrence, and leave old unscheduled data untouched',async()=>{
 const workspace=fixture();fs.mkdirSync(path.join(workspace,'data'));const file=path.join(workspace,'data/reminders.json');
 fs.writeFileSync(file,JSON.stringify([{id:'once',user:'alice',active:true,text:'One off',due_at:new Date(Date.now()-1000).toISOString()},{id:'daily',user:'alice',active:true,text:'Daily',due_at:new Date(Date.now()-1000).toISOString(),recurrence:{kind:'daily',hour:8,minute:0}},{id:'legacy',user:'alice',active:true,text:'Old',time:'17.10.2026 um 14:00'}]));const sent=[];
 const scheduler=startBackgroundServices({workspace,start:false,loadUsersConfig:()=>config,sendToAgent:async()=>'',bot:{api:{sendMessage:async value=>sent.push(value)}}});
 try{await scheduler.checkPluginReminders();await scheduler.checkPluginReminders();assert.equal(sent.length,2);const after=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(after[0].active,false);assert.ok(Date.parse(after[1].due_at)>Date.now());assert.equal(after[2].active,true);assert.equal(after[2].due_at,undefined);}finally{scheduler.stop();fs.rmSync(workspace,{recursive:true,force:true});}
});
test('reminder times validate dates and support relative/daily/weekly schedules',()=>{
 const now=new Date('2026-11-08T12:00:00+01:00');assert.equal(parseReminderTime('in 10 Minuten',now).due_at,new Date(+now+600000).toISOString());
 assert.equal(parseReminderTime('jeden Montag um 09:00',now).recurrence.kind,'weekly');assert.equal(parseReminderTime('jeden Tag 08:00',now).recurrence.kind,'daily');
 for(const invalid of ['31.02.2027 10:00','heute 03:00','jeden Tag 25:00','jeden Tag','nächste Woche'])assert.throws(()=>parseReminderTime(invalid,now));
});
