import { describe, expect, it } from 'vitest'
import { find_clashes, type ClashHit } from 'src/bibtex'

describe('find_clashes trust checks', () => {
	const h = (id: string, path: string, line: number, doi?: string): ClashHit => ({
		id, path, line, doi,
	})

	it('groups undirected citeKey collisions once', () => {
		const clashes = find_clashes([
			h('Same', 'a.md', 1),
			h('Same', 'b.md', 2),
		])
		expect(clashes).toHaveLength(1)
		expect(clashes[0].reasons).toEqual(['citeKey'])
		expect(clashes[0].members).toHaveLength(2)
	})

	it('merges DOI + citeKey reasons on same member set', () => {
		const clashes = find_clashes([
			h('A', 'a.md', 1, '10/x'),
			h('A', 'b.md', 1, '10/x'),
		])
		expect(clashes).toHaveLength(1)
		expect(clashes[0].reasons).toEqual(['DOI', 'citeKey'])
	})

	it('ignores singleton hits', () => {
		expect(find_clashes([h('Only', 'a.md', 0, '10/y')])).toEqual([])
	})
})
