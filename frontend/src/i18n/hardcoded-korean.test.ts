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
  // Pending migration: each task removes its files.
  "src/App.tsx",
  "src/ui.tsx",
  "src/panels.tsx",
  "src/reportWorkflow.ts",
  "src/ReportTools.tsx",
  "src/MachineSettings.tsx",
  "src/ForensicTools.tsx",
  "src/ImageInspector.tsx",
  "src/VideoInspector.tsx",
  "src/AiAssistant.tsx",
  "src/EvidenceIntake.tsx",
  "src/workbench/EvidenceTree.tsx",
  "src/workbench/FileViewer.tsx",
  "src/workbench/Properties.tsx",
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
  return ["src", "electron"]
    .flatMap((dir) => walk(join(root, dir)))
    .map((path) => relative(root, path).split(sep).join("/"))
    .filter((path) => /\.tsx?$/.test(path))
    .filter((path) => !EXCLUDED.some((pattern) => pattern.test(path)));
}

const read = (path: string) => readFileSync(join(root, path), "utf8");

it("keeps Korean UI copy inside src/locales/ko-KR", () =>
  expect(
    sourceFiles().filter((f) => !KOREAN_ALLOWED.has(f) && HANGUL.test(read(f))),
  ).toEqual([]));

it("does not allow-list files that no longer contain Korean", () =>
  expect([...KOREAN_ALLOWED].filter((f) => !HANGUL.test(read(f)))).toEqual([]));
