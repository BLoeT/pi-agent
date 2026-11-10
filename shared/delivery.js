import { updateJson } from "./storage.js";
export function claimDelivery(file,key,legacyKey) {
  return updateJson(file,{},ledger=>{
    const now=Date.now(),previous=ledger[key] || (legacyKey ? ledger[legacyKey] : undefined);
    if(typeof previous==="string" || (previous?.pending && now-previous.pending<2*3600000)) return false;
    ledger[key]={pending:now};return true;
  });
}
export function finishDelivery(file,key,success) {
  updateJson(file,{},ledger=>{
    if(success) ledger[key]=new Date().toISOString();else delete ledger[key];
    for(const [id,value] of Object.entries(ledger)) {
      const timestamp=typeof value==="string"?Date.parse(value):value?.pending;
      if(timestamp && Date.now()-timestamp>7*86400000) delete ledger[id];
    }
  });
}
export function localDateKey(date=new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
