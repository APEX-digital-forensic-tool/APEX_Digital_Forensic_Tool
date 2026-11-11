export const STORED_KEY_ENV = "APEX_DESKTOP_AI_STORED_KEY";
const CONFIG_ENV = "APEX_DESKTOP_AI_CONFIG";
const PROVIDER_ID = "apex-desktop";

export interface TextFile {
  read(): string | null;
  write(text: string): void;
  remove(): void;
}
export interface KeyCrypto {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(cipher: Buffer): string;
}
export interface AiDeps {
  file: TextFile;
  crypto: KeyCrypto;
  env: Record<string, string | undefined>;
}
export interface AiConnectionStatus {
  configured: boolean;
  managed: boolean;
  has_key: boolean;
  storage_available: boolean;
  base_url: string | null;
  model_id: string | null;
  temperature: number;
  max_output: number;
  timeout: number;
}
export type AiSaveResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "AI_CONNECTION_INVALID"
        | "AI_KEY_STORAGE_UNAVAILABLE"
        | "AI_CONNECTION_MANAGED";
    };

const DEFAULTS = { temperature: 0, max_output: 4096, timeout: 30 };

interface Stored {
  base_url: string;
  model_id: string;
  temperature: number;
  max_output: number;
  timeout: number;
  key: string;
}

function isManaged(deps: AiDeps): boolean {
  return (deps.env[CONFIG_ENV] ?? "").trim() !== "";
}

function validUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.search || url.hash) return false;
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost")
  );
}

function inRange(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

function validModel(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 256;
}

function validKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 4096 &&
    // eslint-disable-next-line no-control-regex
    !/[\x00-\x1f\x7f]/.test(value)
  );
}

function readStored(deps: AiDeps): Stored | null {
  const text = deps.file.read();
  if (text === null) return null;
  try {
    const v: unknown = JSON.parse(text);
    if (typeof v !== "object" || v === null) return null;
    const s = v as Record<string, unknown>;
    if (
      !validUrl(s.base_url) ||
      !validModel(s.model_id) ||
      !inRange(s.temperature, 0, 2) ||
      !inRange(s.max_output, 1, 200000) ||
      !Number.isInteger(s.max_output) ||
      !inRange(s.timeout, 1, 600) ||
      typeof s.key !== "string"
    )
      return null;
    return s as unknown as Stored;
  } catch {
    return null;
  }
}

function decryptKey(stored: Stored, deps: AiDeps): string | null {
  try {
    const plain = deps.crypto.decrypt(Buffer.from(stored.key, "base64"));
    return plain === "" ? null : plain;
  } catch {
    return null;
  }
}

/** A stored connection whose key can be decrypted by this account. */
function usable(deps: AiDeps): { stored: Stored; key: string } | null {
  const stored = readStored(deps);
  if (!stored) return null;
  const key = decryptKey(stored, deps);
  return key === null ? null : { stored, key };
}

export function aiConnectionStatus(deps: AiDeps): AiConnectionStatus {
  const managed = isManaged(deps);
  const found = usable(deps);
  const stored = found?.stored;
  return {
    configured: managed || found !== null,
    managed,
    has_key: found !== null,
    storage_available: deps.crypto.available(),
    base_url: stored?.base_url ?? null,
    model_id: stored?.model_id ?? null,
    temperature: stored?.temperature ?? DEFAULTS.temperature,
    max_output: stored?.max_output ?? DEFAULTS.max_output,
    timeout: stored?.timeout ?? DEFAULTS.timeout,
  };
}

const INVALID: AiSaveResult = { ok: false, code: "AI_CONNECTION_INVALID" };

export function saveAiConnection(input: unknown, deps: AiDeps): AiSaveResult {
  if (isManaged(deps)) return { ok: false, code: "AI_CONNECTION_MANAGED" };
  if (typeof input !== "object" || input === null) return INVALID;
  const i = input as Record<string, unknown>;

  if (!validUrl(i.base_url) || !validModel(i.model_id)) return INVALID;
  const temperature = i.temperature ?? DEFAULTS.temperature;
  const max_output = i.max_output ?? DEFAULTS.max_output;
  const timeout = i.timeout ?? DEFAULTS.timeout;
  if (
    !inRange(temperature, 0, 2) ||
    !inRange(max_output, 1, 200000) ||
    !Number.isInteger(max_output) ||
    !inRange(timeout, 1, 600)
  )
    return INVALID;

  // An empty or omitted key keeps the one already stored.
  let key: string;
  if (i.api_key === undefined || i.api_key === "") {
    const existing = usable(deps);
    if (!existing) return INVALID;
    key = existing.key;
  } else if (validKey(i.api_key)) {
    key = i.api_key;
  } else {
    return INVALID;
  }

  if (!deps.crypto.available())
    return { ok: false, code: "AI_KEY_STORAGE_UNAVAILABLE" };

  const stored: Stored = {
    base_url: i.base_url,
    model_id: i.model_id,
    temperature,
    max_output,
    timeout,
    key: deps.crypto.encrypt(key).toString("base64"),
  };
  deps.file.write(JSON.stringify(stored));
  return { ok: true };
}

export function clearAiConnection(deps: AiDeps): AiSaveResult {
  if (isManaged(deps)) return { ok: false, code: "AI_CONNECTION_MANAGED" };
  deps.file.remove();
  return { ok: true };
}

/** Variables to add to the engine's environment; {} when managed by the user's own env, unset, or undecryptable. */
export function aiEnvironment(deps: AiDeps): Record<string, string> {
  if (isManaged(deps)) return {};
  const found = usable(deps);
  if (!found) return {};
  const { stored, key } = found;
  return {
    [CONFIG_ENV]: JSON.stringify({
      provider_id: PROVIDER_ID,
      base_url: stored.base_url,
      model_id: stored.model_id,
      api_key_env: STORED_KEY_ENV,
      temperature: stored.temperature,
      max_output: stored.max_output,
      timeout: stored.timeout,
    }),
    [STORED_KEY_ENV]: key,
  };
}
