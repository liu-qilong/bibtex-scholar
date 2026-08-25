# SPEED — scale & smoothness for large libraries

Living tracker for making BibTeX Scholar safe at **10k+ entries** on Obsidian/Electron.
Update this file as work lands. If a session dies, **this file is the source of truth**.

**Related:** `docs/stability-trust.md`

---

## Principles (do not regress)

1. **Hot path stays O(viewport)** — typing, caret, one popup, one ```bibtex section paint.
2. **Cold path may be O(n)** — rescan, clash collect, export — but **chunked, cancelable, progressive**.
3. **Never mount what you can’t see** — no 10k React roots / chips.
4. **Index what you query; materialize fat fields on demand.**
5. **Measure** — counters + synthetic 10k fixtures, not folklore.

---

## Already good (protect these)

| Area | Where | Why it scales |
|------|--------|----------------|
| DOI clash check | `src/architecture/doi-index.ts` | O(1) paint path |
| Save coalescing | `src/infra/save-coalesce.ts` | Not one write per entry — see caveat below (E8) |
| Editor cite widgets | `src/editor.ts` + `cite-span.ts` | Visible ranges only |
| Citation popup | `src/ui/citation-popup.ts` | One global open |
| Citation chip rendering | `src/hover.tsx` | One shared React root for the card (not one per chip); chips are plain DOM — see `docs/one-root-per-chip.md` |
| Rename vault scan | `src/scale/vault-scan.ts` | Chunked, cancelable |
| Idle/unload audit | `src/infra/idle-audit.ts` | No leaked work |
| Panel/suggest caps | `src/scale/library-scale.ts` | Hard mount caps (S1) |
| Slim free-text match | `src/bibtex.ts` `match_query` | No abstract on every keystroke; TeX→Unicode + accent-fold + token AND; word-level Levenshtein (length-scaled budget) via `token_matches_haystack`; per-entry corpus cached by object identity (S8) |
| Scale report command | `main` → `format_scale_report` | Visible counters (S2) |
| List-mode virtualized repaint | `src/panel.ts` `paint_list_window`, `src/scale/library-scale.ts` `should_repaint_window`/`diff_window_ids` | Scroll/keystroke repaint is a no-op when the window is unchanged; only ids entering/leaving the window are (re)mounted (S8) |

---

## Pain at 10k (current)

| Surface | Failure mode | Mitigation status |
|---------|--------------|-------------------|
| Paper panel React per entry | Freeze / memory | **S1 done** — empty preview 50, search cap 80 |
| EditorSuggest full dump | Keystroke jank | **S1 done** — cap 50 + slim match |
| Durable fat `bibtex_dict` blob | Large RAM + slow `saveData` | **S3 done** — no double-stored `source`; abstracts stay on fields |
| `rescan_vault()` sequential full vault | UI freeze | **S4+S5 done** — chunked + fingerprints; hard reset for full clash harvest |
| Missing-PDF full list | Slow open + large DOM | **S7 done** — chunked probe + virtual rows + cache |
| Rename O(files), no reverse index | Painful on huge vaults | **S6 done** — citekey↔path index after first full scan |
| Same-note duplicate-ID check (`check_duplicate_id` in `src/bibtex.ts`) used to build a `RegExp` and scan the whole note's flattened text **per entry in the block** | Was O(entries · notesize) per note, same shape as upstream's own known-bad code (see `external_UPSTREAM-BIBTEX-SCHOLAR.md`) | **done (2026-08-25)** — new `count_citekeys_in_note` scans the note once and returns citekey occurrence counts; `bibtex_codeblock_processor` builds it once per block render (`same_note_counts` in `src/main.ts`) and passes it to every `check_duplicate_id` call in that block instead of rescanning. `id_index` still covers the cross-file half unchanged. Old `file_content`-regex path kept as a fallback when no map is passed (tests, other callers). Measured: E9 (`tests/perf/duplicate-id-scan.perf.test.ts`) — ~1279× fewer ms for 2000 entries in one note; correctness cross-checked against the regex path. |
| Save coalescing (`SaveCoalescer`, 80ms trailing throttle) degrades to upstream's per-entry full-serialize cost if codeblock paints are spaced **past** the debounce window | Fix's adequacy depends on Obsidian's real paint cadence for many-block notes, which we don't control | **Measured, not fixed** — `tests/perf/save-cache-amplification.perf.test.ts` (E8, 2026-08-25): synchronous/burst paints → ~1 write, ~1000× fewer bytes than upstream; paints spaced faster than but close to the 80ms window (20ms) → real but bounded win (~4×, not eliminated — quadratic-shaped, just scaled); paints spaced past the window (100ms) → 0% improvement, same quadratic total as upstream. No action taken — no evidence yet on real per-block paint spacing for a many-block note; the numbers exist now so a real trace can be checked against them. |

---

## Required program (incremental rescan is NOT optional)

| ID | Slice | Status | Outcome |
|----|--------|--------|---------|
| **S1** | Panel virtualization + empty-query policy + suggest cap / slim match | **done** | Panel / ` open without freeze |
| **S2** | Perf counters + 10k synthetic tests + trust budgets | **done** | Regressions visible |
| **S3** | Slim hot cache (reconstructible `source`; abstracts policy) | **done** | Smaller RAM/disk |
| **S4** | Chunked progressive **full** rescan | **done** | Recache usable on large vaults |
| **S5** | **Incremental rescan** (fingerprints; merge; hard reset) | **done** | Daily-driver large vault |
| **S6** | Reverse indexes (citekey→paths; path→citekeys) | **done** | Fast rename / retarget |
| **S7** | Virtualize missing-PDF (+ optional cache) | **done** | Safe occasional audit |
| **S8** | Hot-path search/render perf: per-entry haystack cache, search-box debounce, suggest double-scan dedupe, keyed list-row reuse | **in_progress** | Faster typing on large libraries |

