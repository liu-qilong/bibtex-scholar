# Upstream candidate — BibTeX Scholar caches in O(n²)

**Plugin:** BibTeX Scholar 1.1.0 (Qilong Liu), Obsidian 1.13.7.
**Found 2026-08-24** while loading a 120k-entry bibliography into a vault.
Sibling of `UPSTREAM-GROBID.md`; same rules — measured, reproducible, no patch offered until
someone upstream wants one.

## Symptom

A vault with **119,992 BibTeX entries** across 28 notes indexes **218 of them** and then
becomes unusable. Not slow — stuck. The 27 notes holding 118,149 external entries never
contribute a single cached entry, because Obsidian never finishes rendering the *first*
file.

## Cause, from `main.js`

`bibtex_codeblock_processor` runs **once per ```bibtex block, at render time**:

```js
(!this.cache.bibtex_dict[i] || this.cache.bibtex_dict[i].source != u) && (
    this.cache.bibtex_dict[i] = {fields: l, source: u, source_path: r.sourcePath},
    await this.save_cache()          //  <-- the whole cache, every new block
)
```

and `save_cache()` is `await this.saveData(this.cache)` — a full serialisation of every entry
seen so far, to `data.json`.

**So importing n entries writes the cache n times, growing each time.** Measured on this
vault: `data.json` is 180,623 bytes for 218 entries = **828 bytes per entry**. Total bytes
written to import n entries is therefore about `828·n²/2`:

| entries | one-time disk written |
|---|---|
| 1,000 | 0.4 GB |
| 1,843 (this library's own papers) | 1.4 GB |
| 10,000 | 41 GB |
| 120,000 | **~6 TB** |

That is why it stalls at 217 of 1,843 in a single file. It is not a size limit, a parse
failure, or a memory problem; it is quadratic I/O.

**A second quadratic, smaller but real.** The duplicate-ID check `G7` builds a `RegExp` and
scans the **entire note's source text** for every block in that note:

```js
let l = new RegExp(`@[a-zA-Z]+{${a(t)},`, "g"), i = 0;
for (; l.exec(r.replace(/\n/g, "")) !== null;) if (i++, i > 1) return !0;
```

`r` is the whole section text, and `.replace(/\n/g,"")` copies it per block. For a note with
k blocks this is O(k · notesize). This one *is* fixed by splitting into smaller notes; the
`save_cache` one is not, because that cache is global.

## Fixes, in order of how little they change

1. **Debounce or batch `save_cache()`.** The correctness requirement is that the cache
   survives a restart, not that it is on disk between two blocks of the same render pass. A
   trailing debounce of a second or two turns n writes into one per render and removes the
   quadratic entirely. Smallest possible change.
2. **Build the duplicate index once per note** instead of a regex per block — a `Set` of the
   IDs in the note, computed on entry.
3. **Offer a bulk import path** that reads a `.bib` file directly into `data.json` rather
   than by rendering markdown. The render-driven design also means *entries only exist once
   their note has been opened*, which is surprising in its own right: a citation to a work
   whose bibliography note has never been viewed silently fails to resolve.

## What we did instead

Not a workaround for upstream — just what this project settled on, for the record. We cap
what goes into the vault (owned papers, plus a bounded tier of the most-cited external
works) and split bibliography notes **by year**, which bounds the `G7` cost and makes entries
findable. The 120k full set stays in `instance/bibtex/refs.bib`, where it was always usable.

## Reproducing

```bash
# any vault, plugin installed
python3 - <<'PY'
import pathlib
p = pathlib.Path("bulk.md"); n = 5000
p.write_text("\n\n".join(
    "```bibtex\n@article{k%d,\n  title = {{T%d}},\n  year = {2020},\n}\n```" % (i, i)
    for i in range(n)))
PY
# open bulk.md in Obsidian, then watch .obsidian/plugins/bibtex-scholar/data.json
# grow while the note never finishes rendering
```
