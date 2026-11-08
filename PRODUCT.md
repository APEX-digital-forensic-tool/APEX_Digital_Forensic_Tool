# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Working digital-forensics analysts: investigators at law-enforcement agencies and corporate security or incident-response teams. They work long, careful sessions at desktop monitors, building a case they may later have to defend. Students and CTF players use the tool too, but they are a secondary audience and do not drive design decisions.

## Product Purpose

APEX lets an analyst create a local case, register evidence (disk images such as RAW/DD/IMG/E01/VHD/VHDX, or folders), run analysis, and then browse files and artifacts, search, build timelines, review machine-extracted candidates (OCR/STT), keep the chain of custody, and draft, review, approve and export reports. No login is required for local analysis. Success means an analyst reaches findings they can defend: every finding traces back to the original evidence, and nothing on screen overstates what the evidence shows.

## Positioning

- **Korean first.** The UI, Hangul file names and paths, Korean keyword search, report templates and explanations are all built for Korean-speaking analysts by default (ko-KR, Asia/Seoul, UTF-8).
- **Original protection and provenance.** Evidence is read-only. Chain-of-custody events are hash-chained and append-only. Report sections cite their sources, and approval captures a verified custody snapshot together with a content fingerprint.
- **Evidence-grounded AI assistance.** Data goes to an external AI only after the case's AI data policy allows it and the analyst has reviewed and consented to the exact excerpt. AI output is treated as a candidate, never as an observed fact.

## Operating Context

- An Electron, React and TypeScript desktop app for Windows x64 and macOS (arm64 and x64). It starts a local loopback FastAPI engine as a child process.
- An FTK Imager-style docked workbench. The left side holds the evidence tree and properties; the right side holds the file or artifact list and the content viewer (Preview, Text, Hex, metadata).
- The workflow runs: create a case, add evidence, run analysis, review files and artifacts, then review and export a report. Search and timeline need their analysis jobs to run first.
- A browser demo mode (`VITE_APEX_DEMO=1 npm run dev:web`) serves synthetic, read-only data for previews.
- The MCP server and the authentication backend run separately from the installed app.

## Capabilities and Constraints

- Evidence hash algorithms are SHA-256, SHA-1 and MD5 only. SHA-512 is not an evidence hash option.
- Hash verification states are NOT_CHECKED, MATCH and MISMATCH. A MISMATCH must read as a stronger integrity warning than a general warning. The UI must never claim tampering; it says the result does not match the earlier reference hash and that the cause needs checking.
- Evidence registration flows through the desktop picker reference, then the engine (format probe and capability check), then registration as an asynchronous task. The frontend must not decide an image's format from its extension alone.
- When a capability is unavailable (for example e01-libewf), the UI shows the reason and never presents it as an empty, successful result.
- Machine-extracted candidates are not observed facts. AI drafts and inferences stay labeled until an analyst reviews them.
- Secrets are never shown. Fingerprint and provenance hashes (for example pragma_key_hash) are labeled as "Fingerprint" (requirement FT-027).
- Report approval requires a completed review and a verified custody snapshot. Export requires an approved version whose content fingerprint matches.
- Open decisions, not yet supported: code signing and notarization, auto-update, differencing-VHD parent chains, encrypted volumes, and automatic reassembly of fragmented files.

## Brand Commitments

- The dark theme is binding (confirmed by the user, 2026-11-08).
- Standing visual preference: the category-standard dark workbench (in the Autopsy and X-Ways class), executed at full craft rather than as a distinctive themed world. This was chosen by the user over four themed directions on 2026-11-08.
- The FTK-style docked panel layout is binding: evidence tree and properties on the left, list and content viewer on the right.
- The supplied APEX logo file is the product mark and must not be redrawn or substituted.
- Voice: precise and non-conclusory. Copy separates observation from interpretation, and the UI never asserts what the evidence does not show (for example, "이 기록만으로 자료 반출 여부를 단정하지 않습니다.").

## Evidence on Hand

- Synthetic demo data: 3 cases, 5 evidence items, about 800 files, 130 artifacts, 130 timeline events, 20 candidates and 3 reports (`frontend/src/demoData.ts`, fixtures in `frontend/src/__fixtures__/`).
- Release v0.1.3 Preview (Windows x64 and macOS installers, SHA256SUMS, build provenance). The engine is unchanged since v0.1.2.
- There are no real case data, customers, benchmarks or performance comparisons. Do not fabricate them, and do not claim superiority over X-Ways or Autopsy.

## Product Principles

1. **Traceable before fast.** Every value on screen can be traced back to its source in the original evidence, and integrity state is always visible.
2. **Never overstate.** Candidates, partial results, unknown time zones and AI output are labeled as what they are.
3. **Korean, not translated.** Interface language is plain Korean. Engine codes and raw identifiers stay out of primary surfaces.
4. **High-stakes moments are explicit.** Registering evidence, recording a review decision, approving and exporting each name their action, show their consequence, and show what they act on.

## Accessibility & Inclusion

Keyboard-complete operation for long expert sessions, readable Hangul at the sizes the app ships, and meaning that never depends on color alone, so integrity and review states also carry text or an icon.