Status: `todo` | `in_progress` | `done` | `blocked`

### S1 checklist
- [x] Empty panel policy implemented (no full mount) — first **50** sorted
- [x] Mount cap **80** on search results
- [x] Status line explains truncation
- [x] Suggest: cap **50**
- [x] Slim free-text match (no abstract unless `abstract:`)
- [x] Pure helpers + `is_unsafe_full_mount` guard helper
- [x] Lightweight row DOM without React — **list mode** (2026-07-22): plain-DOM rows, no chips, no React roots
- [x] True scroll virtualization via `visible_window` — **list mode only** (2026-07-22): unbounded, virtualized, same technique as the missing-PDF list. **Discover mode** (the renamed condensed chip view) deliberately keeps the old capped-mount approach — chips need real listeners to respond to hover, so it stays capped at `DISCOVER_RESULT_CAP` (140), not virtualized. Don't read "virtualization done" as covering discover mode too.

### S2 checklist
- [x] PerfCounters: panel_rows, suggest returned/matched, rescan_ms/read/skip
- [x] Command: **Show BibTeX library scale report**
- [x] Vitest 10k smoke in `tests/library-scale.test.ts`
- [x] `docs/stability-trust.md` scale budgets

### S3 checklist
- [x] Reconstructible `source` not double-stored (`entry_source` / slim entries)
- [x] Abstracts policy: stay on `fields` for UI; free-text still opt-in via `abstract:`
- [x] Load normalize/migration strips stored `source`

### S4 checklist
- [x] Chunk + yield + progress Notice + cancel
- [x] Atomic dict swap only on full success; cancel leaves cache untouched
- [x] Pure `collect_hits_from_markdown` + `scan_bibtex_hits_chunked` (no new file — lives next to existing vault-scan chunk pattern)
- [x] first-id / first-DOI wins via existing `rebuild_dict_from_hits`

### S5 checklist (required)
- [x] path → fingerprint map persisted (`path_fingerprints`, mtime+size)
- [x] new/changed/deleted/unchanged classification
- [x] Parse only changed/new; drop deleted; merge cached winners + fresh; global first-wins
- [x] Rebuild doi_index + clash_reasons + source-tag patch
- [x] Hard-reset full scan command + panel collision path
- [x] Tests: merge, delete, conflict, fingerprint

### S6 checklist
- [x] citekey → paths for inline cites (`CitePathIndex`)
- [x] path → citekeys (bidirectional)
- [x] invalidation on rescan/uncache; live update on modify/rename/delete

### S7 checklist
- [x] Chunked PDF probes (`probe_missing_pdf_chunked`)
- [x] Virtualized rows (`visible_window` + scroll paint)
- [x] Optional cached result + Recheck button

