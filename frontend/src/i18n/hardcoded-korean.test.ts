import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { HANGUL } from "./testing";

const root = fileURLToPath(new URL("../..", import.meta.url));

const KOREAN_ALLOWED = new Set([
  // Synthetic data for the dev-only demo mode, not UI copy.
  "src/demoData.ts",
  "src/demoBridge.ts",
  // Language names are always shown in their own language.
  "src/i18n/locales.ts",
]);

const EXCLUDED = [
  /\.test\.tsx?$/,
  /^src\/locales\/ko-KR\//,
  /^src\/__fixtures__\//,
  /^src\/contracts\/generated\//,
];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function sourceFiles() {
  return (
    ["src", "electron"]
      .flatMap((dir) => walk(join(root, dir)))
      .map((path) => relative(root, path).split(sep).join("/"))
      // Stylesheets count too: generated content (`content: "…"`) is UI copy.
      .filter((path) => /\.(tsx?|css)$/.test(path))
      .concat("index.html")
      .filter((path) => !EXCLUDED.some((pattern) => pattern.test(path)))
  );
}

const read = (path: string) => readFileSync(join(root, path), "utf8");

it("keeps Korean UI copy inside src/locales/ko-KR", () =>
  expect(
    sourceFiles().filter((f) => !KOREAN_ALLOWED.has(f) && HANGUL.test(read(f))),
  ).toEqual([]));

it("does not allow-list files that no longer contain Korean", () =>
  expect([...KOREAN_ALLOWED].filter((f) => !HANGUL.test(read(f)))).toEqual([]));
