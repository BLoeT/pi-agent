import { randomUUID } from "node:crypto";
import { getCurrentUserId } from "/app/lib/users.js";
import { updateJson } from "/app/lib/storage.js";
import { parseReminderTime } from "/shared/reminders.js";
const file="/workspace/data/reminders.json";
export default {
  name:"reminders", label:"Erinnerungen",
  description:"Erstellt echte Telegram-Erinnerungen. create, list, cancel, reschedule. Zeit eindeutig angeben: morgen 08:00, in 10 Minuten, jeden Montag um 09:00 oder TT.MM.YYYY HH:mm.",
  parameters:{type:"object",properties:{action:{type:"string",enum:["create","list","cancel","reschedule"]},text:{type:"string"},time:{type:"string"},user:{type:"string"},id:{type:"string"}},required:["action"]},
  execute:async(_id,{action,text,time,user,id})=>{
    try {
      const current=getCurrentUserId();
      if(user && user!==current) throw new Error("Nur eigene Erinnerungen erlaubt");
      return updateJson(file,[],reminders=>{
        let value;
        if(action==="list") value={status:"ok",reminders:reminders.filter(r=>r.active && r.user===current).map(r=>({...r,scheduled:Boolean(r.due_at),...(!r.due_at?{notice:"Zeitpunkt mit reschedule bestätigen; alte Erinnerung war noch nicht terminiert"}:{})}))};
        else if(action==="create") {
          if(typeof text!=="string" || !text.trim() || text.length>3500) throw new Error("Erinnerungstext muss 1–3500 Zeichen haben");
          const timing=parseReminderTime(time);
          const reminder={id:randomUUID(),user:current,text:text.trim(),time,...timing,created:new Date().toISOString(),active:true};
          reminders.push(reminder);value={status:"ok",message:"Erinnerung terminiert",reminder};
        } else {
          const reminder=reminders.find(r=>r.id===id && r.user===current);
          if(!reminder) throw new Error("Eigene Erinnerung nicht gefunden");
          if(action==="cancel") reminder.active=false;
          else if(action==="reschedule") {delete reminder.recurrence;Object.assign(reminder,parseReminderTime(time),{time,active:true});}
          else throw new Error("Unbekannte Aktion");
          value={status:"ok",reminder};
        }
        return {content:[{type:"text",text:JSON.stringify(value)}],details:{}};
      });
    } catch(error) {return {content:[{type:"text",text:JSON.stringify({error:error.message})}],details:{}};}
  }
};
