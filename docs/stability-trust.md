# Stability & performance trust checks

Focus areas: **cursor management**, **cache durability**, **data integrity**, **idle work**, **scale**.

## Guarantees (with automated tests)

| Guarantee | Module | Tests |
|-----------|--------|--------|
| Cite decorations rebuild only when caret enters/leaves a cite span | `src/cite-span.ts` | `tests/cite-span.test.ts` |
| Idle typing in non-bibtex notes skips rename detection (fence gate) | `text_may_contain_bibtex_block` | same |
| Vault rescan: first id + first DOI wins; pure rebuild | `src/cache-ops.ts` | `tests/cache-ops.test.ts` |
| Disk load tolerates corrupt/partial plugin data | `normalize_plugin_cache` | same |
| Dict audit catches key/id mismatch & duplicate DOIs | `audit_bibtex_dict` | same |
| Frequent saves coalesce (not one write per codeblock entry) | `src/save-coalesce.ts` | `tests/save-coalesce.test.ts` |
| Popup debounce / grace / single open / ESC suppress / dispose | `src/citation-popup.ts` | `tests/citation-popup.test.ts` |
| Clash grouping undirected + reason merge | `find_clashes` | `tests/find-clashes.test.ts` |
| DOI clash checks O(1) via `doi_index` | `src/doi-index.ts` | `tests/doi-index.test.ts` |
| Rename vault scan is chunked, prioritised, cancelable | `src/vault-scan.ts` | `tests/vault-scan.test.ts` |
| Full rescan is chunked + cancelable; cancel does not swap dict | `scan_bibtex_hits_chunked` + `rescan_vault` | `tests/vault-scan.test.ts`, `tests/cache-ops.test.ts` |
| Durable entries omit reconstructible `source`; abstracts stay on fields | `slim_entry` / `entry_source` / `normalize_plugin_cache` | `tests/cache-ops.test.ts` |
| Incremental rescan via mtime+size fingerprints; hard reset for full harvest | `classify_path_fingerprints` + merge hits | `tests/cache-ops.test.ts` |
| Inline cite reverse index; rename scan restricts to known paths after build | `CitePathIndex` + `scan_inline_cites` | `tests/vault-scan.test.ts` |
| Missing-PDF chunked probe + virtualized rows + cache/recheck | `probe_missing_pdf_chunked` + panel | `tests/cache-ops.test.ts`, `tests/library-scale.test.ts` |
| Idle = no popup + no dirty save + no rename timers | `src/idle-audit.ts` | `tests/idle-audit.test.ts` |

## Runtime patches (main plugin)

1. **Codeblock processor** — sequential loop; one coalesced save per paint; DOI check uses `doi_index`.
2. **`save_cache` / `schedule_save_cache`** — `SaveCoalescer` (80 ms); flush on unload; flush/schedule counters.
3. **`load_cache` / `rescan_vault`** — normalize (slim source) + rebuild DOI index; rescan is chunked (32), fingerprint-incremental, progress Notice, epoch-cancel; partial harvest never commits; hard flag re-reads all files.
4. **Modify handler** — early-exit counter; fence gate before parse.
5. **EditorPrompt / PaperPanel** — live dict getters.
6. **`scan_inline_cites`** — chunked (32), active file first, progress Notice, substring reject, cancel flag.
7. **`onunload`** — cancel scan, clear rename timers, dispose popup, flush save.
8. **`idle_snapshot` / `audit_idle` / `is_idle`** — expose Phase C invariants.

## Run

```bash
npm test          # vitest trust suite
npm run build     # tsc + esbuild production
```

## Scale budgets (10k+ libraries)

Notes on the ongoing scale work live in **`SPEED.md`**. Budgets set so far:

| Budget | Target | Mechanism |
|--------|--------|-----------|
| Paper panel mounts | ≤ **80** chips (`PANEL_RESULT_CAP`); empty open ≤ **50** (`PANEL_EMPTY_PREVIEW`) | `list_ids_for_panel` |
| EditorSuggest rows | ≤ **50** (`SUGGEST_RESULT_CAP`) | `list_ids_for_suggest` |
| Free-text search fields | slim catalog only (not abstract) | `match_query` |
| Durable entry payload | no double-stored `source`; abstracts on `fields` | `slim_entry` / `entry_source` |
| Soft rescan file reads | only new/changed paths (mtime+size fp) | `path_fingerprints` / `classify_path_fingerprints` |
| Rename cite scan (warm index) | only known citing paths (+ active file) | `CitePathIndex` |
| Missing-PDF open | chunked probe + virtual DOM window | `probe_missing_pdf_chunked` / `visible_window` |
| Suggest / panel list work | pure helpers + vitest 10k smoke | `tests/library-scale.test.ts` |

Debug: command **Show BibTeX library scale report** → `format_scale_report` (entries, cache≈bytes, panel_rows, suggest returned/matched, last rescan).

## Remaining risks

- Rename scan is O(known citing paths) once the reverse index is warm; first post-rescan rename still walks the vault once to rebuild it (in-memory only).
- CodeMirror widget `eq` does not detect field content updates without id/expand change.
- Soft incremental clash detection only sees cached **winners** on unchanged paths; use **Hard reset** / panel collision recache for a full harvest.
- Abstracts still live on every entry's `fields` (by policy); further RAM wins would need a colder abstract store.
- Missing-PDF list cache is invalidated when library entry count changes or via **Recheck**.
