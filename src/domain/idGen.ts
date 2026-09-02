import { randomBytes } from "node:crypto";

const CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Firestoreの自動ID発行(20文字のランダム文字列)相当のIDを生成する。 */
export function newDocId(): string {
  const bytes = randomBytes(20);
  let id = "";
  for (let i = 0; i < 20; i++) {
    id += CHARS[bytes[i] % CHARS.length];
  }
  return id;
}
