# 첫 실행 설정 창 + 앱 내 AI 연결 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱 첫 실행에 작은 설정 창(언어 → 분석자 이름 → AI 연결 → OCR·음성 인식 → 서버 계정)을 먼저 띄우고, 끝나면 본 앱 창으로 넘어가게 한다. AI API 키는 앱이 OS 키체인으로 암호화해 저장한다.

**Architecture:** Python 엔진은 바꾸지 않는다. Electron main이 키를 `safeStorage`로 암호화해 `userData`에 저장하고, 엔진을 띄울 때 환경변수로 넣는다. 저장·검증·env 조립과 "어느 창을 먼저 열지" 판단은 Electron에 의존하지 않는 순수 모듈로 빼서 단위 테스트한다. 설정 창과 본 앱 창은 같은 `index.html`을 쓰고 `#setup` 해시로 구분한다.

**Tech Stack:** Electron 44 (`safeStorage`, `BrowserWindow`), React 19, TypeScript 5.9, Vitest 4 + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-11-first-run-setup-design.md`

## Global Constraints

- 프론트 명령은 `frontend/`에서 실행. 각 태스크 완료 조건: `npm run typecheck` + `npx vitest run` 전체 통과.
- 브랜치 `feat/first-run-setup` (이미 생성됨).
- 새 화면 문구는 전부 `src/locales/{ko-KR,en-US}/setup.ts`에. 소스에 한글 리터럴 금지(가드 테스트가 잡는다). 영어 값에 한글 금지.
- DOM을 쓰는 새 테스트 파일은 첫 줄에 `// @vitest-environment jsdom`.
- 기존 테스트는 고치지 않는다(바뀐 시그니처에 인자를 넘기는 수정만 허용).
- API 키는 어떤 IPC 응답·로그·DOM에도 다시 나오지 않는다. 평문으로 디스크에 쓰지 않는다.
- 실제 API 키는 쓰지 않는다. 테스트와 실제 앱 확인에는 `test-key-123` 같은 가짜 값과 `http://127.0.0.1:9/v1`를 쓴다.
- 고정값: `provider_id = "apex-desktop"`, `api_key_env = "APEX_DESKTOP_AI_STORED_KEY"`, 저장소 키 `apex.examinerName`, 설정 창 크기 620×720.
- 기본값·범위: `temperature` 0–2 (기본 0), `max_output` 1–200000 (기본 4096), `timeout` 1–600 (기본 30), `model_id` 1–256자, `api_key` 1–4096자·제어 문자 없음.
- 주소 규칙: `https:`만 허용, `127.0.0.1`·`localhost`는 `http:` 허용, 사용자명·비밀번호·쿼리·해시가 있으면 거절.
- Python(`src/`)은 건드리지 않는다.

## Review Focus

1. **키 유출 경로** — 저장 후에도 입력란·React 상태·IPC 응답·콘솔에 키가 남으면 안 된다 → Task 1(응답에 키 없음), Task 4(저장 후 입력란 비움·DOM에 키 없음) 테스트.
2. **깨진/변조된 저장 파일** — `ai-connection.json`이나 `app-state.json`이 깨졌거나 다른 계정의 키체인으로 암호화돼 복호화가 실패해도 앱은 정상 시작하고 "설정 안 됨"으로 보여야 한다 → Task 1·2 테스트.
3. **환경변수와 앱 저장 값이 함께 있을 때** — 환경변수가 이기고, 앱은 엔진에 자기 값을 넣지 않으며 화면에서 수정이 막혀야 한다 → Task 1·4 테스트.
4. **설정 창을 중간에 닫거나 단계에서 저장이 실패했을 때** — 완료로 기록되지 않고 다음 실행에 다시 뜬다. 저장 실패는 그 단계에 머물며 건너뛸 수 있다 → Task 2·6 테스트, Task 7 실제 확인.
5. **엔진 재시작 중의 화면** — 재시작 동안 본 앱이 오류로 굳지 않고 다시 연결된다. 진행 중 작업이 있으면 저장·삭제가 막힌다 → Task 4 테스트, Task 7 실제 확인.

---

## File Structure

