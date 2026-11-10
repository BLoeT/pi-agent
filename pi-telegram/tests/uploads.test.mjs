import test from 'node:test';
import assert from 'node:assert/strict';
import {imageFilename,savedPhotoCaption} from '/shared/upload-names.js';
import {createMessageHandler} from '../handlers.js';
import {createServiceClient} from '../client.js';

test('German naming captions and safe filenames work consistently',()=>{
 for(const caption of ['Speichere das unter Name "test1"','Speichere das unter dem Namen „test1“','Speicher das als test1'])assert.equal(savedPhotoCaption(caption).name,'test1');
 assert.equal(savedPhotoCaption('Was ist auf diesem Bild zu sehen?'),null);
 assert.equal(imageFilename('Urlaub 2026.png','png'),'Urlaub 2026.png');
 assert.throws(()=>imageFilename('../other/file','png'));
 assert.throws(()=>imageFilename('bad\\name','jpg'));
});

test('photo naming uses the authorized Telegram user and central upload API',async()=>{
 const sent=[],saved=[];let prompts=0;
 const client={closed:false,thinkingModes:new Map(),async downloadTelegramFile(){return Buffer.from('synthetic-photo');},async saveUpload(user,image,name){saved.push({user,image,name});return {name:name+'.png'};},async sendToAgent(){prompts++;}};
 const handler=createMessageHandler({bot:{api:{async sendChatAction(){},async sendMessage(value){sent.push(value);}}},client,messenger:{},users:{isAuthorized:id=>id===1,getUserIdForChat:()=> 'alice'},checkHabitConfirmation:()=>false,traceOptions:{log(){}}});
 await handler({chat:{id:1,type:'private'},message:{message_id:1,photo:[{file_id:'test'}],caption:'Speichere das unter dem Namen "test1"'}});
 assert.equal(saved[0].user,'alice');assert.equal(saved[0].name,'test1');assert.equal(prompts,0);assert.match(sent[0].text,/test1.png/);
 await handler({chat:{id:2,type:'private'},message:{message_id:2,photo:[{file_id:'test'}],caption:'Speichere das als fremd'}});assert.equal(saved.length,1);
});

test('service client sends owner, name and exact image to authenticated upload endpoint',async()=>{
 let request;
 const client=createServiceClient({agentUrl:'http://agent',internalToken:'synthetic'},{fetchImpl:async(url,options)=>{request={url,options};return new Response('{"name":"test1.png"}');}});
 assert.equal((await client.saveUpload('alice','BASE64','test1')).name,'test1.png');
 assert.equal(request.url,'http://agent/uploads');assert.equal(request.options.headers.Authorization,'Bearer synthetic');assert.deepEqual(JSON.parse(request.options.body),{user_id:'alice',image_base64:'BASE64',name:'test1'});client.close();
});
