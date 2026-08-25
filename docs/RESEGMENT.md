# Module layout (and historical review labels)

This document describes how `src/` is organized on disk. It is **not** an active upstreaming
plan and does **not** describe this repository’s git topology.

## Upstream status (read this first)

Functional review of the fork’s hardening/UX work was completed against a **separate**
repository cut that used unrelated history and a unit-branch / merge-cascade (“resegment”)
workflow. That review is **passed**. The maintainer agreed this repo may offer the full
product delta as a **draft PR** once history is cleaned up by **rebasing onto current
upstream `main`**.

Do not look here for `resegment/*` branches, cascade merge order, or per-unit PR
instructions—those lived on the review cut, not on this tree. See the README section
[Contributing this back upstream](../README.md#contributing-this-back-upstream).

## Physical layout

`src/` groups modules by concern (aligned with the README “About this fork” areas), with
one deliberate exception for Trust (below):

```
src/architecture/  settings-tab.ts, citekey-index.ts, doi-index.ts, command-modals.ts, prompt-trigger.ts
src/scale/         library-scale.ts, vault-scan.ts, debounce.ts
src/core/          cache-ops.ts, cite-span.ts
src/infra/         idle-audit.ts, save-coalesce.ts
src/display/       tex-display.ts
src/ui/            citation-card-layout.ts, citation-popup.ts, pin-registry.ts, ux-copy.ts
```

No `src/mobile/` — Mobile has no dedicated files; it is `Platform.isMobile` branches inside
`hover.tsx`, `styles.css`, and `src/architecture/settings-tab.ts`.

`main.ts`, `bibtex.ts`, `editor.ts`, `panel.ts`, `prompt.ts`, and `hover.tsx` stay at `src/`
root: each is shared across areas (`main.ts` alone imports from every subfolder). Filing any
of them under one area folder would misrepresent ownership. `styles.css` stays at the repo
root; Obsidian requires it there.

Internal imports use bare `'src/<path>'` specifiers (`tsconfig.json` `baseUrl: "."`).

### Why Trust doesn’t have a folder

The Trust story split into two coupling clusters, not one:

- `cache-ops.ts` and `cite-span.ts` sit next to the BibTeX data engine → `src/core/`
- `idle-audit.ts` and `save-coalesce.ts` are generic plugin lifecycle plumbing → `src/infra/`

Where folder name and historical review label diverge, a one-line comment marks the label:

```text
// Review unit: Trust — see docs/RESEGMENT.md.
// Review unit: Mobile — see docs/RESEGMENT.md.
```

Grep for `Review unit:` to find those sites. The labels still match the README area table;
they are not branch names in this repo.

## Historical diagram

`gallery/resegment-topology.png` is a picture of the **review cut’s** unit cascade (how that
other tree was sliced for reading). It is kept as a map of *concerns*, not as instructions
for branches that exist here.

Rough correspondence:

| Review label (historical) | On-disk home in this repo |
|---------------------------|---------------------------|
| Architecture | `src/architecture/`, plus hub wiring in `main.ts` / `prompt.ts` |
| Scale | `src/scale/`, panel list paths in `panel.ts` |
| Trust | `src/core/` + `src/infra/` (see above) |
| Display | `src/display/` |
| UI | `src/ui/`, `hover.tsx`, `styles.css` |
| Mobile | no folder — `Platform.isMobile` call sites |
| Docs & Release | README, `docs/`, version/manifest plumbing |

Scale’s vault-scan is a dependency of Trust’s clash detection (`tests/find-clashes.test.ts`);
that is a code dependency, not a merge-order rule for this repo.

## What this file used to be

Earlier drafts of this document described a permanent `resegment/*` branch set and cascade
merge into `main` for a stack of upstream PRs. That workflow applied only to the unrelated-
history review variant. This repository keeps the **folder layout** and **area labels** from
that work; it does not keep the cascade as its history model.
