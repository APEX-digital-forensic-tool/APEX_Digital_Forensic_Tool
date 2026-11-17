import { describe, expect, it } from "vitest";
import {
  attachServerConnection,
  callWithServerConnection,
  aiConnectionStatus,
  aiEnvironment,
  clearAiConnection,
  saveAiConnection,
  type AiDeps,
} from "./aiConnection";

function deps(
  o: { available?: boolean; env?: Record<string, string>; text?: string } = {},
): AiDeps {
  let text: string | null = o.text ?? null;
  return {
    file: {
      read: () => text,
      write: (t) => {
        text = t;
      },
      remove: () => {
        text = null;
      },
    },
    crypto: {
      available: () => o.available ?? true,
      encrypt: (s) => Buffer.from("enc:" + s),
      decrypt: (b) => {
        const s = b.toString();
        if (!s.startsWith("enc:")) throw new Error("cannot decrypt");
        return s.slice(4);
      },
    },
    env: o.env ?? {},
  };
}

const valid = {
  base_url: "https://api.example.com/v1",
  model_id: "model-x",
  api_key: "test-key-123",
};

describe("aiConnection", () => {
  it("stores the key encrypted and never reports it back", () => {
    const d = deps();
    expect(saveAiConnection(valid, d)).toEqual({ ok: true });
    expect(d.file.read()).not.toContain("test-key-123");
    const status = aiConnectionStatus(d);
    expect(status).toMatchObject({
      configured: true,
      has_key: true,
      managed: false,
      base_url: valid.base_url,
      model_id: "model-x",
      temperature: 0,
      max_output: 4096,
      timeout: 30,
    });
    expect(JSON.stringify(status)).not.toContain("test-key-123");
  });
  it("builds the engine environment from the stored connection", () => {
    const d = deps();
    saveAiConnection(
      { ...valid, temperature: 1, max_output: 16384, timeout: 240 },
      d,
    );
    const env = aiEnvironment(d);
    expect(env.APEX_DESKTOP_AI_STORED_KEY).toBe("test-key-123");
    expect(JSON.parse(env.APEX_DESKTOP_AI_CONFIG)).toEqual({
      provider_id: "apex-desktop",
      base_url: valid.base_url,
      model_id: "model-x",
      api_key_env: "APEX_DESKTOP_AI_STORED_KEY",
      temperature: 1,
      max_output: 16384,
      timeout: 240,
    });
  });
  it.each([
    [
      "http on a public host",
      { ...valid, base_url: "http://api.example.com/v1" },
    ],
    [
      "credentials in the URL",
      { ...valid, base_url: "https://user:pw@api.example.com/v1" },
    ],
    [
      "a query string",
      { ...valid, base_url: "https://api.example.com/v1?k=1" },
    ],
    ["a non-integer max_output", { ...valid, max_output: 1.5 }],
    ["a hash", { ...valid, base_url: "https://api.example.com/v1#x" }],
    ["not a URL", { ...valid, base_url: "api.example.com" }],
    ["an empty model", { ...valid, model_id: "" }],
    ["a control character in the key", { ...valid, api_key: "abc\ndef" }],
    ["temperature out of range", { ...valid, temperature: 3 }],
    ["no key at all", { base_url: valid.base_url, model_id: "model-x" }],
    ["a non-object", "nope"],
  ])("rejects %s", (_name, input) => {
    const d = deps();
    expect(saveAiConnection(input, d)).toEqual({
      ok: false,
      code: "AI_CONNECTION_INVALID",
    });
    expect(d.file.read()).toBeNull();
  });
  it("allows http for local model servers", () => {
    for (const base_url of [
      "http://127.0.0.1:11434/v1",
      "http://localhost:8080/v1",
    ])
      expect(saveAiConnection({ ...valid, base_url }, deps())).toEqual({
        ok: true,
      });
  });
  it("keeps the stored key when the key field is left empty", () => {
    const d = deps();
    saveAiConnection(valid, d);
    expect(
      saveAiConnection(
        { base_url: valid.base_url, model_id: "model-y", api_key: "" },
        d,
      ),
    ).toEqual({ ok: true });
    expect(aiEnvironment(d).APEX_DESKTOP_AI_STORED_KEY).toBe("test-key-123");
    expect(aiConnectionStatus(d).model_id).toBe("model-y");
  });
  it("refuses to store when encryption is unavailable", () => {
    const d = deps({ available: false });
    expect(saveAiConnection(valid, d)).toEqual({
      ok: false,
      code: "AI_KEY_STORAGE_UNAVAILABLE",
    });
    expect(d.file.read()).toBeNull();
    expect(aiConnectionStatus(d).storage_available).toBe(false);
  });
  it("lets the user's own environment variable win", () => {
    const d = deps({ env: { APEX_DESKTOP_AI_CONFIG: "{}" } });
    expect(aiConnectionStatus(d)).toMatchObject({
      managed: true,
      configured: true,
    });
    expect(saveAiConnection(valid, d)).toEqual({
      ok: false,
      code: "AI_CONNECTION_MANAGED",
    });
    expect(clearAiConnection(d)).toEqual({
      ok: false,
      code: "AI_CONNECTION_MANAGED",
    });
    expect(aiEnvironment(d)).toEqual({});
  });
  it.each([
    ["corrupt JSON", "{oops"],
    ["a wrong shape", '{"base_url":1}'],
    [
      "a non-integer max_output",
      JSON.stringify({
        base_url: "https://a.example/v1",
        model_id: "m",
        temperature: 0,
        max_output: 1.5,
        timeout: 30,
        key: Buffer.from("enc:k").toString("base64"),
      }),
    ],
    [
      "a key this account cannot decrypt",
      JSON.stringify({
        base_url: "https://a.example/v1",
        model_id: "m",
        temperature: 0,
        max_output: 4096,
        timeout: 30,
        key: Buffer.from("other").toString("base64"),
      }),
    ],
  ])("treats %s as not configured without throwing", (_name, text) => {
    const d = deps({ text });
    expect(aiConnectionStatus(d)).toMatchObject({
      configured: false,
      has_key: false,
    });
    expect(aiEnvironment(d)).toEqual({});
  });
  it("removes the stored connection", () => {
    const d = deps();
    saveAiConnection(valid, d);
    expect(clearAiConnection(d)).toEqual({ ok: true });
    expect(d.file.read()).toBeNull();
    expect(aiConnectionStatus(d).configured).toBe(false);
  });
});

