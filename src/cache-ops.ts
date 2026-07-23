/**
 * Pure cache rebuild / integrity helpers for the BibTeX dict.
 * Keeps durable-store logic free of Obsidian APIs where possible.
 *
 * SPEED S3: slim entries (no double-stored reconstructible `source`).
 * SPEED S5: path fingerprints + merge helpers for incremental rescan.
 */

import {
	entry_source,
	make_bibtex,
	normalize_id,
	parse_bibtex,
	type BibtexDict,
	type BibtexElement,
	type BibtexField,
	type ClashHit,
} from 'src/bibtex'
import { text_may_contain_bibtex_block } from 'src/cite-span'
import {
	type IdIndex,
	id_index_claim,
	id_index_clear_owner,
} from 'src/citekey-index'
import {
	type DoiIndex,
	doi_index_on_delete,
	doi_index_on_remove_path,
	doi_index_on_upsert,
} from 'src/doi-index'

export type ScanHit = ClashHit & { fields: BibtexField }

/**
 * Extract BibTeX scan hits from one markdown file's text.
 * Cheap gate: no ```bibtex → empty (caller may count as skipped).
 */
export async function collect_hits_from_markdown(path: string, text: string): Promise<ScanHit[]> {
	if (!text_may_contain_bibtex_block(text)) {
		return []
	}
	const hits: ScanHit[] = []
	const block_re = /```bibtex[^\n]*\n([\s\S]*?)```/g
	let match: RegExpExecArray | null
	while ((match = block_re.exec(text)) !== null) {
		const line = text.slice(0, match.index).split('\n').length - 1
		for (const fields of await parse_bibtex(match[1])) {
			hits.push({
				id: fields.id,
				doi: fields.doi,
				path,
				line,
				fields,
			})
		}
	}
	return hits
}

/** path → lean fingerprint string (`mtimeMs:size`). */
export type PathFingerprintMap = Record<string, string>

export type PluginCacheShape = {
	bibtex_dict: BibtexDict
	note_folder: string
	pdf_folder: string
	template_path: string
	fetch_mode: string
	/** Base font size (px) for the floating citation card UI. */
	card_font_size: number
	/** When true, floating citation cards use a wider max width. */
	card_wide: boolean
	/** When true, the paper panel offers a toggle listing entries with no matching PDF. */
	missing_pdf_enabled: boolean
	/** When true, citation cards in the paper panel's dense chip list wait 2x the open debounce before a hover opens them. */
	panel_double_debounce_enabled: boolean
	/**
	 * Paper panel papers-list view: 'discover' (capped, occasionally-random
	 * dense chips with clash/missing-PDF coloring) or 'list' (virtualized,
	 * unbounded row list, optionally sorted by mention count).
	 */
	papers_view: 'discover' | 'list'
	/**
	 * Text size (px) for discover-mode chip buttons — independent of
	 * `card_font_size` (the floating citation card, shown everywhere else)
	 * and of `list_font_size` below.
	 */
	panel_chip_font_size: number
	/**
	 * Text size (px) for list-mode rows in the paper panel — independent of
	 * `card_font_size` and `panel_chip_font_size`. Row height scales with it
	 * (see {@link list_row_height_px}).
	 */
	list_font_size: number
	/**
	 * Last-known vault file fingerprints for incremental rescan (SPEED S5).
	 * Missing/empty → next rescan reads every markdown file (safe cold start).
	 */
	path_fingerprints: PathFingerprintMap
	/**
	 * When true, paint-time duplicate Notices fire at most once per Obsidian
	 * session (not once per codeblock). Tooltips / "not cached" tags still show.
	 */
	quiet_duplicate_notices: boolean
	/** Relative vault path for “Export library to .bib” (Copy/export modal). */
	export_bib_path: string
}

export const DEFAULT_PLUGIN_CACHE: PluginCacheShape = {
	bibtex_dict: {},
	note_folder: 'note',
	pdf_folder: 'pdf',
	template_path: '',
	fetch_mode: 'doi',
	card_font_size: 13,
	card_wide: false,
	missing_pdf_enabled: false,
	panel_double_debounce_enabled: false,
	papers_view: 'discover',
	panel_chip_font_size: 13,
	list_font_size: 13,
	path_fingerprints: {},
	quiet_duplicate_notices: false,
	export_bib_path: 'bibliography.bib',
}

