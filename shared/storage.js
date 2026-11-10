import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const LOCK_TIMEOUT_MS = 5000;
const STALE_LOCK_MS = 60000;

/** Reject existing symlinks in fixed data paths, including dangling links. */
export function assertSafePath(file) {
  let current = path.resolve(file);
  while (true) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Symlink als Datenpfad nicht erlaubt");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

/** Missing data gets a fresh default; corrupt data is never silently reset. */
export function readJson(file, fallback) {
  assertSafePath(file);
  let content;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(fallback);
    throw error;
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Datendatei beschädigt; Original bleibt erhalten: ${path.basename(file)}`);
  }
}

/** Replace one complete file; an interrupted write leaves its predecessor intact. */
export function atomicWrite(file, content) {
  assertSafePath(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, content);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    assertSafePath(file);
    fs.renameSync(temporary, file);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

/** Cross-process lock for short synchronous read/modify/write operations only. */
export function withFileLock(file, callback) {
  assertSafePath(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      assertSafePath(lock);
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > STALE_LOCK_MS) {
          fs.rmdirSync(lock);
          continue;
        }
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (Date.now() > deadline) throw new Error("Datendatei beschäftigt; bitte erneut versuchen");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try {
    const result = callback();
    if (result && typeof result.then === "function") {
      throw new Error("Dateisperren dürfen keine asynchronen Aktionen enthalten");
    }
    return result;
  } finally {
    fs.rmdirSync(lock);
  }
}

export function updateJson(file, fallback, callback) {
  return withFileLock(file, () => {
    const value = readJson(file, fallback);
    if (Array.isArray(fallback) !== Array.isArray(value) || value === null || typeof value !== "object") {
      throw new Error("Ungültiges Datenformat; Original bleibt erhalten");
    }
    const result = callback(value);
    atomicWrite(file, JSON.stringify(value, null, 2));
    return result;
  });
}
