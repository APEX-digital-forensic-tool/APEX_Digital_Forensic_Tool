# 영어 UI 지원 및 언어 선택 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** APEX 데스크톱 앱에서 한국어/English를 고를 수 있게 하고, 모든 UI 문구를 영어로 제공한다.

**Architecture:** 외부 라이브러리 없이 타입 검사되는 메시지 카탈로그(`src/locales/ko-KR/*`, `src/locales/en-US/*`)와 React Context(`I18nProvider`/`useI18n`)로 구현한다. 한국어 카탈로그가 타입의 기준(`Messages = typeof koKR`)이고 영어 카탈로그는 같은 형태를 컴파일 타임에 강제받는다. 컴포넌트별 마이그레이션 진척은 "하드코딩 한글 금지" 가드 테스트의 허용 목록을 하나씩 줄이는 것으로 측정한다.

**Tech Stack:** React 19, TypeScript 5.9 (strict), Vitest 4 + Testing Library (jsdom), Electron 44 (esbuild 번들), Vite 8.

**Spec:** 별도 스펙 문서 없음. 아래 "결정 사항"이 스펙이다 (2026-11-11 요청: "영어권 사용자를 위해 언어 선택 + 영어 지원").

## 결정 사항 (Spec)

1. 지원 로캘은 `ko-KR`, `en-US` 두 개. `type Locale = "ko-KR" | "en-US"`.
2. 시작 언어 결정 순서: 저장된 선택(`localStorage["apex.locale"]`, 유효한 `Locale`일 때) → `navigator.languages`를 앞에서부터 보며 처음 `ko*`이면 `ko-KR`, `en*`이면 `en-US` → 어느 쪽도 없으면 `en-US`.
   - 영향: 영어 OS를 쓰는 기존 한국어 사용자는 업그레이드 후 영어로 시작한다. 설정에서 한 번 바꾸면 유지된다.
3. 언어 선택 UI는 설정 화면 맨 위 "언어 / Language" 카드의 네이티브 `<select>`. 선택지 이름은 항상 자기 언어로 표기(`한국어`, `English`). 바꾸면 바로 반영되고(재시작·리마운트 없음, 선택한 사건·탭 유지) 저장된다.
4. `<html lang>`을 `ko`/`en`으로 동기화한다.
5. 새 사건의 `locale`은 현재 UI 로캘을 쓴다(`App.tsx`의 하드코딩 `"ko-KR"` 대체). 보고서 레이블 언어는 사건 로캘을 따른다. 백엔드 `report/runtime.py`의 `_label`이 이미 처리하고 있다. 기존 `ko-KR` 사건은 UI가 영어여도 한국어 보고서로 나온다.
6. 네이티브 파일 대화상자(Electron main) 문구도 UI 언어를 따른다: `pick(kind, locale)`.
7. 백엔드가 한국어로 내려주는 표시 문구 2개(`src/apex_desktop/ai_content.py`의 `notice`, `src/apex_desktop/machine.py`의 `bundled_stt.name`)는 백엔드를 고치지 않고 프론트에서 카탈로그 문구로 대신 표시한다(CLI/MCP 호환 유지).
8. 범위 밖: `demoData.ts`/`demoBridge.ts`의 합성 데이터(개발용 데모 모드 전용, 증거 "데이터"로 취급), 백엔드·CLI 메시지, 영어 README, AI 응답 언어, 사건 시간대 기본값(Asia/Seoul 유지), 세 번째 언어.
9. 의존성 추가 없음(i18next 등 쓰지 않음). 로캘 두 개에는 타입 카탈로그로 충분하고, 키 누락은 컴파일 타임에 잡힌다.

## Global Constraints

- 프론트 명령은 모두 `frontend/`에서 실행한다. 각 태스크 완료 조건: `npm run typecheck` 통과 + `npx vitest run` 전체 통과.
- 작업 브랜치는 `feat/i18n-english` (main에서 분기, superpowers:using-git-worktrees). 저장소 루트의 추적되지 않는 `.claude/`, `.impeccable/`는 건드리지 않는다.
- **기존 한국어 테스트는 수정하지 않는다.** 예외는 시그니처가 바뀐 함수 호출에 `koKR`을 넘기는 수정뿐이다. 한국어 문구는 카탈로그로 **글자 그대로** 옮긴다. 기존 테스트가 실패하면 문구가 바뀐 것이다.
- Provider 없이 렌더링된 컴포넌트는 Context 기본값(`ko-KR`)을 쓴다. 그래서 기존 테스트는 그대로 한국어로 돈다.
- 모듈 전역 로캘 상태는 두지 않는다. 컴포넌트는 `const { m } = useI18n()`, 순수 함수는 `m: Messages` 인자를 받는다.
- 표시 문구를 만드는 `useMemo`/`useCallback`은 deps에 `m`을 넣는다.
- 메시지 값은 `string`이거나 `(...args: (string | number)[]) => string` 함수다. 함수는 인자를 보간·비교만 한다(메서드 호출 금지). 카탈로그 검사 테스트가 모든 인자에 숫자 `2`를 넣어 호출한다.
- 영어 카탈로그 값에는 한글이 없어야 한다(테스트로 강제).
- 키 이름은 camelCase, UI 영역별로 중첩한다(`m.shell.nav.settings`). 코드값 → 문구 표(`labels`, `errors`)는 원래 코드값을 키로 쓴다.
- 새 테스트 파일 중 DOM을 쓰는 파일은 첫 줄에 `// @vitest-environment jsdom` (기본 환경은 node).
- 영어 카피 규칙: 버튼·제목·탭은 sentence case("Add evidence"), 버튼에는 마침표를 찍지 않는다. 안내·오류는 완결된 문장에 마침표. "Please" 대신 간결한 명령형("Check the evidence path and permissions."). 제품·형식·코드명은 번역하지 않는다(APEX, E01, VHDX, OCR, STT, FFmpeg, IANA, UTC+9, MiB). 숫자 표기는 그대로 둔다(33,177,600).
- 용어집 (모든 태스크 공통, 이 표와 다르게 번역하지 않는다):