/** Allowed range for citation card font size (px). */
export const CARD_FONT_SIZE_MIN = 10
export const CARD_FONT_SIZE_MAX = 20

/** Allowed range for paper panel (discover-mode chip) text size (px) — independent of the card range above. */
export const PANEL_CHIP_FONT_SIZE_MIN = 10
export const PANEL_CHIP_FONT_SIZE_MAX = 20

/** Allowed range for paper panel (list-mode row) text size (px) — independent of card/chip ranges above. */
export const LIST_FONT_SIZE_MIN = 10
export const LIST_FONT_SIZE_MAX = 20

/**
 * Abstracts policy (SPEED S3): keep abstracts on `fields` for cards/export,
 * but free-text search does not scan them unless the query uses `abstract:…`
 * (see `match_query` / `FREE_TEXT_SEARCH_FIELDS`).
 */
export const ABSTRACTS_IN_HOT_CACHE = true

/** Clamp and coerce a raw setting value to a valid card font size. */
export function normalize_card_font_size(raw: unknown): number {
	const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
	if (!Number.isFinite(n)) {
		return DEFAULT_PLUGIN_CACHE.card_font_size
	}
	return Math.min(CARD_FONT_SIZE_MAX, Math.max(CARD_FONT_SIZE_MIN, Math.round(n)))
}

/** Clamp and coerce a raw setting value to a valid paper panel (discover-mode chip) text size. */
export function normalize_panel_chip_font_size(raw: unknown): number {
	const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
	if (!Number.isFinite(n)) {
		return DEFAULT_PLUGIN_CACHE.panel_chip_font_size
	}
	return Math.min(PANEL_CHIP_FONT_SIZE_MAX, Math.max(PANEL_CHIP_FONT_SIZE_MIN, Math.round(n)))
}

/** Clamp and coerce a raw setting value to a valid paper panel (list-mode row) text size. */
export function normalize_list_font_size(raw: unknown): number {
	const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
	if (!Number.isFinite(n)) {
		return DEFAULT_PLUGIN_CACHE.list_font_size
	}
	return Math.min(LIST_FONT_SIZE_MAX, Math.max(LIST_FONT_SIZE_MIN, Math.round(n)))
}

/**
 * Drop reconstructible `source` from one entry. Keeps fields (incl. abstract),
 * source_path, and optional source_line.
 */
export function slim_entry(entry: BibtexElement): BibtexElement {
	const out: BibtexElement = {
		fields: entry.fields,
		source_path: typeof entry.source_path === 'string' ? entry.source_path : '',
	}
	if (typeof entry.source_line === 'number' && Number.isFinite(entry.source_line)) {
		out.source_line = entry.source_line
	}
	return out
}

/** Slim every entry in a dict (new object; does not mutate input entries in place). */
export function slim_bibtex_dict(dict: BibtexDict): BibtexDict {
	const out: BibtexDict = {}
	for (const id of Object.keys(dict)) {
		const e = dict[id]
		if (!e || typeof e !== 'object' || !e.fields || typeof e.fields !== 'object') {
			continue
		}
		out[id] = slim_entry(e)
	}
	return out
}

function normalize_path_fingerprints(raw: unknown): PathFingerprintMap {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return {}
	}
	const out: PathFingerprintMap = {}
	for (const [path, fp] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof path === 'string' && path.length > 0 && typeof fp === 'string' && fp.length > 0) {
			out[path] = fp
		}
	}
	return out
}

/**
 * Normalize data loaded from disk. Guards against missing/corrupt fields so
 * the plugin always runs with a well-formed cache object.
 * Migrates fat entries by dropping reconstructible `source` (S3).
 */
