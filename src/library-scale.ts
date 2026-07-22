/**
 * Scale helpers for large libraries (10k+ entries).
 * Pure: no Obsidian APIs — caps, slim search fields, list windowing math.
 */

import { match_query, type BibtexDict, type BibtexElement, type Clash, type ClashHit } from 'src/bibtex'

/** Empty paper-panel list: show this many sorted ids, not the whole library. */
export const PANEL_EMPTY_PREVIEW = 50

/** Max chips mounted in the paper panel for a search result set. */
export const PANEL_RESULT_CAP = 80

/** Max EditorSuggest rows returned per keystroke. */
export const SUGGEST_RESULT_CAP = 50

/** Max clash cards mounted in the clash panel. */
export const CLASH_RESULT_CAP = 80

/**
 * Discover-mode chip cap (not virtualized — chips need real listeners to
 * respond to hover, so unlike list mode this stays a hard mount cap).
 */
export const DISCOVER_RESULT_CAP = 140

/** Assumed row height (px) for missing-PDF virtual list layout. */
export const MISSING_PDF_ROW_HEIGHT = 28

/** Overscan rows above/below the missing-PDF viewport. */
export const MISSING_PDF_OVERSCAN = 6

/** Assumed row height (px) for list-mode's virtual layout (two-line row: title + meta). */
export const LIST_ROW_HEIGHT = 52

/** Overscan rows above/below the list-mode viewport. */
export const LIST_OVERSCAN = 6

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

/**
 * Random sample of `ids`, capped at `cap`, no duplicates. Injectable `rng`
 * (same convention as `probe_missing_pdf_chunked`'s injectable `sleep`) keeps
 * sampling deterministic in tests. Partial Fisher–Yates: only shuffles as
 * many positions as needed to fill the cap.
 */
export function random_sample_ids(ids: string[], cap: number, rng: () => number = Math.random): string[] {
	const pool = ids.slice()
	const n = Math.min(cap, pool.length)
	for (let i = 0; i < n; i++) {
		const j = i + Math.floor(rng() * (pool.length - i))
		;[pool[i], pool[j]] = [pool[j], pool[i]]
	}
	return pool.slice(0, n)
}

/**
 * Unbounded sorted + filtered id list — backs list mode, which virtualizes
 * instead of hard-capping. Same `match_query` filtering as {@link list_ids_for_panel},
 * just without a mount cap. `compare` defaults to alpha (same as every other
 * panel list); pass {@link compare_by_mention_count} for "Most cited" sort.
 */
export function filtered_ids(
	dict: BibtexDict,
	query: string,
	compare: (a: string, b: string) => number = (a, b) => a.localeCompare(b),
): string[] {
	const q = query.trim()
	const all = Object.keys(dict).sort(compare)
	if (q.length === 0) {
		return all
	}
	return all.filter((id) => {
		const entry = dict[id]
		return entry != null && match_query(entry, q)
	})
}

/** Descending mention count, alpha tiebreak — comparator for {@link filtered_ids}. */
export function compare_by_mention_count(counts: Map<string, number>): (a: string, b: string) => number {
	return (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b)
}

export type ClashListResult<H extends ClashHit = ClashHit> = {
	clashes: Clash<H>[]
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
 * risk the papers list used to have. Generic so callers that scan with
 * `ScanHit` (id/path/line + parsed `fields`) keep that data on `.members`.
 */
export function list_clashes_for_panel<H extends ClashHit>(clashes: Clash<H>[]): ClashListResult<H> {
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
