import { createPrivateKey } from "node:crypto";
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

if (
  process.platform !== "darwin" ||
  !process.env.RUNNER_TEMP ||
  !process.env.GITHUB_ENV
)
  throw new Error("Run key preparation on the macOS GitHub Actions runner.");
const encoded = process.env.APPLE_API_KEY_BASE64?.replace(/\s/g, "");
if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
  throw new Error("APPLE_API_KEY_BASE64 is missing or invalid.");
const key = Buffer.from(encoded, "base64");
try {
  const parsed = createPrivateKey(key);
  if (
    parsed.asymmetricKeyType !== "ec" ||
    parsed.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  )
    throw new Error();
} catch {
  throw new Error(
    "APPLE_API_KEY_BASE64 must contain an App Store Connect .p8 private key.",
  );
}
const path = join(process.env.RUNNER_TEMP, "apex-notary.p8");
await writeFile(path, key, { mode: 0o600, flag: "wx" });
await appendFile(process.env.GITHUB_ENV, `APPLE_API_KEY=${path}\n`);
console.log(
  "Prepared temporary notarization key; key contents are never logged.",
);
