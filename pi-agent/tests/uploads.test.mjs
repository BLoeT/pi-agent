if(process.env.RIBO_TEST_ISOLATED!=='1')throw Error('Isolated workspace required');
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
process.env.USERS_CONFIG_PATH='/tmp/upload-users.json';
const {runAsUser,ensureUserWorkspace,getCurrentAttachment}=await import('../lib/users.js');
const {saveIncomingImage,listUploads,resolveGenerationSource,renameUpload,deleteUpload}=await import('../lib/uploads.js');
const {createChatService}=await import('../services/chat.js');
const {createApp}=await import('../app.js');
const {loadConfig}=await import('../config.js');
const {default:imagegen}=await import('../tools/imagegen.js');
const {default:videogen}=await import('../tools/video.js');
const {default:files}=await import('../tools/files.js');
const png='iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==';
const users=['upload_a','upload_b'];
fs.writeFileSync(process.env.USERS_CONFIG_PATH,JSON.stringify({users:Object.fromEntries(users.map(user=>[user,{permissions:['imagegen','videogen','files']}])) ,groups:{}}));
users.forEach(ensureUserWorkspace);
const data=result=>JSON.parse(result.content[0].text);

test('uploads preserve the exact bytes, separate owners and never overwrite a name',()=>{
 const a=saveIncomingImage('upload_a',png,{name:'test1'}),b=saveIncomingImage('upload_b',png,{name:'test1'});
 assert.equal(a.relative,'uploads/test1.png');assert.equal(b.relative,'uploads/test1.png');
 assert.deepEqual(fs.readFileSync('/workspace/users/upload_a/'+a.relative),Buffer.from(png,'base64'));
 assert.throws(()=>saveIncomingImage('upload_a',png,{name:'test1'}),e=>e.status===409);
 assert.throws(()=>saveIncomingImage('upload_a',png,{name:'../upload_b/hijack'}),e=>e.status===400);
 assert.throws(()=>saveIncomingImage('upload_a','YQ=='));
 saveIncomingImage('upload_b',png,{name:'only-b'});
 assert.ok(!listUploads('upload_a').files.some(f=>f.name==='only-b.png'));
});

test('current upload is request scoped and an old Telegram source cannot replace it',async()=>{
 const attachment=saveIncomingImage('upload_a',png,{name:'current'});
 fs.mkdirSync('/workspace/users/upload_a/telegram-inbox',{recursive:true});
 fs.writeFileSync('/workspace/users/upload_a/telegram-inbox/old.png','OLD TELEGRAM IMAGE');
 await runAsUser('upload_a',async()=>{
  assert.equal(resolveGenerationSource(),attachment.relative);
  assert.equal(resolveGenerationSource(attachment.relative),attachment.relative);
  assert.throws(()=>resolveGenerationSource('telegram-inbox/old.png'),/Falsches Quellbild/);
  assert.throws(()=>resolveGenerationSource('telegram-inbox/old.png',false));
  assert.equal(resolveGenerationSource(undefined,false),undefined);
  await runAsUser('upload_a',async()=>assert.equal(getCurrentAttachment(),attachment));
  await runAsUser('upload_b',async()=>assert.equal(getCurrentAttachment(),undefined));
 },{attachment});
 assert.equal(getCurrentAttachment(),undefined);
});

test('image and video tools receive current user upload bytes, stale sources never reach generation',async()=>{
 const saved=globalThis.fetch,captured=[];
 const attachment=saveIncomingImage('upload_a',png,{name:'generation-input'});
 globalThis.fetch=async(url,options)=>{
  const body=JSON.parse(options.body);captured.push(body);
  const video=String(url).endsWith('/generate-video');
  const folder=video?'generated-videos':'generated-images',name=randomUUID()+(video?'.mp4':'.png');
  fs.mkdirSync('/workspace/'+folder,{recursive:true});fs.writeFileSync('/workspace/'+folder+'/'+name,video?'synthetic video':Buffer.from(png,'base64'));
  return new Response(JSON.stringify({path:'/workspace/'+folder+'/'+name}));
 };
 try{await runAsUser('upload_a',async()=>{
  const result=data(await imagegen.execute('test',{prompt:'Synthetic edit'}));assert.equal(result.status,'ok');
  assert.ok(captured[0].init_image.endsWith('/users/upload_a/'+attachment.relative));
  assert.deepEqual(fs.readFileSync('/workspace/users/upload_a/'+attachment.relative),Buffer.from(png,'base64'));
  const stale=data(await imagegen.execute('test',{prompt:'Synthetic edit',source_image:'telegram-inbox/old.png'}));
  assert.match(stale.error,/Falsches Quellbild/);assert.equal(captured.length,1);
  const video=data(await videogen.execute('test',{prompt:'Synthetic animation'}));assert.equal(video.status,'ok');assert.equal(video.mode,'img2vid');
  assert.ok(captured[1].init_image.endsWith('/users/upload_a/'+attachment.relative));
  await imagegen.execute('test',{prompt:'Explicit new image',use_uploaded_image:false});assert.equal(captured[2].init_image,undefined);
 },{attachment});}finally{globalThis.fetch=saved;}
});

