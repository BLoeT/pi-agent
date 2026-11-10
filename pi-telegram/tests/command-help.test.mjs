import test from 'node:test';
import assert from 'node:assert/strict';
import {COMMAND_HELP,isCommandHelp} from '../command-help.js';
import {createMessageHandler} from '../handlers.js';

test('plain German requests and help aliases find the command overview',()=>{
 for(const text of ['Was sind deine Commands?','Welche Befehle gibt es?','wie waren nochmal deine befehle','Zeig mir bitte deine Commands','Kannst du mir deine Commands zeigen?','Hast du eine Liste deiner Befehle?','Zeig mir die Befehle','commands','/hilfe','/help','/commands@RiboBot'])
  assert.equal(isCommandHelp(text),true,text);
 for(const text of [null,'Schalte das Licht an','/modell','/audio aus','Erkläre Python commands','Welche Linux-Befehle brauche ich zum Kopieren?','Was sind die wichtigsten Git Commands?'])
  assert.equal(isCommandHelp(text),false,String(text));
 assert.ok(COMMAND_HELP.length<4096);
 for(const command of ['/audio','/modell','/modus','/vorschau','/reset','/id','/start','/hilfe'])assert.ok(COMMAND_HELP.includes(command));
 assert.ok(!COMMAND_HELP.includes('/model '));
});

test('authorized command questions send exactly one overview without agent, preview or audio',async()=>{
 const sent=[];
 const handler=createMessageHandler({bot:{api:{async sendMessage(value){sent.push(value);}}},users:{isAuthorized:id=>id===1,getUserIdForChat:()=> 'alice'},client:{closed:false},messenger:{}});
 for(const text of ['Was sind deine Commands?','Welche Befehle gibt es?','/hilfe']){
  const count=sent.length;await handler({chat:{id:1},message:{message_id:7,text}});
  assert.equal(sent.length,count+1);assert.equal(sent.at(-1).text,COMMAND_HELP);assert.deepEqual(sent.at(-1).reply_parameters,{message_id:7});
 }
 await handler({chat:{id:2},message:{message_id:8,text:'Was sind deine Commands?'}});
 assert.match(sent.at(-1).text,/Kein Zugriff/);
});
