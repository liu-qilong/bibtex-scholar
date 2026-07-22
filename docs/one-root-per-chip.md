# One React root per citation chip — what to fix and why

Audience: someone comfortable with TypeScript who is new to **Obsidian plugin
development** and to **Electron**. This explains a real architectural cost
that used to exist in the citation-popup code, why it existed, and what
replacing it involved.

**Status: implemented 2026-07-22.** Sections 1–3 below describe the problem
and the target shape as originally scoped; section 6 records what actually
shipped and how it differs from the original plan. Sections 4–5 (the "why
later" reasoning and suggested work order) are kept as historical context —
the blast-radius concerns in section 4 turned out to be manageable in one
pass, listed in section 6.

**Verification caveat:** this landed as a logic/DOM-behavior refactor,
verified via `tests/hover-popup.test.tsx` (jsdom + `@testing-library/react`)
and `tsc`/`esbuild` production build — both green. It has **not** been through
a manual pass inside real Obsidian (Live Preview, Reading mode, paper panel,
under actual mouse/keyboard input). jsdom is a strong proxy for open/close/
position/swap logic, but the refactor's actual payoff — idle-memory and
listener-count reduction under high citation density in a live editor — is
not something jsdom measures. Do a manual pass (checklist in section 6) before
treating this as fully verified.

---

## 1. Some context you need first

**Obsidian plugins run inside Electron's renderer process.** That's just a
Chromium tab with extra Node.js APIs available — the same JS engine, the same
DOM, the same `document`/`window` you'd get in a browser. Nothing about
"Electron" makes UI code here behave differently from a web app. You will not
find Electron-specific APIs in this plugin's UI code, and you don't need any
to understand this doc.

**Obsidian does not ship React.** The app itself is not built with React, and
it exposes no React runtime to plugins. If a plugin wants to use React (this
one does, for the citation card), it must bundle its own private copy of
`react` + `react-dom` into its output file. That's why `esbuild.config.mjs`
marks `obsidian` and `electron` as `external` (Obsidian provides those at
runtime — don't bundle them) but does **not** mark `react`/`react-dom` as
external — those get compiled straight into `main.js`. Every plugin that uses
React pays this bundling cost independently; there is no shared instance.

**A "React root" is not free.** `createRoot(container)` (from `react-dom/client`)
is React's entry point into one DOM subtree. Each root owns its own fiber
tree, its own scheduler hooks, and keeps alive whatever closures your
components captured (event handlers, `useEffect` cleanups, refs). Calling
`createRoot` many times means many independent, unrelated React
"applications" living in the same page side by side — as opposed to **one**
application that happens to render many components. The idiomatic use of
React (and the one that scales) is one root per page/panel, many components
under it.

**CodeMirror 6 doesn't know React exists.** Obsidian's Live Preview editor is
built on CodeMirror 6, which has its own widget model
(`WidgetType.toDOM()` / `.eq()` / `.destroy()`, see `@codemirror/view`) for
inline replacement content — completely separate from, and unaware of,
React's component lifecycle. Bridging the two requires manual glue: something
has to call `createRoot` when a widget's DOM is created and `.unmount()` when
it's destroyed. That glue is exactly where today's design went.

---

## 2. What the code used to do (historical — see section 6 for what shipped)

Every citation chip — one per `` `{id}` `` / `` `[id]` `` in a note, plus one
per entry in a `bibtex` code block, the paper panel list, and search results —
is its own independent React application:

- `mount_hover_tree()` (`src/hover.tsx:561`) calls `createRoot(el)` and mounts
  a `<HoverPopup>` tree into `el`. It's memoized per-element via
  `hover_roots` (`src/hover.tsx:559`, a `WeakMap<HTMLElement, Root>`), so a
  *re-render* of the same host element reuses its root — but a *new* chip
  anywhere in the document always gets a **new** root.
- Three call sites each make a fresh host element and call this: the
  `bibtex` code-block processor and inline reference processor in
  `src/main.ts`, the paper panel list in `src/panel.ts`, and — the one that
  matters most for typical notes — `HoverWidget.toDOM()`
  (`src/hover.tsx:654`), the CodeMirror widget instantiated once **per cite
  span, per visible range, per document**.
- Teardown mirrors this 1:1: `HoverWidget.destroy()` calls `unmount_hover()`
  (`src/hover.tsx:586`), `HoverRenderChild.onunload()`
  (`src/hover.tsx:629`) does the same for reading-view/codeblock/panel
  mounts.

So a note with 40 citations in view has **40 separate React roots**, each with
its own fiber tree, its own `useState`/`useEffect` closures, and — while its
card happens to be open — its own `ResizeObserver` and a document-level
`pointerdown` capture listener (see `HoverPopup`'s effects in
`src/hover.tsx`). `citation_popup` (`src/citation-popup.ts`) already
centralizes the *logic* of "which one is open" into a single controller
singleton; the *rendering*, however, is still fully decentralized.

This isn't broken — `citation_popup`'s one-global-open invariant keeps it
correct, and the test suite (`tests/hover-popup.test.tsx`,
`tests/citation-popup.test.ts`) confirms the behavior holds. It's a cost
that scales with citation density: more chips visible → more roots alive →
more idle listeners and memory, even though at most one card is ever open at
a time.

---

## 3. The target shape

Since `citation_popup` already knows the single source of truth — "which
instance id is active" — the fix is to stop giving every chip the ability to
render a card, and instead let **one** root, shared by the whole plugin, do
that job for whichever chip is currently active.

```
Today:                              Target:

 chip 1 → React root 1 (idle)        chip 1 → plain DOM node  ─┐
 chip 2 → React root 2 (OPEN)        chip 2 → plain DOM node  ─┼─ registry
 chip 3 → React root 3 (idle)        chip 3 → plain DOM node  ─┘     │
   ...                                                               ▼
 chip N → React root N (idle)                         ONE shared root
                                                        renders 0-or-1 card,
                                                        looked up by active id
```

Concretely:

1. **Chips stop being React components.** A chip is just a small button with
   an id and some text — it doesn't need component state, hooks, or a fiber
   tree of its own. Render it with plain DOM calls
   (`document.createElement('button')`, set `textContent`/`aria-*`
   attributes, attach `mouseenter`/`mouseleave`/`click` listeners that call
   `citation_popup.enter_trigger(id)` etc. directly). This is the same shape
   `HoverWidget.toDOM()` already has to satisfy for CodeMirror — it just
   currently delegates that DOM-building to React unnecessarily.

2. **Add a chip registry.** A single `Map<instance_id, { anchor: HTMLElement,
   bibtex: BibtexElement, plugin: BibtexScholar, app: App }>`, populated when
   a chip is created and deleted when it's torn down (CM `destroy()`,
   `HoverRenderChild.onunload()`, panel `unmount_hover_hosts`). This replaces
   what the per-chip React closures currently hold onto implicitly.

3. **One root, created once.** Lazily create a single `createRoot()` under
   `app.workspace.containerEl` (same portal target as today) — once per
   plugin instance, not once per chip. It renders a `<CardManager>` that
   subscribes to `citation_popup` the same way `HoverPopup` does today
   (`citation_popup.register(id, listener)`), but instead of *being* the
   card, it looks up `citation_popup.get_active_id()` in the registry and
   renders the (single) `<CitationCardBody>` for whichever chip that
   resolves to, positioned against that chip's `anchor` element using the
   existing pure `src/citation-card-layout.ts` math.

4. **Teardown gets simpler, not harder.** Only one root to ever unmount
   (on plugin `onunload`), instead of tracking N. Removing a chip from the
   registry while its card is open should also tell `citation_popup` to
   close it (chip left the document — nothing to point the card at anymore).

The pure logic added this round — `src/citation-card-layout.ts` and
`src/citation-popup.ts` — carries over untouched; this refactor only changes
*how many roots render the result*, not the open/close/placement rules
themselves.

---

## 4. Why this was worth deferring (historical — it was picked up; see section 6)

- It touches the CodeMirror widget (`src/editor.ts`, `HoverWidget` in
  `src/hover.tsx`), the codeblock/inline processors (`src/main.ts`), and the
  panel (`src/panel.ts`) — every mount site changes shape. That's a wider
  blast radius than anything in this round.
- It changes a working, tested interaction model. The payoff (idle-memory /
  listener count under high citation density) is real but only matters at a
  scale most vaults won't hit — this is an optimization for the tail, not a
  correctness fix.
- It's exactly the kind of change that needs the DOM-behavior test coverage
  added this round (`tests/hover-popup.test.tsx`) as a safety net *before*
  starting — that test file already exercises open/close/flip through the
  public `render_hover()` surface, so it can be pointed at whichever new
  mount path replaces today's per-chip root without rewriting the
  assertions.

## 5. Suggested order of work (historical — see section 6 for the order actually used)

1. Add the chip registry + a no-op `<CardManager>` (renders nothing yet)
   alongside the existing per-chip roots, so both can be exercised
   side by side.
2. Switch `HoverWidget` (the CodeMirror path — highest chip density) to the
   plain-DOM chip + registry, backed by the new manager root. Verify against
   `tests/hover-popup.test.tsx` and a manual Live Preview pass.
3. Migrate the remaining mount sites (codeblock/inline processors in
   `src/main.ts`, panel list in `src/panel.ts`) the same way.
4. Delete `mount_hover_tree`, `hover_roots`, and the per-chip `<HoverPopup>`
   component once nothing references them.

---

## 6. What actually shipped (2026-07-22)

Landed in one pass rather than the staged rollout in section 5 — all mount
sites (`HoverWidget` in `src/editor.ts`'s CM path, the codeblock/inline
processors in `src/main.ts`, and the panel list in `src/panel.ts`) already
went through the same three entry points (`render_hover`, `HoverRenderChild`,
`unmount_hover_hosts`), so switching what those entry points do internally
covered every call site at once — no per-site migration needed, and no
parallel old/new code path to delete afterward.

### Shape, as built

- **Chip = plain DOM**, built by `build_chip_dom()` in `src/hover.tsx`
  (`span.bibtex-hover > span.bibtex-hover-chip > button`) — no component, no
  hooks, no fiber tree. `mount_chip()` wires `mouseenter`/`mouseleave`/`click`
  listeners straight to `citation_popup` and updates `aria-expanded`/
  `aria-controls` directly via the existing `citation_popup.register(id, listener)`
  callback (unchanged controller API — only the listener body changed from a
  React state setter to direct DOM attribute writes).
- **Chip registry**: `chip_registry: Map<instance_id, { anchor, bibtex, plugin, app }>`
  (module-level in `src/hover.tsx`, not a separate file — small enough to keep
  next to the manager that reads it). `chip_hosts: WeakMap<HTMLElement, ChipHost>`
  tracks host-element → chip identity so a re-render of the same host reuses
  its instance id instead of minting a new one (same reuse contract
  `mount_hover_tree`/`hover_roots` used to provide).
- **One root, created lazily**: `ensure_card_manager(app)` creates a single
  hidden host under `app.workspace.containerEl` and mounts `<CardManager>`
  into it once; every later `mount_chip()` call is a no-op on this front.
  `CardManager` renders 0-or-1 `<CardShell>` for whichever id
  `citation_popup.get_active_id()` reports, looked up in `chip_registry`, and
  portals it — same portal target as before.
- **`CardShell`** is the old `HoverPopup`'s card half (positioning effect,
  click-outside effect, ESC handler, `<CitationCardBody>`) extracted
  unchanged in substance, just reading its anchor from the registry entry
  instead of a local `chip_ref`.
