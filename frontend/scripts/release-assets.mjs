import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { releaseVersion } from "./release-policy.mjs";

export async function checksum(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function prepareAssets(directory, version, env, mode = "signed") {
  if (!["signed", "preview"].includes(mode)) throw new Error("Unknown release mode.");
  if (
    !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? "") ||
    !/^\d+$/.test(env.GITHUB_RUN_ID ?? "") ||
    !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? "")
  )
    throw new Error(
      "Release provenance requires a GitHub commit, run ID and repository.",
    );
  const files = [
    `APEX-${version}-Windows-x64.exe`,
    ...["arm64", "x64"].flatMap((arch) => [
      `APEX-${version}-macOS-${arch}.dmg`,
      `APEX-${version}-macOS-${arch}.zip`,
      `verification-macOS-${arch}.json`,
    ]),
  ].sort();
  const actual = (await readdir(directory)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(files))
    throw new Error(
      "Expected exactly Windows x64 and both verified macOS DMG/ZIP artifacts.",
    );
  const sums = Object.fromEntries(
    await Promise.all(
      files.map(async (name) => [name, await checksum(join(directory, name))]),
    ),
  );
  for (const arch of ["arm64", "x64"]) {
    const report = JSON.parse(
      await readFile(
        join(directory, `verification-macOS-${arch}.json`),
        "utf8",
      ),
    );
    if (
      report.status !== "verified" ||
      report.version !== version ||
      report.arch !== arch ||
      report.source_commit !== env.GITHUB_SHA ||
      report.run_id !== env.GITHUB_RUN_ID
    )
      throw new Error(
        `Missing matching macOS ${arch} verification provenance.`,
      );
    if (mode === "preview") {
      const required = [
        "zip-bundle-signature", "zip-native-signatures", "zip-runtime-smoke", "zip-electron-smoke",
        "dmg-bundle-signature", "dmg-native-signatures", "dmg-electron-smoke",
      ];
      if (report.signing_mode !== "adhoc" || report.notarized !== false ||
          !required.every(check => report.checks?.includes(check)))
        throw new Error(`Missing actual macOS ${arch} preview signature/launch checks.`);
    } else if (report.signing_mode === "adhoc") {
      throw new Error("Ad-hoc previews cannot be published as notarized releases.");
    }
    for (const extension of ["dmg", "zip"]) {
      const name = `APEX-${version}-macOS-${arch}.${extension}`;
      if (report.sha256?.[name] !== sums[name])
        throw new Error(`Artifact changed after verification: ${name}`);
    }
  }
  const provenance = {
    version,
    source_commit: env.GITHUB_SHA,
    workflow_run: `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
    macos: mode === "preview"
      ? "Ad-hoc signed preview; NOT Apple notarized; first launch may require Open Anyway"
      : "Developer ID signed, notarized, stapled and verified on both native architectures",
    windows: "Unsigned preview; SmartScreen warnings may appear",
    artifacts: sums,
  };
  const provenancePath = join(directory, "build-provenance.json");
  await writeFile(provenancePath, JSON.stringify(provenance, null, 2) + "\n");
  sums["build-provenance.json"] = await checksum(provenancePath);
  await writeFile(
    join(directory, "SHA256SUMS.txt"),
    Object.entries(sums)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, sum]) => `${sum}  ${name}\n`)
      .join(""),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url)),
  );
  const lock = JSON.parse(
    await readFile(new URL("../package-lock.json", import.meta.url)),
  );
  if (!process.argv[2])
    throw new Error("Provide the downloaded release artifact directory.");
  await prepareAssets(
    resolve(process.argv[2]),
    releaseVersion(pkg, lock),
    process.env,
    process.argv[3] === "--preview" ? "preview" : "signed",
  );
}

