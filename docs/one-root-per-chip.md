# One React root per citation chip — what to fix and why

Audience: someone comfortable with TypeScript who is new to **Obsidian plugin
development** and to **Electron**. This is a design doc, not a task list for
this branch — nothing here has been implemented. It explains a real
architectural cost in the current citation-popup code, why it exists, and what
replacing it would actually involve.

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

## 2. What the code does today

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

## 4. Why this is worth doing later, not now

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

## 5. Suggested order of work, when this is picked up

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
