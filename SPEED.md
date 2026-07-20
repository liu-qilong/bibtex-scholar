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
| DOI clash check | `src/doi-index.ts` | O(1) paint path |
| Save coalescing | `src/save-coalesce.ts` | Not one write per entry |
| Editor cite widgets | `src/editor.ts` + `cite-span.ts` | Visible ranges only |
| Citation popup | `src/citation-popup.ts` | One global open |
| Rename vault scan | `src/vault-scan.ts` | Chunked, cancelable |
| Idle/unload audit | `src/idle-audit.ts` | No leaked work |
| Panel/suggest caps | `src/library-scale.ts` | Hard mount caps (S1) |
| Slim free-text match | `src/bibtex.ts` `match_query` | No abstract on every keystroke |
| Scale report command | `main` → `format_scale_report` | Visible counters (S2) |

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

Status: `todo` | `in_progress` | `done` | `blocked`

### S1 checklist
- [x] Empty panel policy implemented (no full mount) — first **50** sorted
- [x] Mount cap **80** on search results
- [x] Status line explains truncation
- [x] Suggest: cap **50**
- [x] Slim free-text match (no abstract unless `abstract:`)
- [x] Pure helpers + `is_unsafe_full_mount` guard helper
- [ ] Lightweight row DOM without React (deferred — cap makes 80 dense chips acceptable; revisit if needed)
- [ ] True scroll virtualization via `visible_window` (helper ready; wire if UI still janks under cap)

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
| `src/library-scale.ts` | Caps, list_ids, `visible_window`, missing-PDF row height |
| `src/bibtex.ts` | slim `match_query`; `entry_source` |
| `src/panel.ts` | capped papers; hard clash rescan; virtual missing-PDF |
| `src/prompt.ts` | capped suggest + stats sink |
| `src/idle-audit.ts` | scale counters + format_scale_report |
| `src/cache-ops.ts` | slim cache, fingerprints, merge, PDF probe |
| `src/vault-scan.ts` | chunked scans + cite reverse index |
| `src/main.ts` | rescan; rename scan via cite index |
| `tests/*` | S1–S7 pure helpers + 10k smoke |
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

---

## Resume after disconnect

1. Read **SPEED.md** Status column.
2. `git status` / branch; note WIP may be uncommitted.
3. `npm test` baseline (expect ≥100 tests).
4. Program **S1–S7 complete**. Follow-ups only if new pain appears (true panel chip virtualization, abstract cold store, S6 durable index).
5. On slice done: Status → `done`, session log line, update trust doc if needed.