- `frontend/electron/aiConnection.ts` (+ `.test.ts`) — 검증, 암호화 저장, 상태, 엔진 env 조립. 순수.
- `frontend/electron/appState.ts` (+ `.test.ts`) — 설정 완료 플래그, 첫 창 판단. 순수.
- `frontend/electron/main.ts`, `preload.ts` — 창 두 개, IPC 4개, 엔진 재시작.
- `frontend/src/gateway.ts`, `demoBridge.ts` — 브리지 타입과 데모 구현.
- `frontend/src/setup/AiConnectionForm.tsx` — 설정 창과 본 앱이 함께 쓰는 폼.
- `frontend/src/setup/profile.ts`, `ProfileSettings.tsx` — 기본 분석자 이름.
- `frontend/src/setup/SetupApp.tsx`, `setup.css` — 설정 창 화면.
- `frontend/src/locales/{ko-KR,en-US}/setup.ts`, `errors.ts` — 문구.
- `frontend/src/main.tsx`, `App.tsx` — 해시 분기, 설정 화면 카드, 새 사건 기본값.

---

### Task 1: AI 연결 저장 모듈

**Files:**
- Create: `frontend/electron/aiConnection.ts`, `frontend/electron/aiConnection.test.ts`

**Interfaces:**
- Produces:
```ts
export const STORED_KEY_ENV = "APEX_DESKTOP_AI_STORED_KEY";
export interface TextFile { read(): string | null; write(text: string): void; remove(): void }
export interface KeyCrypto { available(): boolean; encrypt(plain: string): Buffer; decrypt(cipher: Buffer): string }
export interface AiDeps { file: TextFile; crypto: KeyCrypto; env: Record<string, string | undefined> }
export interface AiConnectionStatus {
  configured: boolean; managed: boolean; has_key: boolean; storage_available: boolean;
  base_url: string | null; model_id: string | null;
  temperature: number; max_output: number; timeout: number;
}
export type AiSaveResult = { ok: true } | { ok: false; code: "AI_CONNECTION_INVALID" | "AI_KEY_STORAGE_UNAVAILABLE" | "AI_CONNECTION_MANAGED" };
export function aiConnectionStatus(deps: AiDeps): AiConnectionStatus;
export function saveAiConnection(input: unknown, deps: AiDeps): AiSaveResult;
export function clearAiConnection(deps: AiDeps): AiSaveResult;
/** Variables to add to the engine's environment; {} when managed by the user's own env, unset, or undecryptable. */
export function aiEnvironment(deps: AiDeps): Record<string, string>;
```
- 저장 파일 형식(JSON): `{ base_url, model_id, temperature, max_output, timeout, key }` (`key` = 암호문 base64).
- `managed` = `deps.env.APEX_DESKTOP_AI_CONFIG`가 비어 있지 않음.
- `aiEnvironment`의 `APEX_DESKTOP_AI_CONFIG` 값은 `{provider_id:"apex-desktop", base_url, model_id, api_key_env:STORED_KEY_ENV, temperature, max_output, timeout}`의 JSON.

- [ ] **Step 1: 실패하는 테스트 작성** (node 환경). 가짜 의존성: 메모리 `TextFile`, `encrypt = (s) => Buffer.from("enc:" + s)`, `decrypt`는 `enc:` 접두어가 없으면 throw.

