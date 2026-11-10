import {randomInt} from 'node:crypto';

export function previewText(text) {
  let visible=text.replace(/<(think|thinking)>[\s\S]*?(?:<\/\1>|$)/gi,'');
  visible=visible.replace(/\[(?:FILE|IMAGE):[^\]]*(?:\]|$)/g,'');
  const bracket=visible.lastIndexOf('[');
  if(bracket>=0 && ['[FILE:','[IMAGE:'].some(marker=>marker.startsWith(visible.slice(bracket)))) visible=visible.slice(0,bracket);
  return visible.slice(0,4096).trim();
}

/** Ephemeral drafts only; final delivery remains exactly one normal message/document. */
export function createPreview({bot,chatId,enabled=true,onVisible=()=>{},interval=1200,startDelay=600,
  now=()=>performance.now(),schedule=setTimeout,unschedule=clearTimeout}) {
  let closed=!enabled || typeof bot.api.sendMessageDraft!=='function', timer=null;
  let text='',last='',lastAt=-Infinity,flight=Promise.resolve(),sending=false;
  const draftId=randomInt(1,2147483647);
  const pump=()=>{
    timer=null;
    if(closed || sending)return;
    const visible=previewText(text);
    if(!visible || visible===last)return;
    const wait=interval-(now()-lastAt);
    if(wait>0){timer=schedule(pump,wait);return;}
    sending=true;last=visible;lastAt=now();
    flight=Promise.resolve().then(()=>bot.api.sendMessageDraft({chat_id:chatId,draft_id:draftId,text:visible},AbortSignal.timeout(3000))).then(()=>onVisible()).catch(()=>{closed=true;}).finally(()=>{
      sending=false;
      if(!closed && timer===null && previewText(text)!==last) timer=schedule(pump,interval);
    });
  };
  return {
    push(delta){if(closed)return;text+=delta;if(timer===null && !sending)timer=schedule(pump,lastAt===-Infinity?startDelay:Math.max(0,interval-(now()-lastAt)));},
    async close(){closed=true;if(timer!==null)unschedule(timer);timer=null;await flight;},
  };
}
