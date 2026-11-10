if(process.env.RIBO_TEST_ISOLATED!=='1')throw Error('Isolated workspace required');
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
process.env.USERS_CONFIG_PATH='/tmp/model-users.json';
process.env.OLLAMA_NATIVE_WARM='0';
process.env.OLLAMA_CONTEXT_LENGTH='65536';
const {createSessionStore}=await import('../services/sessions.js');
const {createChatService}=await import('../services/chat.js');
const {createApp}=await import('../app.js');
const {loadConfig}=await import('../config.js');
const {createModelPreferences}=await import('../services/model-selection.js');
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const close=server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

// Real SDK, native Ollama adapter, HTTP security and preferences; synthetic models only.
test('live catalog, SDK model switch, tools, history, user isolation and persistence',async()=>{
 fs.writeFileSync(process.env.USERS_CONFIG_PATH,JSON.stringify({users:{model_a:{permissions:[]},model_b:{permissions:[]}},groups:{}}));
 let ids=['test-vision:latest','test-text:latest','test-embedding:latest'],unavailable=false;
 const generations=[];
 const ollama=http.createServer(async(req,res)=>{
  let body='';for await(const part of req)body+=part;
  const data=body?JSON.parse(body):{};
  if(unavailable){res.writeHead(503);res.end('{}');return;}
  res.setHeader('Content-Type','application/json');
  if(req.url==='/api/tags')return res.end(JSON.stringify({models:ids.map(name=>({name}))}));
  if(req.url==='/api/show')return res.end(JSON.stringify({capabilities:data.name==='test-embedding:latest'?['embedding']:data.name==='test-text:latest'?['completion']:['completion','tools','vision','thinking'],thinking:{values:[false,'low','medium']},model_info:{'test.context_length':data.name==='test-text:latest'?8192:65536}}));
  if(req.url==='/api/chat'){
   generations.push(data);res.setHeader('Content-Type','application/x-ndjson');
   return res.end(JSON.stringify({model:data.model,message:{role:'assistant',content:'SYNTHETIC_OK'},done:true,prompt_eval_count:1,eval_count:1})+'\n');
  }
  res.writeHead(404);res.end('{}');
 });
 await listen(ollama);process.env.OLLAMA_HOST='http://127.0.0.1:'+ollama.address().port;
 const config=loadConfig({PI_MODEL:'test-vision:latest',RIBO_WEB_USER:'model_a',RIBO_WEB_PASSWORD:'p'.repeat(24),RIBO_INTERNAL_TOKEN:'t'.repeat(48)});
 let sessions=createSessionStore(config,[],{baseTools:[{name:'synthetic_tool',label:'Synthetic',description:'Synthetic inert tool',parameters:{type:'object',properties:{}},async execute(){return {content:[{type:'text',text:'ok'}]};}}]});
 const chat=createChatService({sessions,prepare:(_id,text)=>text,log(){}});
 const app=createApp({config,chat});const api=http.createServer(app);await listen(api);
 const root='http://127.0.0.1:'+api.address().port;
 const basic='Basic '+Buffer.from('model_a:'+config.webPassword).toString('base64');
 const post=(url,body={},auth=basic,extra={})=>fetch(root+url,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
 try{
  let listing=await (await post('/models/list')).json();
  assert.equal(listing.selected,'test-vision:latest',JSON.stringify(listing));assert.equal(listing.models.length,2);assert.equal(generations.length,0);
  assert.equal(listing.models.find(m=>m.id==='test-text:latest').context_window,8192);
  assert.equal(listing.models.find(m=>m.id==='test-vision:latest').vision,true);
  const session=await sessions.get('model_a');assert.equal(session.model.api,'ollama-native');
  const history=[{role:'user',content:[{type:'text',text:'Synthetic prior turn'}],timestamp:Date.now()}];
  session.agent.state.messages=history;
  const tools=session.getActiveToolNames();assert.ok(tools.includes('synthetic_tool'));
  assert.equal((await post('/model',{model:'test-text:latest',user_id:'model_b'})).status,403);
  assert.equal((await post('/model',{model:'test-text:latest'},basic,{Origin:'https://evil.invalid'})).status,403);
  assert.equal((await post('/model',{model:'test-text:latest'},'')).status,401);
  assert.equal((await post('/model',{model:'missing'})).status,400);
  assert.equal((await post('/model',{model:'test-text:latest'})).status,200);
  assert.equal(session.model.id,'test-text:latest');assert.deepEqual(session.agent.state.messages,history);assert.deepEqual(session.getActiveToolNames(),[]);
  assert.equal((await post('/models/list',{user_id:'model_b'},'Bearer '+config.internalToken).then(r=>r.json())).selected,'test-vision:latest');
  const png='iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==';
  assert.equal((await post('/prompt',{message:'Describe image',image_base64:png})).status,400);
  assert.equal(fs.existsSync('/workspace/users/model_a/uploads'),false);
  const response=await post('/prompt',{message:'Synthetic test',thinking_level:'off'});
  assert.equal(response.status,200);assert.equal((await response.json()).response,'SYNTHETIC_OK');
  assert.equal(generations.at(-1).model,'test-text:latest');assert.equal(generations.at(-1).tools,undefined);assert.equal(generations.at(-1).options.num_ctx,8192);assert.equal(generations.at(-1).options.num_predict,2048);
  const preference=fs.readFileSync('/workspace/users/model_a/model-preference.json','utf8');
  unavailable=true;assert.equal((await post('/model',{model:'test-vision:latest'})).status,503);unavailable=false;
  assert.equal(fs.readFileSync('/workspace/users/model_a/model-preference.json','utf8'),preference);assert.equal(session.model.id,'test-text:latest');
  ids.push('new-model:latest');listing=await (await post('/models/list',{refresh:true})).json();assert.ok(listing.models.some(m=>m.id==='new-model:latest'));
  const restored=createSessionStore(config,[],{baseTools:[]});try{assert.equal((await restored.get('model_a')).model.id,'test-text:latest');}finally{restored.dispose();}
  ids=ids.filter(id=>id!=='test-text:latest');await post('/models/list',{refresh:true});
  assert.equal((await post('/prompt',{message:'Should not silently change model'})).status,409);
  assert.equal((await post('/model',{model:'test-vision:latest'})).status,200);assert.deepEqual(session.getActiveToolNames(),tools);
  assert.equal((await post('/model',{model:'../not-a-model'})).status,400);
  assert.equal(fs.statSync('/workspace/users/model_a/model-preference.json').mode&0o777,0o600);
 }finally{await chat.close();await close(api);await close(ollama);}
});

test('model switches cannot race answers or another switch; queued answers wait',async()=>{
 let finish,started,setFinish,setStarted,selected='old';
 const ready=new Promise(r=>started=r),switchReady=new Promise(r=>setStarted=r);
 const seen=[];
 const session={subscribe(){return()=>{};},async prompt(){seen.push(selected);started();if(seen.length===1)await new Promise(r=>finish=r);},async abort(){finish();}};
 const chat=createChatService({sessions:{get:async()=>session,async setModel(_user,id){setStarted();await new Promise(r=>setFinish=r);selected=id;return {selected:id};},dispose(){}},prepare:(_id,text)=>text,log(){}});
 try{
  const prompt=chat.prompt({userId:'race',message:'First'});await ready;
  await assert.rejects(chat.setModel('race','new'),e=>e.status===409);finish();await prompt;
  const switching=chat.setModel('race','new');await switchReady;
  await assert.rejects(chat.setModel('race','other'),e=>e.status===409);
  const next=chat.prompt({userId:'race',message:'Second'});await tick();assert.deepEqual(seen,['old']);setFinish();await switching;await next;assert.deepEqual(seen,['old','new']);
 }finally{await chat.close();}
});

test('corrupt preferences and symlinks stay intact instead of silently resetting',()=>{
 const preferences=createModelPreferences({provider:'ollama',model:'default'});
 const root='/workspace/users/prefguard';fs.mkdirSync(root,{recursive:true});
 fs.writeFileSync(root+'/model-preference.json','{broken');assert.throws(()=>preferences.get('prefguard'));assert.equal(fs.readFileSync(root+'/model-preference.json','utf8'),'{broken');
 fs.unlinkSync(root+'/model-preference.json');fs.writeFileSync(root+'/original','untouched');fs.symlinkSync(root+'/original',root+'/model-preference.json');assert.throws(()=>preferences.set('prefguard','new'));assert.equal(fs.readFileSync(root+'/original','utf8'),'untouched');
});
