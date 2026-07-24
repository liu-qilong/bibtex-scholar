import { describe, expect, it } from 'vitest'
import type { BibtexDict, BibtexElement, Clash } from 'src/bibtex'
import { match_query } from 'src/bibtex'
import {
	CLASH_RESULT_CAP,
	compare_by_mention_count,
	DISCOVER_RESULT_CAP,
	filtered_ids,
	list_clashes_for_panel,
	list_ids_for_panel,
	list_ids_for_suggest,
	list_row_height_px,
	LIST_ROW_HEIGHT,
	missing_pdf_row_height_px,
	MISSING_PDF_ROW_HEIGHT,
	PANEL_EMPTY_PREVIEW,
	PANEL_RESULT_CAP,
	random_sample_ids,
	SUGGEST_RESULT_CAP,
	is_unsafe_full_mount,
	visible_window,
} from 'src/library-scale'

function entry(id: string, extra: Record<string, string> = {}): BibtexElement {
	return {
		fields: { type: 'article', id, title: `Title ${id}`, author: 'Ada', year: '2020', ...extra },
		source: `@article{${id},}`,
		source_path: `${id}.md`,
	}
}

function dict_of(n: number, map?: (i: number) => BibtexElement): BibtexDict {
	const d: BibtexDict = {}
	for (let i = 0; i < n; i++) {
		const e = map ? map(i) : entry(`Paper${String(i).padStart(4, '0')}`)
		d[e.fields.id] = e
	}
	return d
}

describe('match_query slim free-text', () => {
	const e = entry('DiffX', {
		title: 'Differential Transformer',
		abstract: 'unique-abstract-token-xyz cancels noise',
	})

	it('matches free-text on title/id, not abstract', () => {
		expect(match_query(e, 'Differential')).toBe(true)
		expect(match_query(e, 'DiffX')).toBe(true)
		expect(match_query(e, 'unique-abstract-token-xyz')).toBe(false)
	})

	it('still matches abstract via explicit key:value', () => {
		expect(match_query(e, 'abstract:unique-abstract-token-xyz')).toBe(true)
	})
})

describe('list_ids_for_panel', () => {
	it('empty query previews first N, never the full library', () => {
		const d = dict_of(200)
		const r = list_ids_for_panel(d, '')
		expect(r.kind).toBe('empty_preview')
		expect(r.ids).toHaveLength(PANEL_EMPTY_PREVIEW)
		expect(r.matched).toBe(200)
		expect(r.truncated).toBe(true)
		expect(r.ids[0] < r.ids[1]).toBe(true) // sorted
	})

	it('empty library returns empty preview', () => {
		const r = list_ids_for_panel({}, '  ')
		expect(r.ids).toEqual([])
		expect(r.matched).toBe(0)
		expect(r.truncated).toBe(false)
	})

	it('search caps mounts at PANEL_RESULT_CAP and reports full match count', () => {
		const d = dict_of(300, (i) =>
			entry(`Hit${String(i).padStart(4, '0')}`, { title: 'CommonTopic paper' }),
		)
		const r = list_ids_for_panel(d, 'CommonTopic')
		expect(r.kind).toBe('search')
		expect(r.ids).toHaveLength(PANEL_RESULT_CAP)
		expect(r.matched).toBe(300)
		expect(r.truncated).toBe(true)
	})

	it('search under the cap is not truncated', () => {
		const d = dict_of(5, (i) => entry(`Only${i}`, { title: 'RareZed' }))
		// plus noise
		d['Noise'] = entry('Noise', { title: 'Other' })
		const r = list_ids_for_panel(d, 'RareZed')
		expect(r.ids).toHaveLength(5)
		expect(r.matched).toBe(5)
		expect(r.truncated).toBe(false)
	})
})

describe('list_ids_for_suggest', () => {
	it('never returns more than SUGGEST_RESULT_CAP', () => {
		const d = dict_of(SUGGEST_RESULT_CAP + 40)
		const r = list_ids_for_suggest(d, '')
		expect(r.ids).toHaveLength(SUGGEST_RESULT_CAP)
		expect(r.truncated).toBe(true)
	})

	it('filters by query under the cap', () => {
		const d = dict_of(20, (i) =>
			entry(`Q${i}`, { title: i < 3 ? 'NeedleHere' : 'Hay' }),
		)
		const r = list_ids_for_suggest(d, 'NeedleHere')
		expect(r.ids).toHaveLength(3)
		expect(r.truncated).toBe(false)
	})
})

function clash_of(n: number): Clash[] {
	const out: Clash[] = []
	for (let i = 0; i < n; i++) {
		out.push({
			reasons: ['DOI'],
			members: [
				{ id: `A${i}`, path: `a${i}.md`, line: 1 },
				{ id: `B${i}`, path: `b${i}.md`, line: 1 },
			],
		})
	}
	return out
}

describe('list_clashes_for_panel', () => {
	it('caps mounted cards at CLASH_RESULT_CAP on a messy import', () => {
		const clashes = clash_of(300)
		const r = list_clashes_for_panel(clashes)
		expect(r.clashes).toHaveLength(CLASH_RESULT_CAP)
		expect(r.matched).toBe(300)
		expect(r.truncated).toBe(true)
	})

	it('under the cap is not truncated', () => {
		const clashes = clash_of(5)
		const r = list_clashes_for_panel(clashes)
		expect(r.clashes).toHaveLength(5)
		expect(r.matched).toBe(5)
		expect(r.truncated).toBe(false)
	})

	it('empty clash list returns empty, not truncated', () => {
		const r = list_clashes_for_panel([])
		expect(r.clashes).toEqual([])
		expect(r.matched).toBe(0)
		expect(r.truncated).toBe(false)
	})
})

