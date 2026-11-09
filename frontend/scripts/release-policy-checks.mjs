import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertMacReleaseCredentials,
  releaseVersion,
} from "./release-policy.mjs";
import { checksum, prepareAssets } from "./release-assets.mjs";

const env = {
  CSC_LINK: "test-certificate",
  CSC_KEY_PASSWORD: "test-password",
  APPLE_API_KEY: "/temporary/test.p8",
  APPLE_API_KEY_ID: "TESTKEY123",
  APPLE_API_ISSUER: "test-issuer",
  APPLE_TEAM_ID: "TESTTEAM12",
};
test("release rejects each missing credential without disclosing other values", () => {
  for (const key of Object.keys(env)) {
    assert.throws(
      () => assertMacReleaseCredentials({ ...env, [key]: "" }, () => true),
      (error) =>
        error.message.includes(key) &&
        !error.message.includes(env.CSC_KEY_PASSWORD),
    );
  }
  assert.doesNotThrow(() => assertMacReleaseCredentials(env, () => true));
});
test("release rejects disabled/ad-hoc signing, conflicting auth and absent key files", () => {
  for (const extra of [
    { CSC_IDENTITY_AUTO_DISCOVERY: "false" },
    { CSC_NAME: "-" },
    { APPLE_ID: "test@example.invalid" },
    { APPLE_TEAM_ID: "invalid" },
  ])
    assert.throws(() =>
      assertMacReleaseCredentials({ ...env, ...extra }, () => true),
    );
  assert.throws(() => assertMacReleaseCredentials(env, () => false));
});
test("release refuses mismatched package versions and malformed tags", () => {
  const lock = { version: "0.1.4", packages: { "": { version: "0.1.4" } } };
  assert.equal(releaseVersion({ version: "0.1.4" }, lock), "0.1.4");
  for (const version of ["0.1.3", "0.1.4;bad", "v0.1.4", null])
    assert.throws(() => releaseVersion({ version }, lock));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "apex-release-test-"));
  const provenance = {
    GITHUB_SHA: "a".repeat(40),
    GITHUB_RUN_ID: "123",
    GITHUB_REPOSITORY: "test/apex",
  };
  await writeFile(join(directory, "APEX-0.1.4-Windows-x64.exe"), "synthetic");
  for (const arch of ["arm64", "x64"]) {
    const sha256 = {};
    for (const ext of ["dmg", "zip"]) {
      const name = `APEX-0.1.4-macOS-${arch}.${ext}`;
      await writeFile(join(directory, name), `synthetic ${arch} ${ext}`);
      sha256[name] = await checksum(join(directory, name));
    }
    await writeFile(
      join(directory, `verification-macOS-${arch}.json`),
      JSON.stringify({
        status: "verified",
        version: "0.1.4",
        arch,
        source_commit: provenance.GITHUB_SHA,
        run_id: provenance.GITHUB_RUN_ID,
        sha256,
      }),
    );
  }
  return { directory, provenance };
}
test("release includes hashes and immutable source/run provenance", async () => {
  const { directory, provenance } = await fixture();
  try {
    await prepareAssets(directory, "0.1.4", provenance);
    const sums = await readFile(join(directory, "SHA256SUMS.txt"), "utf8");
    assert.equal(sums.trim().split("\n").length, 8);
    const record = JSON.parse(
      await readFile(join(directory, "build-provenance.json")),
    );
    assert.equal(record.source_commit, provenance.GITHUB_SHA);
    assert.match(record.windows, /Unsigned/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
for (const change of ["tampered", "missing", "foreign-run", "extra"]) {
  test(`release blocks ${change} artifacts`, async () => {
    const { directory, provenance } = await fixture();
    try {
      const path = join(directory, "APEX-0.1.4-macOS-arm64.dmg");
      if (change === "tampered") await writeFile(path, "changed");
      if (change === "missing") await rm(path);
      if (change === "foreign-run") provenance.GITHUB_RUN_ID = "999";
      if (change === "extra")
        await writeFile(join(directory, "private.p8"), "must not upload");
      await assert.rejects(prepareAssets(directory, "0.1.4", provenance));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
