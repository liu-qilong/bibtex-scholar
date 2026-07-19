import { describe, expect, it } from 'vitest'
import { build_clash_reasons_by_id, find_clashes, source_tag_state, type ClashHit } from 'src/bibtex'

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

describe('build_clash_reasons_by_id', () => {
	const h = (id: string, path: string, line: number, doi?: string): ClashHit => ({
		id, path, line, doi,
	})

	it('is empty when there are no clashes', () => {
		expect(build_clash_reasons_by_id([])).toEqual(new Map())
	})

	it('flags both sides of a citeKey clash with the same reason', () => {
		const clashes = find_clashes([
			h('Same', 'a.md', 1),
			h('Same', 'b.md', 2),
		])
		const by_id = build_clash_reasons_by_id(clashes)
		expect(by_id.get('Same')).toEqual(['citeKey'])
	})

	it('merges reasons across two different clash groups sharing an id', () => {
		// 'A' clashes on citeKey with 'B' (different DOI), and separately on DOI with 'C' (different id).
		const clashes = find_clashes([
			h('A', 'a.md', 0, '10/a'),
			h('A', 'b.md', 0, '10/b'),
			h('C', 'c.md', 0, '10/a'),
		])
		const by_id = build_clash_reasons_by_id(clashes)
		expect(by_id.get('A')).toEqual(['DOI', 'citeKey'])
		expect(by_id.get('C')).toEqual(['DOI'])
	})

	it('a losing duplicate and its winner both get the same reasons', () => {
		const clashes = find_clashes([
			h('Dup', 'winner.md', 0, '10/x'),
			h('Dup', 'loser.md', 0, '10/x'),
		])
		const by_id = build_clash_reasons_by_id(clashes)
		expect(by_id.get('Dup')).toEqual(['DOI', 'citeKey'])
	})
})

describe('source_tag_state', () => {
	it('falls back to the plain "source" label when there is no clash', () => {
		expect(source_tag_state(undefined)).toEqual({
			clashing: false,
			text: 'source',
			title: null,
		})
		expect(source_tag_state([])).toEqual({
			clashing: false,
			text: 'source',
			title: null,
		})
	})

	it('joins reasons for the clash label and tooltip', () => {
		const state = source_tag_state(['DOI', 'citeKey'])
		expect(state.clashing).toBe(true)
		expect(state.text).toBe('DOI · citeKey')
		expect(state.title).toContain('DOI · citeKey')
		expect(state.title).toContain('Recache and collect collisions')
	})
})
