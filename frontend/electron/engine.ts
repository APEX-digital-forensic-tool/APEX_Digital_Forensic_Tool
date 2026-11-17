import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { stopChild } from "./engineGuard";

/** How to run the engine. Read again on every start, so a restart picks up new AI settings. */
export interface EngineLaunch {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The local engine process: its URL once healthy, else the code requests fail with. */
export class Engine {
  url = "";
  error = "SERVICE_NOT_READY";
  child: ChildProcess | undefined;
  // Bumped on every spawn and restart so a previous child's events never touch current state.
  private generation = 0;
  // Set by stop(); no engine is spawned or restarted after that.
  private stopped = false;
  // Serialized so overlapping restarts cannot orphan a child spawned by an earlier restart.
  private restarting: Promise<boolean> = Promise.resolve(true);

  constructor(
    private readonly token: string,
    private readonly launch: () => EngineLaunch,
  ) {}

  start() {
    if (this.stopped) return;
    const current = ++this.generation;
    const { command, args, cwd, env } = this.launch();
    if (!existsSync(command)) {
      this.error = "PYTHON_RUNTIME_MISSING";
      return;
    }
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      env: { ...env, APEX_DESKTOP_TOKEN: this.token },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    child.on("error", () => {
      if (current !== this.generation) return;
      this.url = "";
      this.error = "BACKEND_START_FAILED";
    });
    child.on("exit", () => {
      if (current !== this.generation) return;
      this.url = "";
      this.error = "BACKEND_STOPPED";
    });
    // Raw backend stderr may contain sensitive paths. Never forward it to the renderer/logs.
    child.stderr?.on("data", () => {});
    const lines = createInterface({ input: child.stdout! });
    lines.on("line", async (line) => {
      try {
        const data = JSON.parse(line);
        if (
          data.type === "apex-ready" &&
          Number.isInteger(data.port) &&
          data.port > 0 &&
          data.port <= 65535
        ) {
          const origin = `http://127.0.0.1:${data.port}`;
          for (let i = 0; i < 50 && current === this.generation; i++) {
            try {
              const r = await fetch(`${origin}/health`, {
                headers: { Authorization: `Bearer ${this.token}` },
                signal: AbortSignal.timeout(1000),
              });
              if (current !== this.generation) break;
              if (r.ok) {
                this.url = origin;
                this.error = "";
                break;
              }
            } catch {
              /* Wait for the child's listener, not an unrelated port. */
            }
            await wait(100);
          }
        }
      } catch {
        /* Only consume the minimal readiness message. */
      }
    });
  }

  /**
   * Stop the engine, start it with the current launch settings, and wait up to 90s for readiness.
   * Resolves false when the old engine survived SIGKILL; no second engine is started on its data.
   */
  restart() {
    const run = () => this.restartNow();
    this.restarting = this.restarting.then(run, run);
    return this.restarting;
  }

  private async restartNow() {
    if (this.stopped) return true;
    const old = this.child;
    this.generation++;
    // No request may reach the engine while it is being stopped.
    this.url = "";
    this.error = "SERVICE_NOT_READY";
    if (old && !(await stopChild(old, { graceMs: 10000, killMs: 5000 }))) {
      // Keep the survivor so stop() and a later restart try to stop it again.
      this.child = old;
      this.error = "BACKEND_START_FAILED";
      return false;
    }
    this.child = undefined;
    if (this.stopped) return true;
    this.start();
    const deadline = Date.now() + 90000;
    while (
      !this.url &&
      this.error === "SERVICE_NOT_READY" &&
      Date.now() < deadline
    )
      await wait(100);
    return true;
  }

  /** On quit: kill the engine and never start another. */
  stop() {
    this.stopped = true;
    this.child?.kill();
  }
}
