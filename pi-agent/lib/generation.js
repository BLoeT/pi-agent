import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {resolveWithin,safeName,serviceHeaders} from "./security.js";
import {fetchResponse} from "./http.js";
export async function generateRequest(url,body,{signal,timeout}) {
  if(signal?.aborted) throw signal.reason || new Error("Abgebrochen");
  const job_id=randomUUID();
  const combined=AbortSignal.any([AbortSignal.timeout(timeout),...(signal?[signal]:[])]);
  let cancellation;
  const cancel=()=>{
    const target=new URL("/cancel",url);
    cancellation=fetch(target,{method:"POST",headers:serviceHeaders({"Content-Type":"application/json"}),body:JSON.stringify({job_id}),signal:AbortSignal.timeout(5000)}).then(response=>response.arrayBuffer()).catch(()=>{});
  };
  combined.addEventListener("abort",cancel,{once:true});
  try {
    const response=await fetchResponse(url,{method:"POST",headers:serviceHeaders({"Content-Type":"application/json"}),body:JSON.stringify({...body,job_id})},{signal:combined,timeout});
    const data=await response.json();
    if(!response.ok || data.error) throw new Error(data.error || `Generierung: HTTP ${response.status}`);
    return data;
  } finally {combined.removeEventListener("abort",cancel);if(cancellation)await cancellation;}
}
export function claimGeneratedFile(data,{kind,filename,userDir}) {
  if(typeof data.path!=="string") throw new Error("Generierungsdienst hat keinen Dateipfad geliefert");
  const extension=kind==="image"?".png":".mp4";
  const folder=kind==="image"?"generated-images":"generated-videos";
  const sourceName=safeName(path.basename(data.path));
  if(!sourceName.endsWith(extension)) throw new Error("Unerwartetes Ausgabeformat");
  const source=resolveWithin(path.join("/workspace",folder),sourceName);
  let stat;
  try {stat=fs.statSync(source);} catch(error) {if(error.code==="ENOENT")throw new Error("Generierte Datei fehlt");throw error;}
  if(!stat.isFile() || stat.size===0) throw new Error("Generierte Datei fehlt oder ist leer");
  fs.mkdirSync(userDir,{recursive:true});
  let name=safeName(filename?.trim() || sourceName);
  if(!name.endsWith(extension)) name+=extension;
  const target=resolveWithin(userDir,name);
  try {fs.renameSync(source,target);}
  catch(error) {
    if(error.code!=="EXDEV") throw error;
    const temporary=resolveWithin(userDir,`transfer-${randomUUID()}.tmp`);
    try {fs.copyFileSync(source,temporary,fs.constants.COPYFILE_EXCL);resolveWithin(userDir,name);fs.renameSync(temporary,target);fs.unlinkSync(source);}
    finally {try{fs.unlinkSync(temporary);}catch(error){if(error.code!=="ENOENT")throw error;}}
  }
  return path.join(folder,name);
}