- **Teardown**: `unmount_hover(el)` now unregisters from `chip_registry` +
  `citation_popup` and clears the host's DOM, instead of `root.unmount()`.
  `unmount_card_manager()` is the new one-time teardown for the shared root
  itself, called from `BibtexScholar.onunload()` (mirrors the existing
  `citation_popup.dispose()` call there) and from `tests/hover-popup.test.tsx`'s
  `afterEach` (each test needs a fresh manager bound to its own fake
  `app`/portal, since the real plugin only ever has one `app` for its whole
  lifetime but tests construct a new fake one per case).

### One controller change this required

`CitationPopupController` gained `subscribe_active(listener)` — separate from
the existing per-id `register(id, listener)` — because `CardManager` needs to
know "who is active now", not "am I active", which nothing in the old API
expressed. It fires immediately with the current active id on subscribe (same
convention `register` already used) and again on every change. The immediate-fire
part is load-bearing, not cosmetic: without it, a chip that calls
`open_for_expand()` synchronously right after `ensure_card_manager()` creates
the manager root can fire before `CardManager`'s subscribing effect has run
(React defers passive effects a tick), and the card would silently never
appear. `tests/citation-popup.test.ts` covers both the immediate-fire-on-subscribe
and fire-on-every-change behavior directly on the controller.

