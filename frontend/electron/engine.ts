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
    private readonly options: {
      /** From spawn to a passing health check. */
      readyTimeoutMs?: number;
      /** Health checks after the engine reports its port. */
      healthAttempts?: number;
    } = {},
  ) {}

  /** Resolves true once the engine passes its health check, false when this start failed. */
  start(): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false);
    const current = ++this.generation;
    this.url = "";
    this.error = "SERVICE_NOT_READY";
    const { command, args, cwd, env } = this.launch();
    if (!existsSync(command)) {
      this.error = "PYTHON_RUNTIME_MISSING";
      return Promise.resolve(false);
    }
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        cwd,
        windowsHide: true,
        env: { ...env, APEX_DESKTOP_TOKEN: this.token },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      // ENOEXEC, ELOOP, EPERM and the like throw here instead of emitting "error".
      this.error = "BACKEND_START_FAILED";
      return Promise.resolve(false);
    }
    this.child = child;
    return new Promise<boolean>((resolve) => {
      // Startup ends once: ready, or failed with the first code. Later events only report a stop.
      let settled = false;
      const timer = setTimeout(
        () => fail("BACKEND_START_TIMEOUT"),
        this.options.readyTimeoutMs ?? 90000,
      );
      const ready = (origin: string) => {
        if (settled || current !== this.generation) return;
        settled = true;
        clearTimeout(timer);
        this.url = origin;
        this.error = "";
        resolve(true);
      };
      const fail = (code: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (current === this.generation) {
          this.url = "";
          this.error = code;
        }
        // A child that failed to start must not linger; its exit no longer changes the code.
        void stopChild(child, { graceMs: 5000, killMs: 5000 });
        resolve(false);
      };
      const ended = (code: string) => {
        if (!settled) return fail(code);
        if (current === this.generation && this.url) {
          this.url = "";
          this.error = code;
        }
      };
      child.on("error", () => ended("BACKEND_START_FAILED"));
      child.on("exit", () => ended("BACKEND_STOPPED"));
      // Raw backend stderr may contain sensitive paths. Never forward it to the renderer/logs.
      child.stderr?.on("data", () => {});
      const lines = createInterface({ input: child.stdout! });
      lines.on("line", async (line) => {
        let data;
        try {
          data = JSON.parse(line);
        } catch {
          return; // Only consume the minimal readiness message.
        }
        if (
          data?.type !== "apex-ready" ||
          !Number.isInteger(data.port) ||
          data.port <= 0 ||
          data.port > 65535
        )
          return;
        const origin = `http://127.0.0.1:${data.port}`;
        const attempts = this.options.healthAttempts ?? 50;
        for (let i = 0; i < attempts; i++) {
          if (settled || current !== this.generation) return;
          try {
            const r = await fetch(`${origin}/health`, {
              headers: { Authorization: `Bearer ${this.token}` },
              signal: AbortSignal.timeout(1000),
            });
            // ready() ignores a child that exited while this request was pending.
            if (r.ok) return ready(origin);
          } catch {
            /* Wait for the child's listener, not an unrelated port. */
          }
          await wait(100);
        }
        fail("BACKEND_START_FAILED");
      });
    });
  }

  /**
   * Stop the engine and start it with the current launch settings. Resolves true once the new
   * engine is ready. Resolves false when it failed, or when the old engine survived SIGKILL;
   * no second engine is started on a survivor's data.
   */
  restart() {
    const run = () => this.restartNow();
    this.restarting = this.restarting.then(run, run);
    return this.restarting;
  }

  private async restartNow() {
    if (this.stopped) return false;
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
    return this.start();
  }

  /** On quit: kill the engine and never start another. */
  stop() {
    this.stopped = true;
    this.child?.kill();
  }
}
