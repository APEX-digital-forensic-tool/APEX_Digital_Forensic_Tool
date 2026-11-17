import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { IMAGE_EXTENSIONS, RAW_IMAGE_EXTENSIONS } from "./imageExtensions";
import { missingReaders } from "./EvidenceIntake";

it("offers the engine's raw image extensions, .001 included", () => {
  expect(RAW_IMAGE_EXTENSIONS).toEqual(
    expect.arrayContaining(["dd", "img", "raw", "001"]),
  );
});

it("gives the native file picker the shared extension list", () => {
  const main = readFileSync("electron/main.ts", "utf8");
  expect(main).toMatch(/extensions: IMAGE_EXTENSIONS,/);
  expect(main).toMatch(
    /import \{ IMAGE_EXTENSIONS \} from "..\/src\/imageExtensions"/,
  );
  expect(IMAGE_EXTENSIONS).toEqual(
    expect.arrayContaining(["e01", "vhd", "vhdx", ...RAW_IMAGE_EXTENSIONS]),
  );
});

it("checks the raw reader for every shared raw extension", () => {
  const unavailable = [{ id: "raw-dd-img", status: "UNAVAILABLE" }];
  for (const ext of RAW_IMAGE_EXTENSIONS)
    expect(
      missingReaders("file", `disk.${ext}`, unavailable).map((c) => c.id),
    ).toEqual(["raw-dd-img"]);
});
