import { App, Modal, ButtonComponent, Setting, Notice, requestUrl } from 'obsidian'
import type BibtexScholar from 'src/main'
import { copy_to_clipboard } from 'src/hover'
import { normalize_for_search, search_tokens, token_matches_haystack } from 'src/tex-display'

/**
 * Represents a single BibTeX entry field.
 * @property {string} type - The type of the BibTeX entry (e.g. article, book, etc.)
 * @property {string} id - The unique identifier for the BibTeX entry.
 * @property {string} [key] - The other fields associated with the BibTeX entry (e.g. author, title, year, etc.)
 */
export interface BibtexField {
    type: string,
    id: string,
    [key: string]: string,
}

/**
 * Represents a single BibTeX element, which includes the main BibTeX fields
 * as well as any additional data associated with a paper.
 * @property {BibtexField} fields - The BibTeX fields for the entry (e.g., type, id, author, title).
 * @property {string} [source] - Optional raw BibTeX; omit when reconstructible via {@link entry_source}.
 * @property {string} source_path - The file path to the BibTeX source.
 * @property {number} [source_line] - 0-based line of the ```bibtex block (incremental rescan sort).
 * @property {any} [key: string] - Any other data associated with the paper, accessible by key (e.g. abstract, keywords).
 */
export interface BibtexElement {
    fields: BibtexField,  // bibtex fields (abstracts stay here — free-text search is opt-in via abstract:)
    source?: string,
    source_path: string,
    source_line?: number,
    [key: string]: any,  // other data associated to the paper
}

/**
 * Represents a dictionary (map) of BibTeX elements, indexed by their citation key or unique identifier.
 * The key is typically the BibTeX citation key, and the value is the associated BibtexElement.
 */
export interface BibtexDict {
	[key: string]: BibtexElement
}

export type ClashReason = 'DOI' | 'citeKey'
export type ClashHit = { id: string, path: string, line: number, doi?: string }
/**
 * Generic over the hit type so callers that scan with richer hits (e.g.
 * `ScanHit`, which also carries `fields`) get that data back on `members`
 * without a cast — `find_clashes` never rebuilds hit objects, it only groups
 * and sorts the references it's given.
 */
export type Clash<H extends ClashHit = ClashHit> = { reasons: ClashReason[], members: H[] }

/** Backticked inline cites: `{id}` or `[id]` (same as cp_std_md). */
export const INLINE_CITE_RE = /`(\{|\[)([^\}\]]+)(\}|\])`/g

/**
 * Case-fold a citekey for internal matching only (duplicate checks, clash
 * grouping, inline-cite resolution). Users type citekeys however they like —
 * the literal casing they typed is always what gets stored/displayed.
 */
export function normalize_id(id: string): string {
    return id.toLowerCase()
}

export function same_paper(a: BibtexField, b: BibtexField): boolean {
    if (a.doi && b.doi) {
        return a.doi === b.doi
    }
    const n = (s?: string) => (s || '').trim().toLowerCase()
    return n(a.title) === n(b.title)
        && n(a.author) === n(b.author)
        && n(a.year) === n(b.year)
}

/**
 * Greedily match cached entries that vanished from a file's current text
 * against entries newly present in it — a citekey rename in progress.
 * `resolve_owner_path` should return the source_path of whatever cache entry
 * currently owns a candidate new id, if any; a candidate already owned by a
 * different file is rejected (that id is genuinely taken, not just renamed).
 * `via` is `'doi'` only when both sides carry the same immutable DOI;
 * otherwise the match is fuzzy (title/author/year).
 */
export function match_citekey_renames(
    cached: [string, BibtexField][],
    current: BibtexField[],
    file_path: string,
    resolve_owner_path: (id: string) => string | undefined,
): { old_id: string, new_id: string, via: 'doi' | 'fuzzy' }[] {
    const current_ids = new Set(current.map((f) => f.id))
    const used_new = new Set<string>()
    const out: { old_id: string, new_id: string, via: 'doi' | 'fuzzy' }[] = []
    for (const [old_id, fields_old] of cached) {
        if (current_ids.has(old_id)) continue
        for (const fields of current) {
            if (fields.id === old_id || used_new.has(fields.id)) continue
            if (!same_paper(fields_old, fields)) continue
            const owner_path = resolve_owner_path(fields.id)
            if (owner_path !== undefined && owner_path !== file_path) continue
            const via = fields_old.doi && fields.doi ? 'doi' : 'fuzzy'
            out.push({ old_id, new_id: fields.id, via })
            used_new.add(fields.id)
            break
        }
    }
    return out
}

