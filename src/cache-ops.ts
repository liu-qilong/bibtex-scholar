/**
 * Pure cache rebuild / integrity helpers for the BibTeX dict.
 * Keeps durable-store logic free of Obsidian APIs where possible.
 */

import { make_bibtex, type BibtexDict, type BibtexElement, type BibtexField, type ClashHit } from 'src/bibtex'

export type ScanHit = ClashHit & { fields: BibtexField }

export type PluginCacheShape = {
	bibtex_dict: BibtexDict
	note_folder: string
	pdf_folder: string
	template_path: string
	fetch_mode: string
}

export const DEFAULT_PLUGIN_CACHE: PluginCacheShape = {
	bibtex_dict: {},
	note_folder: 'note',
	pdf_folder: 'pdf',
	template_path: '',
	fetch_mode: 'doi',
}

/**
 * Normalize data loaded from disk. Guards against missing/corrupt fields so
 * the plugin always runs with a well-formed cache object.
 */
export function normalize_plugin_cache(raw: unknown): PluginCacheShape {
	const base: PluginCacheShape = {
		bibtex_dict: {},
		note_folder: DEFAULT_PLUGIN_CACHE.note_folder,
		pdf_folder: DEFAULT_PLUGIN_CACHE.pdf_folder,
		template_path: DEFAULT_PLUGIN_CACHE.template_path,
		fetch_mode: DEFAULT_PLUGIN_CACHE.fetch_mode,
	}

	if (!raw || typeof raw !== 'object') {
		return base
	}

	const o = raw as Record<string, unknown>
	const dict = o.bibtex_dict
	const bibtex_dict: BibtexDict =
		dict && typeof dict === 'object' && !Array.isArray(dict)
			? (dict as BibtexDict)
			: {}

	return {
		bibtex_dict,
		note_folder: typeof o.note_folder === 'string' ? o.note_folder : base.note_folder,
		pdf_folder: typeof o.pdf_folder === 'string' ? o.pdf_folder : base.pdf_folder,
		template_path: typeof o.template_path === 'string' ? o.template_path : base.template_path,
		fetch_mode: typeof o.fetch_mode === 'string' ? o.fetch_mode : base.fetch_mode,
	}
}

/**
 * Rebuild bibtex_dict from vault scan hits.
 * Policy: path+line sort, first citekey wins, first DOI wins (same as rescan_vault).
 * Returns a **new** dict — does not mutate `hits`.
 */
export function rebuild_dict_from_hits(hits: ScanHit[]): BibtexDict {
	const sorted = hits.slice().sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
	const dict: BibtexDict = {}
	const used_dois = new Set<string>()

	for (const h of sorted) {
		if (h.id in dict) continue
		if (h.doi && used_dois.has(h.doi)) continue
		dict[h.id] = {
			fields: h.fields,
			source: make_bibtex(h.fields),
			source_path: h.path,
		}
		if (h.doi) used_dois.add(h.doi)
	}
	return dict
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

/**
 * Remove all entries whose source_path equals `path`. Mutates dict; returns count removed.
 */
export function remove_entries_for_path(dict: BibtexDict, path: string): number {
	let n = 0
	for (const id of Object.keys(dict)) {
		if (dict[id].source_path === path) {
			delete dict[id]
			n++
		}
	}
	return n
}

/**
 * Insert or update a non-duplicate entry. Returns true if the dict was mutated.
 * Caller is responsible for duplicate checks before calling.
 */
export function upsert_entry(
	dict: BibtexDict,
	id: string,
	fields: BibtexField,
	source: string,
	source_path: string,
): boolean {
	const prev = dict[id]
	if (prev && prev.source === source && prev.source_path === source_path) {
		return false
	}
	dict[id] = { fields, source, source_path }
	return true
}

/** Count entries — useful for notices and invariants. */
export function entry_count(dict: BibtexDict): number {
	return Object.keys(dict).length
}

/**
 * Integrity check: every entry must have id matching the map key, and a source_path string.
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
		if (typeof e.source !== 'string') {
			problems.push(`entry "${key}" missing source string`)
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
