/**
 * Bounded vault scans: inline cite propagation + full-library bibtex hit collection.
 * Pure w.r.t. Obsidian — inject path list + reader for tests.
 *
 * SPEED S6: reverse cite indexes (citekey→paths, path→citekeys) live here so
 * rename scans can reuse the same pass that builds them.
 */

import { INLINE_CITE_RE, type CiteHit } from 'src/bibtex'
import { collect_hits_from_markdown, type ScanHit } from 'src/cache-ops'
import { text_may_contain_bibtex_block } from 'src/cite-span'

export type VaultRead = (path: string) => Promise<string>

// ─── SPEED S6: reverse indexes for inline cites ─────────────────────────────

/**
 * Bidirectional index of inline `` `{id}` `` / `` `[id]` `` cites.
 * Not durable — rebuilt on first full cite scan after invalidate.
 */
export type CitePathIndex = {
	cite_to_paths: Map<string, Set<string>>
	path_to_cites: Map<string, Set<string>>
}

export function create_cite_path_index(): CitePathIndex {
	return {
		cite_to_paths: new Map(),
		path_to_cites: new Map(),
	}
}

export function cite_index_clear(index: CitePathIndex): void {
	index.cite_to_paths.clear()
	index.path_to_cites.clear()
}

/** Unique inline citekeys in `text` (fences stripped). */
export function extract_inline_cite_ids(text: string): string[] {
	const body = text.replace(/```bibtex[\s\S]*?```/g, '')
	const found = new Set<string>()
	const re = new RegExp(INLINE_CITE_RE.source, 'g')
	let m: RegExpExecArray | null
	while ((m = re.exec(body)) !== null) {
		if (m[2]) found.add(m[2])
	}
	return [...found]
}

/** Drop every association for `path`. */
export function cite_index_remove_path(index: CitePathIndex, path: string): void {
	const old = index.path_to_cites.get(path)
	if (!old) return
	for (const id of old) {
		const paths = index.cite_to_paths.get(id)
		if (!paths) continue
		paths.delete(path)
		if (paths.size === 0) index.cite_to_paths.delete(id)
	}
	index.path_to_cites.delete(path)
}

/**
 * Replace the cite set for `path` (remove old edges, add new).
 * Pass empty `cite_ids` to clear the path from the index.
 */
export function cite_index_set_path(index: CitePathIndex, path: string, cite_ids: string[]): void {
	cite_index_remove_path(index, path)
	if (cite_ids.length === 0) return
	const set = new Set(cite_ids)
	index.path_to_cites.set(path, set)
	for (const id of set) {
		let paths = index.cite_to_paths.get(id)
		if (!paths) {
			paths = new Set()
			index.cite_to_paths.set(id, paths)
		}
		paths.add(path)
	}
}

/** Move path key after a vault rename. */
export function cite_index_retarget_path(index: CitePathIndex, old_path: string, new_path: string): void {
	const cites = index.path_to_cites.get(old_path)
	if (!cites) return
	const ids = [...cites]
	cite_index_remove_path(index, old_path)
	cite_index_set_path(index, new_path, ids)
}

/** Sorted paths known to cite `id` (empty array if none). */
export function cite_index_paths_for(index: CitePathIndex, id: string): string[] {
	const paths = index.cite_to_paths.get(id)
	if (!paths || paths.size === 0) return []
	return [...paths].sort((a, b) => a.localeCompare(b))
}

/** Sorted citekeys known for `path` (empty if none). */
export function cite_index_cites_for(index: CitePathIndex, path: string): string[] {
	const cites = index.path_to_cites.get(path)
	if (!cites || cites.size === 0) return []
	return [...cites].sort((a, b) => a.localeCompare(b))
}

export type ChunkedScanOptions = {
	old_id: string
	/** All candidate markdown paths (typically vault-wide). */
	paths: string[]
	/** Paths to scan first (e.g. active/open files). */
	priority_paths?: string[]
	read: VaultRead
	/** Files per event-loop chunk (default 32). */
	chunk_size?: number
	/** Yield between chunks (default 0 → microtask-friendly setTimeout 0). */
	yield_ms?: number
	on_progress?: (done: number, total: number) => void
	should_cancel?: () => boolean
	sleep?: (ms: number) => Promise<void>
	/**
	 * When set, each file's inline citekeys update this index (SPEED S6).
	 * Used while building a full index on a vault-wide pass.
	 */
	cite_index?: CitePathIndex
}

export type ChunkedScanResult = {
	hits: CiteHit[]
	/** Number of files actually read from the vault. */
	files_read: number
	/** True when stopped early via should_cancel. */
	cancelled: boolean
}

