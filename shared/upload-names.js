/** Shared naming contract for the web API and Telegram captions. */
export class UploadNameError extends Error {}
export function imageFilename(name, extension) {
  if(typeof name!=='string')throw new UploadNameError('Bildname erforderlich');
  const base=name.trim().normalize('NFC').replace(/\.(?:png|jpe?g|webp)$/i,'');
  if(!/^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,119}$/u.test(base) || base.includes('..') || /[. ]$/.test(base)) {
    throw new UploadNameError('Bildname: 1–120 Buchstaben/Zahlen, Leerzeichen, Bindestrich oder Unterstrich; keine Pfade');
  }
  return `${base}.${extension}`;
}
export function savedPhotoCaption(caption) {
  if(typeof caption!=='string'||!/^\s*(?:bitte\s+)?(?:speicher(?:e|n)?|save)(?:\s|$)/i.test(caption))return null;
  const match=/\b(?:unter(?:\s+(?:dem\s+)?namen?)?|als(?:\s+(?:datei|name))?)\s+(.+?)\s*$/i.exec(caption);
  if(!match)return {name:undefined};
  const name=match[1].trim().replace(/^["'„“”«»]+|["'„“”«»]+[.!]?$/g,'').trim();
  return {name};
}
