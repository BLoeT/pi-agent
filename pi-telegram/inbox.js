import path from "node:path";
import { randomUUID } from "node:crypto";
import { validUserId } from "../shared/identity.js";
import { assertSafePath, atomicWrite } from "../shared/storage.js";

export function savePhoto(userId, data, workspace = "/workspace") {
  if (!validUserId(userId)) throw new Error("Ungültiger Nutzer");
  const extension = data.subarray(0, 4).toString("hex") === "89504e47" ? "png"
    : data.subarray(0, 4).toString() === "RIFF" ? "webp" : "jpg";
  const filename = `telegram_${randomUUID()}.${extension}`;
  const target = path.join(workspace, "users", userId, "telegram-inbox", filename);
  assertSafePath(target);
  atomicWrite(target, data);
  return filename;
}
