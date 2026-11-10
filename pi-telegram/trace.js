import {randomUUID} from 'node:crypto';

/** Durations only: no chat IDs, text, audio or image contents. */
export function createTrace(kind, {log = console.log,now = () => performance.now(),incomingDate} = {}) {
  const started = now();
  const fields = {event:'telegram_duration',request_id:randomUUID(),kind};
  if(Number.isFinite(incomingDate)) fields.incoming_age_ms = Math.max(0,Math.round(Date.now()-incomingDate*1000));
  let finished = false;
  return {
    id:fields.request_id,
    mark(key) { if(fields[key]===undefined) fields[key]=Math.round(now()-started); },
    async measure(key,fn) {const begin=now();try{return await fn();}finally{fields[key]=(fields[key]||0)+Math.round(now()-begin);}},
    finish(outcome='ok') {if(finished)return;finished=true;try{log(JSON.stringify({...fields,total_ms:Math.round(now()-started),outcome}));}catch{}},
  };
}
