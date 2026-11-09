import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { assertMacReleaseCredentials, macPreviewEnvironment } from "./release-policy.mjs";

const platform = process.argv[2];
const release = process.argv[3] === "--release";
if (process.argv.length > 4 || (process.argv[3] && !release))
  throw new Error("Usage: dist.mjs win32|darwin [--release]");
if (!["darwin", "win32"].includes(platform) || process.platform !== platform)
  throw new Error("Build on the target OS with its native Python runtime.");
if (release && platform === "darwin") assertMacReleaseCredentials(process.env);
const runtime = JSON.parse(
  await readFile(
    new URL("../../desktop-runtime/runtime-info.json", import.meta.url),
    "utf8",
  ),
);
if (runtime.platform !== platform || runtime.arch !== process.arch)
  throw new Error(
    "Rebuild desktop-runtime using Python matching this Node.js OS and architecture.",
  );
const require = createRequire(import.meta.url);
const result = spawnSync(
  process.execPath,
  [
    require.resolve("electron-builder/cli.js"),
    platform === "darwin" ? "--mac" : "--win",
    `--${process.arch}`,
    "--config",
    release ? "electron-builder.release.cjs" : "electron-builder.preview.cjs",
    "--publish",
    "never",
  ],
  {
    stdio: "inherit",
    env: !release && platform === "darwin" ? macPreviewEnvironment(process.env) : process.env,
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);