```ts
const valid = { base_url: "https://api.example.com/v1", model_id: "model-x", api_key: "test-key-123" };

it("stores the key encrypted and never reports it back", () => {
  const d = deps();
  expect(saveAiConnection(valid, d)).toEqual({ ok: true });
  expect(d.file.read()).not.toContain("test-key-123");
  const status = aiConnectionStatus(d);
  expect(status).toMatchObject({ configured: true, has_key: true, managed: false, base_url: valid.base_url, model_id: "model-x", temperature: 0, max_output: 4096, timeout: 30 });
  expect(JSON.stringify(status)).not.toContain("test-key-123");
});
it("builds the engine environment from the stored connection", () => {
  const d = deps(); saveAiConnection({ ...valid, temperature: 1, max_output: 16384, timeout: 240 }, d);
  const env = aiEnvironment(d);
  expect(env.APEX_DESKTOP_AI_STORED_KEY).toBe("test-key-123");
  expect(JSON.parse(env.APEX_DESKTOP_AI_CONFIG)).toEqual({ provider_id: "apex-desktop", base_url: valid.base_url, model_id: "model-x", api_key_env: "APEX_DESKTOP_AI_STORED_KEY", temperature: 1, max_output: 16384, timeout: 240 });
});
it.each([
  ["http on a public host", { ...valid, base_url: "http://api.example.com/v1" }],
  ["credentials in the URL", { ...valid, base_url: "https://user:pw@api.example.com/v1" }],
  ["a query string", { ...valid, base_url: "https://api.example.com/v1?k=1" }],
  ["not a URL", { ...valid, base_url: "api.example.com" }],
  ["an empty model", { ...valid, model_id: "" }],
  ["a control character in the key", { ...valid, api_key: "abc\ndef" }],
  ["temperature out of range", { ...valid, temperature: 3 }],
  ["no key at all", { base_url: valid.base_url, model_id: "model-x" }],
  ["a non-object", "nope"],
])("rejects %s", (_name, input) => {
  const d = deps();
  expect(saveAiConnection(input, d)).toEqual({ ok: false, code: "AI_CONNECTION_INVALID" });
  expect(d.file.read()).toBeNull();
});
it("allows http for local model servers", () => {
  for (const base_url of ["http://127.0.0.1:11434/v1", "http://localhost:8080/v1"])
    expect(saveAiConnection({ ...valid, base_url }, deps())).toEqual({ ok: true });
});
it("keeps the stored key when the key field is left empty", () => {
  const d = deps(); saveAiConnection(valid, d);
  expect(saveAiConnection({ base_url: valid.base_url, model_id: "model-y", api_key: "" }, d)).toEqual({ ok: true });
  expect(aiEnvironment(d).APEX_DESKTOP_AI_STORED_KEY).toBe("test-key-123");
  expect(aiConnectionStatus(d).model_id).toBe("model-y");
});
it("refuses to store when encryption is unavailable", () => {
  const d = deps({ available: false });
  expect(saveAiConnection(valid, d)).toEqual({ ok: false, code: "AI_KEY_STORAGE_UNAVAILABLE" });
  expect(d.file.read()).toBeNull();
  expect(aiConnectionStatus(d).storage_available).toBe(false);
});
it("lets the user's own environment variable win", () => {
  const d = deps({ env: { APEX_DESKTOP_AI_CONFIG: "{}" } }); 
  expect(aiConnectionStatus(d)).toMatchObject({ managed: true, configured: true });
  expect(saveAiConnection(valid, d)).toEqual({ ok: false, code: "AI_CONNECTION_MANAGED" });
  expect(clearAiConnection(d)).toEqual({ ok: false, code: "AI_CONNECTION_MANAGED" });
  expect(aiEnvironment(d)).toEqual({});
});
it.each([["corrupt JSON", "{oops"], ["a wrong shape", '{"base_url":1}'], ["a key this account cannot decrypt", JSON.stringify({ base_url: "https://a.example/v1", model_id: "m", temperature: 0, max_output: 4096, timeout: 30, key: Buffer.from("other").toString("base64") })]])(
  "treats %s as not configured without throwing", (_name, text) => {
    const d = deps({ text });
    expect(aiConnectionStatus(d)).toMatchObject({ configured: false, has_key: false });
    expect(aiEnvironment(d)).toEqual({});
  });
it("removes the stored connection", () => {
  const d = deps(); saveAiConnection(valid, d);
  expect(clearAiConnection(d)).toEqual({ ok: true });
  expect(d.file.read()).toBeNull();
  expect(aiConnectionStatus(d).configured).toBe(false);
});
```
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run electron/aiConnection.test.ts` / Expected: FAIL (모듈 없음)
- [ ] **Step 3: 구현** — 위 시그니처대로. URL은 `new URL()`로 파싱(실패는 무효). 숫자 필드는 `Number.isFinite` 확인.
- [ ] **Step 4: 통과 확인** — Run: `npm run typecheck && npx vitest run` / Expected: 전부 PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): add encrypted AI connection store"`

---

### Task 2: 설정 완료 상태 모듈

**Files:**
- Create: `frontend/electron/appState.ts`, `frontend/electron/appState.test.ts`

