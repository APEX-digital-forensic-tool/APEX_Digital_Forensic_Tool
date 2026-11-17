import { request } from "node:http";

/** The longest AI provider timeout the settings and the engine accept. */
const MAX_AI_TIMEOUT_SECONDS = 600;

/**
 * How long the shell waits for one engine operation. An AI request may try the provider twice
 * (a retry after a server error), each try up to the longest AI timeout.
 */
export function engineTimeoutMs(operation: string) {
  if (operation === "runtime") return 60000;
  if (operation === "ai.analyze")
    return (2 * MAX_AI_TIMEOUT_SECONDS + 60) * 1000;
  return 120000;
}

/**
 * POST one JSON operation to the engine and parse its JSON reply. Rejects on a redirect, a
 * network error or after `timeoutMs`. Node's fetch cannot be used here: it stops waiting for
 * response headers after 300s, and an AI request can take longer.
 */
export function postEngine(
  url: string,
  token: string,
  payload: unknown,
  timeoutMs: number,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        if ((res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400) {
          req.destroy(new Error("Engine replied with a redirect"));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          clearTimeout(timer);
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            reject(error);
          }
        });
        res.on("error", reject);
      },
    );
    const timer = setTimeout(
      () => req.destroy(new Error("Engine request timed out")),
      timeoutMs,
    );
    req.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.end(body);
  });
}
