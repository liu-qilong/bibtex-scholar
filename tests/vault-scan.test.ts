import { describe, expect, it, vi } from 'vitest'
import {
	cite_index_cites_for,
	cite_index_clear,
	cite_index_paths_for,
	cite_index_remove_path,
	cite_index_retarget_path,
	cite_index_set_path,
	count_inline_cites,
	create_cite_path_index,
	extract_inline_cite_ids,
	order_scan_paths,
	scan_bibtex_hits_chunked,
	scan_inline_cites_chunked,
} from 'src/vault-scan'

describe('vault-scan (Phase B)', () => {
	it('order_scan_paths puts priority first without duplicates', () => {
		const ordered = order_scan_paths(
			['c.md', 'a.md', 'b.md', 'd.md'],
			['b.md', 'missing.md', 'b.md'],
		)
		expect(ordered[0]).toBe('b.md')
		expect(ordered.slice(1)).toEqual(['a.md', 'c.md', 'd.md'])
	})

	it('count_inline_cites ignores bibtex fences and non-cite mentions', () => {
		const text = [
			'See `{Alpha}` and `[Alpha]`.',
			'```bibtex',
			'@article{Alpha, title={x}}',
			'```',
			'Alpha alone does not count.',
		].join('\n')
		expect(count_inline_cites(text, 'Alpha')).toBe(2)
		expect(count_inline_cites(text, 'Beta')).toBe(0)
	})

	it('chunked scan reads all files, prioritizes, yields between chunks', async () => {
		const files: Record<string, string> = {
			'open.md': 'cite `{Key}`',
			'a.md': 'nope',
			'b.md': '`[Key]` here',
			'c.md': 'nothing',
			'd.md': 'also `{Key}`',
		}
		const read_order: string[] = []
		const sleeps: number[] = []
		const progress: Array<[number, number]> = []

		const result = await scan_inline_cites_chunked({
			old_id: 'Key',
			paths: Object.keys(files),
			priority_paths: ['open.md'],
			read: async (path) => {
				read_order.push(path)
				return files[path] ?? ''
			},
			chunk_size: 2,
			yield_ms: 0,
			sleep: async (ms) => { sleeps.push(ms) },
			on_progress: (done, total) => progress.push([done, total]),
		})

		expect(read_order[0]).toBe('open.md')
		expect(result.files_read).toBe(5)
		expect(result.cancelled).toBe(false)
		expect(result.hits.map((h) => h.path).sort()).toEqual(['b.md', 'd.md', 'open.md'])
		expect(result.hits.find((h) => h.path === 'open.md')?.count).toBe(1)
		// 5 files, chunk 2 → yields after chunks that are not last
		expect(sleeps.length).toBeGreaterThanOrEqual(1)
		expect(progress.at(-1)).toEqual([5, 5])
	})

	it('cancel mid-scan stops further reads', async () => {
		let n = 0
		const paths = Array.from({ length: 20 }, (_, i) => `f${i}.md`)
		const result = await scan_inline_cites_chunked({
			old_id: 'X',
			paths,
			read: async (path) => {
				n++
				return path
			},
			chunk_size: 5,
			should_cancel: () => n >= 7,
			sleep: async () => {},
		})
		expect(result.cancelled).toBe(true)
		expect(result.files_read).toBeLessThan(20)
		expect(result.files_read).toBeGreaterThanOrEqual(7)
	})

	it('does not regex-scan files that lack the id substring', async () => {
		const spy = vi.fn(async () => 'completely unrelated text without the token')
		const result = await scan_inline_cites_chunked({
			old_id: 'RareKey',
			paths: ['a.md', 'b.md'],
			read: spy,
			chunk_size: 10,
			sleep: async () => {},
		})
		expect(result.hits).toEqual([])
		expect(spy).toHaveBeenCalledTimes(2)
	})
})