/**
 * A paint-time "duplicate" is actually an in-place rename-in-progress when the
 * conflicting owner lives in this same file and its old citekey has already
 * disappeared from the file's current text — i.e. nothing else in this note
 * still refers to it, so it can't be a genuine two-entries-one-DOI clash.
 * `current_ids` is every citekey parsed from the file's ```bibtex blocks right
 * now (case-sensitive is fine here — callers pass raw ids, matched by exact
 * string membership against `owner_id`).
 */
export function is_pending_same_file_rename(
    owner_entry: BibtexElement | undefined,
    owner_id: string,
    current_id: string,
    file_path: string,
    current_ids: Set<string>,
): boolean {
    if (!owner_entry || owner_id === current_id) {
        return false
    }
    return owner_entry.source_path === file_path && !current_ids.has(owner_id)
}

/**
 * 0-based [start, end] line span of the ```bibtex fence block that currently
 * contains citekey `id` in `body` — or undefined if no such block exists.
 * Used to check whether the caret is still inside the block being renamed,
 * so an automatic rename (mutating the vault) waits until the user has
 * actually moved on rather than firing mid-edit.
 */
export async function find_bibtex_block_line_range(
    body: string,
    id: string,
): Promise<{ start: number, end: number } | undefined> {
    const block_re = /```bibtex[^\n]*\n([\s\S]*?)```/g
    let match: RegExpExecArray | null
    while ((match = block_re.exec(body)) !== null) {
        const fields = await parse_bibtex(match[1])
        if (fields.some((f) => f.id === id)) {
            const start = body.slice(0, match.index).split('\n').length - 1
            const end = start + match[0].split('\n').length - 1
            return { start, end }
        }
    }
    return undefined
}

/**
 * Rewrite the defining `@type{old_id,` header inside a ```bibtex fence to
 * `new_id`. A no-op wherever `old_id` isn't the fence's own citekey — safe to
 * call unconditionally. `rename_citekey`'s forward path relies on the user
 * having already typed `new_id` into the fence themselves (a no-op here);
 * Undo runs the rename in reverse with no one to edit the fence by hand, so
 * it needs this to keep the fence, cache, and inline cites in agreement.
 */
export function replace_bibtex_fence_citekey(content: string, old_id: string, new_id: string): string {
    const escaped = old_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const header_re = new RegExp(`(@[a-zA-Z]+\\{)${escaped}(,)`)
    const fence = /```bibtex[^\n]*\n[\s\S]*?```/g
    return content.replace(fence, (block) => block.replace(header_re, `$1${new_id}$2`))
}

/** Replace `{old}` / `[old]` outside ```bibtex fences. */
export function replace_inline_citekey(content: string, old_id: string, new_id: string): string {
    const fence = /```bibtex[^\n]*\n[\s\S]*?```/g
    let out = ''
    let last = 0
    let m: RegExpExecArray | null
    while ((m = fence.exec(content)) !== null) {
        out += replace_cites_chunk(content.slice(last, m.index), old_id, new_id)
        out += m[0]
        last = m.index + m[0].length
    }
    out += replace_cites_chunk(content.slice(last), old_id, new_id)
    return out
}

function replace_cites_chunk(text: string, old_id: string, new_id: string): string {
    const norm_old = normalize_id(old_id)
    return text.replace(/`(\{|\[)([^\}\]]+)(\}|\])`/g, (match, open, id, close) =>
        normalize_id(id) === norm_old ? `\`${open}${new_id}${close}\`` : match
    )
}

export type CiteHit = { path: string, count: number }

export class RenameCitekeyModal extends Modal {
    old_id: string
    new_id: string
    hits: CiteHit[]
    on_apply: () => Promise<void>

    constructor(app: App, old_id: string, new_id: string, hits: CiteHit[], on_apply: () => Promise<void>) {
        super(app)
        this.old_id = old_id
        this.new_id = new_id
        this.hits = hits
        this.on_apply = on_apply
    }