**Interfaces:**
- Consumes: `TextFile` (Task 1)
- Produces:
```ts
export function isSetupComplete(file: TextFile): boolean;   // missing or corrupt file → false
export function markSetupComplete(file: TextFile): void;    // writes {"setup_complete":true}
export function firstWindow(o: { setupComplete: boolean; smokeTest: boolean }): "setup" | "main";
```

- [ ] **Step 1: 실패하는 테스트 작성**
```ts
it("starts with setup until it is completed", () => {
  const file = memoryFile();
  expect(isSetupComplete(file)).toBe(false);
  expect(firstWindow({ setupComplete: false, smokeTest: false })).toBe("setup");
  markSetupComplete(file);
  expect(isSetupComplete(file)).toBe(true);
  expect(firstWindow({ setupComplete: true, smokeTest: false })).toBe("main");
});
it.each(["{oops", '{"setup_complete":"yes"}', "null", ""])("treats %j as not completed", (text) =>
  expect(isSetupComplete(memoryFile(text))).toBe(false));
it("skips setup for the packaging smoke test", () =>
  expect(firstWindow({ setupComplete: false, smokeTest: true })).toBe("main"));
```
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run electron/appState.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — Run: `npm run typecheck && npx vitest run` / Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): track first-run setup completion"`

---

### Task 3: 브리지 타입 + Electron main 배선

**Files:**
- Modify: `frontend/src/gateway.ts` (`DesktopBridge`), `frontend/src/demoBridge.ts`, `frontend/src/demoBridge.test.ts`(추가만), `frontend/electron/preload.ts`, `frontend/electron/main.ts`

**Interfaces:**
- Consumes: Task 1·2 전부
- Produces (`DesktopBridge`에 추가; `AiConnectionStatus` 타입은 `electron/aiConnection.ts`에서 `import type`):
```ts
aiConnection(): Promise<Reply<AiConnectionStatus>>;
saveAiConnection(input: { base_url: string; model_id: string; api_key?: string; temperature?: number; max_output?: number; timeout?: number }): Promise<Reply<AiConnectionStatus>>;
clearAiConnection(): Promise<Reply<AiConnectionStatus>>;
completeSetup(): Promise<Reply<null>>;
```
- IPC 채널: `apex:ai-connection`, `apex:ai-connection-save`, `apex:ai-connection-clear`, `apex:setup-complete`.

- [ ] **Step 1: 실패하는 테스트 추가** — `src/demoBridge.test.ts`
```ts
it("reports no AI connection and refuses to store one in the demo", async () => {
  const bridge = createDemoBridge();
  expect(await bridge.aiConnection()).toMatchObject({ ok: true, data: { configured: false, managed: false, has_key: false } });
  expect(await bridge.saveAiConnection({ base_url: "https://a.example/v1", model_id: "m", api_key: "test-key-123" }))
    .toEqual({ ok: false, error: { code: "DEMO_READ_ONLY" } });
  expect(await bridge.completeSetup()).toEqual({ ok: true, data: null });
});
```
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/demoBridge.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현.**
  - `demoBridge`: 위 테스트대로. `clearAiConnection`도 `DEMO_READ_ONLY`.
  - `preload.ts`: 네 메서드를 각 채널의 `ipcRenderer.invoke`로.
  - `main.ts`:
    - `TextFile` 구현 두 개(`userData/ai-connection.json`, `userData/app-state.json`): 읽기 실패는 `null`, 쓰기는 임시 파일 → `renameSync`, 권한 `0o600`.
    - `KeyCrypto`는 `safeStorage`의 `isEncryptionAvailable` / `encryptString` / `decryptString`.
    - `startBackend()`의 `env`에 `...aiEnvironment(deps)`를 추가(사용자 env 뒤에 병합).
    - `restartBackend()`: 현재 자식을 `kill()` → `exit` 대기(최대 10초) → `backendURL = ""`, `backendError = "SERVICE_NOT_READY"` → `startBackend()` → `backendURL`이 찰 때까지 대기(최대 90초). 자식마다 세대 번호를 캡처해, 지난 세대의 `exit`/`error`/준비 이벤트는 상태를 건드리지 않게 한다.
    - 저장·삭제 핸들러: 모듈 호출 → `ok`면 `restartBackend()` 후 `aiConnectionStatus` 반환, 아니면 `fail(code)`.
    - 창: `createMainWindow()`(기존 옵션 그대로)와 `createSetupWindow()`(620×720, `resizable:false`, `maximizable:false`, `fullscreenable:false`, 같은 `webPreferences`와 탐색·권한 차단, `pageURL + "#setup"`). 시작 시 `firstWindow({ setupComplete: isSetupComplete(stateFile), smokeTest })`로 고른다.
    - `apex:setup-complete`: 발신자가 설정 창일 때만 → `markSetupComplete` → `createMainWindow()` → 설정 창 `close()`.
    - `trusted(event)`: 발신 프레임이 설정 창 또는 본 앱 창의 `mainFrame`이고 URL(해시 제외)이 `pageURL`과 같을 때 true.
    - `handle()`이 콜백에 `event`를 넘기게 하고, `apex:pick`은 `BrowserWindow.fromWebContents(event.sender)`를 부모로 쓴다.
    - `second-instance`: 열려 있는 창을 앞으로.
