import {defineTool} from '@earendil-works/pi-coding-agent';
import {Type} from '@sinclair/typebox';
import {getCurrentUserId} from '../lib/users.js';
import {listUploads,renameUpload,deleteUpload} from '../lib/uploads.js';

/** Every user may manage their own uploaded photos, without wider file permissions. */
export default defineTool({
 name:'uploads',label:'Meine Bilder',
 description:'Verwaltet ausschließlich die eigenen hochgeladenen Bilder aus Web und Telegram. list zeigt aktuelle Namen/Pfade, rename benennt ein Bild um (z.B. test1), delete löscht die Datei. Keine fremden Nutzer oder sonstigen Dateien zugänglich. Vor Änderungen den passenden Dateinamen aus dem aktuellen Auftrag oder list verwenden.',
 parameters:Type.Object({action:Type.String({enum:['list','rename','delete']}),name:Type.Optional(Type.String({description:'Vollständiger Bildname aus list, z.B. test1.png'})),new_name:Type.Optional(Type.String({description:'Neuer Name für rename, z.B. test1'})),offset:Type.Optional(Type.Integer({minimum:0}))}),
 execute:async(_id,{action,name,new_name,offset=0})=>{
  try{
   const userId=getCurrentUserId();let value;
   if(action==='list'){if(!Number.isSafeInteger(offset)||offset<0)throw Error('Ungültige Seite');value=listUploads(userId,offset);}
   else if(action==='rename')value=renameUpload(userId,name,new_name);
   else if(action==='delete')value=deleteUpload(userId,name);
   else throw Error('Unbekannte Bildaktion');
   return {content:[{type:'text',text:JSON.stringify({status:'ok',...value})}],details:{}};
  }catch(error){return {content:[{type:'text',text:JSON.stringify({error:error.status?error.message:'Bildverwaltung fehlgeschlagen; Dateiname prüfen.'})}],details:{},isError:true};}
 }
});
