# APEX Design System

The category-standard dark forensic workbench, executed precisely. The user chose it on 2026-11-08 over four themed directions; see PRODUCT.md, "Brand Commitments". The layout is FTK Imager-style and docked: the evidence tree and properties sit on the left, the list and content viewer on the right.

## Color

All colors live as CSS custom properties on `:root` in `frontend/src/styles.css`. Component CSS uses tokens only. The only hex literals left are the token definitions and alpha shadows.

| Role | Tokens |
|---|---|
| Grounds, darkest to raised | `--surface-sunken` #18191c, `--bg` #1e1f22, `--surface` #232529, `--surface-2` #2b2d31, `--surface-3` #33363b, `--surface-4` #3d4046 |
| Lines | `--line-subtle` #2e3035, `--line` #3a3c41, `--line-strong` #4b4e55 |
| Text | `--text-faint` #80858e, `--text-muted` #9ca3af, `--text-soft` #c5c9d0, `--text` #e5e7eb, `--text-strong` #f5f6f8 |
| Accent | `--accent` #3b82f6 (primary buttons, focus rings, active tab underline), `--accent-hover`, `--accent-selected` (selected tree and table rows), `--accent-soft` (active list items), `--accent-text`, `--on-accent` |
| States | `--ok-*`, `--warn-*` and `--danger-*`, each with `-fg`, `-bg` and `-line` |
| Overlay | `--scrim` |

Rules:
- Blue marks only selection, focus and the primary action.
- State colors mark only state. Badges map engine values to green (complete, match, accepted), amber (partial, candidate, unavailable) and red (fail, mismatch, reject) in `Badge` (`frontend/src/ui.tsx`).
- Color never carries meaning alone. Every badge has a Korean label, and integrity shows the algorithm, the digest and a status word.
- Hash MISMATCH uses the danger notice with fixed wording ("무결성 검증 결과가 이전 기준 해시와 일치하지 않습니다. 원인 확인이 필요합니다."). It never says tampering.

## Type

- Faces: system stack (-apple-system, Segoe UI, Malgun Gothic) for the UI. A monospace stack (SFMono-Regular, Consolas) for hex views, hashes and digests.
- Six roles, all tokens on `:root`. Every `font-size` in the CSS uses one of them:

| Token | Size | Role |
|---|---|---|
| `--fs-meta` | 11px | captions, counts, status bar (the floor; nothing renders smaller) |
| `--fs-ui` | 12px | tables, tabs, tree, toolbar, labels, badges |
| `--fs-body` | 13px | dialogs, report text, empty-state messages (root size) |
| `--fs-title` | 15px | section titles inside a screen |
| `--fs-heading` | 19px | dialog and screen headings |
| `--fs-display` | 22px | report title |

- Report prose is capped at 75ch and uses `text-wrap: pretty`.
- English captions that only repeated Korean pane titles ("Properties", "File List") were removed.

## Components and patterns

- **Dialogs** (`FormDialog`): action-named titles and submit buttons ("증거 등록", "반려 기록", "승인"). An optional `context` block (`.decision-subject`) quotes what the decision acts on. Required selects open on "선택하세요" with no pre-chosen value.
- **Evidence intake** (`frontend/src/EvidenceIntake.tsx`): the picker leads to a confirmation sheet. It shows the name, kind and extension; says the engine decides the format; lists missing reader capabilities with their reason; and asks for a display name and a hash algorithm (SHA-256 by default, SHA-1, MD5, or none). After the register task succeeds, the chosen HASH analysis starts automatically.
- **Integrity cell** (`.integrity-cell`): algorithm, short digest (8…8, with the full digest in a tooltip) and a verification badge. It appears in the evidence table and in Properties.
- **Report review flow** (`ReviewFlowBar`): five-step stepper (초안 → 검토 중 → 검토 완료 → 승인 → 내보냄). It shows one primary next action and gives the reason when that action is blocked.
- **Metadata groups**: the viewer's metadata tab shows 기본 정보 / 추가 정보 / 기술 정보 / 시각. Each key/value appears once, under the first group that has it.
- **Jobs**: finished jobs say "끝남" or "일부 결과로 끝남" instead of a percentage. An amber "확인 N" badge next to 작업 counts failed or partial jobs.
- **Free-text with suggestions**: `FieldSpec.suggestions` renders a datalist (case time zone). Invalid IANA zones are rejected before `cases.create`.
- **Time**: tables put the case offset in the column header ("생성 시간 (UTC+9)"). Single values append it ("… (UTC+9)").
- **First-run setup window** (`frontend/src/setup/SetupApp.tsx`): a fixed 620×720 window shown before the main window on first launch. A 196px rail on `--surface-sunken` holds the logo, the window title and the five-step list; a step's mark is its number, filled with `--accent-fill` when current and a green check when done. The pane shows one step at a time: a `--fs-heading` title, a one-line lead, then the step's controls, with Back / Skip / primary pinned in the footer. Language is two full-width choice rows. On the AI step the primary button saves and continues; every other optional step has Skip and Next. The shared OCR and account panels are embedded with `compact` (no card frame, title or intro). Text uses `word-break: keep-all` so Hangul wraps between words. On macOS the window has no title bar and the rail is the drag region.
- **AI connection and new-case defaults** (`AiConnectionForm`, `ProfileSettings`): Settings cards in the same pattern as the account card. The API key is an uncontrolled password field that is cleared after saving and never rendered back.

## Accessibility

- Contrast: body and muted text are 5.4:1 or better on every surface. White text sits on `--accent-fill` (#2563eb, 5.2:1), never on `--accent` (3.7:1). `--text-faint` (#90959e) is 4.6:1 on panel headers.
- Heading order has no skipped levels: pane titles, empty states and the inspector title use h2 under the workspace h1.
- Required dialog fields get a visual "필수" / "Required" mark from CSS (`content: attr(data-required-label) / ""`, with the text coming from the message catalog). The control's `required` attribute carries the requirement to assistive tech, and the accessible name stays the bare label.
- Keys: Esc closes the AI and job drawers (dialogs handle their own Esc). Ctrl/⌘+F opens 통합 검색 and focuses the query. Icon-only buttons have `aria-label`.
- Advisory left open on purpose: in the dense workbench, pane titles sit near table size (12px) and are separated by weight, not size.