- [ ] **Step 4: 통과 확인** — Run: `npm run typecheck && npx vitest run && node scripts/electron.mjs` / Expected: 테스트 PASS, `dist-electron/main.cjs` 빌드 성공
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): wire setup window and AI connection IPC"`

(main.ts의 창·IPC 배선은 Electron 런타임이 필요해 단위 테스트하지 않는다. 판단 로직은 Task 1·2가 덮고, 배선은 Task 7에서 실제 앱으로 확인한다.)

---

### Task 4: AI 연결 폼 + 본 앱 설정 카드

**Files:**
- Create: `frontend/src/setup/AiConnectionForm.tsx`, `frontend/src/setup/AiConnectionForm.test.tsx`, `frontend/src/locales/{ko-KR,en-US}/setup.ts`
- Modify: `frontend/src/locales/{ko-KR,en-US}/index.ts`, `frontend/src/locales/{ko-KR,en-US}/errors.ts`, `frontend/src/App.tsx` (설정 라우트: `<LanguageSettings />` 아래 카드)

**Interfaces:**
- Consumes: Task 3 브리지
- Produces:
```ts
export function AiConnectionForm(props: {
  /** Save/remove are blocked with this reason shown (e.g. analysis tasks running). */
  blockedReason?: string;
  showRemove?: boolean;
  onChanged?: (status: AiConnectionStatus) => void;
}): JSX.Element;
```
- 문구(`m.setup.ai`, ko / en):
  - `title` AI 연결 / AI connection · `baseUrl` 접속 주소 / Base URL · `model` 모델 이름 / Model name · `apiKey` API 키 / API key
  - `keepKey` 비워 두면 저장된 키를 유지합니다. / Leave empty to keep the stored key.
  - `advanced` 고급 설정 / Advanced settings · `temperature` Temperature / Temperature · `maxOutput` 최대 출력 토큰 / Max output tokens · `timeout` 제한 시간 (초) / Timeout (seconds)
  - `save` 저장 / Save · `remove` 연결 삭제 / Remove connection
  - `configured` 설정됨 / Configured · `notConfigured` 설정 안 됨 / Not configured
  - `managed` 환경변수(APEX_DESKTOP_AI_CONFIG)로 관리되는 설정입니다. 실행 환경에서 변경해주세요. / Managed by the APEX_DESKTOP_AI_CONFIG environment variable. Change it in the runtime environment.
  - `storageUnavailable` 이 컴퓨터에서는 키를 암호화할 수 없어 앱에 저장하지 않습니다. / This computer cannot encrypt the key, so it is not stored in the app.
  - `restartNote` 저장하면 분석 엔진을 다시 시작합니다. / Saving restarts the analysis engine.
  - `busy` 분석 작업이 끝난 뒤 변경할 수 있습니다. / You can change this after the running analysis tasks finish.
  - `policyNote` 무엇을 AI로 보낼지는 사건별 AI 데이터 정책이 결정합니다. / What is sent to AI is decided by each case's AI data policy.
