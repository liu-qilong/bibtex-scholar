# Stability & performance trust checks

Focus areas: **cursor management**, **cache durability**, **data integrity**, **idle work**, **scale**.

## Guarantees (with automated tests)

| Guarantee | Module | Tests |
|-----------|--------|--------|
| Cite decorations rebuild only when caret enters/leaves a cite span | `src/cite-span.ts` | `tests/cite-span.test.ts` |
| Chip visibility filter is pure half-open policy (`spans_showing_chips`); multi-cite lines hide only the span under the caret | `src/cite-span.ts` | `tests/cite-span.test.ts` |
| Live Preview EditorView: chip outside cite, raw text inside, Source mode empty, case-insensitive resolve, multi-cite isolation, rebuild on doc edit | `src/editor.ts` (`createHoverWidgetPlugin`) | `tests/editor-decorations.test.ts` |
| Chip lifecycle: unmount closes open card; host re-render does not stack chips; panel host wipe / HoverRenderChild unload clean up; widget `eq` / `ignoreEvent` / double-destroy contracts | `src/hover.tsx` | `tests/hover-popup.test.tsx` |
| Idle typing in non-bibtex notes skips rename detection (fence gate) | `text_may_contain_bibtex_block` | same |
| Vault rescan: first id + first DOI wins; pure rebuild | `src/cache-ops.ts` | `tests/cache-ops.test.ts` |
| Disk load tolerates corrupt/partial plugin data | `normalize_plugin_cache` | same |
| Dict audit catches key/id mismatch & duplicate DOIs | `audit_bibtex_dict` | same |
| Frequent saves coalesce (not one write per codeblock entry) | `src/save-coalesce.ts` | `tests/save-coalesce.test.ts` |
| Popup debounce / grace / single open / ESC suppress / dispose | `src/citation-popup.ts` | `tests/citation-popup.test.ts` |
| Clash grouping undirected + reason merge | `find_clashes` | `tests/find-clashes.test.ts` |
| DOI clash checks O(1) via `doi_index` | `src/doi-index.ts` | `tests/doi-index.test.ts` |
| Citekey duplicate/clash checks and inline-cite resolution are case-insensitive; storage/display keep the user's literal casing | `src/citekey-index.ts` | `tests/citekey-index.test.ts`, `tests/bibtex.test.ts`, `tests/find-clashes.test.ts`, `tests/vault-scan.test.ts` |
| One shared React root renders the (0-or-1) transient preview card plus any pinned cards, not one root per chip; opening a second (unpinned) chip swaps the preview card cleanly | `src/hover.tsx` (`CardManager`, `chip_registry`) | `tests/hover-popup.test.tsx` |
| Pinned cards: dedup by paper id, detach from the anchor/hover-close machinery entirely, survive what would otherwise close a preview card (click-outside, scroll, mouseleave grace); Esc closes only the front-most pin, one at a time; unpin/× always closes (no "revert to hover-tracked" state) | `src/pin-registry.ts`, `src/hover.tsx` (`CardShell`, `CardManager`) | `tests/pin-registry.test.ts`, `tests/hover-popup.test.tsx` |
| Rename vault scan is chunked, prioritised, cancelable | `src/vault-scan.ts` | `tests/vault-scan.test.ts` |
| Full rescan is chunked + cancelable; cancel does not swap dict | `scan_bibtex_hits_chunked` + `rescan_vault` | `tests/vault-scan.test.ts`, `tests/cache-ops.test.ts` |
| Durable entries omit reconstructible `source`; abstracts stay on fields | `slim_entry` / `entry_source` / `normalize_plugin_cache` | `tests/cache-ops.test.ts` |
| Incremental rescan via mtime+size fingerprints; hard reset for full harvest | `classify_path_fingerprints` + merge hits | `tests/cache-ops.test.ts` |
| Inline cite reverse index; rename scan restricts to known paths after build | `CitePathIndex` + `scan_inline_cites` | `tests/vault-scan.test.ts` |
| Missing-PDF chunked probe + virtualized rows + cache/recheck | `probe_missing_pdf_chunked` + panel | `tests/cache-ops.test.ts`, `tests/library-scale.test.ts` |
| Idle = no popup + no dirty save + no rename timers | `src/idle-audit.ts` | `tests/idle-audit.test.ts` |
| Paper panel discover/list views: random sampling capped/deduped/rng-injectable; list mode's filter+sort is unbounded (no mount cap, virtualized); mention-count sort is descending with an alpha tiebreak | `src/library-scale.ts` (`random_sample_ids`, `filtered_ids`, `compare_by_mention_count`) | `tests/library-scale.test.ts` |
| `cite_index` can be warmed independent of any rename target (`old_id` optional); O(1) mention count accessor distinct from the display-oriented path-list accessor | `src/vault-scan.ts` (`scan_inline_cites_chunked`, `cite_index_count_for`) | `tests/vault-scan.test.ts` |
| Live Preview citation chip DOM is `contenteditable="false"`, so CM6's contentEditable root cannot treat the chip's rendered text as editable document content near the caret | `src/hover.tsx` (`build_chip_dom`, `HoverWidget.toDOM`) | `tests/hover-popup.test.tsx` |
| Chip button `mousedown` is `preventDefault`'d so the native `<button>` cannot steal focus from CM's contentEditable root (caret vanish / jump after chip click) | `src/hover.tsx` (`mount_chip`) | `tests/hover-popup.test.tsx` |
| `HoverWidget.destroy(dom)` unmounts via the DOM node CM passes in — not instance fields — so decoration rebuilds that reuse DOM via `eq` still clean up `chip_registry` / popup listeners when the widget is later removed | `src/hover.tsx` (`HoverWidget`) | `tests/hover-popup.test.tsx` |

