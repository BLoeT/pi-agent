import test from 'node:test';
import assert from 'node:assert/strict';
import {createMessageHandler} from '../handlers.js';
import {createServiceClient} from '../client.js';

test('Telegram model commands use authorized identity and never invoke the LLM',async()=>{
 const sent=[],calls=[];
 const client={closed:false,async models(user,refresh){calls.push({user,refresh});return {selected:'old',models:[{id:'new:latest',vision:true,tools:true}]};},async setModel(user,model){calls.push({user,model});return {selected:model,model:{vision:false,tools:false}};}};
 const handler=createMessageHandler({client,bot:{api:{async sendMessage(msg){sent.push(msg);}}},users:{isAuthorized:id=>id===1,getUserIdForChat:()=> 'alice'},messenger:{}});
 const send=(text,id=1)=>handler({chat:{id},message:{message_id:1,text}});
 await send('/modell');await send('/modell aktualisieren');await send('/modell new:latest');await send('/modell new:latest',2);
 assert.deepEqual(calls,[{user:'alice',refresh:false},{user:'alice',refresh:true},{user:'alice',model:'new:latest'}]);
 assert.match(sent[0].text,/new:latest/);assert.match(sent[2].text,/keine Bilder/);assert.match(sent[2].text,/keine Werkzeuge/);assert.match(sent[3].text,/Kein Zugriff/);
});

test('Telegram model client sends mapped owner in authenticated JSON only',async()=>{
 const requests=[];
 const client=createServiceClient({agentUrl:'http://agent',internalToken:'synthetic'},{fetchImpl:async(url,options)=>{requests.push({url,options});return new Response('{"selected":"new"}');}});
 await client.models('alice',true);await client.setModel('alice','new');
 assert.deepEqual(requests.map(r=>r.url),['http://agent/models/list','http://agent/model']);
 assert.deepEqual(JSON.parse(requests[0].options.body),{user_id:'alice',refresh:true});assert.deepEqual(JSON.parse(requests[1].options.body),{user_id:'alice',model:'new'});
 assert.ok(requests.every(r=>r.options.headers.Authorization==='Bearer synthetic'));client.close();
});