describe('vault-scan bibtex harvest (SPEED S4)', () => {
	it('collects hits across files, skips non-bibtex, yields between chunks', async () => {
		const files: Record<string, string> = {
			'a.md': '```bibtex\n@article{A, title={a}}\n```',
			'b.md': 'no blocks here',
			'c.md': '```bibtex\n@article{C, title={c}, doi={10/c}}\n```',
			'd.md': 'still nothing',
		}
		const sleeps: number[] = []
		const progress: Array<[number, number]> = []

		const result = await scan_bibtex_hits_chunked({
			paths: ['a.md', 'b.md', 'c.md', 'd.md'],
			read: async (path) => files[path] ?? '',
			chunk_size: 2,
			yield_ms: 0,
			sleep: async (ms) => { sleeps.push(ms) },
			on_progress: (done, total) => progress.push([done, total]),
		})

		expect(result.cancelled).toBe(false)
		expect(result.files_read).toBe(4)
		expect(result.files_skipped).toBe(2)
		expect(result.hits.map((h) => h.id).sort()).toEqual(['A', 'C'])
		expect(result.hits.find((h) => h.id === 'C')?.doi).toBe('10/c')
		expect(sleeps.length).toBeGreaterThanOrEqual(1)
		expect(progress.at(-1)).toEqual([4, 4])
	})

	it('cancel mid-scan leaves partial hits and cancelled=true (caller must not commit)', async () => {
		let n = 0
		const paths = Array.from({ length: 20 }, (_, i) => `f${i}.md`)
		const result = await scan_bibtex_hits_chunked({
			paths,
			read: async (path) => {
				n++
				return '```bibtex\n@article{X, title={x}}\n```'
			},
			chunk_size: 5,
			should_cancel: () => n >= 7,
			sleep: async () => {},
		})
		expect(result.cancelled).toBe(true)
		expect(result.files_read).toBeLessThan(20)
		expect(result.files_read).toBeGreaterThanOrEqual(7)
		// Partial harvest is returned for debugging; rescan_vault must not swap cache.
		expect(result.hits.length).toBe(result.files_read - result.files_skipped)
	})
})

describe('vault-scan cite reverse index (SPEED S6)', () => {
	it('extract_inline_cite_ids ignores fences and de-dupes', () => {
		const text = [
			'`{Alpha}` and `[Beta]` and `{Alpha}`',
			'```bibtex',
			'@article{Gamma, title={x}}',
			'```',
			'`[Gamma]` after',
		].join('\n')
		expect(extract_inline_cite_ids(text).sort()).toEqual(['Alpha', 'Beta', 'Gamma'])
	})

	it('set/remove/retarget keep cite↔path edges consistent', () => {
		const idx = create_cite_path_index()
		cite_index_set_path(idx, 'a.md', ['X', 'Y'])
		cite_index_set_path(idx, 'b.md', ['X'])
		expect(cite_index_paths_for(idx, 'X')).toEqual(['a.md', 'b.md'])
		expect(cite_index_cites_for(idx, 'a.md')).toEqual(['X', 'Y'])

		cite_index_set_path(idx, 'a.md', ['Y']) // drop X from a
		expect(cite_index_paths_for(idx, 'X')).toEqual(['b.md'])
		expect(cite_index_paths_for(idx, 'Y')).toEqual(['a.md'])

		cite_index_retarget_path(idx, 'b.md', 'b2.md')
		expect(cite_index_paths_for(idx, 'X')).toEqual(['b2.md'])
		expect(cite_index_cites_for(idx, 'b.md')).toEqual([])

		cite_index_remove_path(idx, 'a.md')
		expect(cite_index_paths_for(idx, 'Y')).toEqual([])
		cite_index_clear(idx)
		expect(cite_index_paths_for(idx, 'X')).toEqual([])
	})

	it('full cite scan populates index for all paths in one pass', async () => {
		const files: Record<string, string> = {
			'a.md': '`{Alpha}`',
			'b.md': 'no cites',
			'c.md': '`[Alpha]` and `{Beta}`',
		}
		const idx = create_cite_path_index()
		const result = await scan_inline_cites_chunked({
			old_id: 'Alpha',
			paths: Object.keys(files),
			read: async (path) => files[path] ?? '',
			chunk_size: 10,
			sleep: async () => {},
			cite_index: idx,
		})
		expect(result.hits.map((h) => h.path).sort()).toEqual(['a.md', 'c.md'])
		expect(cite_index_paths_for(idx, 'Alpha')).toEqual(['a.md', 'c.md'])
		expect(cite_index_paths_for(idx, 'Beta')).toEqual(['c.md'])
		expect(cite_index_cites_for(idx, 'b.md')).toEqual([])
	})
})
