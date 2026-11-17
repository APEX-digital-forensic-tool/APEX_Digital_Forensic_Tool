import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { TextFile } from "./aiConnection";
import {
  canWrite,
  firstWindow,
  isSetupComplete,
  markSetupComplete,
} from "./appState";

function memoryFile(initial: string | null = null): TextFile {
  let text = initial;
  return {
    read: () => text,
    write: (t) => {
      text = t;
    },
    remove: () => {
      text = null;
    },
  };
}

it("starts with setup until it is completed", () => {
  const file = memoryFile();
  expect(isSetupComplete(file)).toBe(false);
  expect(firstWindow({ setupComplete: false, smokeTest: false })).toBe("setup");
  markSetupComplete(file);
  expect(isSetupComplete(file)).toBe(true);
  expect(firstWindow({ setupComplete: true, smokeTest: false })).toBe("main");
});
it.each(["{oops", '{"setup_complete":"yes"}', "null", ""])(
  "treats %j as not completed",
  (text) => expect(isSetupComplete(memoryFile(text))).toBe(false),
);
it("skips setup for the packaging smoke test", () =>
  expect(firstWindow({ setupComplete: false, smokeTest: true })).toBe("main"));

// The single-instance lock fails the same way for a second instance and for a folder it cannot write.
it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "tells a writable user data folder from a read-only one",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "apex-state-"));
    try {
      expect(canWrite(dir)).toBe(true);
      expect(canWrite(join(dir, "new"))).toBe(true);
      chmodSync(dir, 0o500);
      expect(canWrite(dir)).toBe(false);
      expect(canWrite(join(dir, "other"))).toBe(false);
    } finally {
      chmodSync(dir, 0o700);
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
