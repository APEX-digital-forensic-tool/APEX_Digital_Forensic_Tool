import { expect, it } from "vitest";
import type { TextFile } from "./aiConnection";
import { firstWindow, isSetupComplete, markSetupComplete } from "./appState";

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
