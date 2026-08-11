# Branch topology: reviewable units instead of one long history

`main` is built as a merge cascade of independent unit branches rather than a single linear
sequence of commits. This exists so the fork can be reviewed (and eventually upstreamed) as a
stack of PRs organized around the same areas the README's "About this fork" table describes —
Architecture, Scale, Trust, Display, UI, Mobile, plus a trailing Docs & Release unit — instead of
as one large diff. See the ["Reviewing this as a stack of PRs"](../README.md#reviewing-this-as-a-stack-of-prs)
section in the README for the rationale and a rendered picture.

The `resegment/*` branches are the permanent markers for this: each one is where a given piece of
functionality actually lives, and they're what `gallery/resegment-topology.png` visualizes.

## Topology

```
53e9751 (main's root commit — untagged)
│
├── unit-architecture   harness, settings-extraction, index-infra, command-modals, hub main/prompt
├── unit-scale          perf-virtualization, search-ranking, hub panel
├── unit-trust          cursor-cache-durability, collision-detection, hub editor/bibtex
├── unit-display        tex-display
├── unit-ui             floating-popup, one-root-per-chip, card-visual-rework, pin-drag,
│                       hover-popup tests, hub hover/styles (UI content, mobile carved out)
│     │
│     └── unit-mobile = unit-ui + one commit restoring tip hover.tsx/styles.css
│                       (stacked on unit-ui rather than base — see Limitations)
└── unit-docs-release   README, roadmap, docker/manifest plumbing
        │
        ▼ cascade merge order: Architecture → Scale → Trust → Display → UI → Mobile → Docs & Release
        ▼
main (tree identical to the original 45-commit history's tip, 0f798ec9…)
```

`resegment/sub-*` and `resegment/leaf-*` branches are the finer-grained pieces each unit branch is
merged from (a `sub-*` name marks a genuinely independent sub-concern the plan called out in
advance; `leaf-*` marks a piece added while building — mostly whole-file hub content and
harness/docs bits). Run `git branch --list 'resegment/*'` for the full set, or
`git log --first-parent --oneline main` for the cascade spine.

## Physical layout

`src/` mostly mirrors the review units as folders, so code that's reviewed and merged
independently is also organized independently on disk — with one deliberate exception (`trust/`,
below):

```
src/architecture/  settings-tab.ts, citekey-index.ts, doi-index.ts, command-modals.ts, prompt-trigger.ts
src/scale/         library-scale.ts, vault-scan.ts, debounce.ts
src/core/          cache-ops.ts, cite-span.ts
src/infra/         idle-audit.ts, save-coalesce.ts
src/display/       tex-display.ts
src/ui/            citation-card-layout.ts, citation-popup.ts, pin-registry.ts, ux-copy.ts
```

No `src/mobile/` — Mobile has no dedicated files; it's `Platform.isMobile` branches inside
`hover.tsx`, `styles.css`, and `src/architecture/settings-tab.ts` (see Limitations below).

### Why Trust doesn't have a folder

The four files originally filed together as "Trust" split on inspection into two structurally
different clusters, not one: `cache-ops.ts` and `cite-span.ts` are tightly coupled to the BibTeX
data engine (`bibtex.ts`, `citekey-index.ts`, `doi-index.ts`) — they moved to `src/core/`.
`idle-audit.ts` and `save-coalesce.ts` have zero BibTeX-domain imports at all; they're generic
plugin-lifecycle plumbing that would look at home in almost any Obsidian plugin — they moved to
`src/infra/`. Grouping by review-unit story and grouping by actual coupling aren't always the same
axis, and here they genuinely diverged.

Because the physical location no longer encodes which review unit a file came from, each of these
four files (and every `Platform.isMobile` call site, since Mobile has no folder at all) carries a
one-line `// Review unit: <Unit> — see docs/RESEGMENT.md.` comment, so the mapping back to
`resegment/unit-trust`/`resegment/unit-mobile` stays traceable without relying on folder names.
Grep for `Review unit:` to find every such site.

`main.ts`, `bibtex.ts`, `editor.ts`, `panel.ts`, `prompt.ts`, and `hover.tsx` stay at `src/` root:
each is imported by multiple units — `main.ts` alone pulls from all five subfolders — so filing any
one of them under a single unit's folder would misrepresent it as owned by that unit rather than
shared across all of them. `styles.css` stays at the repo root; Obsidian requires it there.

All internal imports use bare `'src/<path>'` specifiers resolved via `tsconfig.json`'s
`baseUrl: "."`, so this was a pure file-location change — no build or test config needed updating.

## Why Scale lands before Trust

Cascade order mostly follows the README table, with one deliberate exception:
`src/scale/vault-scan.ts` (Scale) is consumed by Trust's clash-detection feature
(`tests/find-clashes.test.ts`), so Scale merges first. If a unit fails to build standalone because
it references a module owned by a "later" unit, that's a sign the dependency or the hunk is
misplaced — promote the dependency earlier rather than adding a shim.

## Verifying tree parity

The cascade's entire point is that recombining the units loses nothing. That's a property of a
specific cascade-tip commit, not something `main` maintains automatically as new commits land on
top of it — re-check after any change to the cascade itself:

```bash
git rev-parse <cascade-tip>^{tree}   # e.g. main's tip right after the cascade was built: e75f282
git rev-parse origin/main^{tree}     # origin/main is a squashed single commit; trees should match
```

## Known limitations

- Most files that existed before this fork (`main.ts`, `bibtex.ts`, `editor.ts`, `panel.ts`,
  `prompt.ts`, `README.md`) are whole-file leaves, not hunk-split — a unit branch's diff against
  `53e9751` for these files is the full base→tip change, not just that unit's slice. Only
  `hover.tsx` and `styles.css` were split further, to isolate the mobile delta. Finer splits are
  possible (`git checkout --patch <tip> -- <path>` against `53e9751` walks a file's diff
  hunk-by-hunk) but weren't needed for the current unit boundaries.
- `unit-mobile` is stacked on `unit-ui`, not on bare `base`: the reviewable mobile delta
  (`git diff resegment/unit-ui resegment/unit-mobile`) only makes sense with UI's styles as
  context. The cascade still merges Mobile after UI and lands on the same final tree.
- A few mobile-related changes live outside `unit-mobile` because they're not really
  platform-specific: `src/architecture/settings-tab.ts`'s `Platform.isMobile` guard (Architecture)
  and some `src/scale/library-scale.ts`/`panel.ts` font-scaling tweaks (Scale).
- Only `main` (the fully cascaded result) is guaranteed to pass `npm run build && npm test`.
  Individual unit/sub/leaf branches before their merge are not standalone-buildable in every case.