## Runtime patches (main plugin)

1. **Codeblock processor** — sequential loop; one coalesced save per paint; DOI check uses `doi_index`; citekey duplicate check uses `id_index` (case-insensitive).
2. **`save_cache` / `schedule_save_cache`** — `SaveCoalescer` (80 ms); flush on unload; flush/schedule counters.
3. **`load_cache` / `rescan_vault`** — normalize (slim source) + rebuild DOI index; rescan is chunked (32), fingerprint-incremental, progress Notice, epoch-cancel; partial harvest never commits; hard flag re-reads all files.
4. **Modify handler** — early-exit counter; fence gate before parse.
5. **EditorPrompt / PaperPanel** — live dict getters.
6. **`scan_inline_cites`** — chunked (32), active file first, progress Notice, substring reject, cancel flag.
6b. **`ensure_cite_index`** — same chunked scanner as `scan_inline_cites`, without a rename target; warms `cite_index` for panel mention-count sorting. No-op if already warm; index self-maintains incrementally afterward via the modify handler.
7. **`onunload`** — cancel scan, clear rename timers, dispose popup, unmount the shared card-manager root (which also clears any pinned cards — in-memory only, not persisted to `data.json`), flush save.
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
| Paper panel discover-mode mounts | search ≤ **80** chips (`PANEL_RESULT_CAP`); empty-query random preview ≤ **140** (`DISCOVER_RESULT_CAP`), not virtualized by design (chips need real listeners to hover) | `list_ids_for_panel`, `random_sample_ids` |
| Paper panel list-mode mounts | unbounded id list, but DOM stays viewport-sized via `visible_window` (same technique as missing-PDF) | `filtered_ids`, panel `paint_list_window` |
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
- One-root-per-chip (`src/hover.tsx`) is logic/DOM-verified (jsdom) but has **not** had a manual pass inside real Obsidian yet (Live Preview, Reading mode, paper panel under real mouse/keyboard input) — see checklist in `docs/one-root-per-chip.md` §6.
- If a chip's host re-renders with new `bibtex` data on the same element while that chip's card is open (same host, different entry — rare in practice), the open card shows stale content until close/reopen; `chip_registry` is updated but `CardManager` doesn't re-read it for an already-active id.
- Paper panel discover/list views (`src/panel.ts`) are logic-verified only — the pure helpers (`random_sample_ids`, `filtered_ids`, `compare_by_mention_count`, `cite_index_count_for`) are unit-tested, but `panel.ts` itself has no test file (same gap the pre-existing clash/missing-PDF panel code already had) and has **not** had a manual pass inside real Obsidian: toggle persistence across restart, randomize-again reshuffling, clash/missing-PDF chip coloring, and list-mode scroll virtualization are all unverified outside jsdom-adjacent unit tests.
- **Sharper flag, not just "manual pass pending":** the panel's flex-fill layout (`.bibtex-panel-root` / `.bibtex-panel-list.is-virtual`, `styles.css`) assumes Obsidian's `.view-content` resolves a definite height for the panel to fill. If that assumption is wrong, the failure mode is severe, not cosmetic — the virtualized list (list mode and missing-PDF mode, both now on this same layout) can collapse to near-zero height instead of scrolling. Missing-PDF mode previously worked under a fixed `max-height`; that cap was removed in this round, so it now shares this unverified layout too. `.bibtex-panel-root` sets both `height: 100%` and `flex: 1 1 auto; min-height: 0` defensively (covers both a percentage-height chain and a flex-parent chain), but this has not been rendered in real Obsidian — check it before relying on list/missing-PDF mode looking correct.
- **Cursor audit (UI stability officer, 2026-07-22):** three independent failure modes stacked under the same user report ("cursor unreliable near a citation chip"). Juniors had fixed only (1); (2) and (3) were still shipping.
  1. **`contenteditable="false"` missing on chip DOM** (`src/hover.tsx`) — CM6's editor root is contentEditable, so the browser could place a native caret inside the chip's rendered text at an offset with no real document meaning. Fixed earlier; covered by jsdom.
  2. **Native `<button>` focus-steal on mousedown** — chips use a real `<button>`. Clicking it focused the button and blurred CM's root, so the caret vanished and the next editor click re-placed it at an unexpected offset. Phase 4 checklist said "opening a card does not move keyboard focus out of the editor" but only the *card* avoided autoFocus; the *chip button* still stole focus. Fixed: `mousedown` `preventDefault` on the chip button (click still toggles the card; Tab+Enter still works for a11y).
  3. **`HoverWidget.destroy` ignored CM's `dom` argument** — destroy stored `this.host` from `toDOM`. After a decoration rebuild, `eq` reuses the DOM but swaps in a *new* widget instance whose `this.host` is null. When the decoration was later removed (scroll out of view, caret enters the span to edit, Source toggle), `destroy()` no-op'd: `chip_registry` and popup listeners leaked, and an open card could stay mounted against a detached anchor (zeroed rects → card jumps to 0,0). Fixed: `destroy(dom)` always calls `unmount_hover(dom)`.