describe('list_row_height_px', () => {
	it('scales with font size so large card fonts do not clip title descenders', () => {
		expect(list_row_height_px(13)).toBeGreaterThanOrEqual(LIST_ROW_HEIGHT)
		expect(list_row_height_px(20)).toBeGreaterThan(list_row_height_px(13))
		expect(list_row_height_px(20)).toBe(Math.round(20 * 4.6))
	})
})

describe('missing_pdf_row_height_px', () => {
	it('scales with font size so touch targets grow with a larger card font', () => {
		expect(missing_pdf_row_height_px(13)).toBeGreaterThanOrEqual(MISSING_PDF_ROW_HEIGHT)
		expect(missing_pdf_row_height_px(20)).toBeGreaterThan(missing_pdf_row_height_px(13))
		expect(missing_pdf_row_height_px(20)).toBe(Math.round(20 * (MISSING_PDF_ROW_HEIGHT / 13)))
	})
})

describe('visible_window', () => {
	it('computes a scroll window with overscan', () => {
		const { start, end } = visible_window(200, 100, 20, 1000, 2)
		// scroll 200 / 20 = row 10; overscan 2 → start 8; visible 5+4 → end 17
		expect(start).toBe(8)
		expect(end).toBe(17)
	})

	it('clamps to total', () => {
		const { start, end } = visible_window(0, 500, 20, 10, 4)
		expect(start).toBe(0)
		expect(end).toBe(10)
	})

	it('long missing-PDF list mounts a small window at the top (S7)', () => {
		const total = 5000
		const { start, end } = visible_window(0, 280, 28, total, 6)
		expect(start).toBe(0)
		// ceil(280/28)+12 = 10+12 = 22
		expect(end).toBe(22)
		expect(end - start).toBeLessThan(40)
	})
})

describe('is_unsafe_full_mount', () => {
	it('flags mounting more than the panel cap on a large library', () => {
		expect(is_unsafe_full_mount(10_000, 10_000)).toBe(true)
		expect(is_unsafe_full_mount(10_000, PANEL_RESULT_CAP)).toBe(false)
		expect(is_unsafe_full_mount(20, 20)).toBe(false)
	})
})

/** Deterministic [0,1) generator (simple LCG) so sampling tests aren't flaky. */
function seeded_rng(seed: number): () => number {
	let state = seed
	return () => {
		state = (state * 1103515245 + 12345) & 0x7fffffff
		return state / 0x7fffffff
	}
}

describe('random_sample_ids', () => {
	it('caps at `cap` with no duplicates, drawn from the input pool', () => {
		const ids = Array.from({ length: 500 }, (_, i) => `P${i}`)
		const sample = random_sample_ids(ids, DISCOVER_RESULT_CAP, seeded_rng(1))
		expect(sample).toHaveLength(DISCOVER_RESULT_CAP)
		expect(new Set(sample).size).toBe(DISCOVER_RESULT_CAP)
		for (const id of sample) {
			expect(ids).toContain(id)
		}
	})

	it('returns the whole pool, unchanged in length, when smaller than the cap', () => {
		const ids = ['A', 'B', 'C']
		const sample = random_sample_ids(ids, DISCOVER_RESULT_CAP, seeded_rng(2))
		expect(sample).toHaveLength(3)
		expect(new Set(sample)).toEqual(new Set(ids))
	})

	it('is deterministic given the same injected rng sequence', () => {
		const ids = Array.from({ length: 50 }, (_, i) => `P${i}`)
		const a = random_sample_ids(ids, 10, seeded_rng(42))
		const b = random_sample_ids(ids, 10, seeded_rng(42))
		expect(a).toEqual(b)
	})
})

describe('filtered_ids', () => {
	it('empty query returns every id, sorted, uncapped (unlike list_ids_for_panel)', () => {
		const d = dict_of(200)
		const ids = filtered_ids(d, '')
		expect(ids).toHaveLength(200)
		expect(ids[0] < ids[1]).toBe(true)
	})

	it('non-empty query filters via match_query, uncapped', () => {
		const d = dict_of(200, (i) => entry(`Q${i}`, { title: i < 90 ? 'NeedleHere' : 'Hay' }))
		const ids = filtered_ids(d, 'NeedleHere')
		expect(ids).toHaveLength(90) // more than PANEL_RESULT_CAP, none dropped
	})

	it('custom compare determines order', () => {
		const d = dict_of(20)
		const ids = filtered_ids(d, '', (a, b) => b.localeCompare(a))
		expect(ids[0] > ids[1]).toBe(true)
	})
})

describe('compare_by_mention_count', () => {
	it('sorts descending by count, alpha tiebreak, missing ids treated as 0', () => {
		const counts = new Map([['B', 5], ['A', 5], ['C', 1]])
		const ids = ['A', 'B', 'C', 'D'].sort(compare_by_mention_count(counts))
		expect(ids).toEqual(['A', 'B', 'C', 'D'])
	})
})

describe('10k smoke (scale)', () => {
	it('panel empty preview and suggest stay O(cap) on a 10k dict', () => {
		const d = dict_of(10_000)
		const panel = list_ids_for_panel(d, '')
		const suggest = list_ids_for_suggest(d, 'Paper0001')
		expect(panel.ids.length).toBe(PANEL_EMPTY_PREVIEW)
		expect(panel.matched).toBe(10_000)
		expect(suggest.ids.length).toBeLessThanOrEqual(SUGGEST_RESULT_CAP)
		// free-text id match should find the one paper
		expect(suggest.ids).toContain('Paper0001')
	})
})