    onOpen() {
        const { contentEl } = this
        const total = this.hits.reduce((s, h) => s + h.count, 0)

        contentEl.createEl('h4', { text: 'Rename citekey' })
        contentEl.createEl('p', { text: `${this.old_id} → ${this.new_id}` })
        contentEl.createEl('p', {
            text: `${total} inline citation(s) in ${this.hits.length} file(s)`,
        })

        const list = contentEl.createEl('ul')
        for (const h of this.hits.slice(0, 10)) {
            list.createEl('li', { text: `${h.path} (${h.count})` })
        }
        if (this.hits.length > 10) {
            contentEl.createEl('p', { text: `…and ${this.hits.length - 10} more` })
        }

        new Setting(contentEl)
            .addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()))
            .addButton((btn) => btn
                .setButtonText('Apply')
                .setCta()
                .onClick(async () => {
                    await this.on_apply()
                    this.close()
                }))
    }

    onClose() {
        this.contentEl.empty()
    }
}

/**
 * Parses a BibTeX string and extracts its fields.
 * @param {string} bibtex_source - The BibTeX source string to parse. P.S. it could contains multiple BibTeX entries.
 * @param {boolean} [lower_case_type=true] - Whether to convert the BibTeX entry type to lower case.
 * @returns {Promise<BibtexField[]>} - A promise that resolves to an array of BibtexField objects.
 */
export async function parse_bibtex(bibtex_source: string, lower_case_type: boolean = true): Promise<BibtexField[]> {
    // match type, id, & fields
    // p.s. no @ string in the fields!
    const entry_regex = /@([a-zA-Z]+){([^,]+),([^@]*)}/g
    let match
    let fields_ls: BibtexField[] = []

    while ((match = entry_regex.exec(bibtex_source.replace(/\n/g, '').replace(/\s+/g, ' '))) !== null) {
        let fields: BibtexField = {
            type: match[1],
            id : match[2],
        }

        let fields_str = match[3]

        // parse bibtex fields
        let mode = 'key'
        let store = ''
        let max_layer = 0
        let stack: string[] = []
        let keys: string[] = []
        let values: string[] = []

        for (let [idx, char] of [...fields_str].entries()) {
            if (mode === 'key') {
                // parsing the key of a field
                if (char === '=') {
                    keys.push(store.replace(/^[, ]+/, '').replace(/[, ]+$/, ''))
                    store = ''
                    mode = 'value'
                } else {
                    store += char
                }
            } else if (mode === 'value') {
                // parsing the value of a field
                store += char

                if (char === '{') {
                    stack.push(char)
                    max_layer += 1

                    // if the value has {} pairs, remove the outmost {
                    if (max_layer === 1) {
                        store = ''
                    }
                } else if (char === '}') {
                    stack.pop()
                    
                    // if the value has {} pairs, discard the outmost }
                    if (stack.length === 0) {
                        store = store.slice(0, -1)
                    }
                }

                if ((max_layer > 0 && stack.length === 0) || (max_layer === 0 && (char === ',' || char === '}' || idx === fields_str.length - 1))) {
                    // when the field has {} pairs, complete parsing when the '{' stack is empty
                    // when the field has no {} layers, complete parsing when the ',' or '}' is encountered or the string ends
                    let value = store.replace(/^[ ]+/, '').replace(/[, ]+$/, '')

                    if (value[0] === '{' || value[-1] === '}') {
                        value = `"${value}"`
                    }

                    values.push(value)
                    store = ''
                    max_layer = 0
                    mode = 'key'
                }
            }
        }
        
        keys.map((key, idx) => { fields[key.toLowerCase()] = values[idx] })

        // if lower_case_type is true, convert bib_type to lower case
        if (lower_case_type === true) {
            fields['type'] = fields['type'].toLowerCase()
        }

        fields_ls.push(fields)
    }

    return fields_ls
}

/**
 * Generate a BibTeX string from the given fields.
 * @param fields - The BibTeX fields to include in the entry.
 * @param include_abstract - Whether to include the abstract field, default is true. P.S. When the generated BibTex string will be used for LaTeX, don't include the abstract, otherwise it may cause issues due to some special characters.
 * @returns The generated BibTeX string.
 */
