/**
 * Scale helpers for large libraries (10k+ entries).
 * Pure: no Obsidian APIs — caps, slim search fields, list windowing math.
 */

import {
	FREE_TEXT_MATCH_FIELDS,
	match_query,
	query_match_score,
	type BibtexDict,
	type BibtexElement,
	type Clash,
	type ClashHit,
} from 'src/bibtex'

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

/**
 * Design-time missing-PDF row height (px) at {@link LIST_ROW_FONT_BASE}.
 * Prefer {@link missing_pdf_row_height_px} when the scroll uses a live font
 * size — a flat height doesn't grow with card_font_size like the list does.
 */
export const MISSING_PDF_ROW_HEIGHT = 28

/** Overscan rows above/below the missing-PDF viewport. */
export const MISSING_PDF_OVERSCAN = 6

/**
 * Virtual missing-PDF row height for the current font size. Single-line row
 * (unlike list mode's title+meta), so a smaller ratio than {@link list_row_height_px}.
 */
export function missing_pdf_row_height_px(font_px: number = LIST_ROW_FONT_BASE): number {
	const f = Number.isFinite(font_px) && font_px > 0 ? font_px : LIST_ROW_FONT_BASE
	return Math.max(MISSING_PDF_ROW_HEIGHT, Math.round(f * (MISSING_PDF_ROW_HEIGHT / LIST_ROW_FONT_BASE)))
}

/**
 * Design-time list row height (px) at {@link LIST_ROW_FONT_BASE}.
 * Prefer {@link list_row_height_px} when the list scroll uses a live font size —
 * fixed 56px + large card_font_size was clipping title descenders (g, y, p).
 */
export const LIST_ROW_HEIGHT = 60

/** Font size (px) assumed by {@link LIST_ROW_HEIGHT} / CSS em metrics. */
export const LIST_ROW_FONT_BASE = 13

/**
 * Virtual list row height for the current list font size.
 * ~4.6em covers title (line-height 1.4) + compact meta + padding/gap with
 * headroom so glyph descenders are not clipped by overflow:hidden.
 */
export function list_row_height_px(font_px: number = LIST_ROW_FONT_BASE): number {
	const f = Number.isFinite(font_px) && font_px > 0 ? font_px : LIST_ROW_FONT_BASE
	return Math.max(LIST_ROW_HEIGHT, Math.round(f * 4.6))
}

/** Overscan rows above/below the list-mode viewport. */
export const LIST_OVERSCAN = 6

/**
 * Free-text (no `key:`) match only scans these fields.
 * Alias of {@link FREE_TEXT_MATCH_FIELDS} — single source of truth in bibtex.ts.
 * Long fields like abstract stay available via explicit `abstract:…` queries.
 */
export const FREE_TEXT_SEARCH_FIELDS = FREE_TEXT_MATCH_FIELDS

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
 * Every match for a non-empty free-text query, ranked by {@link query_match_score}
 * (desc) then `tiebreak`. Single ranking path shared by panel discover, panel
 * list mode, and `{`/`[` EditorSuggest — membership is always {@link match_query}.
 */
function scored_matches(
	dict: BibtexDict,
	q: string,
	tiebreak: (a: string, b: string) => number = (a, b) => a.localeCompare(b),
): { id: string; score: number }[] {
	const scored: { id: string; score: number }[] = []
	for (const id of Object.keys(dict)) {
		const entry = dict[id]
		if (!entry || !match_query(entry, q)) continue
		scored.push({ id, score: query_match_score(entry, q) })
	}
	scored.sort((a, b) => b.score - a.score || tiebreak(a.id, b.id))
	return scored
}

/**
 * Ranked + capped search hits (discover / EditorSuggest mount caps).
 */
function ranked_search_ids(dict: BibtexDict, q: string, cap: number): LibraryListResult {
	const scored = scored_matches(dict, q)
	const matched = scored.length
	const ids = scored.slice(0, cap).map((s) => s.id)
	return {
		ids,
		matched,
		truncated: matched > ids.length,
		kind: 'search',
	}
}

