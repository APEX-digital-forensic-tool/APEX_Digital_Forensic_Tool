import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  safeStorage,
  type IpcMainInvokeEvent,
  type WebPreferences,
} from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { runtimeExecutable } from "./runtime";
import { messagesFor } from "../src/i18n/catalog";
import {
  aiConnectionStatus,
  aiEnvironment,
  clearAiConnection,
  saveAiConnection,
  type AiDeps,
  type KeyCrypto,
  type TextFile,
} from "./aiConnection";
import { firstWindow, isSetupComplete, markSetupComplete } from "./appState";

// Used by native packaging CI to exercise the shipped Electron/preload/API path.
// An explicit CLI flag and isolated data directory keep normal user data untouched.
const smokeTest = process.argv.includes("--apex-smoke-test");
if (smokeTest) {
  const directory = process.env.APEX_SMOKE_DATA_DIR;
  if (!directory) throw new Error("APEX_SMOKE_DATA_DIR is required for smoke testing");
  app.setPath("userData", resolve(directory));
}

const operations = new Set([
  "runtime",
  "cases.list",
  "cases.create",
  "evidence.list",
  "evidence.register",
  "files.list",
  "files.roots",
  "artifacts.list",
  "search.query",
  "search.history",
  "timeline.list",
  "candidates.list",
  "candidates.review",
  "view",
  "raw.read",
  "media.inspect",
  "media.video",
  "ai.analyze",
  "ai.prepare",
  "machine.capabilities",
  "machine.configure",
  "machine.reset",
  "machine.run",
  "files.streams",
  "streams.read",
  "streams.export",
  "files.recover",
  "evidence.carve",
  "context.create",
  "context.get",
  "context.update",
  "analysis.start",
  "tasks.list",
  "tasks.cancel",
  "custody.list",
  "custody.add",
  "custody.verify",
  "reports.list",
  "reports.create",
  "reports.get",
  "reports.version",
  "reports.action",
  "reports.export",
  "policy.get",
  "policy.save",
  "policy.audit",
]);
let window: BrowserWindow | undefined;
let setupWindow: BrowserWindow | undefined;
let backend: ChildProcess | undefined;
// Bumped on every spawn and restart so a previous child's events never touch current state.
let generation = 0;
let backendURL = "";
let backendError = "SERVICE_NOT_READY";
const token = randomBytes(32).toString("hex");
const picked = new Map<string, string>();
let account:
  | {
      access_token: string;
      refresh_token: string;
      expiresAt: number;
      origin: string;
    }
  | undefined;
let pageURL = "";
const fail = (code: string) => ({ ok: false, error: { code } });

/** A file in userData: unreadable reads as null; writes go through a 0600 temp file and rename. */
function userDataFile(name: string): TextFile {
  const path = () => join(app.getPath("userData"), name);
  return {
    read() {
      try {
        return readFileSync(path(), "utf8");
      } catch {
        return null;
      }
    },
    write(text) {
      const target = path();
      const temp = `${target}.${process.pid}.tmp`;
      mkdirSync(dirname(target), { recursive: true });
      try {
        writeFileSync(temp, text, { encoding: "utf8", mode: 0o600 });
        chmodSync(temp, 0o600);
        renameSync(temp, target);
      } catch (error) {
        rmSync(temp, { force: true });
        throw error;
      }
    },
    remove() {
      rmSync(path(), { force: true });
    },
  };
}
const keyCrypto: KeyCrypto = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (cipher) => safeStorage.decryptString(cipher),
};
const aiDeps: AiDeps = {
  file: userDataFile("ai-connection.json"),
  crypto: keyCrypto,
  env: process.env,
};
const stateFile = userDataFile("app-state.json");

