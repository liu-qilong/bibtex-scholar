# True citation popup — Phase 0 (spec lock)

Branch: `feature/truepopup`  
Status: **phases 0–5 complete** (2026-07-18)  
Goal: replace in-flow hover expansion with floating popups + debounced hover + ESC dismiss.

Phases 0–5 implemented on this branch. This doc remains the behavioral contract.

---

## Problem (context)

Today `HoverPopup` (`src/hover.tsx`) renders the full card **inline** next to the cite chip. That shifts layout, moves click/hover targets, and interacts badly with CodeMirror decoration rebuilds on selection. Open is immediate on `mouseenter` with no ESC path.

---

## Locked decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | **Open debounce** | **250 ms** after pointer enters the cite chip (compact `` `{id}` ``). |
| 2 | **Close grace** | **150 ms** after pointer leaves the chip **and** the card (so chip → card transit does not flicker). |
| 3 | **Expanded cite `` `[id]` ``** | Open on mount **without** debounce. ESC dismisses. Re-open only after full leave of chip+card, then re-enter (or a later explicit open such as click — Phase 4 optional). |
| 4 | **Concurrency** | **One global** citation popup at a time. Opening another chip closes the current card. |
| 5 | **Portal root (Phase 2)** | Mount floating card under **`app.workspace.containerEl`** (Obsidian workspace chrome), not `document.body`. |

### ESC dismiss (intent, all later phases)

While a popup is open, **Escape**:

1. Closes the card immediately (no close grace).
2. Marks the **current interaction** as dismissed: while the pointer remains over that chip (and until a full leave of chip+card), the card must **not** auto-reopen from hover.
3. Does not steal editor focus permanently; editor should remain usable for typing.

### Compact vs expanded cite

| Form | Open |
|------|------|
| `` `{id}` `` | After **250 ms** hover on chip (unless dismissed this interaction). |
| `` `[id]` `` | On mount / when chip is shown as expanded; no open debounce. Same close grace / ESC rules after open. |

---

## End-state model (for Phase 1+)

```
  [chip]  — only compact control stays in text flow
     │
     │  hover (+ debounce / or mount for [id])
     │  ESC → dismiss for this interaction
     ▼
  [floating card]  — portal to workspace container (Phase 2)
                    position: fixed near chip
```

Implemented: controller (1) → portal (2) → editor stability (3) → click/a11y (4) → root lifecycle (5).

---

## Non-goals (kept)

- Rewriting to Obsidian `HoverPopover` / `hover-link` as the primary card shell.
- Blocking Obsidian `Modal` for citation peeks.
- Cite syntax or cache changes.
- ~~Click-to-open / click-outside~~ (Phase 4 done).

---

## Phase checklist

| Phase | Scope | Inspect when done |
|-------|--------|-------------------|
| **0** | Spec lock (this doc) | Decisions agreed |
| **1** | Shared controller: debounce, close grace, ESC dismiss, one global open | Skim without open; ESC sticks until leave — **done 2026-07-18** (`src/ui/citation-popup.ts`, wired in `src/hover.tsx`; card still inline) |
| **2** | Portal + fixed position under workspace container | Open does not shift text — **done 2026-07-18** (`createPortal` → `app.workspace.containerEl`, fixed + clamp/flip; styles in `styles.css`) |
| **3** | Editor decoration stability (chip-only widget, fewer remounts) | Caret motion does not thrash popup — **done 2026-07-18** (selection rebuild only on cite enter/leave; `HoverWidget.eq` + `destroy` unmount) |
| **4** | Polish (click-outside, a11y) | **done 2026-07-18** — click-outside close; chip click toggle; ARIA expanded/haspopup; no focus steal on open |
| **5** | Cleanup (React roots, styles, docs) | **done 2026-07-18** — `HoverRenderChild` / `unmount_hover`; panel list dispose; uncache confirm fix; README UX |

### Inspect / live QA

Phases 0–5 are **done** (see table above). Automated coverage is under `tests/hover-popup.test.tsx` and related suites. Ongoing code debt is indexed in [`docs/roadmap.md`](roadmap.md) **Technical debt** — not in per-phase manual checklists.


---

## Implementation touchpoints (later)

- `src/hover.tsx` — `HoverPopup`, `render_hover`, `HoverWidget`
- `src/editor.ts` — CM replace decorations (Phase 3 focus)
- `styles.css` — floating card styles (Phase 2)
- Mount paths: reading processor, bibtex blocks, paper panel (all via `render_hover` / same popup)

---

## Phase 0 complete when

- [x] Open debounce locked: **250 ms**
- [x] Close grace locked: **150 ms**
- [x] `` `[id]` `` behavior locked: open on mount, ESC dismissible
- [x] Single global popup locked
- [x] Portal root locked: workspace container
- [x] Decisions written down on the branch

Next: **Phase 1** — shared popup controller (still allowed to be in-flow for inspection).
