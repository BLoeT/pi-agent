/** Explicit local model check; no production workspace, external calls or real generation. */
if(process.env.RIBO_TEST_ISOLATED!=='1'||process.env.RIBO_UPLOAD_MODEL_TEST!=='1')throw Error('Explicit isolated model check required');
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {createSessionStore} from '/app/services/sessions.js';
import {createChatService} from '/app/services/chat.js';
import {loadConfig} from '/app/config.js';
import {coreTools} from '/app/tools/index.js';
import {ensureUserWorkspace,runAsUser} from '/app/lib/users.js';

function image(rgb){
 const crc=buffer=>{let v=0xffffffff;for(const byte of buffer){v^=byte;for(let i=0;i<8;i++)v=(v>>>1)^((v&1)?0xedb88320:0);}return(v^0xffffffff)>>>0;};
 const chunk=(name,data)=>{const type=Buffer.from(name),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([length,type,data,checksum]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(32,0);header.writeUInt32BE(32,4);header[8]=8;header[9]=2;
 const rows=[];for(let y=0;y<32;y++)rows.push(Buffer.from([0,...Array.from({length:32},()=>rgb).flat()]));
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);
}
const red=image([255,0,0]),blue=image([0,0,255]);
fs.writeFileSync('/workspace/users.json',JSON.stringify({users:{photolab:{permissions:['imagegen','files','memory'],personality:'Antworte kurz.'}},groups:{}}));
ensureUserWorkspace('photolab');fs.mkdirSync('/workspace/users/photolab/telegram-inbox',{recursive:true});fs.writeFileSync('/workspace/users/photolab/telegram-inbox/old-blue.png',blue);
const original=globalThis.fetch,captured=[];
globalThis.fetch=async(url,options)=>{
 const target=new URL(String(url));
 if(target.port==='8086'&&target.pathname==='/generate'){
  const body=JSON.parse(options.body);captured.push(body);
  assert.ok(body.init_image?.endsWith('/users/photolab/uploads/new-red.png'),'Wrong image sent to generation');
  assert.deepEqual(fs.readFileSync('/workspace/users/photolab/uploads/new-red.png'),red);
  fs.mkdirSync('/workspace/generated-images',{recursive:true});fs.writeFileSync('/workspace/generated-images/upload-check.png',red);
  return new Response('{"path":"/workspace/generated-images/upload-check.png"}');
 }
 if(target.hostname!=='host.docker.internal'||target.port!=='11434')throw Error('External action blocked in test');
 return original(url,options);
};
const allowed=new Set(['imagegen','files','memory','uploads']);
const baseTools=coreTools.map(tool=>allowed.has(tool.name)?tool:{...tool,execute:async()=>{throw Error('External tool blocked');}});
const sessions=createSessionStore(loadConfig(),[],{baseTools});const chat=createChatService({sessions,log(){}});
try{
 const result=await runAsUser('photolab',()=>chat.prompt({userId:'photolab',image:red.toString('base64'),imageName:'new-red',thinkingLevel:'low',signal:AbortSignal.timeout(180000),message:'Erzeuge eine bearbeitete Variante des gerade angehängten Bildes mit grauem Hintergrund. Verwende ausschließlich das neue angehängte Bild als Vorlage, nicht ein älteres Bild.'}));
 assert.ok(captured.length>0,'Model did not call image generation');
 assert.ok(captured.every(body=>body.init_image.endsWith('/users/photolab/uploads/new-red.png')));
 assert.match(result.response,/\[IMAGE:photolab:/);
 await runAsUser('photolab',()=>chat.prompt({userId:'photolab',thinkingLevel:'low',signal:AbortSignal.timeout(120000),message:'Benenne ausschließlich das hochgeladene Original new-red.png in test1 um, nicht das generierte Bild.'}));
 assert.ok(fs.existsSync('/workspace/users/photolab/uploads/test1.png'));
 assert.ok(!fs.existsSync('/workspace/users/photolab/uploads/new-red.png'));
 await runAsUser('photolab',()=>chat.prompt({userId:'photolab',thinkingLevel:'low',signal:AbortSignal.timeout(120000),message:'Lösche jetzt das hochgeladene Original test1.png. Das ist ausdrücklich gewünscht.'}));
 assert.ok(!fs.existsSync('/workspace/users/photolab/uploads/test1.png'));
 console.log(JSON.stringify({current_upload_used:true,old_telegram_image_not_used:true,exact_uploaded_bytes_preserved:true,natural_rename_verified:true,natural_delete_verified:true,owner:'synthetic-photolab',generation_requests:captured.length}));
}finally{await chat.close();globalThis.fetch=original;}