| 한국어 | English |
|---|---|
| 사건 / 사건 개요 / 현재 사건 / 새 사건 | Case / Case overview / Current case / New case |
| 증거 / 증거 관리 / 증거 이미지 / 증거 등록 | Evidence / Evidence / Evidence image / Add evidence |
| 분석자(사람) | Examiner |
| 파일 시스템 / 파일 목록 | File system / Files |
| 아티팩트 · 레지스트리 · 이벤트 로그 · 프리패치 | Artifacts · Registry · Event log · Prefetch |
| 탐색 · 분석 (탭 그룹) | Explore · Analyze |
| 통합 검색 / 타임라인 | Search / Timeline |
| 추출 후보 검토 / 자동 추출 후보 | Candidate review / Machine-extracted candidate |
| 채택 · 반려 · 정정 | Accept · Reject · Correct |
| 관찰 사실 / 분석가 주석 | Observed fact / Analyst annotation |
| (증거) 보관 이력 / 보관 이력 이벤트 | Chain of custody / Custody event |
| 해시 무결성 / 지문 | Hash integrity / Fingerprint |
| 보고서 · 초안 · 검토 중 · 검토 완료 · 승인 · 내보냄 | Report · Draft · In review · Reviewed · Approved · Exported |
| 검토 제출 | Submit for review |
| 삭제 후보 / 복구 후보 | Deleted candidate / Recovered candidate |
| 원본 (보기 모드 RAW) / 원본 파일 | Raw / Source file |
| 분석 엔진 / 분석기(OCR·STT) | Analysis engine / Analyzer |
| 설정 / 런타임 기능 / 시간대 | Settings / Runtime capabilities / Time zone |
| 인용 근거 / 제한 사항 | Citations / Limitations |
| 닫기 · 저장 · 다시 시도 | Close · Save · Try again |

## Review Focus

1. **긴 영어 문구가 최소 창 크기(1060×700)에서 넘침.** 탭, 툴바 버튼, 표 머리글, 배지, 대화상자 버튼이 겹치거나 잘려서 읽을 수 없으면 안 된다 → Task 9 시각 검증에서 화면별로 확인하고 CSS로 고친다.
2. **저장소 접근 실패나 오염된 값.** `localStorage`가 throw하거나 `"fr-FR"`, `""` 같은 값이 들어 있으면 OS 언어 감지로 넘어가고 앱은 정상 동작해야 한다 → Task 1 테스트.
3. **세션 중 언어 전환으로 상태 유실.** 선택한 사건과 현재 화면이 유지돼야 한다 → Task 4 테스트.
4. **백엔드 한국어 문구나 알 수 없는 코드가 영어 UI에 노출.** 알 수 없는 오류 코드는 영어 폴백 문장 + 코드로, AI 가림 안내와 내장 STT 모델명은 영어로 보여야 한다 → Task 1, Task 8 테스트.
5. **기존 ko-KR 사건의 보고서 언어.** UI가 영어여도 기존 사건 보고서는 한국어, 새 사건은 `en-US`로 만들어진다 → Task 4 테스트(생성 payload), README 명시(Task 9).

---

## File Structure

새로 만드는 파일:
- `src/i18n/locales.ts`: `Locale`, `LOCALES`, `LANGUAGE_NAMES`, `LOCALE_STORAGE_KEY`, `isLocale`, `resolveInitialLocale`, `htmlLang`. React 의존 없음(Electron main도 import).
- `src/i18n/catalog.ts`: `messagesFor`, `lookup`, `Messages` 재export. React 의존 없음.
- `src/i18n/I18nProvider.tsx`: Context, `I18nProvider`, `useI18n`.
- `src/i18n/testing.tsx`: `renderInEnglish`, `HANGUL`.
- `src/i18n/i18n.test.tsx`, `src/i18n/hardcoded-korean.test.ts`.
- `src/locales/ko-KR/index.ts`, `src/locales/en-US/index.ts`: 네임스페이스 모음.
- `src/locales/{ko-KR,en-US}/<ns>.ts`: 네임스페이스별 카탈로그(태스크마다 추가).
- `src/LanguageSettings.tsx`, `src/LanguageSettings.test.tsx`.
- `src/i18n/en-shell.test.tsx` (T4·T5), `en-report.test.tsx` (T6), `en-evidence.test.tsx` (T7), `en-tools.test.tsx` (T8).

이동: `src/locales/ko-KR.ts` → `src/locales/ko-KR/errors.ts` (Task 1).

네임스페이스와 담당 태스크: `common`, `errors` (T1) · `settings`, `native` (T2) · `labels`, `ui` (T3) · `shell` (T4) · `views` (T5) · `panels`, `report` (T6) · `evidence`, `workbench` (T7) · `tools`, `machine`, `ai` (T8).

## 마이그레이션 레시피 (T3–T8 공통)

대상 파일마다 순서대로:
1. 한글 문구를 `src/locales/ko-KR/<ns>.ts`의 `export const <ns> = { … }`로 글자 그대로 옮기고 `ko-KR/index.ts`에 등록한다.
2. `src/locales/en-US/<ns>.ts`에 `export const <ns>: Messages["<ns>"] = { … }`를 쓰고(용어집·카피 규칙) `en-US/index.ts`에 등록한다.
3. 소스의 리터럴을 `m.<ns>.…`로 바꾼다. `aria-label`, `title`, `placeholder`, 템플릿 문자열도 포함.
4. `hardcoded-korean.test.ts`의 `KOREAN_ALLOWED`에서 해당 파일을 지운다.
5. 태스크에 적힌 영어 테스트를 추가한다.

