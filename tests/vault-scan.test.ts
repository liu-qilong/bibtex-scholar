import { describe, expect, it, vi } from 'vitest'
import {
	count_inline_cites,
	order_scan_paths,
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
