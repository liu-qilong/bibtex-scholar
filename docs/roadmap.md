# Product roadmap notes

## Done recently (trust + UX)

- Quiet unknown cites (visual only)
- Duplicate first-wins literacy (not cached tag, summary notice, quiet-once setting)
- Vault delete → soft uncache with Undo
- Pin affordance + drag without per-move React re-renders
- Long-press Live Preview chip → edit raw cite
- Open card refresh when chip bibtex updates
- Cache management modal literacy (soft vs explicit hard remove)
- Export library to vault `.bib` from Copy/export modal
- Settings diagnostics (local scale + audit)
- Settings tab extracted from `main.ts`
- **C3 mobile hardening (mostly done):** panel `--icon-size` with touch-sized buttons; safe-area corner actions; click-only chip open on mobile (no synthetic hover leave-close); higher pin-drag threshold; discover-chip / clash / missing-PDF touch floors. `isDesktopOnly` stays `false` — installable on mobile with these fixes; not a full redesign (e.g. dedicated pin-without-drag UX, polished small-screen panel chrome).

## Platform work

### C2 — Citation styles / CSL — **out of scope for now**

Configurable CSL (or style presets) for export and note templates, beyond current `\autocite{id}` / BibTeX copy helpers. Cache/export story is already good enough if we ever reopen this; no active plan.

### C3 — Mobile — **mostly done**

Shipped under “Done recently.” Residual polish only if a real mobile bug shows up — not a tracked open project.

## Technical debt

Code- and contract-level debt only. Live Obsidian exercise of shipped UX is not tracked here.

### How we track it

Prefer **executable contracts** over prose checklists:

1. Add or promote an `it.todo('…')` (or a failing `it` once work starts) that names the missing behavior.
2. Implement until the test is a real assertion.
3. Keep prose here as a short index + context — the test file is the source of truth for what still fails.

Primary harness today: [`tests/bibtex-renderer.completeness.test.ts`](../tests/bibtex-renderer.completeness.test.ts)  
(structure = `parse_bibtex`, display = `display_bibtex_*` / segments).

### BibTeX parse / display (open contracts)

Custom stack all along (same lineage as upstream): regex field parse + display walker. Accents, font switches (`{\itshape …}`, `\textbf{…}`, …), bare `~`, and DBLP `<i>`/`<em>` are covered by green tests in that harness. Still open as `it.todo`:

| Contract (`it.todo`) | Layer | Notes |
|----------------------|--------|--------|
| Simple math (`$\alpha$`) as readable text | display | Optional symbol map; not a full math engine |
| Outer quotes stripped from `"…"` fields | structure | Parser currently keeps surrounding `"` |
| Structured author names (particles, corporate) | structure | Display keeps one raw author string today |
| `@string` resolution | structure | Custom parse does not expand abbreviations |
| `crossref` field inheritance | structure | Not implemented |

**Direction when this bites users:** grow the completeness harness first; consider a BibTeX library **only for structural parse** (adapter → existing `BibtexField`), keep display as an explicit small grammar. Do not conflate the two layers.

### Scale (deliberately deferred)

Recorded as open/deferred in [`SPEED.md`](../SPEED.md) S8 — not bugs, intentional tradeoffs until measured or UX-signed:

- Full-dict scan for exact “N matches” copy (no early-exit without product sign-off)
- Discover/clash chip list: capped, not virtualized (listeners need real DOM)
- `display_bibtex_text` memoization: measure-first; likely moot after list row-diff

### Not debt

- **C2 CSL** — out of scope (see Platform work)
- **C3 mobile** — mostly done; further issues are ordinary bugs, not a program slice
- One-off design notes / historical QA lists under `docs/*` — not a backlog
