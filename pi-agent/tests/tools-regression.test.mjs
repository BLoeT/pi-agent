if(process.env.RIBO_TEST_ISOLATED!=='1')throw Error('Use isolated tmpfs workspace');
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {runAsUser,ensureUserWorkspace,getDeferredDeliveries} from '../lib/users.js';
import {updateJson,readJson} from '../lib/storage.js';
const permissions=['admin','notes','projects','expenses','flashcards','proactive_rules','calendar','imagegen'];
fs.writeFileSync('/workspace/users.json',JSON.stringify({users:{audit_a:{permissions,groups:[]},audit_b:{permissions:permissions.filter(p=>p!=='admin'),groups:[]}},groups:{}}));
for(const user of ['audit_a','audit_b'])ensureUserWorkspace(user);
const tool=async(name)=>(await import(`../tools/${name}.js`)).default;
function decode(value){try{return JSON.parse(value.content[0].text);}catch{return {error:value.content[0].text};}}
const call=async(name,args,user='audit_a',signal)=>runAsUser(user,async()=>decode(await (await tool(name)).execute('test',args,signal)));

test('ZIP succeeds and rejects a foreign symlink without changing either user file',async()=>{
 const project='/workspace/users/audit_a/projects/demo';fs.mkdirSync(project,{recursive:true});fs.writeFileSync(project+'/main.js','test');
 const first=await call('projects',{action:'zip',project:'demo'});assert.equal(first.status,'ok',JSON.stringify(first));
 const zip=project+'.zip';assert.equal(fs.readFileSync(zip).subarray(0,2).toString(),'PK');
 fs.unlinkSync(zip);const victim='/workspace/users/audit_b/victim';fs.writeFileSync(victim,'untouched');fs.symlinkSync(victim,zip);
 const denied=await call('projects',{action:'zip',project:'demo'});assert.ok(denied.error);assert.equal(fs.readFileSync(victim,'utf8'),'untouched');
});
test('corrupt notes and memory are preserved on read and write attempts',async()=>{
 for(const [name,file,args]of [['notes','notes.json',{action:'list'}],['memory','memory/long_term.json',{action:'remember',text:'new'}]]){
  const target='/workspace/users/audit_a/'+file;const broken='[{"text":"recoverable"}';fs.writeFileSync(target,broken);
  const result=await call(name,args);assert.ok(result.error,JSON.stringify(result));assert.equal(fs.readFileSync(target,'utf8'),broken);fs.unlinkSync(target);
 }
});
test('data path symlinks cannot read or replace another user data',async()=>{
 const own='/workspace/users/audit_a/notes.json',other='/workspace/users/audit_b/notes.json';fs.writeFileSync(other,'[{"text":"private"}]');fs.symlinkSync(other,own);
 const denied=await call('notes',{action:'add',text:'bad'});assert.ok(denied.error);assert.equal(fs.readFileSync(other,'utf8'),'[{"text":"private"}]');fs.unlinkSync(own);
});
test('same names get distinct rule ids and legacy duplicate ids stay user-scoped',async()=>{
 const a=await call('proactive_rules',{action:'add',name:'Morning',prompt:'test',hour:8});
 assert.ok((await call('proactive_rules',{action:'add',name:'Morning',prompt:'test',hour:8})).error);
 const b=await call('proactive_rules',{action:'add',name:'Morning',prompt:'test',hour:8},'audit_b');assert.notEqual(a.rule.id,b.rule.id);
 updateJson('/workspace/proactive_rules.json',[],rules=>{for(const rule of rules)rule.id='legacy';});
 const changed=await call('proactive_rules',{action:'toggle',id:'legacy',enabled:false},'audit_b');assert.equal(changed.status,'ok');
 const rules=readJson('/workspace/proactive_rules.json',[]);assert.equal(rules.find(r=>r.userId==='audit_a').enabled,true);assert.equal(rules.find(r=>r.userId==='audit_b').enabled,false);
});
test('invalid dates reject without creating an expense',async()=>{
 for(const date of ['31.02.2026','unreadable']){const result=await call('expenses',{action:'add',amount:5,category:'Test',date});assert.ok(result.error,JSON.stringify(result));}
});
test('batch cards deduplicate normalized fronts',async()=>{
 const result=await call('flashcards',{action:'generate_cards',deck:'Review',cards:[{front:'Hallo',back:'Hello'},{front:' hallo ',back:'Hello'}]});assert.equal(result.added,1);
});
test('calendar expands weekly recurrence and edits a stable UID',async()=>{
 const from=new Date();from.setDate(from.getDate()-7);from.setHours(10,0,0,0);
 const fmt=date=>`${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}T100000`;
 const file='/workspace/users/audit_a/calendar.ics';fs.writeFileSync(file,`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:repeat\r\nDTSTART:${fmt(from)}\r\nDURATION:PT1H\r\nRRULE:FREQ=WEEKLY\r\nSUMMARY:Weekly test\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
 const today=await call('calendar',{action:'today'});assert.match(today.result,/Weekly test/);assert.equal(today.events[0].uid,'repeat');
 const edit=await call('calendar',{action:'edit',event_id:'repeat',new_title:'Changed',time:'11:30'});assert.equal(edit.status,'ok',JSON.stringify(edit));
 const content=fs.readFileSync(file,'utf8');assert.match(content,/UID:repeat/);assert.match(content,/RRULE:FREQ=WEEKLY/);assert.match(content,/SUMMARY:Changed/);
});
test('plugin visibility honors empty ACL and admin guard',async()=>{
 fs.mkdirSync('/workspace/plugins',{recursive:true});fs.writeFileSync('/workspace/plugins/review.js','export default {name:"review_hidden", description:"test"};');fs.writeFileSync('/workspace/plugins/review.meta.json',JSON.stringify({allowed_users:[]}));
 assert.doesNotMatch((await call('capabilities',{})).message,/review_hidden|review\.js/);
 fs.writeFileSync('/workspace/plugins/review.meta.json',JSON.stringify({allowed_users:['audit_b']}));assert.doesNotMatch((await call('capabilities',{},'audit_b')).message,/review_hidden|review\.js/);
});
test('scheduled nested tool context accumulates one delivery and never sends directly',async()=>{
 const plugin=(await import('../plugins/send_message.js')).default;
 const saved=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not send');};
 try{await runAsUser('audit_a',async()=>{
  await runAsUser('audit_a',()=>plugin.execute('test',{user:'audit_a',text:'Full detailed answer'}));
  await plugin.execute('test',{user:'audit_a',text:'Full detailed answer'});
  assert.deepEqual(getDeferredDeliveries(),['Full detailed answer']);
 },{scheduled:true});assert.equal(calls,0);}finally{globalThis.fetch=saved;}
});
test('image errors do not claim success and abort reaches the job cancellation API',async()=>{
 const saved=globalThis.fetch;let release,captured,cancelled=0;
 globalThis.fetch=async(url,options)=>{
  if(String(url).endsWith('/cancel')){cancelled++;return new Response('{}');}
  captured=options;return new Promise((resolve,reject)=>{release=()=>resolve(new Response(JSON.stringify({path:'/tmp/not-created.png'})));options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});
 };
 try{
  const c=new AbortController();const pending=call('imagegen',{prompt:'test'},'audit_a',c.signal);
  while(!captured)await new Promise(r=>setTimeout(r,1));c.abort();const result=await pending;assert.ok(result.error);assert.equal(captured.signal.aborted,true);assert.equal(cancelled,1);
  captured=undefined;const missing=call('imagegen',{prompt:'test'});while(!release || !captured)await new Promise(r=>setTimeout(r,1));release();assert.ok((await missing).error);
 }finally{globalThis.fetch=saved;}
});
test('cross-process JSON updates do not lose increments',async()=>{
 const file='/workspace/audit-counter.json';fs.writeFileSync(file,'{"value":0}');
 const code=`import{updateJson}from'/shared/storage.js';for(let i=0;i<25;i++)updateJson('${file}',{},v=>v.value++);`;
 const worker=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',code]);let error='';child.stderr.on('data',d=>error+=d);child.on('exit',code=>code?reject(Error(error)):resolve());child.on('error',reject);});
 await Promise.all([worker(),worker()]);assert.equal(readJson(file,{}).value,50);
});

test('reminder plugin schedules, reschedules, and cancels only its owner entries',async()=>{
 const plugin=(await import('../plugins/reminders.js')).default;
 const create=await runAsUser('audit_a',()=>plugin.execute('test',{action:'create',text:'Synthetic reminder',time:'in 10 Minuten'}));
 const first=decode(create);assert.equal(first.status,'ok');assert.ok(Date.parse(first.reminder.due_at)>Date.now());
 const id=first.reminder.id;
 const foreign=decode(await runAsUser('audit_b',()=>plugin.execute('test',{action:'cancel',id})));assert.ok(foreign.error);
 const moved=decode(await runAsUser('audit_a',()=>plugin.execute('test',{action:'reschedule',id,time:'jeden Montag um 09:00'})));assert.equal(moved.reminder.recurrence.kind,'weekly');
 const cancelled=decode(await runAsUser('audit_a',()=>plugin.execute('test',{action:'cancel',id})));assert.equal(cancelled.reminder.active,false);
});
test('HTTP timeout remains active while reading a stalled response body',async()=>{
 const http=await import('node:http');const {fetchJson}=await import('../lib/http.js');
 const server=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.flushHeaders();res.write('{');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await assert.rejects(fetchJson(`http://127.0.0.1:${server.address().port}`,{},{timeout:40}),/timeout|abort/i);}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('calendar recurrence exceptions and all-day DST endings are respected',async()=>{
 const ical=(await import('node-ical')).default;const {eventsForDate}=await import('../lib/calendar.js');const {generateVEvent}=await import('../lib/helpers.js');
 const parsed=ical.sync.parseICS('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:exception\r\nDTSTART:20261101T100000\r\nDURATION:PT1H\r\nRRULE:FREQ=WEEKLY\r\nEXDATE:20261108T100000\r\nSUMMARY:Excluded\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');
 assert.equal(eventsForDate(parsed,new Date(2026,10,8)).length,0);
 const event=generateVEvent({title:'DST',startDate:new Date(2026,9,25),allDay:true});assert.match(event,/DTEND;VALUE=DATE:20261026/);
});