모듈 최상위 상수에 들어 있던 문구(예: `routeNames`, `candidateDecisions`, `actionCopy`)는 id·구조만 소스에 남기고 문구는 렌더 시점에 `m`에서 찾는다.

---

### Task 1: i18n 기반 + 오류 카탈로그

**Files:**
- Create: `src/i18n/locales.ts`, `src/i18n/catalog.ts`, `src/i18n/I18nProvider.tsx`, `src/i18n/testing.tsx`, `src/i18n/i18n.test.tsx`, `src/i18n/hardcoded-korean.test.ts`, `src/locales/ko-KR/index.ts`, `src/locales/ko-KR/common.ts`, `src/locales/en-US/index.ts`, `src/locales/en-US/common.ts`, `src/locales/en-US/errors.ts`
- Move: `src/locales/ko-KR.ts` → `src/locales/ko-KR/errors.ts` (`errorMessages` → `export const errors`. `resourceMessages`는 지우고 gateway로 옮긴다)
- Modify: `src/gateway.ts` (`errorText`, 리소스 키 매핑), `src/ui.tsx:278-292` (`ErrorState`), `src/main.tsx`, `src/test-setup.ts`, `src/design-contract.test.tsx:233-245` (`errorText` 호출에 `koKR` 전달)

**Interfaces:**
- Produces:
```ts
// src/i18n/locales.ts
export type Locale = "ko-KR" | "en-US";
export const LOCALES: readonly Locale[];                 // ["ko-KR", "en-US"]
export const LANGUAGE_NAMES: Record<Locale, string>;     // { "ko-KR": "한국어", "en-US": "English" }
export const LOCALE_STORAGE_KEY = "apex.locale";
export function isLocale(value: unknown): value is Locale;
export function resolveInitialLocale(stored: string | null, languages: readonly string[]): Locale;
export function htmlLang(locale: Locale): "ko" | "en";
// src/locales/ko-KR/index.ts
export const koKR: { common: …; errors: … /* 태스크마다 네임스페이스 추가 */ };
export type Messages = typeof koKR;
// src/locales/en-US/index.ts
export const enUS: Messages;
// src/i18n/catalog.ts
export type { Messages };
export function messagesFor(locale: unknown): Messages;  // "en-US" → enUS, 그 외 전부 → koKR
export function lookup(table: object, key: string): string; // 없는 키는 key를 그대로 반환
// src/i18n/I18nProvider.tsx
export interface I18nValue { locale: Locale; m: Messages; setLocale(next: Locale): void }
export function I18nProvider(props: { children: ReactNode; initialLocale?: Locale }): JSX.Element;
export function useI18n(): I18nValue; // Provider 밖: { locale: "ko-KR", m: koKR, setLocale: 아무것도 안 함 }
// src/i18n/testing.tsx
export const HANGUL: RegExp; // /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-힯ힰ-퟿]/ (이스케이프로 작성, 한글 리터럴 없이)
export function renderInEnglish(ui: ReactElement): RenderResult; // <I18nProvider initialLocale="en-US">로 감싸 render
// src/gateway.ts
export function errorText(error: unknown, m: Messages): string;
```
- `m.common.operationFailed: (code: string) => string`. ko는 기존 gateway.ts 문구 그대로(`작업을 완료하지 못했습니다. 오류 코드: ${code}`), en은 `The operation could not be completed. Error code: ${code}`.
- `m.errors.DESKTOP_REQUIRED` en = `"Analysis runs in the Windows or macOS desktop app."` (테스트 고정값). 나머지 오류 문구는 레시피대로 번역한다.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/i18n/i18n.test.tsx` (jsdom). `Probe`는 `useI18n()`의 `locale`을 텍스트로 보여주고, 버튼 두 개로 `setLocale("en-US")`/`setLocale("ko-KR")`를 호출하는 테스트 전용 컴포넌트다.

```tsx
describe("resolveInitialLocale", () => {
  it("prefers a valid stored locale", () =>
    expect(resolveInitialLocale("en-US", ["ko-KR"])).toBe("en-US"));
  it("ignores invalid stored values", () => {
    expect(resolveInitialLocale("fr-FR", ["ko-KR"])).toBe("ko-KR");
    expect(resolveInitialLocale("", ["en-GB"])).toBe("en-US");
  });
  it("takes the first Korean or English system language", () => {
    expect(resolveInitialLocale(null, ["ja-JP", "ko"])).toBe("ko-KR");
    expect(resolveInitialLocale(null, ["en-GB", "ko-KR"])).toBe("en-US");
  });
  it("falls back to English", () => {
    expect(resolveInitialLocale(null, ["de-DE"])).toBe("en-US");
    expect(resolveInitialLocale(null, [])).toBe("en-US");
  });
});
describe("I18nProvider", () => {
  it("defaults to Korean without a provider", () => {
    render(<Probe />);
    expect(screen.getByTestId("locale").textContent).toBe("ko-KR");
  });
  it("persists the choice and syncs <html lang>", () => {
    render(<I18nProvider initialLocale="ko-KR"><Probe /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "en" }));
    expect(screen.getByTestId("locale").textContent).toBe("en-US");
    expect(localStorage.getItem("apex.locale")).toBe("en-US");
    expect(document.documentElement.lang).toBe("en");
  });
  it("restores the stored choice on the next launch", () => {
    localStorage.setItem("apex.locale", "en-US");
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByTestId("locale").textContent).toBe("en-US");
  });
  it("keeps working when storage throws", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    render(<I18nProvider><Probe /></I18nProvider>);           // jsdom navigator.languages = en-US
    expect(screen.getByTestId("locale").textContent).toBe("en-US");
    fireEvent.click(screen.getByRole("button", { name: "ko" }));
    expect(screen.getByTestId("locale").textContent).toBe("ko-KR");
    get.mockRestore(); set.mockRestore();
  });
});
describe("catalogs", () => {
  it("English has exactly the Korean keys", () => expect(shape(enUS)).toEqual(shape(koKR)));
  it("English contains no Hangul", () => expect(hangulLeaves(enUS)).toEqual([]));
});
describe("errorText", () => {
  it("translates known codes and message keys", () => {
    expect(errorText(new GatewayError("DESKTOP_REQUIRED"), enUS))
      .toBe("Analysis runs in the Windows or macOS desktop app.");
    expect(errorText(new GatewayError("X", "error.validation"), enUS)).toBe(enUS.errors.VALIDATION_ERROR);
  });
  it("falls back to a sentence with the code", () => {
    expect(errorText(new GatewayError("NEW_ENGINE_CODE"), enUS))
      .toBe("The operation could not be completed. Error code: NEW_ENGINE_CODE");
    expect(errorText(new Error("boom"), enUS)).toContain("DESKTOP_OPERATION_FAILED");
  });
});
```
`shape(obj)`는 객체를 재귀로 돌며 리프를 `typeof` 결과로 바꾼다. `hangulLeaves(obj)`는 문자열 리프와 함수 리프(인자마다 `2`를 넣어 호출한 결과) 가운데 `HANGUL`에 걸리는 것의 경로 목록을 돌려준다. 둘 다 테스트 파일 안의 헬퍼다.

`src/i18n/hardcoded-korean.test.ts` (node 환경): `frontend/src`, `frontend/electron` 아래 `.ts/.tsx`를 재귀로 읽는다. `*.test.*`, `src/locales/ko-KR/**`, `src/__fixtures__/**`, `src/contracts/generated/**`는 제외한다. 경로는 `frontend/` 기준 POSIX 형식.

```ts
const KOREAN_ALLOWED = new Set([
  // Synthetic data for the dev-only demo mode, not UI copy.
  "src/demoData.ts",
  "src/demoBridge.ts",
  // Language names are always shown in their own language.
  "src/i18n/locales.ts",
  // Pending migration: each task removes its files.
  "src/App.tsx", "src/ui.tsx", "src/panels.tsx", "src/reportWorkflow.ts", "src/ReportTools.tsx",
  "src/MachineSettings.tsx", "src/ForensicTools.tsx", "src/ImageInspector.tsx", "src/VideoInspector.tsx",
  "src/AiAssistant.tsx", "src/EvidenceIntake.tsx", "src/workbench/EvidenceTree.tsx",
  "src/workbench/FileViewer.tsx", "src/workbench/Properties.tsx", "electron/main.ts",
]);
it("keeps Korean UI copy inside src/locales/ko-KR", () =>
  expect(sourceFiles().filter((f) => !KOREAN_ALLOWED.has(f) && HANGUL.test(read(f)))).toEqual([]));
it("does not allow-list files that no longer contain Korean", () =>
  expect([...KOREAN_ALLOWED].filter((f) => !HANGUL.test(read(f)))).toEqual([]));
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/i18n` / Expected: FAIL (모듈 `./locales` 등을 찾을 수 없음)

- [ ] **Step 3: 구현.**
  - `I18nProvider`: 초기 상태를 lazy로 `initialLocale ?? resolveInitialLocale(safeGet(), navigator.languages ?? [navigator.language])`. `setLocale`은 `safeSet` 후 state 갱신(저장 실패는 무시). `useEffect`로 `document.documentElement.lang = htmlLang(locale)`. Context value는 `locale` 기준 `useMemo`. `safeGet`/`safeSet`은 try/catch로 감싼 localStorage 접근이다.
  - `gateway.ts`: `const RESOURCE_KEY_CODES: Record<string, keyof Messages["errors"]>` (기존 `resourceMessages` 8개 매핑을 코드명으로 옮김). `errorText`는 messageKey → 코드 → `m.errors`, 없으면 `m.common.operationFailed(code)`.
  - `ErrorState`: `const { m } = useI18n()` 후 `errorText(error, m)`.
  - `main.tsx`: `<React.StrictMode><I18nProvider><App /></I18nProvider></React.StrictMode>`.
  - `test-setup.ts`: `afterEach`에서 `localStorage.clear()`를 try/catch로, `document`가 있으면 `document.documentElement.lang = "ko"`. node 환경 테스트를 위해 `typeof` 가드.

- [ ] **Step 4: 통과 확인** — Run: `npm run typecheck && npx vitest run` / Expected: 전부 PASS

- [ ] **Step 5: Commit**
```bash
git add frontend/src/i18n frontend/src/locales frontend/src/gateway.ts frontend/src/ui.tsx frontend/src/main.tsx frontend/src/test-setup.ts frontend/src/design-contract.test.tsx
git commit -m "feat(desktop): add typed ko-KR/en-US message catalogs and locale provider"
```

---

### Task 2: 언어 선택 카드 + 네이티브 파일 대화상자

**Files:**
- Create: `src/LanguageSettings.tsx`, `src/LanguageSettings.test.tsx`, `src/locales/{ko-KR,en-US}/settings.ts`, `src/locales/{ko-KR,en-US}/native.ts`
- Modify: `src/App.tsx` (설정 라우트 `<div className="settings scroll">` 첫 자식으로 `<LanguageSettings />`. `:840`의 `window.apex.pick(kind)` → `pick(kind, locale)`), `src/MachineSettings.tsx:39` (`pick(kind, locale)`), `src/gateway.ts` (`DesktopBridge.pick` 시그니처), `electron/preload.ts`, `electron/main.ts:264-290`, `src/demoBridge.ts` (`pick` 시그니처만), `src/i18n/hardcoded-korean.test.ts` (`electron/main.ts` 제거)

**Interfaces:**
- Consumes: `useI18n`, `LOCALES`, `LANGUAGE_NAMES`, `messagesFor` (Task 1)
- Produces:
  - `export function LanguageSettings(): JSX.Element`: `<div className="card">`, `<h3 id=…>{m.settings.language.title}</h3>`, 설명 `<p className="muted">`, `aria-labelledby`로 제목과 연결된 `<select>`. 옵션 value는 `LOCALES`, 텍스트는 `LANGUAGE_NAMES`.
  - `DesktopBridge.pick(kind: "file" | "directory", locale?: Locale)`
  - `m.settings.language = { title, description }`. ko: `"언어"`, `"화면에 표시할 언어를 선택합니다. 새로 만드는 사건의 보고서 언어에도 적용됩니다."` / en: `"Language"`, `"Choose the display language. New cases also use it for report labels."`
  - `m.native = { pickTitle, evidenceImages, allFiles }`. ko는 main.ts 기존 문구 그대로(`"분석할 증거 선택"`, `"증거 이미지"`, `"모든 파일"`) / en: `"Select evidence to analyze"`, `"Evidence images"`, `"All files"`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/LanguageSettings.test.tsx` (jsdom)
```tsx
it("switches the display language and remembers it", async () => {
  render(<I18nProvider initialLocale="ko-KR"><LanguageSettings /></I18nProvider>);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "언어" }), "en-US");
  expect(screen.getByRole("heading", { name: "Language" })).toBeTruthy();
  expect(document.documentElement.lang).toBe("en");
  expect(localStorage.getItem("apex.locale")).toBe("en-US");
});
it("names each language in its own language", () => {
  renderInEnglish(<LanguageSettings />);
  expect(screen.getAllByRole("option").map((o) => [o.getAttribute("value"), o.textContent]))
    .toEqual([["ko-KR", "한국어"], ["en-US", "English"]]);
});
it("localizes native picker text and falls back to Korean", () => {
  expect(messagesFor("en-US").native.pickTitle).toBe("Select evidence to analyze");
  expect(messagesFor("bogus").native.pickTitle).toBe("분석할 증거 선택");
});
```
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/LanguageSettings.test.tsx` / Expected: FAIL (모듈 없음)
- [ ] **Step 3: 구현.** main: `handle("apex:pick", async (kind: unknown, locale: unknown) => { const text = messagesFor(locale).native; … })`. `messagesFor`는 `../src/i18n/catalog`에서 import(esbuild가 번들링). preload: `pick: (kind, locale) => ipcRenderer.invoke("apex:pick", kind, locale)`. App·MachineSettings는 `const { locale } = useI18n()`로 넘긴다.
- [ ] **Step 4: 통과 확인** — Run: `npm run typecheck && npx vitest run && node scripts/electron.mjs` / Expected: 테스트 PASS, `dist-electron/main.cjs` 빌드 성공
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): add language setting and localize native file picker"`

---

### Task 3: 공용 UI 키트 (`ui.tsx`)

**Files:**
- Create: `src/locales/{ko-KR,en-US}/labels.ts` (기존 `labels` 표 전체), `src/locales/{ko-KR,en-US}/ui.ts` (컴포넌트·헬퍼 문구, `Fields` 필드명 표, `custodyOverrides` 포함)
- Modify: `src/ui.tsx`. 시그니처가 바뀐 헬퍼와 `labels[...]` 호출부 전부: `src/App.tsx:243,1617,2112`, `src/panels.tsx:156,712`, `src/EvidenceIntake.tsx:89`, `src/workbench/Properties.tsx:30,47,50`. 헬퍼 호출부는 `grep -n "displayValue(\|custodyEvent(\|evidenceFormat(\|timeWithZone(\|time(" src`로 찾는다.
- Test: `src/i18n/en-shell.test.tsx` (새 파일, 이 태스크에서 만듦)

**Interfaces:**
- Consumes: `useI18n`, `lookup`, `Messages`
- Produces (Task 4–8이 사용):
  - `ui.tsx`에서 `labels` export 삭제 → 어디서든 `lookup(m.labels, code)`
  - `displayValue(value: unknown, zone: string, m: Messages): string` (`"예"/"아니요"` → `m.ui.yes`/`m.ui.no` = `"Yes"`/`"No"`)
  - `custodyEvent(type: unknown, m: Messages): string`
  - `evidenceFormat(format: unknown, m: Messages): string` (`"폴더"` → `"Folder"`)
  - `time(value: unknown, zone: string, m: Messages): string`, `timeWithZone(value: unknown, zone: string, m: Messages): string` (`" · 시간대 미확정"` → `" · time zone unknown"`)
  - `Table` 정렬: `localeCompare(…, locale)` (`"ko"` 하드코딩 대체)
  - 고정 en 값: `Empty` 기본 제목 `"No results"`, 기본 본문 `"Nothing was found in the selected scope."`, `ErrorState` 버튼 `"Try again"`, `Loading` `"Waiting for the analysis engine"`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/i18n/en-shell.test.tsx` (jsdom)
```tsx
it("renders shared states in English", () => {
  renderInEnglish(<><Empty /><Loading /><ErrorState error={new GatewayError("DESKTOP_REQUIRED")} retry={() => {}} /></>);
  expect(screen.getByText("No results")).toBeTruthy();
  expect(screen.getByText("Nothing was found in the selected scope.")).toBeTruthy();
  expect(screen.getByText("Waiting for the analysis engine")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
});
it("translates enum labels and helper text", () => {
  renderInEnglish(<Badge value="CHANGES_REQUESTED" />);
  expect(screen.getByText("Changes requested")).toBeTruthy();
  expect(displayValue(true, "UTC", enUS)).toBe("Yes");
  expect(evidenceFormat("DIRECTORY", enUS)).toBe("Folder");
  expect(time("2026-01-01T00:00:00", "UTC", enUS)).toContain("time zone unknown");
});
```
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/i18n/en-shell.test.tsx` / Expected: FAIL
- [ ] **Step 3: 레시피대로 `ui.tsx` 마이그레이션, 위 시그니처 적용, 모든 호출부 갱신.** 호출부가 아직 한국어 하드코딩 파일(App 등)이어도 `const { m } = useI18n()`를 추가해 넘긴다. `KOREAN_ALLOWED`에서 `src/ui.tsx` 제거.
- [ ] **Step 4: 통과 확인** — Run: `npm run typecheck && npx vitest run` / Expected: 전부 PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): localize shared UI kit and enum labels"`

---

### Task 4: 앱 셸 (`App.tsx` 1–1395행: 상수, 핸들러, 열 정의, 상단 바, 탭, 헤더)

**Files:**
- Create: `src/locales/{ko-KR,en-US}/shell.ts`
- Modify: `src/App.tsx:1-1395` (`routeNames`, `routeGroups` 레이블, `communicationTypes`, `candidateDecisions`, `CandidateSubject`, 핸들러 안 문구, `newCase` 대화상자, `fileColumns`/`artifactColumns` 등 열 레이블, 상단 바, 탭 nav, 헤더). `newCase`의 `locale: "ko-KR"` → `locale` (`useI18n`)
- Test: `src/i18n/en-shell.test.tsx` (추가)

**Interfaces:**
- Consumes: Task 1–3 전부
- Produces: `m.shell.routes: Record<Route | "COMMUNICATION", string>`, `m.shell.groups: { case; explore; analyze; report }`. 고정 en 값: 그룹 `"Case"`, `"Explore"`, `"Analyze"`, `"Report"` / 설정 탭 `"Settings"` / 상단 select 레이블 `"Current case"` / 버튼 `"New case"` / 대화상자 제목 `"Create a new case"`, 제출 `"Create case"`, 필드 `"Case name"`, `"Examiner name"`, `"Case description"`, `"Time zone (IANA)"`. `routeGroups`는 `{ id, tabs }`만 남기고 레이블은 `m.shell.groups[id]`.

- [ ] **Step 1: 실패하는 테스트 추가** — 브리지·픽스처 준비는 `src/layout.test.tsx`와 같게(`createDemoBridge`, `core.json`, `afterEach`에서 `cleanup`과 `delete window.apex`)
```tsx
it("switches the shell to English without losing the open case", async () => {
  window.apex = createDemoBridge();
  render(<I18nProvider initialLocale="ko-KR"><App /></I18nProvider>);
  await screen.findByRole("option", { name: core.cases[0].name });
  fireEvent.change(screen.getByLabelText("현재 사건"), { target: { value: core.cases[0].id } });
  fireEvent.click(await screen.findByRole("button", { name: "설정" }));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "언어" }), "en-US");
  expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Settings" }).getAttribute("aria-current")).toBe("page");
  expect((screen.getByLabelText("Current case") as HTMLSelectElement).value).toBe(core.cases[0].id);
  for (const name of ["Case", "Explore", "Analyze", "Report"])
    expect(screen.getByRole("button", { name })).toBeTruthy();
});
it("creates new cases in the display language", async () => {
  const bridge = createDemoBridge();
  const invoke = vi.spyOn(bridge, "invoke");
  window.apex = bridge;
  renderInEnglish(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "New case" }));
  fireEvent.change(screen.getByLabelText(/Case name/), { target: { value: "Laptop seizure" } });
  fireEvent.click(screen.getByRole("button", { name: "Create case" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("cases.create", expect.objectContaining({ locale: "en-US" })));
});
```
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/i18n/en-shell.test.tsx` / Expected: FAIL ("Settings" heading 없음)
- [ ] **Step 3: 레시피대로 1–1395행 마이그레이션.** `src/App.tsx`는 Task 5까지 허용 목록에 남는다.
- [ ] **Step 4: 통과 확인** — Run: `npm run typecheck && npx vitest run` / Expected: 전부 PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): localize workbench shell and create cases in the UI locale"`

---

### Task 5: 화면 본문 (`App.tsx` 1396행–끝)

**Files:**
- Create: `src/locales/{ko-KR,en-US}/views.ts`
- Modify: `src/App.tsx:1396-end` (사건 개요, 설정 화면 런타임 카드, 증거·검색·파일·아티팩트·타임라인·후보·보관 이력 화면, 상태 표시줄), `src/i18n/hardcoded-korean.test.ts` (`src/App.tsx` 제거)
- Test: `src/i18n/en-shell.test.tsx` (추가)

**Interfaces:**
- Produces: 고정 en 값: `"Demo · Synthetic data"` (2424행), `m.views.shownCount: (n: number) => string` = `` `${n} shown` `` (1920행 `{n}개 표시`), 설정 카드 제목 `"Runtime capabilities"`, 사건 없음 `"No saved cases"`

- [ ] **Step 1: 실패하는 테스트 추가**
```tsx
it("renders route views in English", async () => {
  window.apex = createDemoBridge();
  renderInEnglish(<App />);
  await screen.findByText("Demo · Synthetic data");
  fireEvent.change(screen.getByLabelText("Current case"), { target: { value: core.cases[0].id } });
  fireEvent.click(await screen.findByRole("button", { name: "Case" }));
  fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
  expect(await screen.findByText(/^\d+ shown$/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByRole("heading", { name: "Runtime capabilities" })).toBeTruthy();
});
```
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/i18n/en-shell.test.tsx` / Expected: FAIL
- [ ] **Step 3: 레시피대로 1396행–끝 마이그레이션.**
- [ ] **Step 4: 통과 확인** — Run: `npm run typecheck && npx vitest run` / Expected: 전부 PASS (가드 테스트 포함, App.tsx 한글 0)
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): localize workbench route views"`

---

### Task 6: 패널·보고서 (`panels.tsx`, `reportWorkflow.ts`, `ReportTools.tsx`)

**Files:**
- Create: `src/locales/{ko-KR,en-US}/panels.ts` (FormDialog, AccountPanel, GovernanceAudit, PolicyPanel), `src/locales/{ko-KR,en-US}/report.ts` (reportWorkflow, Reports, ReportTools), `src/i18n/en-report.test.tsx`
- Modify: `src/panels.tsx`, `src/reportWorkflow.ts`, `src/ReportTools.tsx`, `src/reportWorkflow.test.tsx` (`reviewFlow` 호출에 `m: koKR` 추가만), 가드 허용 목록 3개 제거

**Interfaces:**
- Produces:
  - `reportWorkflow.ts`: `REVIEW_STEPS` 삭제 → `export const REVIEW_STEP_COUNT = 5`. 레이블은 `m.report.reviewSteps: [string, string, string, string, string]` (ko 리터럴에 튜플 타입을 명시해 `typeof`가 `string[]`로 넓어지지 않게).
  - `actionCopy` 삭제 → `export interface ActionCopy { label: string; title: string; submit: string; description: string; field?: string }`. `m.report.actions: Record<ReviewAction | "export", ActionCopy>` (ko에서 이 타입을 명시).
  - `reviewFlow({ version, decision, exported, m }: { version: Row; decision: string | null | undefined; exported?: boolean; m: Messages }): ReviewFlow`. 반환하는 `hint`/`blocked`/`stepLabel`은 `m.report`에서.
  - 고정 en 값: 단계 `["Draft", "In review", "Reviewed", "Approved", "Exported"]`, `actions.submit.label` `"Submit for review"`, FormDialog `"Save"`/`"Close"`/`"Working…"`, ReportTools `"Compare versions"`, `"Both versions are identical."`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/i18n/en-report.test.tsx`. Reports 렌더 준비는 `src/ReportTools.test.tsx`의 픽스처(`report.json`)와 같게.
```tsx
it("labels the review workflow in English", async () => {
  renderReportsInEnglish();   // ReportTools.test.tsx와 같은 준비를 renderInEnglish로 감싼 로컬 헬퍼
  for (const step of ["Draft", "In review", "Reviewed", "Approved", "Exported"])
    expect(await screen.findByText(step)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Submit for review" })).toBeTruthy();
});
it("derives English hints from reviewFlow", () => {
  const flow = reviewFlow({ version: draftVersion, decision: null, m: enUS });
  expect(flow.hint).not.toMatch(HANGUL);
  expect(enUS.report.actions[flow.primary].label).toBe("Submit for review");
});
```
(`draftVersion`은 `src/reportWorkflow.test.tsx`의 초안 버전 픽스처와 같은 형태)
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/i18n/en-report.test.tsx` / Expected: FAIL
- [ ] **Step 3: 레시피대로 마이그레이션, 위 시그니처 적용.**
- [ ] **Step 4: 통과 확인** — Run: `npm run typecheck && npx vitest run` / Expected: 전부 PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): localize panels and report review workflow"`

---

### Task 7: 증거 등록·워크벤치 (`EvidenceIntake.tsx`, `workbench/EvidenceTree.tsx`, `workbench/FileViewer.tsx`, `workbench/Properties.tsx`)

**Files:**
- Create: `src/locales/{ko-KR,en-US}/evidence.ts` (EvidenceIntake), `src/locales/{ko-KR,en-US}/workbench.ts` (나머지 3개), `src/i18n/en-evidence.test.tsx`
- Modify: 위 4개 파일, 가드 허용 목록 4개 제거

**Interfaces:**
- Produces: 고정 en 값: FileViewer 영역 레이블 `"File content viewer"`, 제목 `"Content viewer"`, `"No file selected"`, `"Read-only"` / Properties 빈 상태 `"Select evidence or a file to see its properties."` / EvidenceTree `"No items"`, `"Collapse"`, `"Expand"` / EvidenceIntake 기능 레이블 `"Read E01 images"`, `"Read folders"`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/i18n/en-evidence.test.tsx`. 렌더 준비는 `src/workbench/FileViewer.test.tsx`, `src/intake.test.tsx`와 같게.
```tsx
it("renders the file viewer chrome in English", () => {
  renderInEnglish(<FileViewer {...emptyViewerProps} />);   // FileViewer.test.tsx의 '선택 없음' 케이스와 같은 props
  expect(screen.getByRole("region", { name: "File content viewer" })).toBeTruthy();
  expect(screen.getByText("No file selected")).toBeTruthy();
});
it("renders empty properties in English", () => {
  renderInEnglish(<Properties row={null} zone="UTC" />);
  expect(screen.getByText("Select evidence or a file to see its properties.")).toBeTruthy();
});
it("lists intake capabilities in English", async () => {
  // intake.test.tsx와 같은 준비로 증거 등록 화면을 연다
  expect(await screen.findByText(/Read E01 images/)).toBeTruthy();
});
```
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/i18n/en-evidence.test.tsx` / Expected: FAIL
- [ ] **Step 3: 레시피대로 마이그레이션.**
- [ ] **Step 4: 통과 확인** — Run: `npm run typecheck && npx vitest run` / Expected: 전부 PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): localize evidence intake and workbench panes"`

---

### Task 8: 분석 도구 (`ForensicTools.tsx`, `ImageInspector.tsx`, `VideoInspector.tsx`, `AiAssistant.tsx`, `MachineSettings.tsx`)

**Files:**
- Create: `src/locales/{ko-KR,en-US}/tools.ts` (ForensicTools, ImageInspector, VideoInspector), `machine.ts`, `ai.ts`, `src/i18n/en-tools.test.tsx`
- Modify: 위 5개 파일, 가드 허용 목록 5개 제거

**Interfaces:**
- Produces:
  - `AiAssistant`: `result.preview.notice`가 있으면 그 텍스트 대신 `m.ai.redactionNotice`를 보여준다. ko는 `ai_content.py:100` 문구 그대로, en `"Automatic redaction cannot find every secret. Review the excerpt before sending."`
  - `MachineSettings`: `data.bundled_stt.available`이면 `data.bundled_stt.name` 대신 `m.machine.bundledModelName`. ko는 `machine.py:207` 문구 그대로, en `"Whisper base · Multilingual (incl. Korean and English)"`
  - STT 언어 옵션 `"한국어 음성"`은 UI 레이블만 번역(`"Korean speech"`). option value `ko`는 그대로.
  - 고정 en 값: `"More analysis"`, `"Recover deleted files"`, `"Image view · Bit analysis"`, `"Video frame viewer"`, `"Structure summary"`, `"Use the bundled multilingual model"`, 공통 `"Close"`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/i18n/en-tools.test.tsx`. 렌더 준비는 각각 `ForensicTools.test.tsx`, `ImageInspector.test.tsx`, `VideoInspector.test.tsx`, `MachineSettings.test.tsx`와 같게. AiAssistant는 `notice`가 한국어인 preview 응답을 돌려주는 가짜 bridge로 렌더.
```tsx
it("shows the AI redaction notice in English even though the engine sends Korean", async () => {
  // preview 응답: { …, requires_review: true, notice: "자동 가림은 모든 비밀정보를 찾아내지 못합니다. 전송할 발췌문을 확인하세요." }
  expect(await screen.findByText("Automatic redaction cannot find every secret. Review the excerpt before sending.")).toBeTruthy();
  expect(screen.queryByText(/자동 가림/)).toBeNull();
});
it("names the bundled STT model in English", async () => {
  // MachineSettings.test.tsx 응답에서 bundled_stt: { available: true, name: "Whisper base · 다국어" }
  expect(await screen.findByText("Whisper base · Multilingual (incl. Korean and English)")).toBeTruthy();
  expect(screen.getByText("Use the bundled multilingual model")).toBeTruthy();
});
it("labels the analysis tools in English", async () => {
  // ForensicTools / ImageInspector / VideoInspector를 각각 renderInEnglish
  expect(await screen.findByText("More analysis")).toBeTruthy();
  expect(screen.getByText("Image view · Bit analysis")).toBeTruthy();
  expect(screen.getByText("Video frame viewer")).toBeTruthy();
});
```
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/i18n/en-tools.test.tsx` / Expected: FAIL
- [ ] **Step 3: 레시피대로 마이그레이션.** 이 태스크가 끝나면 `KOREAN_ALLOWED`에는 `src/demoData.ts`, `src/demoBridge.ts`, `src/i18n/locales.ts`만 남는다.
- [ ] **Step 4: 통과 확인** — Run: `npm run typecheck && npx vitest run` / Expected: 전부 PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): localize analysis tools, AI assistant and analyzer settings"`

---

### Task 9: 시각 검증 + 문서

**Files:**
- Modify (필요한 만큼): `src/styles.css`, `src/workbench/workbench.css` (넘침 수정), `README.md`

- [ ] **Step 1: 데모 웹 실행** — `preview_start {name: "apex-demo-web"}` (`.claude/launch.json`). 브라우저에서 `localStorage.setItem("apex.locale","en-US")` 후 새로고침, 뷰포트 1060×700.
- [ ] **Step 2: 영어 화면 스크린샷** — 사건 개요, 증거, 파일 시스템(뷰어·속성 열림), 타임라인, 추출 후보 검토, 보고서(검토 단계 바), 설정, 새 사건 대화상자, 추가 분석 대화상자. 화면마다 탭·버튼·표 머리글·배지·대화상자 버튼이 겹치거나 잘려 읽을 수 없는 곳을 기록하고 사용자에게 캡처를 보낸다.
- [ ] **Step 3: 넘침 수정** — 고정 폭 요소에는 `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`을 주고, 잘리는 텍스트에는 같은 문구를 `title`로 넣는다. 수정한 화면을 다시 캡처해 확인하고, 한국어(`ko-KR`)로도 같은 화면을 한 번씩 캡처해 회귀가 없는지 본다.
- [ ] **Step 4: README 갱신** — 3행 소개와 46행 상태 표의 "한국어 UI"를 "한국어·영어 UI (설정 → 언어)"로 바꾼다. 69행 근처 "한국어 표기" 항목 옆에 한 줄 추가: "언어: 첫 실행 시 OS 언어(한국어 외에는 영어)로 시작하고 설정 → 언어에서 바꿀 수 있습니다. 보고서 레이블은 사건을 만들 때의 언어를 따릅니다."
- [ ] **Step 5: 최종 검증** — Run: `npm run typecheck && npm test && npm run build` / Expected: 모두 성공. 가드 테스트의 허용 목록이 3개(demoData, demoBridge, i18n/locales)인지 확인.
- [ ] **Step 6: Commit** — `git commit -m "docs: document English UI and fix English layout overflow"`