export function normalize_plugin_cache(raw: unknown): PluginCacheShape {
	const base: PluginCacheShape = {
		bibtex_dict: {},
		note_folder: DEFAULT_PLUGIN_CACHE.note_folder,
		pdf_folder: DEFAULT_PLUGIN_CACHE.pdf_folder,
		template_path: DEFAULT_PLUGIN_CACHE.template_path,
		fetch_mode: DEFAULT_PLUGIN_CACHE.fetch_mode,
		card_font_size: DEFAULT_PLUGIN_CACHE.card_font_size,
		card_wide: DEFAULT_PLUGIN_CACHE.card_wide,
		missing_pdf_enabled: DEFAULT_PLUGIN_CACHE.missing_pdf_enabled,
		panel_double_debounce_enabled: DEFAULT_PLUGIN_CACHE.panel_double_debounce_enabled,
		papers_view: DEFAULT_PLUGIN_CACHE.papers_view,
		panel_chip_font_size: DEFAULT_PLUGIN_CACHE.panel_chip_font_size,
		list_font_size: DEFAULT_PLUGIN_CACHE.list_font_size,
		path_fingerprints: {},
		quiet_duplicate_notices: DEFAULT_PLUGIN_CACHE.quiet_duplicate_notices,
		export_bib_path: DEFAULT_PLUGIN_CACHE.export_bib_path,
	}

	if (!raw || typeof raw !== 'object') {
		return base
	}

	const o = raw as Record<string, unknown>
	const dict = o.bibtex_dict
	const raw_dict: BibtexDict =
		dict && typeof dict === 'object' && !Array.isArray(dict)
			? (dict as BibtexDict)
			: {}

	return {
		bibtex_dict: slim_bibtex_dict(raw_dict),
		note_folder: typeof o.note_folder === 'string' ? o.note_folder : base.note_folder,
		pdf_folder: typeof o.pdf_folder === 'string' ? o.pdf_folder : base.pdf_folder,
		template_path: typeof o.template_path === 'string' ? o.template_path : base.template_path,
		fetch_mode: typeof o.fetch_mode === 'string' ? o.fetch_mode : base.fetch_mode,
		card_font_size: normalize_card_font_size(
			o.card_font_size !== undefined ? o.card_font_size : base.card_font_size,
		),
		card_wide: typeof o.card_wide === 'boolean' ? o.card_wide : base.card_wide,
		missing_pdf_enabled: typeof o.missing_pdf_enabled === 'boolean' ? o.missing_pdf_enabled : base.missing_pdf_enabled,
		panel_double_debounce_enabled: typeof o.panel_double_debounce_enabled === 'boolean'
			? o.panel_double_debounce_enabled
			: base.panel_double_debounce_enabled,
		papers_view: o.papers_view === 'discover' || o.papers_view === 'list' ? o.papers_view : base.papers_view,
		panel_chip_font_size: normalize_panel_chip_font_size(
			o.panel_chip_font_size !== undefined ? o.panel_chip_font_size : base.panel_chip_font_size,
		),
		list_font_size: normalize_list_font_size(
			o.list_font_size !== undefined ? o.list_font_size : base.list_font_size,
		),
		path_fingerprints: normalize_path_fingerprints(o.path_fingerprints),
		quiet_duplicate_notices: typeof o.quiet_duplicate_notices === 'boolean'
			? o.quiet_duplicate_notices
			: base.quiet_duplicate_notices,
		export_bib_path: typeof o.export_bib_path === 'string' && o.export_bib_path.length > 0
			? o.export_bib_path
			: base.export_bib_path,
	}
}

/**
 * Rebuild bibtex_dict from vault scan hits.
 * Policy: path+line sort, first citekey wins (case-insensitively), first DOI
 * wins (same as rescan_vault). Entries are slim: no double-stored `source`
 * (use {@link entry_source}). Returns a **new** dict — does not mutate `hits`.
 */
export function rebuild_dict_from_hits(hits: ScanHit[]): BibtexDict {
	const sorted = hits.slice().sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
	const dict: BibtexDict = {}
	const used_ids = new Set<string>()
	const used_dois = new Set<string>()

	for (const h of sorted) {
		const norm_id = normalize_id(h.id)
		if (used_ids.has(norm_id)) continue
		if (h.doi && used_dois.has(h.doi)) continue
		dict[h.id] = {
			fields: h.fields,
			source_path: h.path,
			source_line: h.line,
		}
		used_ids.add(norm_id)
		if (h.doi) used_dois.add(h.doi)
	}
	return dict
}

