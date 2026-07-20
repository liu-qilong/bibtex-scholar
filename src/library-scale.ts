/**
 * Scale helpers for large libraries (10k+ entries).
 * Pure: no Obsidian APIs — caps, slim search fields, list windowing math.
 */

import { match_query, type BibtexDict, type BibtexElement, type Clash } from 'src/bibtex'

/** Empty paper-panel list: show this many sorted ids, not the whole library. */
export const PANEL_EMPTY_PREVIEW = 50

/** Max chips mounted in the paper panel for a search result set. */
export const PANEL_RESULT_CAP = 80

/** Max EditorSuggest rows returned per keystroke. */
export const SUGGEST_RESULT_CAP = 50

/** Max clash cards mounted in the clash panel. */
export const CLASH_RESULT_CAP = 80

/** Assumed row height (px) for missing-PDF virtual list layout. */
export const MISSING_PDF_ROW_HEIGHT = 28

/** Overscan rows above/below the missing-PDF viewport. */
export const MISSING_PDF_OVERSCAN = 6

/**
 * Free-text (no `key:`) match only scans these fields.
 * Long fields like abstract stay available via explicit `abstract:…` queries.
 */
export const FREE_TEXT_SEARCH_FIELDS = [
	'id',
	'title',
	'author',
	'year',
	'doi',
	'journal',
	'booktitle',
	'url',
] as const

export type LibraryListKind = 'empty_preview' | 'search'

export type LibraryListResult = {
	ids: string[]
	/** How many entries matched before the mount cap (search) or library size (empty). */
	matched: number
	/** True when more matches exist than were returned. */
	truncated: boolean
	kind: LibraryListKind
}

function sorted_ids(dict: BibtexDict): string[] {
	return Object.keys(dict).sort((a, b) => a.localeCompare(b))
}

/**
 * Paper panel listing policy:
 * - empty / whitespace query → first {@link PANEL_EMPTY_PREVIEW} ids (sorted), never full library
 * - non-empty query → match_query hits, hard-capped at {@link PANEL_RESULT_CAP}
 */
export function list_ids_for_panel(dict: BibtexDict, query: string): LibraryListResult {
	const q = query.trim()
	if (q.length === 0) {
		const all = sorted_ids(dict)
		const ids = all.slice(0, PANEL_EMPTY_PREVIEW)
		return {
			ids,
			matched: all.length,
			truncated: all.length > ids.length,
			kind: 'empty_preview',
		}
	}

	const ids: string[] = []
	let matched = 0
	for (const id of sorted_ids(dict)) {
		const entry = dict[id]
		if (!entry || !match_query(entry, q)) continue
		matched++
		if (ids.length < PANEL_RESULT_CAP) {
			ids.push(id)
		}
	}
	return {
		ids,
		matched,
		truncated: matched > ids.length,
		kind: 'search',
	}
}

/**
 * EditorSuggest listing: same match rules, capped at {@link SUGGEST_RESULT_CAP}.
 * Empty query still returns a capped prefix so `{` alone is usable on small libs
 * without dumping 10k rows.
 */
export function list_ids_for_suggest(dict: BibtexDict, query: string): LibraryListResult {
	const q = query.trim()
	const ids: string[] = []
	let matched = 0

	for (const id of sorted_ids(dict)) {
		const entry = dict[id]
		if (!entry) continue
		if (q.length > 0 && !match_query(entry, q)) continue
		matched++
		if (ids.length < SUGGEST_RESULT_CAP) {
			ids.push(id)
		}
	}

	return {
		ids,
		matched,
		truncated: matched > ids.length,
		kind: q.length === 0 ? 'empty_preview' : 'search',
	}
}

export type ClashListResult = {
	clashes: Clash[]
	/** How many clashes existed before the mount cap. */
	matched: number
	/** True when more clashes exist than were returned. */
	truncated: boolean
}

/**
 * Clash panel listing policy: hard-capped at {@link CLASH_RESULT_CAP} clash
 * cards, same reasoning as {@link list_ids_for_panel} — a messy import can
 * produce as many clash groups as there are entries, and mounting one card
 * + one row per member per clash without a cap is the same unbounded-DOM
 * risk the papers list used to have.
 */
export function list_clashes_for_panel(clashes: Clash[]): ClashListResult {
	const matched = clashes.length
	const capped = clashes.slice(0, CLASH_RESULT_CAP)
	return {
		clashes: capped,
		matched,
		truncated: matched > capped.length,
	}
}

/** Scroll-window math for a virtualized list (pure; used by panel + tests). */
export function visible_window(
	scroll_top: number,
	viewport_h: number,
	row_h: number,
	total: number,
	overscan: number = 4,
): { start: number; end: number } {
	const safe_row = Math.max(1, row_h)
	const start = Math.max(0, Math.floor(scroll_top / safe_row) - overscan)
	const visible = Math.ceil(viewport_h / safe_row) + overscan * 2
	const end = Math.min(total, start + visible)
	return { start, end }
}

/** True when mounting `n` full hover hosts would be reckless without a cap. */
export function is_unsafe_full_mount(entry_count: number, mounted: number): boolean {
	return entry_count > PANEL_RESULT_CAP && mounted > PANEL_RESULT_CAP
}

/** Expose slim field set for match_query free-text (tests / docs). */
export function free_text_field_values(entry: BibtexElement): string[] {
	const out: string[] = []
	for (const key of FREE_TEXT_SEARCH_FIELDS) {
		const v = entry.fields[key]
		if (v != null && String(v).length > 0) {
			out.push(String(v))
		}
	}
	return out
}
