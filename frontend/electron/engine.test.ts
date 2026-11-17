import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Engine, type EngineLaunch } from "./engine";

const folders: string[] = [];
function folder() {
  const path = mkdtempSync(join(tmpdir(), "apex-engine-"));
  folders.push(path);
  return path;
}
const engines: Engine[] = [];
function track(engine: Engine) {
  engines.push(engine);
  return engine;
}
// Windows refuses to delete a folder while a fake engine still runs in it.
afterEach(async () => {
  await Promise.all(
    engines.splice(0).map((engine) => {
      const child = engine.child;
      engine.stop();
      return child && child.exitCode === null && child.signalCode === null
        ? new Promise((r) => child.once("exit", r))
        : undefined;
    }),
  );
  for (const path of folders.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe("Engine.start", () => {
  it("reports a missing runtime", () => {
    const dir = folder();
    const engine = new Engine("token", () => ({
      command: join(dir, "missing"),
      args: [],
      cwd: dir,
      env: {},
    }));
    engine.start();
    expect(engine.error).toBe("PYTHON_RUNTIME_MISSING");
  });

  // An executable file the OS cannot run makes spawn() throw ENOEXEC instead of emitting "error".
  it.skipIf(process.platform === "win32")(
    "reports a runtime the OS refuses to run instead of throwing",
    () => {
      const dir = folder();
      const command = join(dir, "engine");
      writeFileSync(command, "not a program\n", { mode: 0o755 });
      const engine = new Engine("token", () => ({
        command,
        args: [],
        cwd: dir,
        env: {},
      }));
      expect(() => engine.start()).not.toThrow();
      expect(engine.error).toBe("BACKEND_START_FAILED");
      expect(engine.url).toBe("");
    },
  );
});

/** A stand-in engine: a real Node child process running `source`. */
function fakeEngine(source: string, extra: Record<string, string> = {}) {
  const dir = folder();
  for (const [name, text] of Object.entries(extra))
    writeFileSync(join(dir, name), text);
  writeFileSync(join(dir, "engine.cjs"), source);
  return (): EngineLaunch => ({
    command: process.execPath,
    args: [join(dir, "engine.cjs")],
    cwd: dir,
    env: { ...process.env, APEX_FAKE_DIR: dir },
  });
}
async function until(done: () => boolean, ms = 8000) {
  const deadline = Date.now() + ms;
  while (!done() && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 20));
}
const dead = (engine: Engine) =>
  !!engine.child &&
  (engine.child.exitCode !== null || engine.child.signalCode !== null);

const serve = (health: string) => `
const http = require("node:http");
const server = http.createServer((req, res) => { ${health} });
server.listen(0, "127.0.0.1", () => {
  console.log(JSON.stringify({ type: "apex-ready", port: server.address().port }));
});
`;

describe("Engine startup failures", () => {
  it("gives up on an engine that never reports ready", async () => {
    const engine = track(
      new Engine("token", fakeEngine("setInterval(() => {}, 1000);"), {
        readyTimeoutMs: 300,
      }),
    );
    const ready = engine.start();
    await until(() => engine.error !== "SERVICE_NOT_READY" && dead(engine));
    expect(engine.error).toBe("BACKEND_START_TIMEOUT");
    expect(engine.url).toBe("");
    expect(dead(engine)).toBe(true);
    await expect(ready).resolves.toBe(false);
  });

  it("stops an engine whose health check never passes", async () => {
    const engine = track(
      new Engine("token", fakeEngine(serve("res.writeHead(503); res.end();")), {
        healthAttempts: 3,
      }),
    );
    const ready = engine.start();
    await until(() => engine.error !== "SERVICE_NOT_READY" && dead(engine));
    expect(engine.error).toBe("BACKEND_START_FAILED");
    expect(engine.url).toBe("");
    expect(dead(engine)).toBe(true);
    await expect(ready).resolves.toBe(false);
  });

  // The engine exits while /health is answered by a process it left behind.
  it("keeps BACKEND_STOPPED when the engine exits during the health check", async () => {
    const engine = track(
      new Engine(
        "token",
        fakeEngine(
          `
const { spawn } = require("node:child_process");
const server = spawn(process.execPath, [require("node:path").join(process.env.APEX_FAKE_DIR, "server.cjs")], {
  stdio: ["ignore", "pipe", "ignore"],
});
server.stdout.once("data", (line) => {
  process.stdout.write(line);
  setTimeout(() => process.exit(0), 100);
});
`,
          {
            "server.cjs": serve(
              "setTimeout(() => { res.end('{}'); server.close(); process.exit(0); }, 600);",
            ),
          },
        ),
      ),
    );
    const ready = engine.start();
    await until(() => dead(engine));
    await new Promise((r) => setTimeout(r, 1000));
    expect(engine.error).toBe("BACKEND_STOPPED");
    expect(engine.url).toBe("");
    await expect(ready).resolves.toBe(false);
  });

  it("reports ready once the health check passes", async () => {
    const engine = track(
      new Engine("token", fakeEngine(serve("res.end('{}');"))),
    );
    await expect(engine.start()).resolves.toBe(true);
    expect(engine.error).toBe("");
    expect(engine.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});