### Deviations from the original plan

- No parallel "no-op CardManager alongside the old roots" step (section 5,
  step 1) — went straight to the real one, verified by the existing DOM test
  file plus one new test, rather than incrementally.
- `chip-registry` was not split into its own file — it's ~10 lines of
  module state that only `CardManager`/`mount_chip` touch; a separate file
  would just add an import hop.

### Known gap, not chased

If a chip's host element is re-rendered with new `bibtex` data (same host,
different entry — rare; markdown re-renders normally get a fresh host)
**while that chip's card is currently open**, the open card keeps showing
the pre-update snapshot until it closes and reopens — `mount_chip`'s reuse
path updates `chip_registry` but doesn't trigger `CardManager` to re-read it
for an already-active id. The old per-chip-props model would have refreshed
reactively. Low-value edge case; revisit only if it turns out to matter in
practice.

### Test coverage added

- `tests/citation-popup.test.ts`: `subscribe_active` fires immediately with
  the current value and on every subsequent open/close; fires immediately
  with the already-active id when subscribing mid-open.
- `tests/hover-popup.test.tsx`: all pre-existing open/close/debounce/
  click-outside/ESC/flip assertions kept passing unmodified against the new
  mount path (only the `mount()` test helper was refactored, to share one
  `app`/portal across chips — no assertion changed), **plus** a new case:
  two chips under the same shared root, click the first (its card renders,
  content matches), click the second (exactly one card in the portal at all
  times, old content gone, new content present, `aria-expanded` flips on
  both buttons) — the actual card-swap reconciliation this refactor exists to
  make correct, which the old N-roots design never had to do.

### Manual verification checklist (not yet run)

- [ ] Live Preview: hover/click several cite chips in one note; only one
      card ever shows; positioning/flip looks right near viewport edges.
- [ ] Reading mode and `` ```bibtex `` blocks: chips render and open the same way.
- [ ] Paper panel: open a chip's card from the dense list, scroll/search —
      card follows or closes sanely, no leaked cards after re-search.
- [ ] Close a note / navigate away with a card open — no stuck floating card.
- [ ] Toggle the plugin off (`onunload`) with a card open — no console errors,
      no leaked listeners on reload.
