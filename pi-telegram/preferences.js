import path from 'node:path';
import {readJson,updateJson} from '../shared/storage.js';
import {validUserId} from '../shared/identity.js';

export function createPreferences(root = '/workspace') {
  const file = userId => {
    if (!validUserId(userId)) throw Error('Ungültiger Nutzer');
    return path.join(root,'users',userId,'telegram-settings.json');
  };
  const validate = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        ['voice','preview'].some(key=>value[key]!==undefined && typeof value[key]!=='boolean')) throw Error('Ungültige Telegram-Einstellungen');
    return {voice:value.voice ?? true,preview:value.preview ?? true};
  };
  return {
    get(userId) { return validate(readJson(file(userId),{})); },
    set(userId,key,enabled) {
      if (!['voice','preview'].includes(key) || typeof enabled !== 'boolean') throw Error('Ungültige Einstellung');
      return updateJson(file(userId),{},value=>{validate(value);value[key]=enabled;return validate(value);});
    },
  };
}