/** Options for a full-vault ```bibtex block harvest (SPEED S4). */
export type ChunkedBibtexScanOptions = {
	paths: string[]
	read: VaultRead
	chunk_size?: number
	yield_ms?: number
	on_progress?: (done: number, total: number) => void
	should_cancel?: () => boolean
	sleep?: (ms: number) => Promise<void>
	/** Override for tests; default is {@link collect_hits_from_markdown}. */
	collect?: (path: string, text: string) => Promise<ScanHit[]>
}

export type ChunkedBibtexScanResult = {
	hits: ScanHit[]
	files_read: number
	/** Files read that had no ```bibtex gate hit (still counted as read). */
	files_skipped: number
	cancelled: boolean
}

const default_sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms)
	})

/**
 * Stable path order: unique priority paths first (in given order), then the rest sorted.
 */
export function order_scan_paths(all_paths: string[], priority_paths: string[] = []): string[] {
	const all_set = new Set(all_paths)
	const out: string[] = []
	const seen = new Set<string>()
	for (const p of priority_paths) {
		if (all_set.has(p) && !seen.has(p)) {
			out.push(p)
			seen.add(p)
		}
	}
	const rest = all_paths.filter((p) => !seen.has(p)).sort((a, b) => a.localeCompare(b))
	return out.concat(rest)
}

/** Count inline `` `{id}` `` / `` `[id]` `` occurrences outside bibtex fences. */
export function count_inline_cites(text: string, old_id: string): number {
	// Cheap reject before regex work.
	if (!text.includes(old_id)) {
		return 0
	}
	const body = text.replace(/```bibtex[\s\S]*?```/g, '')
	if (!body.includes(old_id)) {
		return 0
	}
	let count = 0
	const re = new RegExp(INLINE_CITE_RE.source, 'g')
	let m: RegExpExecArray | null
	while ((m = re.exec(body)) !== null) {
		if (m[2] === old_id) count++
	}
	return count
}

/**
 * Scan vault paths for inline citations of `old_id`, yielding between chunks
 * so the UI can paint (progress notices, input).
 */
export async function scan_inline_cites_chunked(opts: ChunkedScanOptions): Promise<ChunkedScanResult> {
	const chunk_size = opts.chunk_size ?? 32
	const yield_ms = opts.yield_ms ?? 0
	const sleep = opts.sleep ?? default_sleep
	const ordered = order_scan_paths(opts.paths, opts.priority_paths ?? [])
	const total = ordered.length
	const hits: CiteHit[] = []
	let files_read = 0
	let cancelled = false

	for (let i = 0; i < ordered.length; i += chunk_size) {
		if (opts.should_cancel?.()) {
			cancelled = true
			break
		}
		const chunk = ordered.slice(i, i + chunk_size)
		for (const path of chunk) {
			if (opts.should_cancel?.()) {
				cancelled = true
				break
			}
			const text = await opts.read(path)
			files_read++
			if (opts.cite_index) {
				cite_index_set_path(opts.cite_index, path, extract_inline_cite_ids(text))
			}
			const count = count_inline_cites(text, opts.old_id)
			if (count > 0) {
				hits.push({ path, count })
			}
		}
		if (cancelled) break
		const done = Math.min(i + chunk.length, total)
		opts.on_progress?.(done, total)
		if (i + chunk_size < ordered.length) {
			await sleep(yield_ms)
		}
	}

	return { hits, files_read, cancelled }
}

/**
 * Harvest ```bibtex entries from markdown paths, yielding between chunks so the
 * UI can paint. Paths are scanned in the given order (callers usually sort).
 * On cancel: returns partial hits + cancelled=true; callers must not commit.
 */
export async function scan_bibtex_hits_chunked(
	opts: ChunkedBibtexScanOptions,
): Promise<ChunkedBibtexScanResult> {
	const chunk_size = opts.chunk_size ?? 32
	const yield_ms = opts.yield_ms ?? 0
	const sleep = opts.sleep ?? default_sleep
	const collect = opts.collect ?? collect_hits_from_markdown
	const total = opts.paths.length
	const hits: ScanHit[] = []
	let files_read = 0
	let files_skipped = 0
	let cancelled = false

	for (let i = 0; i < opts.paths.length; i += chunk_size) {
		if (opts.should_cancel?.()) {
			cancelled = true
			break
		}
		const chunk = opts.paths.slice(i, i + chunk_size)
		for (const path of chunk) {
			if (opts.should_cancel?.()) {
				cancelled = true
				break
			}
			const text = await opts.read(path)
			files_read++
			if (!text_may_contain_bibtex_block(text)) {
				files_skipped++
				continue
			}
			const file_hits = await collect(path, text)
			for (const h of file_hits) {
				hits.push(h)
			}
		}
		if (cancelled) break
		const done = Math.min(i + chunk.length, total)
		opts.on_progress?.(done, total)
		if (i + chunk_size < opts.paths.length) {
			await sleep(yield_ms)
		}
	}

	return { hits, files_read, files_skipped, cancelled }
}
