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
| **A** DOI clash checks O(1) via `doi_index` | `src/doi-index.ts` | `tests/doi-index.test.ts` |
| **B** Rename vault scan is chunked, prioritised, cancelable | `src/vault-scan.ts` | `tests/vault-scan.test.ts` |
| **C** Idle = no popup + no dirty save + no rename timers | `src/idle-audit.ts` | `tests/idle-audit.test.ts` |

## Runtime patches (main plugin)

1. **Codeblock processor** — sequential loop; one coalesced save per paint; DOI check uses `doi_index`.
2. **`save_cache` / `schedule_save_cache`** — `SaveCoalescer` (80 ms); flush on unload; flush/schedule counters.
3. **`load_cache` / `rescan_vault`** — normalize + rebuild DOI index.
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

## Remaining risks

- Rename scan is still O(files) for correctness, but **chunked + progress + yield** so the UI can breathe.
- CodeMirror widget `eq` does not detect field content updates without id/expand change.
- No reverse cite→files index yet (would shrink rename scan further).