- **Pinned cards** (`src/pin-registry.ts`) are logic/DOM-verified (jsdom): pin/unpin/dedup/z-order/subscribe are pure-unit-tested, and pin/unpin/multi-card/Esc-front-most are DOM-tested in `tests/hover-popup.test.tsx`. "Survives switching notes" — the user's stated acceptance criterion — is covered as far as jsdom can reach: a test pins a card, then tears down its originating chip via `unmount_hover` (the same call CM6's widget `destroy()` makes when a note's editor is torn down), and asserts the pinned card is unaffected — it lives in `pin_registry`, detached from `chip_registry`, and the portal target is `workspace.containerEl`, which is stable across leaf/note changes. What jsdom can't exercise: the actual drag *feel* (`onPointerDown`/`pointermove`/`pointerup` via real pointer capture — note each `pointermove` currently re-renders `CitationCardBody` through React state, which could be janky on a heavy card; if so, bypass React during drag and commit to the registry once on `pointerup`), real multi-card visual z-stacking, and an actual note-switch in a live Obsidian vault (not just simulated chip teardown). Needs a manual pass in real Obsidian before calling either the drag interaction or note-switch survival itself confirmed working, same posture as the rest of this session's panel/card UI work.
  - `EditorView.atomicRanges` was deliberately **not** added: edit-a-citation UX depends on the caret landing *inside* `[from, to)` so `cursor_inside_span()` derenders the chip to raw text; atomic ranges would skip the whole span in one arrow-key step and break that.
  - **Still residual (not a "broken caret", but perceived jump):** chip visual width ≠ raw `` `{id}` `` width, so arrowing into/out of a cite causes a layout shift as the replace decoration mounts/unmounts. Inherent to non-width-matched replace widgets; do not "fix" with atomic ranges.
  - All three fixes are jsdom-verified; click-to-position / arrow-into-edit-mode around a chip still needs a manual pass in real Obsidian before calling the caret issue fully closed.
- If the user types further while the one-time "Most cited" `cite_index` build is still running, that render falls back to A–Z (the index isn't warm yet) and the build finishes in the background without re-rendering; the index does get marked warm, so re-selecting "Most cited" afterward is instant — but the *current* list won't re-sort itself proactively when the build completes underneath it.
