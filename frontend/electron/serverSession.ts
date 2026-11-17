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
/** Node runs a longer timer after 1 ms instead, which would refresh in a loop. */
const MAX_TIMER_MS = 2 ** 31 - 1;

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
/** What a refresh request came back with; null when the server could not be reached or answered nonsense. */
type Exchange = { tokens: Tokens } | { rejected: true } | null;

/** Longer-lived access tokens are a broken contract, not a long session. */
const MAX_TTL_MS = 365 * 24 * 3_600_000;

function parseTokens(body: unknown): Tokens | null {
  const b = body as Record<string, unknown> | null;
  if (
    !b ||
    typeof b.access_token !== "string" ||
    typeof b.refresh_token !== "string" ||
    typeof b.expires_in !== "number"
  )
    return null;
  const ttl = b.expires_in * 1000;
  if (!(ttl > 0 && ttl <= MAX_TTL_MS)) return null;
  return { access: b.access_token, refresh: b.refresh_token, ttl };
}

export function createServerSession(deps: SessionDeps) {
  let state: State = { kind: "signed_out", reason: null };
  // Bumped on login and logout so a refresh that started earlier cannot revive or overwrite the session.
  let generation = 0;
  // The refresh in flight and the sign-in it belongs to.
  let refreshing: {
    generation: number;
    exchange: Promise<Exchange>;
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
      Math.min(Math.max(0, ms), MAX_TIMER_MS),
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
      // Never report success: the session in place belongs to someone else's sign-in.
      void post(`${origin}/auth/logout`, { bearer: tokens.access }).catch(
        () => {},
      );
      return {
        ok: false,
        code:
          latest().kind === "signed_in"
            ? "AUTH_ALREADY_SIGNED_IN"
            : "AUTH_LOGIN_CANCELLED",
      };
    }
    generation++;
    set(signedIn(origin, tokens));
    return { ok: true, status: status() };
  }

  /**
   * Ends the session here at once, then on the server. Nothing in this app can
   * use the session after the first line: what the server revoke needs is kept
   * aside. A lapsed access token cannot end it, so the token is renewed first
   * (joining a renewal already in flight rather than reusing its refresh
   * token). A server that could not be told is reported, because its session
   * would otherwise outlive the logout unnoticed.
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
    const ended = state;
    const inFlight =
      refreshing?.generation === generation ? refreshing.exchange : null;
    generation++;
    set({ kind: "signed_out", reason: "LOGGED_OUT" });

    let access =
      ended.expiresAt - ended.margin > deps.now() ? ended.access : null;
    // Only a lapsing token needs renewing; a valid one can end the session as is.
    const renewed = access
      ? null
      : (inFlight ?? exchange(ended.origin, ended.refresh));
    if (renewed) {
      const result = await renewed;
      // A refresh the server rejected means the session is already over there.
      if (result && "rejected" in result) return { ok: true };
      if (result) access = result.tokens.access;
      else if (ended.expiresAt <= deps.now()) access = null;
    }
    if (!access) return { ok: false, code: "AUTH_LOGOUT_INCOMPLETE" };
    try {
      const response = await post(`${ended.origin}/auth/logout`, {
        bearer: access,
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
    const from = state;
    const attempt = generation;
    const pending = exchange(from.origin, from.refresh);
    const entry = {
      generation: attempt,
      exchange: pending,
      promise: pending
        .then((result) => adopt(from, attempt, result))
        .finally(() => {
          if (refreshing === entry) refreshing = null;
        }),
    };
    refreshing = entry;
    return entry.promise;
  }

  /** Trades a refresh token for new tokens. Touches no state. */
  async function exchange(
    origin: string,
    refreshToken: string,
  ): Promise<Exchange> {
    try {
      const response = await post(`${origin}/auth/refresh`, {
        body: { refresh_token: refreshToken },
      });
      if (response.status === 401) return { rejected: true };
      if (!response.ok) return null;
      const tokens = parseTokens(await response.json().catch(() => null));
      return tokens ? { tokens } : null;
    } catch {
      return null;
    }
  }

  /** Applies a refresh result, unless the sign-in it belongs to has ended since. */
  function adopt(
    from: Extract<State, { kind: "signed_in" }>,
    attempt: number,
    result: Exchange,
  ): string | null {
    if (attempt !== generation) return null;
    if (result && "rejected" in result) {
      set({ kind: "signed_out", reason: "SESSION_EXPIRED" });
      return null;
    }
    if (!result) {
      // Server unreachable or misbehaving: keep the session and try again soon.
      schedule(RETRY_MS);
      deps.onChange(status());
      return from.expiresAt > deps.now() ? from.access : null;
    }
    set(signedIn(from.origin, result.tokens));
    return result.tokens.access;
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