### S8 checklist
- [x] Per-entry free-text search corpus cached by object identity (`search_corpus_cache` in `src/bibtex.ts`) — `match_query` no longer rebuilds/normalizes an entry's slim corpus on every keystroke, only once per entry object. Safe because `upsert_entry`/`rebuild_dict_from_hits` always construct a new entry object on real content changes and never mutate `.fields` in place.
- [x] Search-box debounce (`src/scale/debounce.ts` `Debouncer`, 130ms trailing) wired into `panel.ts`'s `SearchComponent.onChange` — clearing the query still fires immediately (no debounce on "back to the full list"); `onClose` cancels any pending call.
- [x] EditorSuggest per-keystroke double scan deduped: `onTrigger` now uses `has_any_match` (short-circuits on first *match*) instead of a second full `list_ids_for_suggest` call — `getSuggestions` still does the one real capped-list scan. Note: on a *miss* (nothing matches) `has_any_match` still walks the whole dict same as before; the win there is dropping the redundant `sorted_ids` allocate+sort, not short-circuiting — profile misses separately if they show up as hot.
- [x] List-mode scroll/keystroke repaint no longer tears down and rebuilds the whole visible window every tick: `should_repaint_window` no-ops when `{list_ref, start, end}` is unchanged; `diff_window_ids` + a `Map<id, HTMLElement>` (`list_row_els`) keep rows whose id stays visible untouched (same DOM node, same live hover chip) — only ids entering/leaving the window are mounted/unmounted. Missing-PDF window got the same no-op guard (no row-diff — those rows have no hover chip, so the win is smaller and the plan marked it lower priority).
- [ ] **Explicitly not done, by design:** `list_ids_for_panel`/`list_ids_for_suggest` still scan every entry even after their mount cap is hit — the exact `matched` count is load-bearing UI copy ("347 matches — showing first 80") and is asserted exactly in tests. Do not add an early-exit here without an explicit UX sign-off on approximating/truncating that count.
- [ ] **Deferred, by design:** discover/clash mode chip remount on every keystroke was *not* virtualized — `docs/one-root-per-chip.md`/this file's S1 checklist already records discover mode as deliberately capped-not-virtualized (chips need real listeners). A within-cap by-id diff (same technique as list mode, minus virtualization) would be the next safe step if this shows up as hot in practice; not implemented yet.
- [ ] **Deferred, measure first:** `display_bibtex_text` per-field memoization — likely moot now that Step 6 means unchanged rows don't re-render at all; only worth doing if profiling on a real TeX-heavy library still shows it hot.
- [x] Search relevance ranking centralized in `scored_matches` (`library-scale.ts`): panel discover (`list_ids_for_panel`), panel list mode (`filtered_ids` when query non-empty), and EditorSuggest (`list_ids_for_suggest`) all use `match_query` + `query_match_score`. Empty list-mode browse still uses A–Z / Most-cited only; during a search those sorts are score tiebreaks. Token fuzzy requires a shared first character and caps reverse-stem overrun (`token_match_quality`; regressions in `tests/problemset-ranking.test.ts`).

---

## Non-goals

- Workers for all vault I/O by default
- Pre-mount floating cards / per-row React trees
- Live O(n) clash_reasons on every paint
- Background full-vault crawls vs Obsidian indexer

---

## Open decisions

1. **Empty panel policy:** **first N (50)** + type to search (not require-search-only)
2. **Abstracts in hot cache:** still stored (S3); **not** free-text searched unless `abstract:`
3. **Fingerprint strength:** **mtime+size** (lean)

---

## Key files (S1–S7)

| File | Role |
|------|------|
| `src/scale/library-scale.ts` | Caps, list_ids, `visible_window`, missing-PDF row height |
| `src/bibtex.ts` | slim `match_query`; `entry_source` |
| `src/panel.ts` | capped papers; hard clash rescan; virtual missing-PDF |
| `src/prompt.ts` | capped suggest + stats sink |
| `src/infra/idle-audit.ts` | scale counters + format_scale_report |
| `src/core/cache-ops.ts` | slim cache, fingerprints, merge, PDF probe |
| `src/scale/vault-scan.ts` | chunked scans + cite reverse index |
| `src/main.ts` | rescan; rename scan via cite index |
| `src/scale/debounce.ts` | clock-injectable trailing debouncer (S8) |
| `tests/*` | S1–S8 pure helpers + 10k smoke |
| `docs/stability-trust.md` | budgets |

