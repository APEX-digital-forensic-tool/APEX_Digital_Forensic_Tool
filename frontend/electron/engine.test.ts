import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Engine } from "./engine";

const folders: string[] = [];
function folder() {
  const path = mkdtempSync(join(tmpdir(), "apex-engine-"));
  folders.push(path);
  return path;
}
afterEach(() => {
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
