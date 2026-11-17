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
/** `server`: AI through the signed-in APEX server. `custom`: an OpenAI-compatible endpoint and key. */
export type AiMode = "server" | "custom";
export interface AiConnectionStatus {
  configured: boolean;
  /** The stored mode; null when nothing is stored or the user's own environment manages AI. */
  mode: AiMode | null;
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
/** Above the server's own 90 s upstream wait, so the engine never gives up on an answer still being billed. */
const SERVER_TIMEOUT = 120;
/** The engine must outlast the server's own wait; a shorter one is raised to this. */
const SERVER_TIMEOUT_FLOOR = 100;

interface Params {
  temperature: number;
  max_output: number;
  timeout: number;
}
type Stored =
  | (Params & { mode: "server" })
  | (Params & {
      mode: "custom";
      base_url: string;
      model_id: string;
      key: string;
    });

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

function validParams(s: Record<string, unknown>): boolean {
  return (
    inRange(s.temperature, 0, 2) &&
    inRange(s.max_output, 1, 200000) &&
    Number.isInteger(s.max_output) &&
    inRange(s.timeout, 1, 600)
  );
}

function readStored(deps: AiDeps): Stored | null {
  const text = deps.file.read();
  if (text === null) return null;
  try {
    const v: unknown = JSON.parse(text);
    if (typeof v !== "object" || v === null) return null;
    const s = v as Record<string, unknown>;
    if (!validParams(s)) return null;
    const params = {
      temperature: s.temperature,
      max_output: s.max_output,
      timeout: s.timeout,
    } as Params;
    if (s.mode === "server")
      return {
        mode: "server",
        ...params,
        timeout: Math.max(params.timeout, SERVER_TIMEOUT_FLOOR),
      };
    // Files written before modes existed hold a custom connection.
    if (
      (s.mode !== undefined && s.mode !== "custom") ||
      !validUrl(s.base_url) ||
      !validModel(s.model_id) ||
      typeof s.key !== "string"
    )
      return null;
    return {
      mode: "custom",
      ...params,
      base_url: s.base_url,
      model_id: s.model_id,
      key: s.key,
    };
  } catch {
    return null;
  }
}

type CustomStored = Extract<Stored, { mode: "custom" }>;

function decryptKey(stored: CustomStored, deps: AiDeps): string | null {
  try {
    const plain = deps.crypto.decrypt(Buffer.from(stored.key, "base64"));
    return plain === "" ? null : plain;
  } catch {
    return null;
  }
}

/** The stored connection, with a custom one's key decrypted; null when unusable. */
function usable(
  deps: AiDeps,
):
  | { stored: Extract<Stored, { mode: "server" }>; key: null }
  | { stored: CustomStored; key: string }
  | null {
  const stored = readStored(deps);
  if (!stored) return null;
  if (stored.mode === "server") return { stored, key: null };
  const key = decryptKey(stored, deps);
  return key === null ? null : { stored, key };
}

export function aiConnectionStatus(deps: AiDeps): AiConnectionStatus {
  const managed = isManaged(deps);
  const found = usable(deps);
  const stored = found?.stored;
  const custom = stored?.mode === "custom" ? stored : null;
  return {
    configured: managed || found !== null,
    mode: managed ? null : (stored?.mode ?? null),
    managed,
    has_key: found?.key != null,
    storage_available: deps.crypto.available(),
    base_url: custom?.base_url ?? null,
    model_id: custom?.model_id ?? null,
    temperature: stored?.temperature ?? DEFAULTS.temperature,
    max_output: stored?.max_output ?? DEFAULTS.max_output,
    // Nothing stored: a new connection starts in server mode.
    timeout: stored?.timeout ?? SERVER_TIMEOUT,
  };
}

/**
 * Gives ai.analyze the signed-in server's LLM address and access token when the
 * APEX server mode is stored. Only the main process may set them, so a copy from
 * the renderer is always dropped. The token travels in the request body over the
 * engine's authenticated loopback, never through the engine's environment.
 */
export async function attachServerConnection(
  operation: string,
  payload: Record<string, unknown>,
  deps: AiDeps,
  credentials: () => Promise<{ origin: string; access: string } | null>,
): Promise<void> {
  if (operation !== "ai.analyze" && operation !== "ai.prepare") return;
  delete payload.server_connection;
  if (operation !== "ai.analyze" || isManaged(deps)) return;
  if (readStored(deps)?.mode !== "server") return;
  const signedIn = await credentials();
  if (signedIn)
    payload.server_connection = {
      base_url: `${signedIn.origin}/llm/v1`,
      access_token: signedIn.access,
    };
}

const INVALID: AiSaveResult = { ok: false, code: "AI_CONNECTION_INVALID" };

export function saveAiConnection(input: unknown, deps: AiDeps): AiSaveResult {
  if (isManaged(deps)) return { ok: false, code: "AI_CONNECTION_MANAGED" };
  if (typeof input !== "object" || input === null) return INVALID;
  const i = input as Record<string, unknown>;
  const mode = i.mode ?? "custom";
  if (mode !== "server" && mode !== "custom") return INVALID;
  if (mode === "custom" && (!validUrl(i.base_url) || !validModel(i.model_id)))
    return INVALID;
  const temperature = i.temperature ?? DEFAULTS.temperature;
  const max_output = i.max_output ?? DEFAULTS.max_output;
  const timeout =
    i.timeout ?? (mode === "server" ? SERVER_TIMEOUT : DEFAULTS.timeout);
  if (
    !inRange(temperature, 0, 2) ||
    !inRange(max_output, 1, 200000) ||
    !Number.isInteger(max_output) ||
    !inRange(timeout, 1, 600)
  )
    return INVALID;
  const params = { temperature, max_output, timeout } as Params;
  if (mode === "server") {
    deps.file.write(
      JSON.stringify({
        mode: "server",
        ...params,
        timeout: Math.max(params.timeout, SERVER_TIMEOUT_FLOOR),
      }),
    );
    return { ok: true };
  }

  // An empty or omitted key keeps the one already stored.
  let key: string;
  if (i.api_key === undefined || i.api_key === "") {
    const existing = usable(deps);
    if (!existing?.key) return INVALID;
    key = existing.key;
  } else if (validKey(i.api_key)) {
    key = i.api_key;
  } else {
    return INVALID;
  }

  if (!deps.crypto.available())
    return { ok: false, code: "AI_KEY_STORAGE_UNAVAILABLE" };

  const stored: Stored = {
    mode: "custom",
    ...params,
    base_url: i.base_url as string,
    model_id: i.model_id as string,
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
  if (found.key === null) {
    const { temperature, max_output, timeout } = found.stored;
    // No secret here: the access token reaches the engine with each ai.analyze request.
    return {
      [CONFIG_ENV]: JSON.stringify({
        connection: "APEX_SERVER",
        temperature,
        max_output,
        timeout,
      }),
    };
  }
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