describe("APEX server mode", () => {
  type Credentials = () => Promise<{ origin: string; access: string } | null>;
  const signedIn: Credentials = async () => ({
    origin: "https://apex.example",
    access: "access-token-1",
  });
  const signedOut: Credentials = async () => null;
  const server = {
    mode: "server",
    temperature: 0.2,
    max_output: 2048,
    timeout: 120,
  };

  it("stores no key and needs no OS encryption", () => {
    const d = deps({ available: false });
    expect(saveAiConnection(server, d)).toEqual({ ok: true });
    expect(JSON.parse(d.file.read()!)).toEqual(server);
    expect(aiConnectionStatus(d)).toMatchObject({
      configured: true,
      mode: "server",
      has_key: false,
      base_url: null,
      model_id: null,
      timeout: 120,
    });
  });
  it("waits longer than the server does for the model by default", () => {
    const d = deps();
    expect(aiConnectionStatus(d).timeout).toBe(120);
    saveAiConnection({ mode: "server" }, d);
    expect(aiConnectionStatus(d).timeout).toBe(120);
  });
  it("never lets a server connection give up before the server does", () => {
    const d = deps();
    saveAiConnection({ ...server, timeout: 30 }, d);
    expect(aiConnectionStatus(d).timeout).toBe(100);
    expect(JSON.parse(aiEnvironment(d).APEX_DESKTOP_AI_CONFIG).timeout).toBe(
      100,
    );
    d.file.write(JSON.stringify({ ...server, timeout: 30 }));
    expect(JSON.parse(aiEnvironment(d).APEX_DESKTOP_AI_CONFIG).timeout).toBe(
      100,
    );
  });
  it("keeps the 30 s default for a new direct connection", () => {
    const d = deps();
    saveAiConnection(valid, d);
    expect(aiConnectionStatus(d).timeout).toBe(30);
  });
  it("gives the engine secret-free settings only", () => {
    const d = deps();
    saveAiConnection(server, d);
    const env = aiEnvironment(d);
    expect(Object.keys(env)).toEqual(["APEX_DESKTOP_AI_CONFIG"]);
    expect(JSON.parse(env.APEX_DESKTOP_AI_CONFIG)).toEqual({
      connection: "APEX_SERVER",
      temperature: 0.2,
      max_output: 2048,
      timeout: 120,
    });
  });
  it("reads a connection saved before modes existed as a direct one", () => {
    const d = deps();
    saveAiConnection(valid, d);
    const legacy = JSON.parse(d.file.read()!);
    delete legacy.mode;
    d.file.write(JSON.stringify(legacy));
    expect(aiConnectionStatus(d)).toMatchObject({
      mode: "custom",
      has_key: true,
    });
  });
  it("attaches the server address and token to ai.analyze only", async () => {
    const d = deps();
    saveAiConnection(server, d);
    const analyze: Record<string, unknown> = { case_id: "c" };
    await attachServerConnection("ai.analyze", analyze, d, signedIn);
    expect(analyze.server_connection).toEqual({
      base_url: "https://apex.example/llm/v1",
      access_token: "access-token-1",
    });
    const other: Record<string, unknown> = {};
    await attachServerConnection("cases.list", other, d, signedIn);
    expect(other).toEqual({});
  });
  it.each<[string, string, boolean, Credentials]>([
    ["ai.prepare in server mode", "ai.prepare", true, signedIn],
    ["ai.analyze in direct mode", "ai.analyze", false, signedIn],
    ["ai.analyze while signed out", "ai.analyze", true, signedOut],
  ])(
    "drops a renderer-supplied connection for %s",
    async (_name, op, isServer, creds) => {
      const d = deps();
      saveAiConnection(isServer ? server : valid, d);
      const payload: Record<string, unknown> = {
        server_connection: {
          base_url: "https://evil.example",
          access_token: "x",
        },
      };
      await attachServerConnection(op, payload, d, creds);
      expect(payload).toEqual({});
    },
  );

  describe("a token the server rejects", () => {
    const rejected = { ok: false, error: { code: "AUTHENTICATION_FAILED" } };
    const answered = { ok: true, data: { status: "COMPLETED" } };
    function engine(...replies: unknown[]) {
      const sent: string[] = [];
      const call = async (payload: Record<string, unknown>) => {
        const c = payload.server_connection as
          { access_token: string } | undefined;
        sent.push(c?.access_token ?? "none");
        return replies.shift();
      };
      return { sent, call };
    }

    it("is renewed once and the request retried", async () => {
      const d = deps();
      saveAiConnection(server, d);
      const e = engine(rejected, answered);
      const auth = {
        credentials: signedIn,
        refresh: async () => "access-token-2",
      };
      const result = await callWithServerConnection(
        "ai.analyze",
        {},
        d,
        auth,
        e.call,
      );
      expect(result).toEqual(answered);
      expect(e.sent).toEqual(["access-token-1", "access-token-2"]);
    });
    it.each<[string, () => Promise<string | null>]>([
      ["the renewal fails", async () => null],
      ["the renewal returns the same token", async () => "access-token-1"],
    ])("is reported as is when %s", async (_name, refresh) => {
      const d = deps();
      saveAiConnection(server, d);
      const e = engine(rejected, answered);
      const result = await callWithServerConnection(
        "ai.analyze",
        {},
        d,
        { credentials: signedIn, refresh },
        e.call,
      );
      expect(result).toEqual(rejected);
      expect(e.sent).toEqual(["access-token-1"]);
    });
    it("is not retried a second time", async () => {
      const d = deps();
      saveAiConnection(server, d);
      let renewals = 0;
      const e = engine(rejected, rejected, answered);
      const result = await callWithServerConnection(
        "ai.analyze",
        {},
        d,
        {
          credentials: signedIn,
          refresh: async () => `access-token-${++renewals + 1}`,
        },
        e.call,
      );
      expect(result).toEqual(rejected);
      expect(e.sent).toHaveLength(2);
    });
    it("leaves a direct connection's errors alone", async () => {
      const d = deps();
      saveAiConnection(valid, d);
      const e = engine(rejected, answered);
      let renewed = false;
      const result = await callWithServerConnection(
        "ai.analyze",
        {},
        d,
        { credentials: signedIn, refresh: async () => ((renewed = true), "x") },
        e.call,
      );
      expect(result).toEqual(rejected);
      expect(renewed).toBe(false);
    });
  });
});
