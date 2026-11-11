import { describe, expect, it } from "vitest";
import {
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
