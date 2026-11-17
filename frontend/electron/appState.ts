import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TextFile } from "./aiConnection";

/** True when a file can be created in `dir`, creating the folder first if needed. */
export function canWrite(dir: string): boolean {
  const probe = join(dir, `.apex-write-check-${process.pid}`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(probe, "");
    rmSync(probe);
    return true;
  } catch {
    return false;
  }
}

export function isSetupComplete(file: TextFile): boolean {
  const text = file.read();
  if (text === null) return false;
  try {
    const v: unknown = JSON.parse(text);
    return (
      typeof v === "object" &&
      v !== null &&
      (v as Record<string, unknown>).setup_complete === true
    );
  } catch {
    return false;
  }
}

export function markSetupComplete(file: TextFile): void {
  file.write(JSON.stringify({ setup_complete: true }));
}

export function firstWindow(o: {
  setupComplete: boolean;
  smokeTest: boolean;
}): "setup" | "main" {
  return o.setupComplete || o.smokeTest ? "main" : "setup";
}
