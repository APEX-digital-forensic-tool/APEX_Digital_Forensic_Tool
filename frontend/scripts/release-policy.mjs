import { existsSync } from "node:fs";

// PR signing is safe here only because the preview config forces identity '-'
// and the child process receives no Apple signing/notarization credentials.
export function macPreviewEnvironment(env) {
  const preview = { ...env };
  for (const key of Object.keys(preview)) {
    if (key.startsWith("CSC_") || key.startsWith("MAC_CSC_") || key.startsWith("APPLE_"))
      delete preview[key];
  }
  preview.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  preview.CSC_FOR_PULL_REQUEST = "true";
  return preview;
}

// electron-builder 26 can skip notarization with only a warning. Fail closed.
export function assertMacReleaseCredentials(env, exists = existsSync) {
  const required = [
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "APPLE_API_KEY",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER",
    "APPLE_TEAM_ID",
  ];
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length)
    throw new Error(`Missing macOS release credentials: ${missing.join(", ")}`);
  if (env.CSC_IDENTITY_AUTO_DISCOVERY === "false" || env.CSC_NAME === "-")
    throw new Error("Developer ID signing must be enabled for a release.");
  if (
    env.APPLE_ID ||
    env.APPLE_APP_SPECIFIC_PASSWORD ||
    env.APPLE_KEYCHAIN_PROFILE
  )
    throw new Error("Release builds use the App Store Connect API key only.");
  if (!/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID))
    throw new Error("APPLE_TEAM_ID must be a 10-character Apple Team ID.");
  if (!exists(env.APPLE_API_KEY))
    throw new Error("APPLE_API_KEY must point to the decoded .p8 file.");
}

export function releaseVersion(pkg, lock) {
  const version = pkg.version;
  if (
    !/^\d+\.\d+\.\d+$/.test(version) ||
    lock.version !== version ||
    lock.packages?.[""]?.version !== version
  )
    throw new Error(
      "Release version must be X.Y.Z and match package-lock.json.",
    );
  return version;
}