- 오류 문구(`errors.ts`):
  - `AI_CONNECTION_INVALID` 접속 주소, 모델 이름, API 키를 확인해주세요. 접속 주소는 https:// 로 시작해야 합니다(로컬 주소 제외). / Check the base URL, model name and API key. The base URL must start with https:// (except local addresses).
  - `AI_KEY_STORAGE_UNAVAILABLE` = `storageUnavailable`과 같은 문장
  - `AI_CONNECTION_MANAGED` = `managed`와 같은 문장
  - `AI_CONFIGURATION_INVALID`: 기존 문장에서 "실행 환경의 APEX_DESKTOP_AI_CONFIG를 확인해주세요."를 "설정의 AI 연결 또는 실행 환경의 APEX_DESKTOP_AI_CONFIG를 확인해주세요."로 (영어도 같은 위치에 "the AI connection in Settings or").

- [ ] **Step 1: 실패하는 테스트 작성** (jsdom). `window.apex`에 `createDemoBridge()`를 넣고 세 AI 메서드를 `vi.fn`으로 덮어쓴다.
```tsx
it("saves the connection, then clears the key field and never shows the key", async () => {
  const save = vi.fn(async () => ok({ ...none, configured: true, has_key: true, base_url: "https://api.example.com/v1", model_id: "model-x" }));
  mount({ aiConnection: async () => ok(none), saveAiConnection: save });
  await userEvent.type(await screen.findByLabelText("Base URL"), "https://api.example.com/v1");
  await userEvent.type(screen.getByLabelText("Model name"), "model-x");
  await userEvent.type(screen.getByLabelText("API key"), "test-key-123");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Configured");
  expect(save).toHaveBeenCalledWith({ base_url: "https://api.example.com/v1", model_id: "model-x", api_key: "test-key-123", temperature: 0, max_output: 4096, timeout: 30 });
  expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
  expect(document.body.innerHTML).not.toContain("test-key-123");
  expect((screen.getByLabelText("API key") as HTMLInputElement).type).toBe("password");
});
it("shows a managed connection as read-only", async () => {
  mount({ aiConnection: async () => ok({ ...none, configured: true, managed: true }) });
  await screen.findByText(/Managed by the APEX_DESKTOP_AI_CONFIG environment variable/);
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});
it("blocks saving and removing while analysis is running", async () => {
  mount({ aiConnection: async () => ok({ ...none, configured: true, has_key: true }) }, { blockedReason: "You can change this after the running analysis tasks finish.", showRemove: true });
  expect((await screen.findByRole("button", { name: "Save" })).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "Remove connection" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByText("You can change this after the running analysis tasks finish.")).toBeTruthy();
});
it("keeps the form filled and explains a rejected save", async () => {
  mount({ aiConnection: async () => ok(none), saveAiConnection: async () => ({ ok: false, error: { code: "AI_CONNECTION_INVALID" } }) });
  await userEvent.type(await screen.findByLabelText("Base URL"), "http://api.example.com");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect((screen.getByLabelText("Base URL") as HTMLInputElement).value).toBe("http://api.example.com");
});
it("says when the key cannot be encrypted on this computer", async () => {
  mount({ aiConnection: async () => ok({ ...none, storage_available: false }) });
  await screen.findByText("This computer cannot encrypt the key, so it is not stored in the app.");
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});
```
(`none` = `{ configured:false, managed:false, has_key:false, storage_available:true, base_url:null, model_id:null, temperature:0, max_output:4096, timeout:30 }`, `mount`는 `renderInEnglish`로 감싼 로컬 헬퍼.)
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/setup/AiConnectionForm.test.tsx` / Expected: FAIL
- [ ] **Step 3: 구현.** 키 입력은 비제어(ref)로 두고 저장 직후 비운다(React 상태에 키를 두지 않는다). 저장된 키가 있으면 `keepKey` 안내. 본 앱 설정 라우트에 `<AiConnectionForm showRemove blockedReason={tasks.some(activeTask) ? m.setup.ai.busy : undefined} onChanged={() => void bootstrap()} />`.
- [ ] **Step 4: 통과 확인** — Run: `npm run typecheck && npx vitest run` / Expected: 전부 PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): add in-app AI connection settings"`

---

### Task 5: 기본 분석자 이름

**Files:**
- Create: `frontend/src/setup/profile.ts`, `frontend/src/setup/ProfileSettings.tsx`, `frontend/src/setup/profile.test.tsx`
- Modify: `frontend/src/App.tsx` (새 사건 대화상자 `investigator` 필드의 `default`, 설정 라우트에 카드), `frontend/src/locales/{ko-KR,en-US}/setup.ts`

