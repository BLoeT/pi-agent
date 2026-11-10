import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startBackgroundServices } from '../scheduler.js';

test('failed proactive send can retry, successful send is deduplicated', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ribo-scheduler-'));
  const now = new Date();
  fs.writeFileSync(path.join(workspace,'proactive_rules.json'), JSON.stringify([
    {id:'test',userId:'alice',enabled:true,hour:now.getHours(),minute:now.getMinutes(),prompt:'Test',name:'Test'}
  ]));
  let fails = true, sent = 0;
  const scheduler = startBackgroundServices({workspace,start:false,
    loadUsersConfig:()=>({users:{alice:{chat_id:123}},groups:{}}),
    sendToAgent:async()=> 'Test answer',
    bot:{api:{sendMessage:async()=>{if(fails)throw Error('simulated network error');sent++;}}}
  });
  try {
    await scheduler.checkProactiveRules();
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(workspace,'reminder_sent.json'),'utf8')), {});
    fails=false;
    await scheduler.checkProactiveRules();
    await scheduler.checkProactiveRules();
    assert.equal(sent,1);
  } finally {scheduler.stop();fs.rmSync(workspace,{recursive:true,force:true});}
});
