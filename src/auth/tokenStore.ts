import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".config", "mmm-mcp");
const CREDENTIALS_PATH = join(CONFIG_DIR, "credentials.json");

export interface StoredCredentials {
  uid: string;
  email: string | null;
  refreshToken: string;
  provider: "password" | "google.com" | "apple.com";
}

function ensureConfigDir(): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

export function saveCredentials(credentials: StoredCredentials): void {
  ensureConfigDir();
  writeFileSync(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2), {
    mode: 0o600,
  });
}

export function loadCredentials(): StoredCredentials | null {
  if (!existsSync(CREDENTIALS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"));
  } catch {
    return null;
  }
}

export function clearCredentials(): void {
  if (existsSync(CREDENTIALS_PATH)) {
    rmSync(CREDENTIALS_PATH);
  }
}

export function credentialsPath(): string {
  return CREDENTIALS_PATH;
}
