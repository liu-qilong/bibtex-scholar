# Stability & performance trust checks

Focus areas: **cursor management**, **cache durability**, **data integrity**, **idle work**.

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

## Runtime patches (main plugin)

1. **Codeblock processor** — sequential loop (no `forEach(async)` races); one coalesced save per paint.
2. **`save_cache` / `schedule_save_cache`** — `SaveCoalescer` (80 ms); flush on unload.
3. **`load_cache`** — `normalize_plugin_cache` instead of shallow assign only.
4. **`rescan_vault`** — atomic `bibtex_dict = rebuild_dict_from_hits(hits)`; skip files without ```` ```bibtex ````.
5. **Modify handler** — early exit without ```` ```bibtex ```` (command path still forces scan).
6. **EditorPrompt / PaperPanel** — live dict getters (no stale snapshot after rescan/uncache).
7. **Editor decorations** — pure cite-span helpers; live `plugin.cache.bibtex_dict` lookup.
8. **`onunload`** — clear rename timers, `citation_popup.dispose()`, flush coalescer.

## Run

```bash
npm test          # vitest trust suite
npm run build     # tsc + esbuild production
```

## Remaining risks (not yet automated)

- Vault-wide `scan_inline_cites` on rename still O(files) — intentional for correctness.
- `check_duplicate_doi` remains O(n) per paint entry — acceptable for typical library sizes.
- CodeMirror widget `eq` does not detect field content updates without id/expand change.