**Interfaces:**
- Produces:
```ts
export const EXAMINER_NAME_KEY = "apex.examinerName";
export function readExaminerName(): string;            // "" when unset or storage fails
export function writeExaminerName(name: string): void;  // trims; removes the key when empty; max 255 chars
export function ProfileSettings(): JSX.Element;         // one labelled input, saves on change
```
- 문구(`m.setup.examiner`): `label` 분석자 이름 / Examiner name · `hint` 새 사건을 만들 때 미리 채워집니다. 사건마다 바꿀 수 있습니다. / Prefilled when you create a case. You can change it for each case.

- [ ] **Step 1: 실패하는 테스트 작성** (jsdom)
```tsx
it("remembers the examiner name and trims it", () => {
  writeExaminerName("  Kim  "); expect(readExaminerName()).toBe("Kim");
  writeExaminerName(""); expect(localStorage.getItem("apex.examinerName")).toBeNull();
});
it("survives blocked storage", () => {
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
  expect(readExaminerName()).toBe(""); get.mockRestore();
});
it("prefills the examiner name in a new case", async () => {
  writeExaminerName("Kim");
  window.apex = createDemoBridge();
  renderInEnglish(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "New case" }));
  expect((screen.getByLabelText("Examiner name") as HTMLInputElement).value).toBe("Kim");
});
it("edits the default from settings", async () => {
  renderInEnglish(<ProfileSettings />);
  await userEvent.type(screen.getByLabelText("Examiner name"), "Lee");
  expect(readExaminerName()).toBe("Lee");
});
```
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/setup/profile.test.tsx` / Expected: FAIL
- [ ] **Step 3: 구현.** `newCase()`가 열릴 때 `readExaminerName()`을 `default`로.
- [ ] **Step 4: 통과 확인** — Run: `npm run typecheck && npx vitest run` / Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): add default examiner name"`

---

### Task 6: 설정 창 화면

**Files:**
- Create: `frontend/src/setup/SetupApp.tsx`, `frontend/src/setup/setup.css`, `frontend/src/setup/SetupApp.test.tsx`
- Modify: `frontend/src/main.tsx` (`location.hash === "#setup"`이면 `<SetupApp />`), `frontend/src/locales/{ko-KR,en-US}/setup.ts`

**Interfaces:**
- Consumes: `LanguageSettings`의 언어 선택 로직(`useI18n`, `LOCALES`, `LANGUAGE_NAMES`), `ProfileSettings`, `AiConnectionForm`, 기존 `MachineSettings`, `AccountPanel`, `window.apex.completeSetup`
- Produces: `export function SetupApp(): JSX.Element`
- 문구(`m.setup`): `title` APEX 시작 설정 / Set up APEX · `steps` [언어, 분석자 이름, AI 연결, OCR·음성 인식, 서버 계정] / [Language, Examiner name, AI connection, OCR and speech recognition, Server account] · `back` 이전 / Back · `skip` 건너뛰기 / Skip · `next` 다음 / Next · `start` 시작 / Start · `progress(n, total)` `${n} / ${total}` · `optional` 선택 사항입니다. 나중에 설정에서 바꿀 수 있습니다. / Optional. You can change this later in Settings. · `accountNote` 로그인은 앱을 끌 때까지만 유지됩니다. / Sign-in lasts until you quit the app. · `machineNote` 기본값으로 바로 쓸 수 있습니다. / The defaults work out of the box.
- 1단계 제목은 두 언어 병기(`LanguageSettings`와 같은 방식). 1단계에는 `건너뛰기`가 없다.

