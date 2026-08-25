# Action strip layout prototypes

**Branch:** `prototype/action-strip-layouts`  
**Goal:** a reliable **block-button command center** on the citation card, with the same tile footprint on narrow and wide cards.

## Direction (current)

| Id | Status | Notes |
|----|--------|--------|
| **`rows`** | **Preferred** | Command rows; fixed-width tiles; subtle Copy/Open captions; solo **uncache** has no “Cache” caption |
| **`grouped`** | Legacy | Previous toolbar (wrap + side dividers) |
| `classic` | **Dropped** | Visually disorganized |
| `grid` | **Dropped** | Visually disorganized (saved values migrate → `rows`) |

## Design rules (rows)

1. **Blocky bands, not a global matrix** — each row is caption + a cells band that shares the same left/right bounds as its siblings (`width: 100%` under the card).
2. **Equal tiles within Copy / Open** — `repeat(auto-fit, minmax(…, 1fr))` so buttons in a row share space; different row lengths still share outer edges.
3. **Captions quieter than actions** — small uppercase, faint: **Copy**, **Open**, **Change**.
4. **Change row is unbalanced on purpose** — compact `key` (rename prompt → `offer_rename`) + wider `uncache` (priority by width).

## How to try

1. Reload the plugin on this branch.
2. Settings → **Citation card → Action strip layout (prototype)** (`rows` vs `grouped`).
3. Compare with **Wider citation cards** on/off — tile size should not change.

## Implementation map

| Piece | Where |
|-------|--------|
| Setting + normalize | `src/core/cache-ops.ts` (`action_strip_layout`) |
| Settings UI | `src/architecture/settings-tab.ts` |
| Markup | `src/hover.tsx` (`ActionStrip`) |
| Layout CSS | `styles.css` (`.bibtex-hover-button-bar.is-layout-*`, `--bibtex-action-tile`) |

## Open questions

- Tile width (`5.4em`) — any label still feels tight?
- Keep a permanent layout preference, or lock `rows` and remove the setting?
- Future “Manage” siblings for uncache (would reintroduce a caption only if ≥2 actions)?
