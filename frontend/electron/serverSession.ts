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
  | "AUTH_ALREADY_SIGNED_IN"
  | "AUTH_LOGIN_CANCELLED"
  | "AUTH_ORIGIN_INVALID"
  | "AUTH_LOGIN_FAILED"
  | "AUTH_SERVER_UNAVAILABLE"
  | "AUTH_CONTRACT_INVALID";

/** A usable access token, its server, and which sign-in issued it. */
export interface Credentials {
  origin: string;
  access: string;
  /** Opaque; changes on every login and logout. Pass it to `refresh` to renew only this sign-in. */
  session: number;
}

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
  // The refresh in flight and the sign-in it belongs to.
  let refreshing: {
    generation: number;
    promise: Promise<string | null>;
  } | null = null;
  let timer: unknown = null;
  // The state as of now; after an await it may differ from what a caller narrowed.
  const latest = (): State => state;

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
    // A second sign-in would race the current session's refresh rotation.
    if (state.kind === "signed_in")
      return { ok: false, code: "AUTH_ALREADY_SIGNED_IN" };
    const started = generation;
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
    if (started !== generation || latest().kind === "signed_in") {
      // Another sign-in or a logout finished first; end the session this one opened.
      void post(`${origin}/auth/logout`, { bearer: tokens.access }).catch(
        () => {},
      );
      return latest().kind === "signed_in"
        ? { ok: true, status: status() }
        : { ok: false, code: "AUTH_LOGIN_CANCELLED" };
    }
    generation++;
    set(signedIn(origin, tokens));
    return { ok: true, status: status() };
  }

  /**
   * Ends the session here and on the server. A lapsed access token cannot end
   * it, so the token is renewed first. The local session ends either way; a
   * server that could not be told is reported, because its session would
   * otherwise outlive the logout unnoticed.
   */
  async function logout(): Promise<
    { ok: true } | { ok: false; code: "AUTH_LOGOUT_INCOMPLETE" }
  > {
    if (state.kind !== "signed_in") {
      // Cancels a sign-in still waiting on the server.
      generation++;
      set({ kind: "signed_out", reason: "LOGGED_OUT" });
      return { ok: true };
    }
    const { origin } = state;
    const current = await credentials();
    // A refresh the server rejected means the session is already over there.
    const serverEnded = !current && latest().kind === "signed_out";
    generation++;
    set({ kind: "signed_out", reason: "LOGGED_OUT" });
    if (serverEnded) return { ok: true };
    if (!current) return { ok: false, code: "AUTH_LOGOUT_INCOMPLETE" };
    try {
      const response = await post(`${origin}/auth/logout`, {
        bearer: current.access,
      });
      if (response.ok) return { ok: true };
    } catch {
      // Unreachable server: reported below.
    }
    return { ok: false, code: "AUTH_LOGOUT_INCOMPLETE" };
  }

  /**
   * One refresh at a time: the server revokes the whole session when a rotated
   * refresh token is reused. With `session`, renews only that sign-in and
   * resolves null once another has replaced it.
   */
  function refresh(session: number = generation): Promise<string | null> {
    if (state.kind !== "signed_in" || session !== generation)
      return Promise.resolve(null);
    if (refreshing?.generation === generation) return refreshing.promise;
    const entry = {
      generation,
      promise: rotate(state, generation).finally(() => {
        if (refreshing === entry) refreshing = null;
      }),
    };
    refreshing = entry;
    return entry.promise;
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
  async function credentials(): Promise<Credentials | null> {
    if (state.kind !== "signed_in") return null;
    const { origin } = state;
    const session = generation;
    const access =
      state.expiresAt - state.margin > deps.now()
        ? state.access
        : await refresh(session);
    return access ? { origin, access, session } : null;
  }

  function dispose() {
    generation++;
    state = { kind: "signed_out", reason: null };
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  }

  return { status, login, logout, credentials, refresh, dispose };
}

export type ServerSession = ReturnType<typeof createServerSession>;