export function make_bibtex(fields: BibtexField, include_abstract: Boolean = true): string {
    let bibtex = `@${fields.type}{${fields.id},\n`

    for (let key in fields) {
        if (key === 'type' || key === 'id') {
            continue
        }
        if (key === 'abstract' && !include_abstract) {
            continue
        }
        bibtex += `  ${key} = {${String(fields[key]).replace(/&amp;/g, '\\&')}},\n`
    }

    bibtex += '}\n'

    return bibtex
}

/**
 * BibTeX source for an entry: prefer stored `source`, else rebuild from fields.
 * Hot cache may omit `source` (SPEED S3) because it is reconstructible.
 */
export function entry_source(
    entry: Pick<BibtexElement, 'fields' | 'source'>,
    include_abstract: boolean = true,
): string {
    if (typeof entry.source === 'string' && entry.source.length > 0) {
        return entry.source
    }
    return make_bibtex(entry.fields, include_abstract)
}

/**
 * Check if a BibTeX entry ID is duplicated within a file or across different files.
 * @param bibtex_dict - The dictionary of BibTeX entries.
 * @param id - The ID of the BibTeX entry to check.
 * @param file_path - The path of the file to check.
 * @param file_content - The content of the file to check.
 * @returns True if the ID is duplicated, false otherwise.
 */
export function check_duplicate_id(
    bibtex_dict: BibtexDict,
    id: string,
    file_path: string,
    file_content: string,
    id_index?: Map<string, string>,
): boolean {
    // if the id appears more than 1 time in the file (case-insensitively)
    // it means the id is duplicated in the same file
    function escape_reg_exp(string: string): string {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
    }

    const id_regex = new RegExp(`@[a-zA-Z]+{${escape_reg_exp(id)},`, 'gi')
    let count = 0

    while (id_regex.exec(file_content.replace(/\n/g, '')) !== null) {
        count++
        if (count > 1) {
            return true
        }
    }

    // if the same id (case-insensitively) existed in bibtex_dict and it's from
    // a different file, it means the id is duplicated in different files
    if (id_index) {
        const owner = id_index.get(normalize_id(id))
        return !!(owner && bibtex_dict[owner] && bibtex_dict[owner].source_path !== file_path)
    }

    // Linear fallback (tests / callers without an index).
    const norm = normalize_id(id)
    for (const cached_id in bibtex_dict) {
        if (normalize_id(cached_id) === norm && bibtex_dict[cached_id].source_path !== file_path) {
            return true
        }
    }

    // otherwise, the id is not duplicated
    return false
}

/**
 * Check if a BibTeX DOI is already used by another cached entry.
 * Prefer passing `doi_index` (O(1)); without it falls back to a linear scan.
 * @param bibtex_dict - The dictionary of BibTeX entries.
 * @param doi - The DOI to check.
 * @param id - The ID of the entry being checked (same id + path is not a clash).
 * @param file_path - The path of the file to check.
 * @param doi_index - Optional doi → citekey map from {@link build_doi_index}.
 * @returns True if the DOI is duplicated, false otherwise.
 */
export function check_duplicate_doi(
    bibtex_dict: BibtexDict,
    doi: string | undefined,
    id: string,
    file_path: string,
    doi_index?: Map<string, string>,
): boolean {
    if (!doi) {
        return false
    }

    if (doi_index) {
        const owner = doi_index.get(doi)
        if (!owner) {
            return false
        }
        if (owner === id) {
            const entry = bibtex_dict[id]
            return !(entry && entry.source_path == file_path)
        }
        return true
    }

    // Linear fallback (tests / callers without an index).
    for (const cached_id in bibtex_dict) {
        const entry = bibtex_dict[cached_id]
        if (entry.fields.doi === doi && !(cached_id === id && entry.source_path == file_path)) {
            return true
        }
    }

    return false
}

function hit_key(h: ClashHit): string {
    return `${h.path}\0${h.line}\0${h.id}`
}

function cmp_hit(a: ClashHit, b: ClashHit): number {
    return a.id.localeCompare(b.id) || a.path.localeCompare(b.path) || a.line - b.line
}