// ─── SPEED S5: fingerprints + incremental merge ─────────────────────────────

/** Lean fingerprint: mtime ms + byte size (SPEED open decision). */
export function file_fingerprint(mtime_ms: number, size: number): string {
	return `${mtime_ms}:${size}`
}

export type PathClassification = {
	new: string[]
	changed: string[]
	unchanged: string[]
	deleted: string[]
}

/**
 * Classify vault paths against the previous fingerprint map.
 * `current_fp[path]` must be set for every path in `vault_paths`.
 */
export function classify_path_fingerprints(
	vault_paths: string[],
	current_fp: PathFingerprintMap,
	previous_fp: PathFingerprintMap,
): PathClassification {
	const result: PathClassification = { new: [], changed: [], unchanged: [], deleted: [] }
	const vault_set = new Set(vault_paths)

	for (const path of vault_paths) {
		const prev = previous_fp[path]
		const cur = current_fp[path]
		if (prev === undefined) {
			result.new.push(path)
		} else if (prev !== cur) {
			result.changed.push(path)
		} else {
			result.unchanged.push(path)
		}
	}

	for (const path of Object.keys(previous_fp)) {
		if (!vault_set.has(path)) {
			result.deleted.push(path)
		}
	}

	return result
}

/**
 * Re-hydrate scan hits from cached winners on unchanged paths so a partial
 * re-parse can still run global first-id / first-DOI via {@link rebuild_dict_from_hits}.
 *
 * Note: entries that lost the race on a prior full scan are not in the dict, so
 * soft incremental clash detection is winner-biased. Panel "collect collisions"
 * uses hard reset for a full harvest.
 */
export function hits_from_cached_entries(dict: BibtexDict, unchanged_paths: Set<string>): ScanHit[] {
	const hits: ScanHit[] = []
	for (const id of Object.keys(dict)) {
		const e = dict[id]
		if (!e || !unchanged_paths.has(e.source_path)) continue
		hits.push({
			id,
			doi: e.fields.doi,
			path: e.source_path,
			line: typeof e.source_line === 'number' ? e.source_line : 0,
			fields: e.fields,
		})
	}
	return hits
}

/** Concat cached unchanged hits + freshly parsed hits (order does not matter; rebuild sorts). */
export function merge_rescan_hits(cached_hits: ScanHit[], fresh_hits: ScanHit[]): ScanHit[] {
	if (cached_hits.length === 0) return fresh_hits.slice()
	if (fresh_hits.length === 0) return cached_hits.slice()
	return cached_hits.concat(fresh_hits)
}

/**
 * Apply path rename to all entries that point at `old_path`.
 * Mutates dict in place; returns whether anything changed.
 */
export function retarget_source_paths(dict: BibtexDict, old_path: string, new_path: string): boolean {
	let changed = false
	for (const id in dict) {
		if (dict[id].source_path === old_path) {
			dict[id].source_path = new_path
			changed = true
		}
	}
	return changed
}

/** Move fingerprint key on rename (mutates map). */
export function retarget_fingerprint(
	fps: PathFingerprintMap,
	old_path: string,
	new_path: string,
): boolean {
	if (!(old_path in fps)) return false
	fps[new_path] = fps[old_path]
	delete fps[old_path]
	return true
}

/**
 * IDs whose entry is sourced from a path under `dir_prefix`. Pass `""` to match
 * every path (whole vault). Callers scoping to one directory must include the
 * trailing slash (`` `${folder.path}/` ``) so a same-prefixed sibling folder
 * (e.g. `"notes-archive/"`) can't match `"notes/"`.
 */
export function ids_under_path(dict: BibtexDict, dir_prefix: string): string[] {
	return Object.keys(dict).filter((id) => dict[id].source_path.startsWith(dir_prefix))
}

/** BibTeX source for exactly these ids (abstracts omitted), sorted for a stable file diff. */
export function format_bibtex_for_ids(dict: BibtexDict, ids: Iterable<string>): string {
	let out = ''
	for (const id of [...ids].sort((a, b) => a.localeCompare(b))) {
		const entry = dict[id]
		if (!entry) continue
		out += make_bibtex(entry.fields, false) + '\n'
	}
	return out
}

