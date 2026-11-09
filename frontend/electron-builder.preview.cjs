const { build } = require("./package.json");

// Certificate-free previews still need a valid, sealed application bundle.
// Developer ID signing and notarization remain in electron-builder.release.cjs.
module.exports = {
  ...build,
  extends: null,
  win: { ...build.win, artifactName: "APEX-${version}-Windows-${arch}.${ext}" },
  mac: {
    ...build.mac,
    artifactName: "APEX-${version}-macOS-${arch}.${ext}",
    identity: "-",
    hardenedRuntime: false,
    notarize: false,
    strictVerify: true,
  },
  dmg: {
    sign: false,
    contents: [
      { x: 130, y: 180, type: "file" },
      { x: 410, y: 180, type: "link", path: "/Applications" },
      { x: 270, y: 310, type: "file", path: "resources/MACOS_PREVIEW.txt" },
    ],
  },
};
