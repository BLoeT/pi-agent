import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadMemories,changeMemory,selectMemories,searchMemories} from '../lib/memory-store.js';

function fixture(fn) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ribo-memory-'));
  try {return fn(path.join(directory,'memory.json'));} finally {fs.rmSync(directory,{recursive:true,force:true});}
}

test('core memory survives many new facts, updates in place, and forget removes it', () => fixture(file => {
  const base=changeMemory(file,{action:'remember',text:'Synthetic household uses Mac mini',core:true}).memory;
  const same=changeMemory(file,{action:'remember',text:'Synthetic household uses Mac mini',core:true}).memory;
  assert.equal(base.id,same.id);
  const entries=loadMemories(file);
  for(let i=0;i<120;i++)entries.push({id:`extra-${i}`,text:`Detail ${i}`,category:'fact'});
  fs.writeFileSync(file,JSON.stringify(entries));
  assert.equal(selectMemories(loadMemories(file),'unrelated question').core[0].id,base.id);
  changeMemory(file,{action:'update',id:base.id,text:'Synthetic household uses Windows'});
  assert.match(selectMemories(loadMemories(file)).core[0].text,/Windows/);
  assert.doesNotMatch(JSON.stringify(loadMemories(file)),/Mac mini/);
  changeMemory(file,{action:'unpin',id:base.id});
  assert.equal(loadMemories(file).find(e=>e.id===base.id).core,false);
  changeMemory(file,{action:'pin',id:base.id});
  assert.equal(changeMemory(file,{action:'forget',id:base.id}).removed,1);
  assert.ok(!loadMemories(file).some(e=>e.id===base.id));
}));

test('relevant old project facts are retrieved without repeating all memories', () => {
  const entries=[{id:'base',text:'Synthetic basic profile',core:true},
    {id:'old',text:'Projekt Mondbasis uses synthetic batteries',category:'fact'},
    ...Array.from({length:30},(_,i)=>({id:String(i),text:`Other entry ${i}`}))];
  const selected=selectMemories(entries,'Welche Batterien nutzt meine Mondbasis?');
  assert.equal(selected.core.length,1);
  assert.equal(selected.relevant[0].id,'old');
  assert.equal(searchMemories(entries,'bitte sag mir etwas').length,0);
  assert.equal(selectMemories(entries,'unrelated').relevant.length,0);
});

test('core limits, corrupt files and missing ids do not overwrite stored data', () => fixture(file => {
  for(let i=0;i<20;i++)changeMemory(file,{action:'remember',text:`core ${i}`,core:true});
  const previous=fs.readFileSync(file,'utf8');
  assert.throws(()=>changeMemory(file,{action:'remember',text:'one too many',core:true}),/Grundwissen voll/);
  assert.equal(fs.readFileSync(file,'utf8'),previous);
  assert.throws(()=>changeMemory(file,{action:'update',id:'missing',text:'wrong'}));
  assert.equal(fs.readFileSync(file,'utf8'),previous);
  fs.writeFileSync(file,'{broken');
  assert.throws(()=>changeMemory(file,{action:'forget_all'}));
  assert.equal(fs.readFileSync(file,'utf8'),'{broken');
}));

test('legacy object format and explicit deletion remain compatible', () => fixture(file => {
  fs.writeFileSync(file,JSON.stringify({facts:[{text:'Old preference',category:'preference'}]}));
  assert.equal(selectMemories(loadMemories(file)).legacy,true);
  const result=changeMemory(file,{action:'remember',text:'Old preference',core:true});
  assert.ok(result.memory.id);
  assert.equal(loadMemories(file).length,1);
  assert.equal(selectMemories(loadMemories(file)).legacy,false);
  changeMemory(file,{action:'forget_all'});
  assert.deepEqual(loadMemories(file),[]);
}));