/** Undirected clashes: same citekey or same DOI. One result per member set. */
export function find_clashes<H extends ClashHit>(hits: H[]): Clash<H>[] {
    const groups = new Map<string, { members: H[], reasons: Set<ClashReason> }>()

    function add(group: H[], reason: ClashReason) {
        if (group.length < 2) return
        const members = group.slice().sort(cmp_hit)
        const key = members.map(hit_key).join('\n')
        if (!groups.has(key)) groups.set(key, { members, reasons: new Set() })
        groups.get(key)!.reasons.add(reason)
    }

    const by_id = new Map<string, H[]>()
    const by_doi = new Map<string, H[]>()
    for (const h of hits) {
        const norm_id = normalize_id(h.id)
        if (!by_id.has(norm_id)) by_id.set(norm_id, [])
        by_id.get(norm_id)!.push(h)
        if (h.doi) {
            if (!by_doi.has(h.doi)) by_doi.set(h.doi, [])
            by_doi.get(h.doi)!.push(h)
        }
    }
    for (const g of by_id.values()) add(g, 'citeKey')
    for (const g of by_doi.values()) add(g, 'DOI')

    return Array.from(groups.values())
        .map(({ members, reasons }) => ({
            members,
            reasons: Array.from(reasons).sort(),
        }))
        .sort((a, b) => cmp_hit(a.members[0], b.members[0]))
}

/**
 * citekey -> merged, sorted reasons it's involved in a clash, from a {@link find_clashes} result.
 * Matches purely by id (not path/line) — every occurrence sharing that citekey lights up,
 * including whichever one currently owns the cache slot, not just the losing duplicate.
 */
export function build_clash_reasons_by_id(clashes: Clash[]): Map<string, ClashReason[]> {
    const acc = new Map<string, Set<ClashReason>>()
    for (const clash of clashes) {
        for (const hit of clash.members) {
            const set = acc.get(hit.id) ?? new Set<ClashReason>()
            for (const r of clash.reasons) set.add(r)
            acc.set(hit.id, set)
        }
    }
    return new Map([...acc].map(([id, set]) => [id, Array.from(set).sort()]))
}

/** Label shown in the ```bibtex "source" tag when a citekey is in a clash group. */
export function format_clash_reason_label(reasons: ClashReason[]): string {
    return reasons.join(' · ')
}

/**
 * Paint state for the ```bibtex source tag next to a codeblock chip.
 * Pure: given the reasons from the last vault rescan (or undefined), returns
 * text/class/title so paint and post-scan DOM refresh stay in lockstep.
 */
export function source_tag_state(reasons: ClashReason[] | undefined): {
    clashing: boolean
    text: string
    title: string | null
} {
    if (reasons && reasons.length > 0) {
        const text = format_clash_reason_label(reasons)
        return {
            clashing: true,
            text,
            title: `Clash: ${text} — from the last "Recache and collect collisions" scan`,
        }
    }
    return { clashing: false, text: 'source', title: null }
}

/**
 * Fields scanned for free-text (no `key:`) queries.
 * Abstracts and other long fields are opt-in via `abstract:…` / `key:value`.
 * Exported so library-scale helpers share the same list (no second source of truth).
 */
export const FREE_TEXT_MATCH_FIELDS = [
    'id',
    'title',
    'author',
    'year',
    'doi',
    'journal',
    'booktitle',
    'url',
] as const

/** Left side of `key:value` must look like a BibTeX field name (not "Attention: …"). */
const FIELD_KEY_RE = /^[a-z][a-z0-9_]*$/i

/**
 * Keys that intentionally select a field. Anything else with a colon
 * (e.g. title fragment `need: transformers`) falls through to free-text.
 * Includes slim free-text fields plus common opt-in fields.
 */
const KNOWN_QUERY_KEYS = new Set<string>([
    ...FREE_TEXT_MATCH_FIELDS,
    'abstract',
    'type',
    'volume',
    'number',
    'pages',
    'publisher',
    'keywords',
    'editor',
    'series',
    'address',
    'month',
    'note',
    'isbn',
    'issn',
    'eprint',
    'school',
    'institution',
    'organization',
    'howpublished',
    'chapter',
    'edition',
])