/**
 * Shallow-copy every entry whose `source_path` equals `path` (for undo buffers).
 * Does not mutate `dict`.
 */
export function snapshot_entries_for_path(dict: BibtexDict, path: string): BibtexDict {
	const out: BibtexDict = {}
	for (const id of Object.keys(dict)) {
		const entry = dict[id]
		if (entry.source_path !== path) {
			continue
		}
		out[id] = {
			fields: { ...entry.fields },
			source_path: entry.source_path,
			...(entry.source !== undefined ? { source: entry.source } : {}),
			...(entry.source_line !== undefined ? { source_line: entry.source_line } : {}),
		}
	}
	return out
}

/**
 * Remove all entries whose source_path equals `path`. Mutates dict; returns count removed.
 * When `doi_index` / `id_index` are provided they are kept in sync.
 */
export function remove_entries_for_path(dict: BibtexDict, path: string, doi_index?: DoiIndex, id_index?: IdIndex): number {
	if (doi_index) {
		doi_index_on_remove_path(doi_index, dict, path)
	}
	let n = 0
	for (const id of Object.keys(dict)) {
		if (dict[id].source_path === path) {
			if (id_index) id_index_clear_owner(id_index, id)
			delete dict[id]
			n++
		}
	}
	return n
}

/**
 * Re-insert a path snapshot after an accidental uncache (e.g. file delete undo).
 * Skips ids already present so we never clobber a newer winner.
 * Returns how many rows were restored vs skipped.
 */
export function restore_entries_snapshot(
	dict: BibtexDict,
	snapshot: BibtexDict,
	doi_index?: DoiIndex,
	id_index?: IdIndex,
): { restored: number, skipped: number } {
	let restored = 0
	let skipped = 0
	for (const id of Object.keys(snapshot)) {
		if (dict[id]) {
			skipped++
			continue
		}
		const entry = snapshot[id]
		if (doi_index) {
			doi_index_on_upsert(doi_index, id, undefined, entry.fields.doi)
		}
		if (id_index) {
			id_index_claim(id_index, id)
		}
		dict[id] = {
			fields: { ...entry.fields },
			source_path: entry.source_path,
			...(entry.source !== undefined ? { source: entry.source } : {}),
			...(entry.source_line !== undefined ? { source_line: entry.source_line } : {}),
		}
		restored++
	}
	return { restored, skipped }
}

/**
 * Insert or update a non-duplicate entry. Returns true if the dict was mutated.
 * Stores a slim entry (no `source` string). Caller passes source text for dirty compare only.
 * When `doi_index` / `id_index` are provided they are kept in sync.
 */
export function upsert_entry(
	dict: BibtexDict,
	id: string,
	fields: BibtexField,
	source: string,
	source_path: string,
	doi_index?: DoiIndex,
	source_line?: number,
	id_index?: IdIndex,
): boolean {
	const prev = dict[id]
	const prev_src = prev ? entry_source(prev) : null
	const same_line = source_line === undefined || prev?.source_line === source_line
	if (prev && prev_src === source && prev.source_path === source_path && same_line) {
		return false
	}
	if (doi_index) {
		doi_index_on_upsert(doi_index, id, prev, fields.doi)
	}
	if (id_index) {
		id_index_claim(id_index, id)
	}
	const entry: BibtexElement = { fields, source_path }
	if (source_line !== undefined) {
		entry.source_line = source_line
	}
	dict[id] = entry
	return true
}

/** Delete a single entry and sync DOI + id indexes. */
export function delete_entry(dict: BibtexDict, id: string, doi_index?: DoiIndex, id_index?: IdIndex): boolean {
	const prev = dict[id]
	if (!prev) return false
	if (doi_index) {
		doi_index_on_delete(doi_index, id, prev)
	}
	if (id_index) {
		id_index_clear_owner(id_index, id)
	}
	delete dict[id]
	return true
}

/** Count entries — useful for notices and invariants. */
export function entry_count(dict: BibtexDict): number {
	return Object.keys(dict).length
}