/**
 * Paper panel listing policy:
 * - empty / whitespace query → first {@link PANEL_EMPTY_PREVIEW} ids (sorted), never full library
 * - non-empty query → match_query hits, hard-capped at {@link PANEL_RESULT_CAP}
 *   ranked by {@link query_match_score} (citekey + exact/prefix above weak fuzzy), alpha tiebreak
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
	return ranked_search_ids(dict, q, PANEL_RESULT_CAP)
}

/**
 * EditorSuggest listing: same match rules, capped at {@link SUGGEST_RESULT_CAP}.
 * Empty query still returns a capped prefix so `{` alone is usable on small libs
 * without dumping 10k rows. Non-empty query ranks by {@link query_match_score}
 * (same policy as {@link list_ids_for_panel}).
 */
export function list_ids_for_suggest(dict: BibtexDict, query: string): LibraryListResult {
	const q = query.trim()
	if (q.length === 0) {
		const all = sorted_ids(dict)
		const ids = all.slice(0, SUGGEST_RESULT_CAP)
		return {
			ids,
			matched: all.length,
			truncated: all.length > ids.length,
			kind: 'empty_preview',
		}
	}
	return ranked_search_ids(dict, q, SUGGEST_RESULT_CAP)
}

/**
 * Cheap existence check for EditorSuggest's `onTrigger` — short-circuits on
 * the first match instead of building the capped id list that
 * {@link list_ids_for_suggest} does, since that caller only needs a boolean
 * to decide whether to open the suggest popup at all (the actual capped list
 * is fetched separately by `getSuggestions`, which does need it).
 */
export function has_any_match(dict: BibtexDict, query: string): boolean {
	const q = query.trim()
	for (const id of Object.keys(dict)) {
		const entry = dict[id]
		if (!entry) continue
		if (q.length === 0 || match_query(entry, q)) return true
	}
	return false
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
 * Unbounded filtered id list — backs list mode, which virtualizes instead of
 * hard-capping.
 *
 * - empty query → every id, ordered by `compare` only (browse / A–Z / most-cited)
 * - non-empty query → same {@link match_query} + {@link query_match_score} ranking
 *   as {@link list_ids_for_panel} / {@link list_ids_for_suggest}; `compare` is
 *   only the score tiebreak (so list mode search order matches the `{` tooltip)
 */
export function filtered_ids(
	dict: BibtexDict,
	query: string,
	compare: (a: string, b: string) => number = (a, b) => a.localeCompare(b),
): string[] {
	const q = query.trim()
	if (q.length === 0) {
		return Object.keys(dict).sort(compare)
	}
	return scored_matches(dict, q, compare).map((s) => s.id)
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

/**
 * True when a virtualized window actually needs repainting. `list_ref` is an
 * identity token for the current list (e.g. the rows container element) —
 * comparing it alongside `{start, end}` means a stale cached range from a
 * previous query/sort can never wrongly suppress a real paint, since a fresh
 * list always gets a new `list_ref`. `prev === null` (first paint) always repaints.
 */
export function should_repaint_window<T>(
	prev: { list_ref: T; start: number; end: number } | null,
	next: { list_ref: T; start: number; end: number },
): boolean {
	if (!prev) return true
	return prev.list_ref !== next.list_ref || prev.start !== next.start || prev.end !== next.end
}

/**
 * Which currently-mounted ids should be unmounted (fell out of the window)
 * and which are newly visible (need mounting), for windowed row reuse —
 * ids present in both stay untouched (same DOM node, same live hover chip).
 */
export function diff_window_ids(mounted_ids: Iterable<string>, next_ids: string[]): { added: string[]; removed: string[] } {
	const next_set = new Set(next_ids)
	const removed: string[] = []
	for (const id of mounted_ids) {
		if (!next_set.has(id)) removed.push(id)
	}
	const mounted_set = new Set(mounted_ids)
	const added = next_ids.filter((id) => !mounted_set.has(id))
	return { added, removed }
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