/**
 * Check if a BibTeX entry matches a search query.
 * Format: <query>;<query>;...
 * Each query could be a string or a <key>:<value> pair. Only the paper that matches all queries will be considered a match.
 *
 * Matching pipeline (shared by panel, list mode, and EditorSuggest):
 * 1. TeX specials → Unicode, accent-fold, lowercase, strip HTML ({@link normalize_for_search})
 * 2. Free-text: whitespace tokens, all must match (order-independent) in the
 *    entry-level slim-field corpus (so `smith 2020` hits author+year)
 * 3. Per token: exact substring first, then word-level Levenshtein within a
 *    length-scaled budget (`magepix` ≈ `manogepix`) — see {@link token_matches_haystack}
 * 4. `key:value`: same token rules, but only within that field (abstract opt-in)
 *
 * Free-text still ignores abstract unless `abstract:…` so 10k libraries stay
 * cheap on every keystroke. The free-text corpus itself is precomputed once
 * per entry object and reused across keystrokes — see {@link search_corpus_cache}.
 *
 * @param bibtex - The BibTeX entry to check.
 * @param query - The search query to match against.
 * @returns True if the BibTeX entry matches the query, false otherwise.
 * @example
 * ```
 * match_query(bibtex, 'CVPR')
 * match_query(bibtex, 'author:John Doe;year:2020')
 * match_query(bibtex, 'abstract:differential attention')
 * match_query(bibtex, 'Muller')  // hits M{\"u}ller / Müller
 * match_query(bibtex, 'antibiofilm magepix')  // typo-tolerant
 * ```
 */

/**
 * Per-entry free-text search corpus cache, keyed by entry object identity.
 * `upsert_entry`/`rebuild_dict_from_hits` always construct a new entry object
 * on real field changes and never mutate `.fields` in place, so a stale entry
 * simply becomes unreachable (and GC'd) instead of returning a stale hit.
 */
const search_corpus_cache = new WeakMap<BibtexElement, string>()

export function match_query(bibtex: BibtexElement, query: string): boolean {
    function field_has_all_tokens(raw: string, tokens: string[]): boolean {
        if (tokens.length === 0) {
            return true
        }
        const hay = normalize_for_search(raw)
        return tokens.every((t) => token_matches_haystack(t, hay))
    }

    /**
     * Slim free-text corpus: one haystack per entry, fields separated so edges never glue.
     * Cached per entry object — {@link upsert_entry} always swaps in a new object on
     * real changes, so the cache self-invalidates by identity (see {@link search_corpus_cache}).
     */
    function slim_corpus(): string {
        const cached = search_corpus_cache.get(bibtex)
        if (cached !== undefined) {
            return cached
        }
        const parts: string[] = []
        for (const key of FREE_TEXT_MATCH_FIELDS) {
            const raw = bibtex.fields[key]
            if (raw != null && String(raw).length > 0) {
                parts.push(normalize_for_search(String(raw)))
            }
        }
        const corpus = parts.join('\n')
        search_corpus_cache.set(bibtex, corpus)
        return corpus
    }

    function match_query_single(q: string): boolean {
        const trimmed = q.trim()
        if (trimmed.length === 0) {
            return true
        }

        // key:value — only for known field names (author:, abstract:, …).
        // Titles often contain colons ("Attention: All You Need"); those fall through to free-text.
        // First colon splits; value may contain further colons (DOIs, URLs).
        const colon = trimmed.indexOf(':')
        if (colon > 0) {
            const key_raw = trimmed.slice(0, colon).trim()
            const key = key_raw.toLowerCase()
            const value = trimmed.slice(colon + 1).trim()
            if (FIELD_KEY_RE.test(key_raw) && KNOWN_QUERY_KEYS.has(key)) {
                if (key in bibtex.fields) {
                    return field_has_all_tokens(String(bibtex.fields[key]), search_tokens(value))
                }
                // Explicit field query but this entry has no such field (journal: on a book).
                // Do not free-text-fallback, or "journal:Nature" would hit titles containing Nature.
                return false
            }
            // else: colon in free text (title phrase) → fall through
        }

        // Free-text: entry-level token AND over slim fields only (exact + fuzzy).
        const tokens = search_tokens(trimmed)
        if (tokens.length === 0) {
            return true
        }
        const corpus = slim_corpus()
        return tokens.every((t) => token_matches_haystack(t, corpus))
    }

    for (const q of query.split(';')) {
        if (q.length > 0 && !match_query_single(q)) {
            return false
        }
    }
    return true
}