test('rename and delete update an active source, with no collision or foreign ownership bypass',async()=>{
 const attachment=saveIncomingImage('upload_a',png,{name:'before-rename'});
 await runAsUser('upload_a',async()=>{
  const renamed=data(await files.execute('test',{action:'rename',file_path:attachment.relative,new_name:'after-rename'}));
  assert.equal(renamed.status,'ok');assert.equal(attachment.relative,'uploads/after-rename.png');
  assert.equal(resolveGenerationSource(),attachment.relative);
  assert.throws(()=>renameUpload('upload_a','after-rename.png','test1'),e=>e.status===409);
  assert.throws(()=>deleteUpload('upload_a','../upload_b/test1.png'));
  assert.equal(data(await files.execute('test',{action:'delete',file_path:attachment.relative})).status,'ok');
  assert.throws(()=>resolveGenerationSource(),/gelöscht/);
 },{attachment});
 assert.ok(fs.existsSync('/workspace/users/upload_b/uploads/test1.png'));
});

test('chat binds the saved path and identical vision data to this request only',async()=>{
 let listener,seenPrompt,seenImage,current;
 const session={agent:{state:{messages:[]}},subscribe(fn){listener=fn;return ()=>{};},async prompt(prompt,options){seenPrompt=prompt;seenImage=options.images[0];current=getCurrentAttachment();listener({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'OK'}});}};
 const chat=createChatService({sessions:{get:async()=>session,dispose(){}},prepare:(_user,text)=>text,log(){}});
 try{
  const result=await chat.prompt({userId:'upload_a',message:'Bearbeite genau dieses Bild',image:png,imageName:'chat-picture'});
  assert.match(seenPrompt,/uploads\/chat-picture\.png/);assert.equal(seenImage.data,png);assert.equal(current.userId,'upload_a');assert.equal(result.upload.name,'chat-picture.png');assert.equal(getCurrentAttachment(),undefined);
 }finally{await chat.close();}
});

test('HTTP gallery, rename, download and delete are scoped to authenticated owner',async()=>{
 const config=loadConfig({RIBO_WEB_USER:'upload_a',RIBO_WEB_PASSWORD:'p'.repeat(24),RIBO_INTERNAL_TOKEN:'t'.repeat(48)});
 const app=createApp({config,chat:{reset(){},cancel:async()=>false}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const root='http://127.0.0.1:'+server.address().port;
 const authorization='Basic '+Buffer.from('upload_a:'+config.webPassword).toString('base64');
 const send=(url,method='GET',body)=>fetch(root+url,{method,headers:{Authorization:authorization,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal((await fetch(root+'/uploads')).status,401);
  let response=await send('/uploads','POST',{image_base64:png,name:'web-image'});assert.equal(response.status,201);
  assert.equal((await send('/uploads','POST',{image_base64:png,name:'web-image'})).status,409);
  assert.equal((await send('/uploads','POST',{image_base64:png,name:'x',user_id:'upload_b'})).status,403);
  const listing=await (await send('/uploads?user_id=upload_b')).json();assert.ok(listing.files.some(f=>f.name==='web-image.png'));assert.ok(!listing.files.some(f=>f.name==='only-b.png'));
  assert.equal((await send('/uploads/only-b.png/content')).status,404);
  assert.equal((await send('/files/upload_b/uploads/only-b.png')).status,403);
  assert.equal((await send('/uploads/web-image.png','DELETE',{user_id:'upload_b'})).status,403);
  response=await send('/uploads/web-image.png/content');assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(png,'base64'));
  assert.equal((await send('/uploads/web-image.png','PATCH',{name:'Mein Bild'})).status,200);
  assert.equal((await send('/uploads/Mein%20Bild.png','DELETE',{})).status,200);
  assert.equal((await send('/uploads/Mein%20Bild.png/content')).status,404);
  assert.equal((await fetch(root+'/uploads/test1.png',{method:'DELETE',headers:{Authorization:authorization,'Content-Type':'application/json',Origin:'https://evil.invalid'},body:'{}'})).status,403);
 }finally{await new Promise(r=>server.close(r));}
});

test('a symlinked upload directory cannot write or disclose another user files',()=>{
 const root='/workspace/users/upload_symlink';fs.mkdirSync(root,{recursive:true});
 fs.symlinkSync('/workspace/users/upload_b/uploads',root+'/uploads');
 assert.throws(()=>saveIncomingImage('upload_symlink',png,{name:'intrusion'}));
 assert.throws(()=>listUploads('upload_symlink'));
 assert.ok(!fs.existsSync('/workspace/users/upload_b/uploads/intrusion.png'));
});

test('photo management works without broad file access and still cannot touch another owner',async()=>{
 const {default:uploads}=await import('../tools/uploads.js');
 saveIncomingImage('upload_reader',png,{name:'own-photo'});
 await runAsUser('upload_reader',async()=>{
  const listed=data(await uploads.execute('test',{action:'list'}));assert.equal(listed.files.length,1);assert.equal(listed.files[0].relative,'uploads/own-photo.png');
  const renamed=data(await uploads.execute('test',{action:'rename',name:'own-photo.png',new_name:'new-own-photo'}));assert.equal(renamed.name,'new-own-photo.png');
  const foreign=data(await uploads.execute('test',{action:'delete',name:'../upload_b/test1.png'}));assert.ok(foreign.error);
  assert.equal(data(await uploads.execute('test',{action:'delete',name:'new-own-photo.png'})).status,'ok');
 });assert.ok(fs.existsSync('/workspace/users/upload_b/uploads/test1.png'));
});
