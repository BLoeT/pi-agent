if(process.env.RIBO_TEST_ISOLATED!=='1')throw Error('Disposable workspace required');
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.USERS_CONFIG_PATH='/tmp/workflow-users.json';
const {runAsUser,ensureUserWorkspace,getDeferredDeliveries}=await import('../lib/users.js');
const {parseGermanDate}=await import('../lib/helpers.js');
const {default:calendar}=await import('../tools/calendar.js');
const {default:lists}=await import('../tools/lists.js');
const {default:flashcards}=await import('../tools/flashcards.js');
const {default:files}=await import('../tools/files.js');
const {default:reminders}=await import('../plugins/reminders.js');
const {default:sendMessage}=await import('../plugins/send_message.js');
const user='workflowa';
fs.writeFileSync(process.env.USERS_CONFIG_PATH,JSON.stringify({users:{[user]:{permissions:['calendar','lists','flashcards','files','admin']}},groups:{}}));
ensureUserWorkspace(user);
const call=(tool,args)=>runAsUser(user,async()=>{const value=await tool.execute('fixture',args);const data=JSON.parse(value.content[0].text);assert.equal(data.error,undefined);return data;});

test('calendar can look up an explicit date, edit by UID and preserve the other event',async()=>{
 await call(calendar,{action:'add',title:'Workflow Alpha',date:'15.01.2030',time:'10:00'});
 await call(calendar,{action:'add',title:'Workflow Beta',date:'2030-01-15',time:'11:00'});
 const before=await call(calendar,{action:'day',day:'2030-01-15'});assert.equal(before.events.length,2);
 const alpha=before.events.find(e=>e.summary==='Workflow Alpha');
 await call(calendar,{action:'edit',event_id:alpha.uid,date:'2030-01-16',time:'14:00'});
 const original=await call(calendar,{action:'day',date:'15.01.2030'});assert.deepEqual(original.events.map(e=>e.summary),['Workflow Beta']);
 const changed=await call(calendar,{action:'day',day:'16.01.2030'});assert.equal(changed.events[0].uid,alpha.uid);assert.equal(new Date(changed.events[0].start).getHours(),14);
 assert.equal(parseGermanDate('2030-02-30'),null);
});

test('shopping list correction replaces the quantity rather than adding it',async()=>{
 await call(lists,{action:'create_list',list_name:'Workflow'});
 await call(lists,{action:'add_item',list_name:'Workflow',item:'Äpfel',quantity:2});
 await call(lists,{action:'update_item',list_name:'Workflow',item:'Äpfel',quantity:5});
 const result=await call(lists,{action:'show_list',list_name:'Workflow'});assert.equal(result.items[0].quantity,5);
});

test('study waits without modifying the score, and explicit answer updates only that card',async()=>{
 await call(flashcards,{action:'add_card',deck:'Workflow',front:'Danke',back:'Gracias'});
 const question=await call(flashcards,{action:'study',deck:'Workflow'});assert.ok(question.expected);assert.ok(question.card_id);
 const path=`/workspace/users/${user}/flashcards/workflow.json`;
 assert.equal(JSON.parse(fs.readFileSync(path)).cards[0].streak,0);
 await call(flashcards,{action:'answer',deck:'Workflow',card_id:question.card_id,correct:true});
 assert.equal(JSON.parse(fs.readFileSync(path)).cards[0].streak,1);
});

test('file markers, real reminder timestamps and deferred scheduled delivery keep their contracts',async()=>{
 fs.writeFileSync(`/workspace/users/${user}/workflow.txt`,'synthetic content');
 const file=await call(files,{action:'send',file_path:'workflow.txt'});assert.equal(file.file_marker,`[FILE:${user}:workflow.txt]`);
 const reminder=await call(reminders,{action:'create',text:'Workflow test',time:'20.01.2030 09:00'});assert.ok(reminder.reminder.due_at);
 await runAsUser(user,async()=>{
  await sendMessage.execute('fixture',{user,text:'FULL WORKFLOW RESULT'});
  await sendMessage.execute('fixture',{user,text:'FULL WORKFLOW RESULT'});
  assert.deepEqual(getDeferredDeliveries(),['FULL WORKFLOW RESULT']);
 },{scheduled:true});
});
