const { build } = require("./package.json");

// Keep ordinary PR/local packages independent of Apple credentials.
// This config is only used by dist:*:release and the release workflow.
module.exports = {
  ...build,
  extends: null,
  win: { ...build.win, artifactName: "APEX-${version}-Windows-${arch}.${ext}" },
  mac: {
    ...build.mac,
    artifactName: "APEX-${version}-macOS-${arch}.${ext}",
    type: "distribution",
    forceCodeSigning: true,
    hardenedRuntime: true,
    strictVerify: true,
    entitlements: "resources/entitlements.mac.plist",
    entitlementsInherit: "resources/entitlements.mac.plist",
    notarize: true,
  },
  dmg: { sign: true },
};