function sentBy(event: IpcMainInvokeEvent, target: BrowserWindow | undefined) {
  return (
    !!target &&
    !target.isDestroyed() &&
    event.sender === target.webContents &&
    event.senderFrame === target.webContents.mainFrame &&
    event.senderFrame.url.split("#")[0] === pageURL.split("#")[0]
  );
}
function trusted(event: IpcMainInvokeEvent) {
  return sentBy(event, window) || sentBy(event, setupWindow);
}
function handle(
  name: string,
  callback: (event: IpcMainInvokeEvent, ...args: any[]) => unknown,
) {
  ipcMain.handle(name, async (event, ...args) => {
    if (!trusted(event)) return fail("DESKTOP_SENDER_DENIED");
    try {
      return await callback(event, ...args);
    } catch {
      return fail("DESKTOP_CONNECTION_FAILED");
    }
  });
}
async function local(operation: string, payload: Record<string, unknown>) {
  if (!backendURL) return fail(backendError);
  const response = await fetch(`${backendURL}/v1/operations/${operation}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    // Reasoning models can take minutes for one governed AI request.
    signal: AbortSignal.timeout(
      operation === "runtime" ? 60000 : operation === "ai.analyze" ? 300000 : 120000,
    ),
    redirect: "error",
  });
  return response.json();
}
async function startBackend() {
  const current = ++generation;
  const repo = resolve(__dirname, "../..");
  const runtime = runtimeExecutable(process.resourcesPath, process.platform);
  const python =
    process.env.APEX_PYTHON ||
    join(
      repo,
      ".venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    );
  const command = app.isPackaged ? runtime : python;
  if (!existsSync(command)) {
    backendError = "PYTHON_RUNTIME_MISSING";
    return;
  }
  const args = app.isPackaged ? [] : ["-m", "apex_desktop"];
  const child = spawn(
    command,
    [...args, "--data-dir", join(app.getPath("userData"), "local")],
    {
      cwd: app.isPackaged ? process.resourcesPath : repo,
      windowsHide: true,
      env: {
        ...process.env,
        // {} when the user's own APEX_DESKTOP_AI_CONFIG manages the connection.
        ...aiEnvironment(aiDeps),
        PYTHONPATH: app.isPackaged ? "" : join(repo, "src"),
        APEX_DESKTOP_TOKEN: token,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  backend = child;
  child.on("error", () => {
    if (current !== generation) return;
    backendURL = "";
    backendError = "BACKEND_START_FAILED";
  });
  child.on("exit", () => {
    if (current !== generation) return;
    backendURL = "";
    backendError = "BACKEND_STOPPED";
  });
  // Raw backend stderr may contain sensitive paths. Never forward it to the renderer/logs.
  child.stderr?.on("data", () => {});
  const lines = createInterface({ input: child.stdout! });
  lines.on("line", async (line) => {
    try {
      const data = JSON.parse(line);
      if (
        data.type === "apex-ready" &&
        Number.isInteger(data.port) &&
        data.port > 0 &&
        data.port <= 65535
      ) {
        const origin = `http://127.0.0.1:${data.port}`;
        for (let i = 0; i < 50 && current === generation; i++) {
          try {
            const r = await fetch(`${origin}/health`, {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(1000),
            });
            if (current !== generation) break;
            if (r.ok) {
              backendURL = origin;
              backendError = "";
              break;
            }
          } catch {
            /* Wait for the child's listener, not an unrelated port. */
          }
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    } catch {
      /* Only consume the minimal readiness message. */
    }
  });
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Stop the engine, start it with the current AI environment, and wait up to 90s for readiness. */
async function restartEngine() {
  const old = backend;
  generation++;
  backend = undefined;
  if (old && old.exitCode === null && old.signalCode === null) {
    await new Promise<void>((done) => {
      const timer = setTimeout(done, 10000);
      old.once("exit", () => {
        clearTimeout(timer);
        done();
      });
      old.kill();
    });
  }
  backendURL = "";
  backendError = "SERVICE_NOT_READY";
  await startBackend();
  const deadline = Date.now() + 90000;
  while (!backendURL && backendError === "SERVICE_NOT_READY" && Date.now() < deadline)
    await wait(100);
}
// Serialized so overlapping saves cannot orphan a child spawned by an earlier restart.
let restarting: Promise<void> = Promise.resolve();
function restartBackend() {
  restarting = restarting.then(restartEngine, restartEngine);
  return restarting;
}

