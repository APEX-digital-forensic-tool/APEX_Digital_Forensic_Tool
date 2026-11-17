# followup/app-state — what main (c945faa) still lacked

Method: my combined branch's tests (`origin/fix/app-state`: `frontend/src/async-state.test.tsx`, `tests/unit/test_file_system_indexing.py`) were run against `origin/main`. Engine items were also checked on the real engine (apex-verify, isolated `APEX_VERIFY_HOME`, real React build driven in Chrome).

| # | Behavior | On main | Evidence |
|---|---|---|---|
| 48 | Folder intake offers no hash and starts no HASH job | fixed on main | `intake.test.tsx` "(#48)" (identical to ours) |
| 49 | Reopening a folder after its job ends CANCELLED / FAILED / INTERRUPTED starts a new job | fixed on main (frees the key on any ended job, via task id) | my `it.each` test passes on main |
| 49 | Reopening while the job runs does not start a second job | fixed on main | same test, running-case assertion passes on main |
| 49 | Engine: discovered subfolders stay partial until listed | **still broken on main** | `test_discovered_folder_stays_partial_until_it_is_listed` fails on main, passes on branch |
| 49 | Engine: opened folder stays partial after a cancelled job (it was flipped to complete at the end of its own listing) | **still broken on main** | `test_cancelled_folder_job_keeps_the_folder_partial_until_it_succeeds` fails on main; real engine: cancel then reopen starts a new FILES job on branch (`[PARTIAL, CANCELLED, RUNNING]` → `+QUEUED`) |
| 49 | Engine: a listing error on the folder keeps it partial | **still broken on main** | `test_folder_whose_listing_failed_stays_partial` fails on main |
| 49 | Engine: an unreadable (denied) opened folder keeps it partial | **still broken on main** | `test_unreadable_opened_folder_stays_partial` fails on main; real engine: `chmod 000` folder stays `is_partial=true` after its job |
| 49 | Engine: a job that drains the queue with skipped items (PARTIAL) clears the opened folder | fixed on main (clears at end of listing) and kept on branch | `test_folder_job_that_drains_with_skipped_items_clears_partial` passes on both; real engine: PARTIAL job → `is_partial=false` |
| 49 | Job start without `task_id` does not strand the key | **still broken on main** (key left set, folder never retried) | `followup-app-state.test.tsx` "allows a retry when a folder job start returns no task id" fails on main |
| 66 | Search runs only on submit; mode change / folder change do not re-run it | fixed on main (`pendingSearch`) | my "(#66) runs a search only when the analyst submits it" passes on main |
| 66 | History reloads after a search | fixed on main | my "(#66) reloads the search history" passes on main |
| 66 | Evidence/case change drops old results and next-page cursor | fixed on main (`searchScope`) | my "(#66) drops the results and the next-page cursor" passes on main |
| 66 | Next-page button disabled while loading; page cleared on artifact tab change | fixed on main (`disabled={loading}`, `setPage(null)`) | code at `App.tsx` (loadPage, pagination) |
| 66 | In-flight search is not discarded when `loadPage` is rebuilt | main differs (`pendingSearch` gate); dropped result is possible only if `loadPage` rebuilds mid-flight, which I could not trigger from the UI | not reproducible, no change |
| 66 | Blank / whitespace search is ignored | **still broken on main** (sends `search.query`) | `followup-app-state.test.tsx` "ignores a blank search submit" fails on main |
| 67 | "Indexing" shown only for the folder's own job | fixed on main | `folderIndexing` uses the folder's task id; real engine: no false indicator |
| 67 | Open folder is refetched when its job ends (PARTIAL badge clears) | main does it differently but correctly (refetch through the `view` op on `treeRevision`, also updates the trail) | real engine: `[PARTIAL, SUCCEEDED]`, partial badge gone after the job |
| 67 | Badge and overview use one attention rule incl. INTERRUPTED | fixed on main | my "(#67) counts an interrupted job" passes on main |
| 67 | Auto-selected evidence is synced to the GUI context | fixed on main | my "(#67) syncs an evidence item" passes on main |

My `async-state` reload/indexing tests (`reloads the open folder…`, `shows a folder as indexing only…`) fail on main only because their mocks model our parent-listing reload; main refetches via `view`, so they are not ported.

## Commits on followup/app-state
1. `test(index): a cancelled or failed folder job must leave the folder partial` (4 tests, fail on main)
2. `fix(index): keep a folder partial until its index job finishes without a listing error` (`file_system_index.py`)
3. `test(app): blank search submit and folder job without a task id` (2 tests, fail on main)
4. `fix(app): ignore a blank search and free the folder key without a task id` (`App.tsx`)

Checks: `pytest tests/unit` pass, `ruff check` pass, `npx vitest run` 270 pass, `npm run typecheck` pass.