- [ ] **Step 1: 실패하는 테스트 작성** (jsdom). `window.apex`는 `createDemoBridge()`에 `completeSetup`만 `vi.fn`으로.
```tsx
it("walks the five steps and finishes", async () => {
  const done = vi.fn(async () => ({ ok: true as const, data: null }));
  window.apex = { ...createDemoBridge(), completeSetup: done };
  render(<I18nProvider initialLocale="ko-KR"><SetupApp /></I18nProvider>);
  expect(screen.getByText("1 / 5")).toBeTruthy();
  await userEvent.click(screen.getByRole("radio", { name: "English" }));
  expect(screen.getByRole("heading", { level: 1, name: "Set up APEX" })).toBeTruthy();
  expect(localStorage.getItem("apex.locale")).toBe("en-US");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.type(screen.getByLabelText("Examiner name"), "Kim");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByRole("heading", { level: 2, name: "AI connection" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(screen.getByRole("heading", { level: 2, name: "OCR and speech recognition" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByRole("heading", { level: 2, name: "Server account" })).toBeTruthy();
  expect(screen.getByText("5 / 5")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(done).toHaveBeenCalledOnce();
  expect(localStorage.getItem("apex.examinerName")).toBe("Kim");
});
it("goes back without losing what was entered", async () => {
  window.apex = createDemoBridge();
  renderInEnglish(<SetupApp />);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.type(screen.getByLabelText("Examiner name"), "Kim");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect((screen.getByLabelText("Examiner name") as HTMLInputElement).value).toBe("Kim");
});
it("stays on the last step and reports when finishing fails", async () => {
  window.apex = { ...createDemoBridge(), completeSetup: async () => ({ ok: false as const, error: { code: "DESKTOP_CONNECTION_FAILED" } }) };
  renderInEnglish(<SetupApp />);
  for (const name of ["Next", "Next", "Skip", "Next"]) await userEvent.click(screen.getByRole("button", { name }));
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByText("5 / 5")).toBeTruthy();
});
```
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/setup/SetupApp.test.tsx` / Expected: FAIL
- [ ] **Step 3: 구현.** 단계 본문은 창 안에서 스크롤, 아래 버튼 줄은 고정. 620×720에 맞춘 여백과 기존 디자인 토큰(`styles.css` 변수)만 사용.
- [ ] **Step 4: 통과 확인** — Run: `npm run typecheck && npx vitest run` / Expected: 전부 PASS (한글 가드 포함)
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): add first-run setup window"`

---

### Task 7: 실제 앱 확인 + 문서

**Files:**
- Modify: `README.md` (AI 설정 절, 미배포 항목), `docs/engine/frontend-engine-integration-2026-10-19.md` (AI 연결 절)

- [ ] **Step 1: 빈 데이터 폴더로 개발 앱 실행** — 저장소 밖 임시 폴더를 `--user-data-dir`로, `--remote-debugging-port`를 붙여 Electron을 띄운다(실행 스크립트는 저장소에 넣지 않는다). 사용자의 기존 앱 데이터는 건드리지 않는다.
- [ ] **Step 2: 설정 창 확인** — CDP로 캡처: 창이 하나(620×720, `#setup`)만 뜨는지, 5단계가 한국어·영어로 넘어가는지, 겹치거나 잘리는 요소가 없는지. 캡처를 사용자에게 보낸다.
- [ ] **Step 3: AI 저장 확인** — 3단계에 `http://127.0.0.1:9/v1`, `test-model`, `test-key-123` 저장 → 오류 없이 "설정됨". `ai-connection.json`에 `test-key-123`이 평문으로 없는지 `grep`으로 확인. 엔진이 다시 떠서 4단계(OCR·음성 인식)가 로드되는지 확인.
- [ ] **Step 4: 전환 확인** — `시작` → 설정 창이 닫히고 본 앱 창(1540×960)이 뜬다. 본 앱 설정 화면의 AI 연결 카드가 "설정됨", 새 사건 대화상자에 분석자 이름이 채워져 있다. 캡처.
- [ ] **Step 5: 재실행 확인** — 앱을 끄고 같은 데이터 폴더로 다시 실행 → 설정 창 없이 본 앱이 바로 뜬다. 설정 창을 중간에 닫은 경우(새 빈 폴더)에는 다음 실행에 다시 뜬다.
- [ ] **Step 6: 문서** — README "AI 설정" 절에 앱 안 설정 방법을 먼저 쓰고 환경변수는 "고급·자동화용, 있으면 우선"으로. "다음 릴리스에 포함 (미배포)"에 첫 실행 설정 창 항목 추가. 엔진 통합 문서의 "렌더러에서 키나 접속 주소를 전달하지 않는다"를 스펙의 "바뀌는 원칙" 문장으로 교체.
- [ ] **Step 7: 최종 검증** — Run: `npm run typecheck && npm test && npm run build` / Expected: 모두 성공
- [ ] **Step 8: Commit** — `git commit -m "docs: describe first-run setup and in-app AI connection"`
