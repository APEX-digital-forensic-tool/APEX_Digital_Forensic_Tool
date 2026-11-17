/**
 * The APEX server sign-in held by the main process. Tokens stay in this
 * module's memory: never on disk, never in a child process environment.
 */

export type SignedOutReason = "LOGGED_OUT" | "SESSION_EXPIRED";

type State =
  | { kind: "signed_out"; reason: SignedOutReason | null }
  | {
      kind: "signed_in";
      origin: string;
      access: string;
      refresh: string;
      expiresAt: number;
      /** Refresh this long before expiry: min(60 s, half the token's lifetime). */
      margin: number;
    };

/** What the renderer may see. No token ever crosses into it. */
export interface AccountStatus {
  /** `reconnecting`: signed in, but the access token lapsed and a refresh has not succeeded yet. */
  state: "signed_out" | "signed_in" | "reconnecting";
  connected: boolean;
  origin: string | null;
  expires_at: number | null;
  reason: SignedOutReason | null;
}

export type LoginError =
  | "VALIDATION_ERROR"
  | "AUTH_ORIGIN_INVALID"
  | "AUTH_LOGIN_FAILED"
  | "AUTH_SERVER_UNAVAILABLE"
  | "AUTH_CONTRACT_INVALID";

export interface SessionDeps {
  fetch: typeof fetch;
  now(): number;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  onChange(status: AccountStatus): void;
}

const REFRESH_MARGIN_MS = 60_000;
const RETRY_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;

/** Only https servers, or plain http on this machine for development. */
export function serverOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const local =
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" && !local)
  )
    return null;
  return url.origin;
}

type Tokens = { access: string; refresh: string; ttl: number };

function parseTokens(body: unknown): Tokens | null {
  const b = body as Record<string, unknown> | null;
  if (
    !b ||
    typeof b.access_token !== "string" ||
    typeof b.refresh_token !== "string" ||
    typeof b.expires_in !== "number" ||
    !(b.expires_in > 0)
  )
    return null;
  return {
    access: b.access_token,
    refresh: b.refresh_token,
    ttl: b.expires_in * 1000,
  };
}

export function createServerSession(deps: SessionDeps) {
  let state: State = { kind: "signed_out", reason: null };
  // Bumped on login and logout so a refresh that started earlier cannot revive or overwrite the session.
  let generation = 0;
  let refreshing: Promise<string | null> | null = null;
  let timer: unknown = null;

  function status(): AccountStatus {
    if (state.kind === "signed_out")
      return {
        state: "signed_out",
        connected: false,
        origin: null,
        expires_at: null,
        reason: state.reason,
      };
    const live = state.expiresAt > deps.now();
    return {
      state: live ? "signed_in" : "reconnecting",
      connected: live,
      origin: state.origin,
      expires_at: state.expiresAt,
      reason: null,
    };
  }

  function schedule(ms: number) {
    if (timer !== null) deps.clearTimer(timer);
    timer = deps.setTimer(
      () => {
        timer = null;
        void refresh();
      },
      Math.max(0, ms),
    );
  }

  function set(next: State) {
    state = next;
    if (next.kind === "signed_in")
      schedule(next.expiresAt - next.margin - deps.now());
    else if (timer !== null) {
      deps.clearTimer(timer);
      timer = null;
    }
    deps.onChange(status());
  }

  function signedIn(origin: string, tokens: Tokens): State {
    return {
      kind: "signed_in",
      origin,
      access: tokens.access,
      refresh: tokens.refresh,
      expiresAt: deps.now() + tokens.ttl,
      margin: Math.min(REFRESH_MARGIN_MS, tokens.ttl / 2),
    };
  }

  async function post(url: string, init: { body?: unknown; bearer?: string }) {
    return deps.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(init.bearer ? { Authorization: `Bearer ${init.bearer}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  async function login(
    input: unknown,
  ): Promise<
    { ok: true; status: AccountStatus } | { ok: false; code: LoginError }
  > {
    const i = input as Record<string, unknown> | null;
    if (
      !i ||
      typeof i.email !== "string" ||
      typeof i.password !== "string" ||
      typeof i.tenant_id !== "string"
    )
      return { ok: false, code: "VALIDATION_ERROR" };
    const origin = serverOrigin(i.origin);
    if (!origin) return { ok: false, code: "AUTH_ORIGIN_INVALID" };
    const attempt = ++generation;
    let response: Response;
    try {
      response = await post(`${origin}/auth/login`, {
        body: { email: i.email, password: i.password, tenant_id: i.tenant_id },
      });
    } catch {
      return { ok: false, code: "AUTH_SERVER_UNAVAILABLE" };
    }
    if (!response.ok)
      return {
        ok: false,
        code:
          response.status === 401
            ? "AUTH_LOGIN_FAILED"
            : "AUTH_SERVER_UNAVAILABLE",
      };
    const tokens = parseTokens(await response.json().catch(() => null));
    if (!tokens) return { ok: false, code: "AUTH_CONTRACT_INVALID" };
    if (attempt !== generation)
      return { ok: false, code: "AUTH_SERVER_UNAVAILABLE" };
    set(signedIn(origin, tokens));
    return { ok: true, status: status() };
  }

  /** Ends the session here at once, then asks the server to revoke it. */
  async function logout(): Promise<void> {
    const previous = state;
    generation++;
    refreshing = null;
    set({ kind: "signed_out", reason: "LOGGED_OUT" });
    if (previous.kind !== "signed_in") return;
    try {
      await post(`${previous.origin}/auth/logout`, { bearer: previous.access });
    } catch {
      // Unreachable server: the access token lapses on its own and the refresh token is gone.
    }
  }

  /** One refresh at a time: the server revokes the whole session when a rotated refresh token is reused. */
  function refresh(): Promise<string | null> {
    if (state.kind !== "signed_in") return Promise.resolve(null);
    refreshing ??= rotate(state, generation).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function rotate(
    from: Extract<State, { kind: "signed_in" }>,
    attempt: number,
  ): Promise<string | null> {
    let response: Response | null = null;
    try {
      response = await post(`${from.origin}/auth/refresh`, {
        body: { refresh_token: from.refresh },
      });
    } catch {
      response = null;
    }
    if (attempt !== generation) return null;
    if (response?.status === 401) {
      set({ kind: "signed_out", reason: "SESSION_EXPIRED" });
      return null;
    }
    const tokens = response?.ok
      ? parseTokens(await response.json().catch(() => null))
      : null;
    if (attempt !== generation) return null;
    if (!tokens) {
      // Server unreachable or misbehaving: keep the session and try again soon.
      schedule(RETRY_MS);
      deps.onChange(status());
      return from.expiresAt > deps.now() ? from.access : null;
    }
    set(signedIn(from.origin, tokens));
    return tokens.access;
  }

  /** A usable access token and the server it belongs to, refreshing first when close to expiry. */
  async function credentials(): Promise<{
    origin: string;
    access: string;
  } | null> {
    if (state.kind !== "signed_in") return null;
    const { origin } = state;
    const access =
      state.expiresAt - state.margin > deps.now()
        ? state.access
        : await refresh();
    return access ? { origin, access } : null;
  }

  function dispose() {
    generation++;
    refreshing = null;
    state = { kind: "signed_out", reason: null };
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  }

  return { status, login, logout, credentials, refresh, dispose };
}

export type ServerSession = ReturnType<typeof createServerSession>;