---

## Session log

| Date | Note |
|------|------|
| 2026-07-19 | SPEED.md created. S1–S7 required; S5 incremental rescan not optional. |
| 2026-07-19 | **S1 done:** panel empty preview 50 / search cap 80; suggest cap 50; slim match_query; library-scale module + tests. |
| 2026-07-19 | **S2 done:** perf scale fields, scale report command, trust doc budgets, 10k smoke. Next: **S3** or **S4**. |
| 2026-07-19 | **S4 done:** chunked full rescan (32, yield, progress Notice, epoch cancel); pure hit collect in cache-ops; no vault-rescan.ts. Next: **S3** or **S5**. |
| 2026-07-19 | **S3+S5 done:** slim entries (`entry_source`, load strips source); path fingerprints mtime+size; soft recache + hard reset command; panel clashes hard. Next: **S6** or **S7**. |
| 2026-07-19 | **S6+S7 done:** cite reverse index (build on first rename scan; restrict later); missing-PDF chunked probe + virtual list + cache/Recheck. Program S1–S7 complete. |
| 2026-07-22 | Follow-up (outside S1–S7, tracked in `docs/one-root-per-chip.md`): citekey matching made case-insensitive (`src/architecture/citekey-index.ts`); one-root-per-chip landed — chips are plain DOM, one shared React root renders the (0-or-1) open card instead of one root per chip. |
| 2026-07-22 | **S1 follow-up done (list mode only):** paper panel split into two views — **discover** (capped chip view, not virtualized by design) and **list** (unbounded, virtualized plain-DOM rows). Mention-count sort reuses `cite_index`. |
| 2026-07-26 | **S8 landed** (corpus cache, search debounce, suggest double-scan dedupe, list window row-diff). Open/deferred items remain the three S8 checklist `- [ ]` bullets (matched-count full scan, discover virtualization, display memoization). |
| 2026-07-28 | Code debt index: `docs/roadmap.md` **Technical debt**; BibTeX parse/display gaps as `it.todo` in `tests/bibtex-renderer.completeness.test.ts`. |
| 2026-08-11 | Scale A/B experiments: `tests/perf/` (upstream-shaped baseline vs fork on public-seed N=5k + mock vault). Run `npm run test:perf`. Not in default `npm test` (wall-clock + Θ(N²) DOI baseline). |
| 2026-08-25 | Reviewed `external_UPSTREAM-BIBTEX-SCHOLAR.md` (upstream 1.1.0 analysis: two quadratics — per-entry `save_cache()` full serialize, and per-block same-note duplicate-ID regex over the whole note). Save-cache fix confirmed real but cadence-dependent, not proven — added E8 perf experiment (`tests/perf/save-cache-amplification.perf.test.ts`) instead of declaring it closed on inspection alone; left as-is (no code change — see row above). Same-note duplicate-ID regex confirmed **was still present, unfixed** — `id_index` (S6-adjacent work) only covered the cross-file half of `check_duplicate_id`. |
| 2026-08-25 | **Fixed**: same-note duplicate-ID quadratic. `count_citekeys_in_note` (`src/bibtex.ts`) + `same_note_counts` param on `check_duplicate_id`; wired into `bibtex_codeblock_processor` (`src/main.ts`). E9 perf experiment + 3 new unit tests in `tests/citekey-index.test.ts`; `npm test` 373 passed, `tsc -noEmit` clean. Also fixed `npm run test:perf` (was finding 0 files — vitest 3.2.7's config `exclude: ['tests/perf/**']` wins over the CLI's positional path filter, pre-existing and unrelated to the above): split into `vitest.config.ts` (default, still excludes `tests/perf`) + `vitest.perf.config.ts` (perf-only `include`, no exclude), sharing alias config via `vitest.shared.ts`. `test:perf` script now points at the new config. |

---

## Resume after disconnect

1. Read **SPEED.md** (S-checklists + deferred bullets); product/code debt index in `docs/roadmap.md` **Technical debt**.
2. `git status` / branch; note WIP may be uncommitted.
3. `npm test` baseline.
4. Program **S1–S8 complete** for required work; remaining S8 lines are deliberate deferrals (see checklist).
5. On slice done: update checklist / session log; if parse/display debt, promote an `it.todo` → real assertion in the completeness harness.
