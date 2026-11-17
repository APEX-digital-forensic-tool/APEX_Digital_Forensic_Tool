import { describe, expect, it } from "vitest";
import {
  createServerSession,
  serverOrigin,
  type AccountStatus,
} from "./serverSession";

const ORIGIN = "https://apex.example";
const LOGIN = {
  origin: ORIGIN + "/",
  email: "a@example.com",
  password: "pw",
  tenant_id: "t1",
};

/** A fake auth server plus a clock and timers the test drives by hand. */
function harness() {
  let now = 1_000_000;
  let issued = 0;
  const calls: { path: string; body: any; auth: string | null }[] = [];
  const timers = new Map<number, { at: number; run: () => void }>();
  let nextTimer = 1;
  const server = {
    ttl: 3600,
    refreshStatus: 200 as number | "down",
    loginStatus: 200 as number | "down",
    logoutStatus: 200 as number | "down",
    pendingRefresh: null as null | Promise<unknown>,
  };
  const changes: AccountStatus[] = [];
  const session = createServerSession({
    now: () => now,
    setTimer: (run, ms) => {
      const id = nextTimer++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimer: (id) => timers.delete(id as number),
    onChange: (s) => changes.push(s),
    fetch: (async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      const headers = init.headers as Record<string, string>;
      calls.push({
        path,
        body: init.body ? JSON.parse(String(init.body)) : null,
        auth: headers.Authorization ?? null,
      });
      const status =
        path === "/auth/login"
          ? server.loginStatus
          : path === "/auth/refresh"
            ? server.refreshStatus
            : server.logoutStatus;
      if (path === "/auth/refresh" && server.pendingRefresh)
        await server.pendingRefresh;
      if (status === "down") throw new TypeError("fetch failed");
      if (status !== 200 || path === "/auth/logout")
        return new Response("{}", { status });
      issued++;
      return Response.json({
        access_token: `access-${issued}`,
        refresh_token: `refresh-${issued}`,
        expires_in: server.ttl,
      });
    }) as typeof fetch,
  });
  return {
    session,
    server,
    calls,
    changes,
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers])
        if (t.at <= now) {
          timers.delete(id);
          t.run();
        }
    },
    pendingTimers: () => timers.size,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("server session", () => {
  it("signs in and reports the server without exposing tokens", async () => {
    const h = harness();
    const result = await h.session.login(LOGIN);
    expect(result).toEqual({
      ok: true,
      status: {
        state: "signed_in",
        connected: true,
        origin: ORIGIN,
        expires_at: 1_000_000 + 3_600_000,
        reason: null,
      },
    });
    expect(JSON.stringify(h.changes)).not.toContain("access-");
    expect(h.calls[0]).toMatchObject({
      path: "/auth/login",
      body: { email: "a@example.com", password: "pw", tenant_id: "t1" },
    });
  });

  it.each([
    [401, "AUTH_LOGIN_FAILED"],
    [500, "AUTH_SERVER_UNAVAILABLE"],
    ["down", "AUTH_SERVER_UNAVAILABLE"],
  ] as const)("maps a login answer of %s to %s", async (status, code) => {
    const h = harness();
    h.server.loginStatus = status;
    expect(await h.session.login(LOGIN)).toEqual({ ok: false, code });
    expect(h.session.status().state).toBe("signed_out");
  });

  it.each([
    "http://apex.example/",
    "not a url",
    "https://u:p@apex.example/",
    "https://apex.example/api",
  ])("refuses the server address %s", async (origin) => {
    const h = harness();
    expect(await h.session.login({ ...LOGIN, origin })).toEqual({
      ok: false,
      code: "AUTH_ORIGIN_INVALID",
    });
    expect(h.calls).toEqual([]);
  });

  it("accepts plain http only on this machine", () => {
    expect(serverOrigin("http://127.0.0.1:8000/")).toBe(
      "http://127.0.0.1:8000",
    );
    expect(serverOrigin("http://localhost:8000")).toBe("http://localhost:8000");
    expect(serverOrigin("http://10.0.0.2:8000/")).toBeNull();
  });

  it("refreshes a minute before expiry on its own", async () => {
    const h = harness();
    await h.session.login(LOGIN);
    h.advance(3_600_000 - 60_000 - 1);
    expect(h.calls.map((c) => c.path)).toEqual(["/auth/login"]);
    h.advance(1);
    await flush();
    expect(h.calls[1]).toMatchObject({
      path: "/auth/refresh",
      body: { refresh_token: "refresh-1" },
    });
    expect(await h.session.credentials()).toEqual({
      origin: ORIGIN,
      access: "access-2",
    });
    expect(h.pendingTimers()).toBe(1);
  });

  it("refreshes at half the lifetime when tokens are short-lived", async () => {
    const h = harness();
    h.server.ttl = 20;
    await h.session.login(LOGIN);
    h.advance(10_000);
    await flush();
    expect(h.calls.map((c) => c.path)).toEqual([
      "/auth/login",
      "/auth/refresh",
    ]);
  });

  it("shares one refresh between concurrent callers", async () => {
    const h = harness();
    await h.session.login(LOGIN);
    h.server.pendingRefresh = flush().then(flush);
    h.advance(3_600_000 - 30_000);
    const tokens = await Promise.all([
      h.session.credentials(),
      h.session.credentials(),
      h.session.credentials(),
    ]);
    expect(h.calls.filter((c) => c.path === "/auth/refresh")).toHaveLength(1);
    expect(new Set(tokens.map((t) => t?.access))).toEqual(
      new Set(["access-2"]),
    );
  });

  it("signs out with SESSION_EXPIRED when the server rejects the refresh", async () => {
    const h = harness();
    await h.session.login(LOGIN);
    h.server.refreshStatus = 401;
    h.advance(3_600_000 - 60_000);
    await flush();
    expect(h.session.status()).toMatchObject({
      state: "signed_out",
      reason: "SESSION_EXPIRED",
    });
    expect(h.changes.at(-1)?.reason).toBe("SESSION_EXPIRED");
    expect(await h.session.credentials()).toBeNull();
  });

  it("keeps the session through a network blip and retries", async () => {
    const h = harness();
    await h.session.login(LOGIN);
    h.server.refreshStatus = "down";
    h.advance(3_600_000 - 60_000);
    await flush();
    expect(h.session.status().state).toBe("signed_in");
    h.advance(60_000);
    expect(h.session.status()).toMatchObject({
      state: "reconnecting",
      connected: false,
    });
    expect(await h.session.credentials()).toBeNull();
    h.server.refreshStatus = 200;
    expect(await h.session.credentials()).toEqual({
      origin: ORIGIN,
      access: expect.stringMatching(/^access-/),
    });
    expect(h.session.status().state).toBe("signed_in");
  });

  it("logs out locally at once and revokes the session on the server", async () => {
    const h = harness();
    await h.session.login(LOGIN);
    await h.session.logout();
    expect(h.session.status()).toMatchObject({
      state: "signed_out",
      reason: "LOGGED_OUT",
    });
    expect(h.calls.at(-1)).toEqual({
      path: "/auth/logout",
      body: null,
      auth: "Bearer access-1",
    });
    expect(h.pendingTimers()).toBe(0);
    expect(await h.session.credentials()).toBeNull();
  });

  it("does not revive a session when a refresh lands after logout", async () => {
    const h = harness();
    await h.session.login(LOGIN);
    h.server.pendingRefresh = flush().then(flush);
    h.advance(3_600_000 - 60_000);
    await h.session.logout();
    await flush();
    await flush();
    await flush();
    expect(h.session.status().state).toBe("signed_out");
    expect(await h.session.credentials()).toBeNull();
  });

  it("refuses a second sign-in and keeps the token an in-flight refresh rotated", async () => {
    const h = harness();
    await h.session.login(LOGIN);
    let release!: () => void;
    h.server.pendingRefresh = new Promise<void>((r) => (release = r));
    h.advance(3_600_000 - 60_000);
    h.server.loginStatus = 401;
    expect(await h.session.login(LOGIN)).toEqual({
      ok: false,
      code: "AUTH_ALREADY_SIGNED_IN",
    });
    release();
    h.server.pendingRefresh = null;
    await flush();
    await flush();
    expect(await h.session.credentials()).toEqual({
      origin: ORIGIN,
      access: "access-2",
    });
    h.advance(3_600_000);
    await flush();
    const refreshes = h.calls.filter((c) => c.path === "/auth/refresh");
    expect(refreshes.map((c) => c.body.refresh_token)).toEqual([
      "refresh-1",
      "refresh-2",
    ]);
  });

  it("renews a lapsed access token before asking the server to end the session", async () => {
    const h = harness();
    await h.session.login(LOGIN);
    h.server.refreshStatus = "down";
    h.advance(3_600_000);
    await flush();
    expect(h.session.status().state).toBe("reconnecting");
    h.server.refreshStatus = 200;
    expect(await h.session.logout()).toEqual({ ok: true });
    expect(h.calls.at(-1)).toMatchObject({
      path: "/auth/logout",
      auth: expect.stringMatching(/^Bearer access-[2-9]/),
    });
  });

  it.each([401, 500, "down"] as const)(
    "reports an incomplete logout when the server answers %s",
    async (answer) => {
      const h = harness();
      await h.session.login(LOGIN);
      h.server.logoutStatus = answer;
      expect(await h.session.logout()).toEqual({
        ok: false,
        code: "AUTH_LOGOUT_INCOMPLETE",
      });
      expect(h.session.status()).toMatchObject({
        state: "signed_out",
        reason: "LOGGED_OUT",
      });
    },
  );
});
