import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';

export function constantEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

export { validUserId } from "../../shared/identity.js";

export function safeName(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 ||
      value.includes('..') || /[/\\\x00-\x1f\x7f]/.test(value) || value.startsWith('.')) {
    throw new Error('Ungültiger Datei- oder Anzeigename');
  }
  return value.trim();
}

function realLocation(target) {
  if (fs.existsSync(target)) return fs.realpathSync(target);
  // lstat also detects dangling symlinks, which must never be followed on write.
  try { if (fs.lstatSync(target).isSymbolicLink()) throw new Error('Ungültiger Symlink'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const parent = path.dirname(target);
  if (parent === target) throw new Error('Ungültiger Pfad');
  return path.join(realLocation(parent), path.basename(target));
}

export function resolveWithin(root, input, { allowRoot = false } = {}) {
  if (typeof input !== 'string' || !input || /[\x00-\x1f\x7f]/.test(input)) throw new Error('Ungültiger Pfad');
  const base = path.resolve(root);
  const target = path.resolve(base, input);
  const inside = (a, b) => {
    const rel = path.relative(a, b);
    return (allowRoot || rel !== '') && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
  };
  if (!inside(base, target) || !inside(realLocation(base), realLocation(target))) throw new Error('Zugriff außerhalb des Workspace verweigert');
  return target;
}

export function serviceHeaders(headers = {}) {
  const token = process.env.RIBO_INTERNAL_TOKEN;
  if (!token || token.length < 32) throw new Error('RIBO_INTERNAL_TOKEN fehlt oder ist zu kurz');
  return { ...headers, Authorization: `Bearer ${token}` };
}
