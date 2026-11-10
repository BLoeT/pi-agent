import { COMMAND_HELP, isCommandHelp } from './command-help.js';
import { redact } from '../shared/errors.js';
import { savedPhotoCaption } from '../shared/upload-names.js';
import { createTrace } from './trace.js';
import { createPreview } from './preview.js';

/** Authorized user flows. Timings and drafts never include reasoning or tool output. */
export function createMessageHandler({bot,users,client,messenger,checkHabitConfirmation,
  preferences={get:()=>({voice:true,preview:true})},traceOptions={}}) {
  return async ctx => {
    if(client.closed)return;
    const msg=ctx.message, chatId=ctx.chat?.id;
    if(!msg || chatId==null)return;
    const messageId=msg.message_id;
    const send=text=>bot.api.sendMessage({chat_id:chatId,text,reply_parameters:{message_id:messageId}});
    if(msg.text==='/id') {await send(`Deine Chat-ID: ${chatId}. Gib diese ID einem Admin zur Freischaltung.`);return;}
    if(!users.isAuthorized(chatId)) {await send('⛔ Kein Zugriff. Schick /id und frage einen Admin nach Freischaltung.');return;}
    const userId=users.getUserIdForChat(chatId);
    if(!userId){await send('⛔ Nutzer nicht zugeordnet.');return;}
    if(isCommandHelp(msg.text)) {await send(COMMAND_HELP);return;}
    const modelCommand=/^\/modell(?:@\w+)?(?:\s+(.*))?$/i.exec(msg.text || '');
    if(modelCommand) {
      const choice=(modelCommand[1] || '').trim();
      try {
        if(!choice || choice.toLowerCase()==='aktualisieren') {
          const data=await client.models(userId,choice.toLowerCase()==='aktualisieren');
          const lines=data.models.map((model,index)=>`${index+1}. ${model.id}${model.vision?' · Bilder':''}${model.tools?'':' · ohne Werkzeuge'}`);
          await send(`Aktuelles Modell: ${data.selected}\n\n${lines.join('\n') || 'Keine Chatmodelle verfügbar.'}\n\nWechseln: /modell MODELLNAME\nNeue Modelle einlesen: /modell aktualisieren`);
        } else {
          const result=await client.setModel(userId,choice);
          await send(`Modell: ${result.selected}\nGilt für deinen Nutzer in Web und Telegram und bleibt nach einem Neustart gespeichert. Dein Chatverlauf bleibt erhalten.${result.model.vision?'':'\nDieses Modell kann keine Bilder analysieren.'}${result.model.tools?'':'\nDieses Modell unterstützt keine Werkzeuge.'}`);
        }
      } catch(error) {
        await send(error.status===409?'Bitte die laufende Antwort abwarten oder stoppen und dann erneut wechseln.':error.status===400?'Modell nicht verfügbar. Mit /modell aktualisieren die aktuellen Namen anzeigen.':'Die Modellauswahl ist gerade nicht erreichbar. Bitte erneut versuchen.');
      }
      return;
    }
    if(/^\/modus(?:\s|$)/.test(msg.text || '')) {
      const choice=msg.text.trim().split(/\s+/)[1]?.toLowerCase();
      const modes={schnell:'off',normal:'low',gruendlich:'medium',gründlich:'medium',maximal:'xhigh'};
      if(modes[choice])client.thinkingModes.set(userId,modes[choice]);
      await send(modes[choice] ? `Denkmodus: ${choice}. Gilt bis zum Bot-Neustart.` : 'Wähle /modus schnell, normal, gruendlich oder maximal.');
      return;
    }
    const setting=/^\/(audio|vorschau)(?:\s+(an|aus))?\s*$/i.exec(msg.text || '');
    if(setting) {
      try {
        const key=setting[1].toLowerCase()==='audio'?'voice':'preview';
        const value=setting[2] ? preferences.set(userId,key,setting[2].toLowerCase()==='an') : preferences.get(userId);
        await send(`${key==='voice'?'Sprachantworten':'Textvorschau'}: ${value[key]?'an':'aus'}. Ändern mit /${key==='voice'?'audio':'vorschau'} an oder aus. Gilt auch nach Neustart.`);
      } catch {await send('Einstellung konnte nicht gespeichert werden. Bestehende Einstellungen bleiben erhalten.');}
      return;
    }
    if(msg.text==='/start') {await send('👋 Ich bin Ribo. Schick Text, Foto oder eine Sprachnachricht. Frag mich einfach: „Welche Befehle gibt es?“ Dann zeige ich dir die ganze Übersicht.');return;}
    if(msg.text==='/reset') {
      try {await client.reset(userId);await send('🔄 Neuer Chat gestartet. Dein Langzeitgedächtnis bleibt erhalten.');}
      catch {if(!client.closed)await send('❌ Reset fehlgeschlagen.');}
      return;
    }
    const kind=msg.voice || msg.audio ? 'voice' : msg.photo ? 'photo' : msg.text && !msg.text.startsWith('/') ? 'text' : null;
    if(!kind)return;
    const trace=createTrace(kind,{...traceOptions,incomingDate:msg.date});
    let preview;
    try {
      const settings=preferences.get(userId);
      let prompt=msg.text,image=null;
      if(kind==='text') {
        const habit=checkHabitConfirmation(userId,msg.text);
        if(habit) {await send(habit.confirmed ? `✅ Alles klar! "${habit.name}" ist jetzt aktiv.` : '👍 Okay, mache ich nicht.');return;}
      }
      await bot.api.sendChatAction({chat_id:chatId,action:'typing'});
      if(kind==='voice') {
        const bytes=await trace.measure('download_ms',()=>client.downloadTelegramFile((msg.voice || msg.audio).file_id));
        prompt=await trace.measure('stt_ms',()=>client.transcribeAudio(bytes));
        if(!prompt || prompt.length<2){await send('🤷 Ich habe nichts verstanden. Versuch es nochmal.');return;}
        await send(`🎤 ${prompt}`);
      } else if(kind==='photo') {
        const photo=msg.photo[msg.photo.length-1];
        const bytes=await trace.measure('download_ms',()=>client.downloadTelegramFile(photo.file_id));
        const caption=(msg.caption || '').trim().toLowerCase();
        const save=savedPhotoCaption(msg.caption || '');
        if(save) {
          try {
            const saved=await client.saveUpload(userId,bytes.toString('base64'),save.name);
            await send(`Bild gespeichert als ${saved.name}. Du kannst es später umbenennen oder löschen.`);
          } catch(error) {
            if(error.status===409)await send('Dieser Bildname ist bereits belegt. Bitte einen anderen Namen wählen.');
            else if(error.status===400)await send('Bitte einen gültigen Bildnamen ohne Pfade verwenden, zum Beispiel: Speichere das unter dem Namen "test1".');
            else throw error;
          }
          return;
        }
        image=bytes.toString('base64');
        prompt=caption ? `Ich habe dir ein Foto geschickt mit dem Hinweis: "${msg.caption}". Schau es dir an und handle entsprechend.`
          : 'Schau dir das Foto an. Beschreibe es kurz und schlage bei nützlichen Informationen passende Aktionen vor. Frage vor dem Speichern nach.';
      }
      preview=createPreview({bot,chatId,enabled:settings.preview && ctx.chat?.type==='private',onVisible:()=>trace.mark('first_visible_ms')});
      const response=await trace.measure('agent_ms',()=>client.sendToAgent(prompt,userId,image,{
        requestId:trace.id,onDelta:delta=>{trace.mark('first_text_delta_ms');preview.push(delta);},
      }));
      await preview.close();
      await messenger.reply(chatId,response,messageId,{voice:settings.voice,trace});
    } catch(error) {
      trace.finish(client.closed?'cancelled':'error');
      await preview?.close();
      if(!client.closed) {
        console.error(JSON.stringify({event:'telegram_message_failed',request_id:trace.id,kind,message:redact(error.message)}));
        await send('❌ Fehler bei der Verarbeitung. Bitte versuche es erneut.');
      }
    } finally {await preview?.close();trace.finish(client.closed?'cancelled':'ok');}
  };
}
