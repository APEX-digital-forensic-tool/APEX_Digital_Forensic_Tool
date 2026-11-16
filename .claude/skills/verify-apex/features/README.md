# APEX verification map

This directory is the maintained source for verifying what an analyst can do in the APEX workbench. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- A run is up: `apex-verify up` printed `ready` and `apex-verify doctor` printed `doctor: OK`.
- `apex-verify corpus` has written the fixtures. Use the absolute paths it printed.
- The browser pane shows `http://127.0.0.1:5174/` at 1440x900.
- A case exists and is selected in `현재 사건`. Create one with `새 사건` → type a name in the first textbox → `사건 만들기`.

## Driving conventions

- Start each recipe from the baseline unless its preconditions say otherwise.
- Prefer accessible names and `aria-label` handles over coordinates.
- Queue file-dialog paths with `window.__apexVerify.pick(<path>)` right before the click that opens the dialog.
- Read stored results with `window.apex.invoke(<operation>, {...})` only to confirm a step, never to perform it.

## Proof and skip reporting

- Capture the action and the resulting state, not only the final screen.
- Confirm each stored result from a second view (engine read, `shasum`, the file viewer).
- Save artifacts under `artifacts/<feature file name>/` in the run directory and name the verified commit.
- A step that fails is a failure. Report it with the visible error and the open issue, and do not reroute through another path to call it verified.

## Feature entry contract

Each feature file has an H1 title, one paragraph on the user-visible behavior, then four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with the browser pane`, `Gotchas`.

## Features

- [Evidence intake](./evidence-intake.md) covers adding image and folder evidence, the reader warning, registration and the automatic hash.
- [File browsing](./file-browsing.md) covers indexing, opening folders, selecting a file and reading its bytes.
- [Analysis jobs](./analysis-jobs.md) covers starting analysis, the jobs drawer, cancelling and what a finished job does to the screen.
- [Chain of custody](./chain-of-custody.md) covers the custody ledger, adding an event and inspecting one.