/**
 * Citekeys with no matching PDF, sorted for a stable worklist.
 * `has_pdf` is injected (real callers check `app.metadataCache.getFirstLinkpathDest`,
 * the same lookup {@link LinkedFileButton} in src/hover.tsx uses) so this stays pure/testable.
 */
export function missing_pdf_ids(dict: BibtexDict, has_pdf: (id: string) => boolean): string[] {
	return Object.keys(dict)
		.filter((id) => !has_pdf(id))
		.sort((a, b) => a.localeCompare(b))
}

/** Default batch size for event-loop-friendly PDF probes (SPEED S7). */
export const MISSING_PDF_PROBE_CHUNK = 64

export type MissingPdfProbeOptions = {
	/** Pre-sorted or unsorted citekeys to probe. */
	ids: string[]
	has_pdf: (id: string) => boolean
	chunk_size?: number
	yield_ms?: number
	sleep?: (ms: number) => Promise<void>
	should_cancel?: () => boolean
	on_progress?: (done: number, total: number) => void
}

export type MissingPdfProbeResult = {
	/** Sorted citekeys with no PDF. */
	missing: string[]
	/** How many ids were probed before cancel (or all). */
	probed: number
	cancelled: boolean
}

const default_probe_sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms)
	})

/**
 * Probe ids for missing PDFs in chunks, yielding so the UI can paint.
 * Sync `has_pdf` is fine — the point is not blocking the main thread for 10k lookups.
 */
export async function probe_missing_pdf_chunked(
	opts: MissingPdfProbeOptions,
): Promise<MissingPdfProbeResult> {
	const chunk_size = opts.chunk_size ?? MISSING_PDF_PROBE_CHUNK
	const yield_ms = opts.yield_ms ?? 0
	const sleep = opts.sleep ?? default_probe_sleep
	const ids = opts.ids.slice().sort((a, b) => a.localeCompare(b))
	const missing: string[] = []
	let probed = 0
	let cancelled = false

	for (let i = 0; i < ids.length; i += chunk_size) {
		if (opts.should_cancel?.()) {
			cancelled = true
			break
		}
		const chunk = ids.slice(i, i + chunk_size)
		for (const id of chunk) {
			if (opts.should_cancel?.()) {
				cancelled = true
				break
			}
			probed++
			if (!opts.has_pdf(id)) {
				missing.push(id)
			}
		}
		if (cancelled) break
		opts.on_progress?.(Math.min(i + chunk.length, ids.length), ids.length)
		if (i + chunk_size < ids.length) {
			await sleep(yield_ms)
		}
	}

	// missing is already in sorted id order because ids were sorted and we append in order
	return { missing, probed, cancelled }
}

/**
 * Integrity check: every entry must have id matching the map key, and a source_path string.
 * `source` is optional (S3); fields must be present so {@link entry_source} can rebuild.
 * Returns list of human-readable problems (empty = healthy).
 */
export function audit_bibtex_dict(dict: BibtexDict): string[] {
	const problems: string[] = []
	const seen_doi = new Map<string, string>()

	for (const key of Object.keys(dict)) {
		const e: BibtexElement | undefined = dict[key]
		if (!e || typeof e !== 'object') {
			problems.push(`entry "${key}" is not an object`)
			continue
		}
		if (!e.fields || typeof e.fields !== 'object') {
			problems.push(`entry "${key}" missing fields`)
			continue
		}
		if (e.fields.id !== key) {
			problems.push(`entry key "${key}" !== fields.id "${e.fields.id}"`)
		}
		if (typeof e.source_path !== 'string' || e.source_path.length === 0) {
			problems.push(`entry "${key}" missing source_path`)
		}
		// source string optional — must be able to reconstruct
		if (typeof e.source === 'string' && e.source.length === 0) {
			problems.push(`entry "${key}" has empty source string`)
		}
		if (!e.fields.type || !e.fields.id) {
			problems.push(`entry "${key}" fields missing type/id for source rebuild`)
		}
		const doi = e.fields.doi
		if (doi) {
			const other = seen_doi.get(doi)
			if (other) {
				problems.push(`DOI "${doi}" shared by "${other}" and "${key}"`)
			} else {
				seen_doi.set(doi, key)
			}
		}
	}
	return problems
}

// Re-export for callers that only import cache-ops
export { entry_source }