const webPreferences: WebPreferences = {
  preload: join(__dirname, "preload.cjs"),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
};
function lockDown(target: BrowserWindow) {
  target.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  target.webContents.on("will-navigate", (event) => event.preventDefault());
  target.webContents.session.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
}
/** Assigns `window` before loading, so callers can close another window right away. */
async function createMainWindow() {
  const created = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1060,
    minHeight: 700,
    backgroundColor: "#111519",
    title: "APEX",
    autoHideMenuBar: true,
    webPreferences,
  });
  window = created;
  created.on("closed", () => {
    if (window === created) window = undefined;
  });
  lockDown(created);
  await created.loadURL(pageURL);
  return created;
}
async function createSetupWindow() {
  const created = new BrowserWindow({
    width: 620,
    height: 720,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    center: true,
    // macOS: no title bar, window buttons inset over the setup rail (which is
    // the drag region). Other platforms keep their native frame.
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#18191c",
    title: "APEX",
    autoHideMenuBar: true,
    webPreferences,
  });
  setupWindow = created;
  created.on("closed", () => {
    if (setupWindow === created) setupWindow = undefined;
  });
  lockDown(created);
  await created.loadURL(pageURL + "#setup");
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    const open = window ?? setupWindow;
    open?.show();
    open?.focus();
  });
  app.whenReady().then(async () => {
    await startBackend();
    pageURL =
      !app.isPackaged && process.env.APEX_DEV_URL === "http://127.0.0.1:5173"
        ? "http://127.0.0.1:5173/"
        : pathToFileURL(join(__dirname, "../dist/index.html")).href;
    handle("apex:invoke", async (_event, operation: unknown, input: unknown) => {
      if (
        typeof operation !== "string" ||
        !operations.has(operation) ||
        !input ||
        typeof input !== "object" ||
        Array.isArray(input)
      )
        return fail("VALIDATION_ERROR");
      const payload = { ...(input as Record<string, unknown>) };
      if (JSON.stringify(payload).length > 1048576)
        return fail("RESOURCE_LIMIT_EXCEEDED");
      if (operation === "evidence.register") {
        const reference = String(payload.source_reference ?? "");
        const path = picked.get(reference);
        if (!path) return fail("PICKER_REFERENCE_REQUIRED");
        delete payload.source_reference;
        payload.source_path = path;
        const result = await local(operation, payload);
        if (result.ok) picked.delete(reference);
        return result;
      }
      if (operation === "machine.configure") {
        const old = await local("machine.capabilities", {});
        if (!old.ok) return old;
        const configured: Record<string, unknown> = {
          ...old.data.settings,
          ocr_provider: payload.ocr_provider,
          stt_provider: payload.stt_provider,
        };
        for (const [referenceKey, pathKey] of [
          ["model_reference", "stt_model_path"],
          ["tessdata_reference", "tessdata_path"],
        ]) {
          if (payload[referenceKey] !== undefined) {
            if (payload[referenceKey] === null) {
              configured[pathKey] = null;
              continue;
            }
            const path = picked.get(String(payload[referenceKey]));
            if (!path) return fail("PICKER_REFERENCE_REQUIRED");
            configured[pathKey] = path;
          }
        }
        const result = await local(operation, configured);
        if (result.ok)
          for (const key of ["model_reference", "tessdata_reference"])
            picked.delete(String(payload[key]));
        return result;
      }
      return local(operation, payload);
    });
    handle("apex:pick", async (event, kind: unknown, locale: unknown) => {
      if (kind !== "file" && kind !== "directory")
        return fail("VALIDATION_ERROR");
      const text = messagesFor(locale).native;
      // trusted() guarantees the sender is one of this app's windows.
      const parent = BrowserWindow.fromWebContents(event.sender)!;
      const result = await dialog.showOpenDialog(parent, {
        title: text.pickTitle,
        properties: [kind === "directory" ? "openDirectory" : "openFile"],
        filters:
          kind === "file"
            ? [
                {
                  name: text.evidenceImages,
                  extensions: ["e01", "dd", "raw", "img", "vhd", "vhdx"],
                },
                { name: text.allFiles, extensions: ["*"] },
              ]
            : undefined,
      });
      if (result.canceled) return { ok: true, data: null };
      const reference = randomUUID();
      if (picked.size > 64) picked.clear();
      picked.set(reference, result.filePaths[0]);
      return {
        ok: true,
        data: { reference, name: result.filePaths[0].split(/[\\/]/).pop() },
      };
    });
    handle("apex:exports", async () => {
      const folder = join(app.getPath("userData"), "local", "exports");
      mkdirSync(folder, { recursive: true });
      const error = await shell.openPath(folder);
      return error ? fail("EXPORT_FOLDER_FAILED") : { ok: true, data: null };
    });
    handle("apex:account", () => ({
      ok: true,
      data: {
        connected: !!account && account.expiresAt > Date.now(),
        origin: account?.origin ?? null,
      },
    }));
    handle(
      "apex:login",
      async (_event, input: {
        origin: string;
        email: string;
        password: string;
        tenant_id: string;
      }) => {
        if (
          !input ||
          typeof input.origin !== "string" ||
          typeof input.email !== "string" ||
          typeof input.password !== "string" ||
          typeof input.tenant_id !== "string"
        )
          return fail("VALIDATION_ERROR");
        const url = new URL(input.origin);
        if (
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          url.pathname !== "/" ||
          (url.protocol !== "https:" &&
            !(
              url.protocol === "http:" &&
              ["127.0.0.1", "localhost"].includes(url.hostname)
            ))
        )
          return fail("AUTH_ORIGIN_INVALID");
        const response = await fetch(`${url.origin}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: input.email,
            password: input.password,
            tenant_id: input.tenant_id,
          }),
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok)
          return fail(
            response.status === 401
              ? "AUTH_LOGIN_FAILED"
              : "AUTH_SERVER_UNAVAILABLE",
          );
        const result = await response.json();
        if (
          typeof result.access_token !== "string" ||
          typeof result.refresh_token !== "string" ||
          typeof result.expires_in !== "number"
        )
          return fail("AUTH_CONTRACT_INVALID");
        account = {
          access_token: result.access_token,
          refresh_token: result.refresh_token,
          expiresAt: Date.now() + result.expires_in * 1000,
          origin: url.origin,
        };
        return { ok: true, data: { connected: true, origin: url.origin } };
      },
    );
    handle("apex:logout", () => {
      account = undefined;
      return { ok: true, data: null };
    });
    // Responses carry only the status; the key never leaves the main process.
    handle("apex:ai-connection", () => ({
      ok: true,
      data: aiConnectionStatus(aiDeps),
    }));
    handle("apex:ai-connection-save", async (_event, input: unknown) => {
      const result = saveAiConnection(input, aiDeps);
      if (!result.ok) return fail(result.code);
      await restartBackend();
      return { ok: true, data: aiConnectionStatus(aiDeps) };
    });
    handle("apex:ai-connection-clear", async () => {
      const result = clearAiConnection(aiDeps);
      if (!result.ok) return fail(result.code);
      await restartBackend();
      return { ok: true, data: aiConnectionStatus(aiDeps) };
    });
    handle("apex:setup-complete", (event) => {
      if (!sentBy(event, setupWindow)) return fail("DESKTOP_SENDER_DENIED");
      const setup = setupWindow;
      markSetupComplete(stateFile);
      // Open the main window before closing setup so "all windows closed" never fires.
      if (!window)
        void createMainWindow().catch(() => {
          /* A failed load leaves a blank window; nothing safe to report. */
        });
      setup?.close();
      return { ok: true, data: null };
    });
    if (firstWindow({ setupComplete: isSetupComplete(stateFile), smokeTest }) === "setup") {
      await createSetupWindow();
      return;
    }
    const main = await createMainWindow();
    if (smokeTest) {
      try {
        const deadline = Date.now() + 90000;
        while (!backendURL && Date.now() < deadline) {
          if (["BACKEND_START_FAILED", "BACKEND_STOPPED", "PYTHON_RUNTIME_MISSING"].includes(backendError))
            throw new Error("Backend startup failed");
          await new Promise((r) => setTimeout(r, 100));
        }
        if (!backendURL) throw new Error("Backend readiness timed out");
        const renderer = await main.webContents.executeJavaScript(`
          (async () => {
            if (!document.querySelector('#root')?.textContent ||
                typeof window.apex?.invoke !== 'function') return false;
            const result = await window.apex.invoke('runtime', {});
            return result?.ok === true;
          })()
        `);
        if (renderer !== true) throw new Error("Renderer or preload IPC failed");
        console.log(JSON.stringify({ type: "apex-desktop-smoke", ok: true, renderer: true, backend: true }));
        app.quit();
      } catch {
        // Never emit backend stderr, tokens, evidence paths, or account details.
        console.log(JSON.stringify({ type: "apex-desktop-smoke", ok: false }));
        backend?.kill();
        app.exit(1);
      }
    }
  });
}
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  account = undefined;
  backend?.kill();
});

