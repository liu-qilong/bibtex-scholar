/**
 * Bounded vault scans for inline cite propagation (Phase B).
 * Pure w.r.t. Obsidian — inject path list + reader for tests.
 */

import { INLINE_CITE_RE, type CiteHit } from 'src/bibtex'

export type VaultRead = (path: string) => Promise<string>

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
}

export type ChunkedScanResult = {
	hits: CiteHit[]
	/** Number of files actually read from the vault. */
	files_read: number
	/** Files skipped because cancelled mid-scan. */
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
