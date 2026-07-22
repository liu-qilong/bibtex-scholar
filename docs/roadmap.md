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

## Planned platform work (not started)

### C2 — Citation styles / CSL

Beyond `\autocite{id}` clipboard helpers: configurable CSL (or a small style preset set) for export and note templates. Depends on a clear cache/export story (now partly in place via `.bib` export).

### C3 — Mobile hardening

`manifest.json` has `isDesktopOnly: false`, but the primary UX is hover chips, floating cards, and long-press edit in Live Preview. Decide either:

1. **Desktop-primary** — set `isDesktopOnly: true` until mobile gestures are designed, or  
2. **Mobile pass** — tap targets, no-hover open, pin without drag, panel layout on small screens.

Until then, mobile is best-effort only.

## Manual QA still required

Live Obsidian: Live Preview long-press edit, pin drag feel, export `.bib`, cache modal copy, diagnostics refresh.
