import fs from "node:fs";
import path from "node:path";
import { imageFilename, UploadNameError } from "../../shared/upload-names.js";
import { randomUUID } from 'node:crypto';
import { atomicWrite } from './storage.js';
import { resolveWithin } from './security.js';
import { getUserWorkspacePath, getCurrentAttachment, getCurrentUserId } from './users.js';
import { HttpError } from '../../shared/errors.js';

function validName(name,extension) {
  try{return imageFilename(name,extension);}catch(error){if(error instanceof UploadNameError)throw new HttpError(400,error.message);throw error;}
}

/** Store exactly the decoded attachment in its authenticated owner's workspace. */
export function saveIncomingImage(userId, base64, {name} = {}) {
  const data = Buffer.from(base64,'base64');
  if (!data.length || data.length > 10*1024*1024 || data.toString('base64') !== base64) {
    throw new HttpError(400,'Ungültiges Bild oder Bild größer als 10 MB');
  }
  let extension,mimeType;
  if (data.length>=8 && data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) {extension='png';mimeType='image/png';}
  else if(data.length>=3 && data[0]===255 && data[1]===216 && data[2]===255){extension='jpg';mimeType='image/jpeg';}
  else if(data.length>=12 && data.subarray(0,4).toString()==='RIFF' && data.subarray(8,12).toString()==='WEBP'){extension='webp';mimeType='image/webp';}
  else throw new HttpError(400,'Nur JPEG, PNG und WebP sind erlaubt');
  const filename=name ? validName(name,extension) : `${randomUUID()}.${extension}`;
  const relative=`uploads/${filename}`;
  const target=resolveWithin(getUserWorkspacePath(userId),relative);
  const temporary=resolveWithin(getUserWorkspacePath(userId),`uploads/.${randomUUID()}.pending`);
  try {
    atomicWrite(temporary,data);
    fs.linkSync(temporary,target); // Atomic publication without replacing an existing name.
  } catch(error) {
    if(error.code==='EEXIST')throw new HttpError(409,'Dieser Bildname existiert bereits. Bitte einen anderen Namen wählen.');
    throw error;
  } finally {try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
  return {userId,relative,mimeType,name:filename};
}

/** Current input wins; a model may never silently substitute an older inbox file. */
export function resolveGenerationSource(source, useUploadedImage = true) {
  const current=getCurrentAttachment();
  if(!current)return source || undefined;
  const userId=getCurrentUserId();
  if(current.deleted)throw new Error('Das aktuell angehängte Bild wurde gelöscht. Bitte erneut hochladen.');
  if(current.userId!==userId)throw new Error('Das angehängte Bild gehört nicht zu diesem Nutzer');
  if(useUploadedImage===false){
    if(source)throw new Error('Ohne Verwendung des aktuellen Uploads ist nur eine neue Erzeugung ohne Quellbild erlaubt');
    return undefined;
  }
  if(source && resolveWithin(getUserWorkspacePath(userId),source)!==resolveWithin(getUserWorkspacePath(userId),current.relative)) {
    throw new Error(`Falsches Quellbild: Zu dieser Nachricht gehört ${current.relative}. Keine ältere Datei verwenden.`);
  }
  return current.relative;
}

export function attachmentPrompt(message,attachment) {
  if(!attachment)return message;
  return `${message}\n\n[Aktuelles angehängtes Bild: ${attachment.relative}. Diese Datei gehört zum Bild DIESER Nachricht und ist die Quelle für dessen Bearbeitung/Animation. Keine älteren Telegram-/Inbox-Dateien suchen oder einsetzen. Bei ausdrücklich neuer Erzeugung ohne Vorlage use_uploaded_image:false setzen.]`;
}

function ownedUpload(userId,filename) {
  if(typeof filename!=='string' || path.basename(filename)!==filename || !/\.(?:png|jpg|webp)$/i.test(filename))throw new HttpError(400,'Ungültiger Bildname');
  const extension=path.extname(filename).slice(1).toLowerCase();
  if(validName(filename,extension)!==filename)throw new HttpError(400,'Ungültiger Bildname');
  const file=resolveWithin(getUserWorkspacePath(userId),`uploads/${filename}`);
  let stat;
  try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')throw new HttpError(404,'Bild nicht gefunden');throw error;}
  if(!stat.isFile()||stat.isSymbolicLink())throw new HttpError(403,'Zugriff verweigert');
  return {file,stat,extension};
}
export function listUploads(userId, offset=0) {
  const root=resolveWithin(getUserWorkspacePath(userId),'uploads');
  if(!fs.existsSync(root))return {files:[],total:0,next:null};
  const files=[];
  for(const name of fs.readdirSync(root)){
    if(name.startsWith('.'))continue;
    try{const {stat}=ownedUpload(userId,name);files.push({name,relative:`uploads/${name}`,size:stat.size,date:stat.mtime.toISOString(),url:`/uploads/${encodeURIComponent(name)}/content`});}catch{}
  }
  files.sort((a,b)=>b.date.localeCompare(a.date)||a.name.localeCompare(b.name));
  return {files:files.slice(offset,offset+20),total:files.length,next:offset+20<files.length?offset+20:null};
}
export function uploadFile(userId,name){return ownedUpload(userId,name).file;}
export function renameUpload(userId,name,newName){
  const {file,extension}=ownedUpload(userId,name);
  const filename=validName(newName,extension);
  if(filename===name)return {name,relative:`uploads/${name}`};
  const target=resolveWithin(getUserWorkspacePath(userId),`uploads/${filename}`);
  try {fs.linkSync(file,target);}catch(error){if(error.code==='EEXIST')throw new HttpError(409,'Dieser Bildname existiert bereits');throw error;}
  try{fs.unlinkSync(file);}catch(error){fs.unlinkSync(target);throw error;}
  const current=getCurrentAttachment();
  if(current?.userId===userId&&current.relative===`uploads/${name}`){current.relative=`uploads/${filename}`;current.name=filename;}
  return {name:filename,relative:`uploads/${filename}`};
}
export function deleteUpload(userId,name){
  const {file}=ownedUpload(userId,name);fs.unlinkSync(file);
  const current=getCurrentAttachment();
  if(current?.userId===userId&&current.relative===`uploads/${name}`)current.deleted=true;
  return {ok:true};
}
