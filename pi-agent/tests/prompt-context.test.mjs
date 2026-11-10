if(process.env.RIBO_TEST_ISOLATED!=='1') throw Error('Isolated workspace required');
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.USERS_CONFIG_PATH = '/tmp/prompt-context-users.json';
const { preparePrompt, readUserContext, userContextExtension } = await import('../services/prompt-context.js');

test('new sessions project persisted facts/style, refresh changes, and do not repeat context in user turns', () => {
  const user='contextperf';
  const file=`/workspace/users/${user}/memory/long_term.json`;
  fs.mkdirSync(`/workspace/users/${user}/memory`,{recursive:true});
  fs.writeFileSync(file,JSON.stringify([{text:'synthetic preference'}]));
  const config=process.env.USERS_CONFIG_PATH || '/workspace/users.json';
  const old=fs.existsSync(config)?fs.readFileSync(config):null;
  fs.writeFileSync(config,JSON.stringify({users:{[user]:{name:'Example',personality:'synthetic style'}},groups:{}}));
  try {
    let hook;
    const register=()=>userContextExtension(user)({on(event,fn){assert.equal(event,'before_agent_start');hook=fn;}});
    register();
    const first=hook({systemPrompt:'BASE'}).systemPrompt;
    assert.match(first,/synthetic preference/);
    assert.match(first,/synthetic style/);
    assert.equal(preparePrompt(user,'question',false),'question');
    assert.match(preparePrompt(user,'task',true),/Geplanter Auftrag/);
    register(); // A new session reads the same durable facts.
    assert.equal(hook({systemPrompt:'BASE'}).systemPrompt,first);
    fs.writeFileSync(file,JSON.stringify({facts:[{text:'updated preference'}]}));
    const changed=hook({systemPrompt:'BASE'}).systemPrompt;
    assert.match(changed,/updated preference/);
    assert.doesNotMatch(changed,/synthetic preference/);
    fs.writeFileSync(file,'[]');
    assert.doesNotMatch(hook({systemPrompt:'BASE'}).systemPrompt,/updated preference/);
    fs.writeFileSync(file,'{broken');
    assert.doesNotThrow(()=>readUserContext(user));
    assert.equal(fs.readFileSync(file,'utf8'),'{broken');
    assert.doesNotMatch(readUserContext('othercontext'),/synthetic style/);
  } finally {
    if(old===null) fs.unlinkSync(config); else fs.writeFileSync(config,old);
  }
});
