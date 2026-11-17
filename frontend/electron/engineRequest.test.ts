import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { engineTimeoutMs, postEngine } from "./engineRequest";

async function server(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const s = createServer(handler);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => s.close() };
}

describe("engineTimeoutMs", () => {
  // The engine tries the provider twice on a server error, each try up to the 600 s AI timeout.
  it("outlasts two provider attempts at the longest AI timeout", () => {
    expect(engineTimeoutMs("ai.analyze")).toBeGreaterThan(2 * 600 * 1000);
  });
  it("keeps the other limits", () => {
    expect(engineTimeoutMs("runtime")).toBe(60000);
    expect(engineTimeoutMs("cases.list")).toBe(120000);
  });
});

describe("postEngine", () => {
  it("posts JSON with the token and returns the reply", async () => {
    const s = await server((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () =>
        res.end(
          JSON.stringify({
            auth: req.headers.authorization,
            got: JSON.parse(body),
          }),
        ),
      );
    });
    try {
      await expect(
        postEngine(`${s.url}/v1/operations/x`, "tok", { a: 1 }, 5000),
      ).resolves.toEqual({ auth: "Bearer tok", got: { a: 1 } });
    } finally {
      s.close();
    }
  });

  it("refuses a redirect", async () => {
    const s = await server((_req, res) => {
      res.writeHead(307, { Location: "http://example.com/" });
      res.end();
    });
    try {
      await expect(postEngine(s.url, "tok", {}, 5000)).rejects.toThrow();
    } finally {
      s.close();
    }
  });

  // Node's fetch gives up after 300 s without response headers, whatever its abort signal says.
  it("waits until its own deadline for a slow reply, then gives up", async () => {
    const s = await server((_req, res) => {
      setTimeout(() => res.end("{}"), 400);
    });
    try {
      await expect(postEngine(s.url, "tok", {}, 2000)).resolves.toEqual({});
      await expect(postEngine(s.url, "tok", {}, 100)).rejects.toThrow();
    } finally {
      s.close();
    }
  });
});