/**
 * True if every free-text clause of `query` (i.e. not an explicit `key:value`
 * aimed at another field) also matches within the entry's citekey alone.
 * Callers already know the entry matches via {@link match_query} — this just
 * ranks *why*, so citekey matches can be sorted above matches that only hit
 * other fields (title/author/…). A query that is entirely `key:value` clauses
 * has no free-text component to test, so it never counts as a key match.
 *
 * @example
 * ```
 * query_matches_citekey(bibtex, 'Smith2020')       // true if the citekey itself contains "Smith2020"
 * query_matches_citekey(bibtex, 'author:Smith')    // false — no free-text clause
 * ```
 */
export function query_matches_citekey(bibtex: BibtexElement, query: string): boolean {
    const id_hay = normalize_for_search(bibtex.fields.id ?? '')
    let saw_free_text = false

    for (const q of query.split(';')) {
        const trimmed = q.trim()
        if (trimmed.length === 0) continue

        const colon = trimmed.indexOf(':')
        if (colon > 0) {
            const key_raw = trimmed.slice(0, colon).trim()
            if (FIELD_KEY_RE.test(key_raw) && KNOWN_QUERY_KEYS.has(key_raw.toLowerCase())) {
                continue // explicit field clause — doesn't count toward key-match ranking
            }
        }

        saw_free_text = true
        const tokens = search_tokens(trimmed)
        if (!tokens.every((t) => token_matches_haystack(t, id_hay))) {
            return false
        }
    }
    return saw_free_text
}

/**
 * Generate a search query for all mentions of a BibTeX entry.
 * @param id - The ID of the BibTeX entry.
 * @returns A regular expression string to match mentions of the entry.
 */
export function mentions_search_query(id: string): string {
    // example: MaksOvsjanikov2012TOG ->
    // /\`[\[\{]MaksOvsjanikov2012TOG[\]\}]\`/  <-- `[id]` or `{id}`
    // OR
    // /\[\[MaksOvsjanikov2012TOG\]\]/  <-- `[[id]]`
    // OR
    // /\[\[MaksOvsjanikov2012TOG\|[^\]]*\]\]/  <-- `[[id|text]]`
    // OR
    // /\[\[MaksOvsjanikov2012TOG\#[^\]]*\]\]/  <-- `[[id#text]]`
    id = id.replace('+', '\\+')
    return `/\\\`[\\[\\{]${id}[\\]\\}]\\\`/\n` +
        `OR /\\[\\[${id}\\]\\]/\n` +
        `OR /\\[\\[${id}\\|[^\\]]*\\]\\]/\n` +
        `OR /\\[\\[${id}#[^\\]]*\\]\\]/`
}

/**
 * The modal for fetching BibTeX entries online or manually.
 * * DOI mode: Fetches BibTeX data from an online source using the DOI.
 * * Manual mode: Allows users to input BibTeX & abstracts manually.
 */
export class FetchBibtexOnline extends Modal {
    plugin: BibtexScholar
    changable_el: HTMLElement
    btn: ButtonComponent

    doi: string = ''
    id_suffix: string = ''
    abstract: string = ''
    bibtex: string = ''

    constructor(app: App, plugin: BibtexScholar) {
        super(app)
        this.plugin = plugin
    }

    onOpen() {
        const { contentEl } = this
        contentEl.createEl('h4', { text: 'Fetch BibTeX online' })

        new Setting(contentEl)
			.setName('Mode')
			.setDesc('')
			.addDropdown(dropdown => dropdown
                .addOptions({
                    'doi': 'DOI',
                    'manual': 'Manual',
                })
                .setValue(this.plugin.cache.fetch_mode)
                .onChange(async (value) => {
                    if (value === 'doi') {
                        this.switch_doi_mode()
                    } else {
                        this.switch_manual_mode()
                    }
                })
            )
        
        new Setting(contentEl)
			.setName('ID suffix')
			.setDesc('Suffix to the paper ID')
			.addText(text => text
				.setValue(this.id_suffix)
				.onChange(async (value) => {
					this.id_suffix = value
				}))

        new Setting(contentEl)
            .setName('Abstract')
            .setDesc('Abstract of the paper')
            .addText(text => text
                .setValue(this.abstract)
                .onChange(async (value) => {
                    this.abstract = value
                }))
        
        this.changable_el = contentEl.createDiv()
        
        if (this.plugin.cache.fetch_mode === 'doi') {
            this.switch_doi_mode()
        } else {
            this.switch_manual_mode()
        }
    }

