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
| **1** | Shared controller: debounce, close grace, ESC dismiss, one global open | Skim without open; ESC sticks until leave — **done 2026-07-18** (`src/citation-popup.ts`, wired in `src/hover.tsx`; card still inline) |
| **2** | Portal + fixed position under workspace container | Open does not shift text — **done 2026-07-18** (`createPortal` → `app.workspace.containerEl`, fixed + clamp/flip; styles in `styles.css`) |
| **3** | Editor decoration stability (chip-only widget, fewer remounts) | Caret motion does not thrash popup — **done 2026-07-18** (selection rebuild only on cite enter/leave; `HoverWidget.eq` + `destroy` unmount) |
| **4** | Polish (click-outside, a11y) | **done 2026-07-18** — click-outside close; chip click toggle; ARIA expanded/haspopup; no focus steal on open |
| **5** | Cleanup (React roots, styles, docs) | **done 2026-07-18** — `HoverRenderChild` / `unmount_hover`; panel list dispose; uncache confirm fix; README UX |

### Phase 5 inspect checklist

- [ ] Open/close notes with many cites — no stuck floating cards after navigate away
- [ ] Paper panel search / clash toggle / close panel — no leaked cards
- [ ] Uncache asks confirm **before** removing
- [ ] README matches floating-card behavior |

### Phase 4 inspect checklist

- [ ] Click outside an open card → closes; hover again can reopen
- [ ] Click chip → opens immediately (no 250 ms wait); click again → closes
- [ ] Keyboard: focus chip (if focusable in reading/panel), Enter/Space toggles; Esc dismisses
- [ ] Opening a card does **not** move keyboard focus out of the editor
- [ ] Screen-reader-ish DOM: chip has `aria-expanded` / `aria-haspopup`; card `role="dialog"`
- [ ] ESC still suppresses reopen while pointer remains on chip |

### Phase 3 inspect checklist

- [ ] Arrow through a paragraph of citations without opening/closing flicker
- [ ] Hover a chip, move caret elsewhere (not into that cite) → popup stays stable (or closes only via leave/ESC)
- [ ] Move caret **into** a cite span → chip becomes raw `` `{id}` `` for editing
- [ ] Move caret **out** of that span → chip returns
- [ ] Type / edit document → decorations still update
- [ ] Scroll viewport → chips in view still work; no obvious leaks after long session |

### Phase 1 inspect checklist

- [ ] Skim past `` `{id}` `` chips → card does **not** open if leave before ~250 ms
- [ ] Hold hover on chip → card opens; move onto card within ~150 ms → stays open
- [ ] Leave chip+card → closes after ~150 ms
- [ ] ESC while open → closes; stays closed until pointer fully leaves chip (then re-hover)
- [ ] Open chip A, hover chip B long enough → A closes, B opens (one global)
- [ ] `` `[id]` `` → open on mount without waiting; ESC still dismisses

### Phase 2 inspect checklist

- [ ] Opening a card does **not** push following lines / displace neighbors
- [ ] Card appears near the chip (below by default; above near bottom of viewport)
- [ ] Card stays in view when clamped at edges; scrolls with page (repositions on scroll)
- [ ] Chip → card pointer path still works with 150 ms close grace
- [ ] Works in reading view, live preview, paper panel, and bibtex blocks
- [ ] Long abstracts scroll inside the card (`max-height`)


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
