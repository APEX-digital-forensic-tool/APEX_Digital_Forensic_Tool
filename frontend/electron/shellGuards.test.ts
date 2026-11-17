import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_AI_TIMEOUT_SECONDS } from "./aiConnection";
import { operationTimeoutMs } from "./engine";
import { authOrigin, PickedPaths } from "./shellGuards";

describe("operationTimeoutMs", () => {
  // The engine tries a provider twice on a server error, each try up to the AI timeout.
  it("outlasts two provider attempts at the longest AI timeout", () => {
    expect(operationTimeoutMs("ai.analyze")).toBeGreaterThan(
      2 * MAX_AI_TIMEOUT_SECONDS * 1000,
    );
  });
  it("keeps the other limits", () => {
    expect(operationTimeoutMs("runtime")).toBe(60000);
    expect(operationTimeoutMs("cases.list")).toBe(120000);
  });
});

describe("PickedPaths", () => {
  it("returns a path only for the purpose and window it was picked for", () => {
    const picked = new PickedPaths();
    const ref = picked.add("/evidence/disk.E01", "evidence", 1);
    expect(picked.get(ref, "model", 1)).toBeUndefined();
    expect(picked.get(ref, "evidence", 2)).toBeUndefined();
    expect(picked.get(ref, "evidence", 1)).toBe("/evidence/disk.E01");
  });
  it("forgets the oldest reference when full and keeps the rest", () => {
    const picked = new PickedPaths(3);
    const refs = ["/a", "/b", "/c", "/d"].map((p) =>
      picked.add(p, "evidence", 1),
    );
    expect(picked.get(refs[0], "evidence", 1)).toBeUndefined();
    expect(refs.slice(1).map((r) => picked.get(r, "evidence", 1))).toEqual([
      "/b",
      "/c",
      "/d",
    ]);
  });
  it("forgets a used reference", () => {
    const picked = new PickedPaths();
    const ref = picked.add("/a", "tessdata", 1);
    picked.delete(ref);
    expect(picked.get(ref, "tessdata", 1)).toBeUndefined();
  });
});

describe("authOrigin", () => {
  it("rejects text that is not a URL instead of throwing", () => {
    expect(authOrigin("not a url")).toBeNull();
    expect(authOrigin("")).toBeNull();
  });
  it("accepts https and loopback http origins only", () => {
    expect(authOrigin("https://apex.example.com/")?.origin).toBe(
      "https://apex.example.com",
    );
    expect(authOrigin("http://127.0.0.1:8000")?.origin).toBe(
      "http://127.0.0.1:8000",
    );
    expect(authOrigin("http://apex.example.com")).toBeNull();
    expect(authOrigin("https://user:pw@apex.example.com")).toBeNull();
    expect(authOrigin("https://apex.example.com/path")).toBeNull();
  });
});

describe("index.html", () => {
  it("lets the shipped renderer connect only to itself", () => {
    const html = readFileSync(
      new URL("../index.html", import.meta.url),
      "utf8",
    );
    expect(html).toMatch(/connect-src 'self';/);
    expect(html).not.toContain("5173");
  });
});