    /**
     * Switching to DOI mode.
     */
    switch_doi_mode() {
        this.changable_el.empty()

        new Setting(this.changable_el)
            .setName('DOI')
            .setDesc('Digital Object Identifier (DOI) of the paper')
            .addText(text => text
                .setValue(this.doi)
                .onChange(async (value) => {
                    this.doi = value
                }))

        new Setting(this.changable_el)
            .addButton(btn => {
                btn.setButtonText('Fetch')
                    .onClick(async () => await this.onfetch())
                this.btn = btn
            })
    }

    /**
     * Switching to manual mode.
     */
    switch_manual_mode() {
        this.changable_el.empty()

        new Setting(this.changable_el)
            .setName('BibTeX')
            .setDesc('BibTeX of the paper')
            .addTextArea(textarea => textarea
                .setValue(this.bibtex)
                .onChange(async (value) => {
                    this.bibtex = value
                }))

        new Setting(this.changable_el)
            .addButton(btn => {
                btn.setButtonText('Process')
                    .onClick(async () => this.on_process(this.bibtex))
                this.btn = btn
            })
    }

    /**
     * Process the BibTeX field to generate a unique ID and add relevant information.
     * @param field The BibTeX field to process.
     * @returns The processed BibTeX field.
     */
    process_bibtex_field(field: BibtexField) {
        // gen id
        let authors = field.author.split(' and ')
        let first_author = authors[0]
        let last_name, first_name

        if (first_author.includes(',')) {
            [last_name, first_name] = first_author.split(',').map(str => str.trim())
        } else {
            let name_parts = first_author.split(' ').map(str => str.trim())
            last_name = name_parts.pop()
            first_name = name_parts.join(' ')
        }

        field['id'] = `${first_name}${last_name}${field['year'] || ''}`.replace(/[^a-zA-Z0-9]/g, '') + this.id_suffix

        // fix duplication
        if (field.id in this.plugin.cache.bibtex_dict) {
            field.id += '+'
        }

        // add abstract
        if (this.abstract != '') {
            field.abstract = this.abstract
        }

        return field
    }

    /**
     * Fetch BibTeX data from an online source, process it, and copy to clipboard.
     * P.S. Used in DOI mode.
     */
    async onfetch() {
        this.btn.setIcon('loader')

        async function fetch_bibtex(doi: string) {
            return requestUrl({
                url: `https://doi.org/${doi}`,
                headers: { Accept: "application/x-bibtex" },
            })
                .then(response => response.text)
                .catch(error => {
                    console.error('Error:', error)
                })
        }

        await fetch_bibtex(this.doi).then(async (bibtex) => {
            const fields = await parse_bibtex(String(bibtex))

            if (fields.length != 0) {
                this.bibtex = make_bibtex(this.process_bibtex_field(fields[0]))
                copy_to_clipboard(this.bibtex)
                this.btn.setIcon('check')
            } else {
                new Notice('Fetch failed')
                this.btn.setIcon('ban')
            }

            setTimeout(() => this.btn.setButtonText('Fetch'), 1000)
        })
    }

    /**
     * Combine BibTeX data from manual input, process it, and copy to clipboard.
     * P.S. Used in manual mode.
     */
    async on_process(bibtex: string) {
        this.btn.setIcon('loader')
        const fields = await parse_bibtex(bibtex)

        if (fields.length != 0) {
            this.bibtex = make_bibtex(this.process_bibtex_field(fields[0]))
            copy_to_clipboard(this.bibtex)
            this.btn.setIcon('check')
        } else {
            new Notice('Process failed')
            this.btn.setIcon('ban')
        }

        setTimeout(() => this.btn.setButtonText('Process'), 1000)
    }
}