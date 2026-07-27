import { describe, expect, it } from 'vitest'
import type { BibtexDict, BibtexElement, Clash } from 'src/bibtex'
import { match_query, query_match_score, query_matches_citekey } from 'src/bibtex'
import {
	CLASH_RESULT_CAP,
	compare_by_mention_count,
	diff_window_ids,
	DISCOVER_RESULT_CAP,
	filtered_ids,
	has_any_match,
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
	should_repaint_window,
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

	it('matches Unicode / ASCII / TeX forms via search normalize (accent-fold)', () => {
		const accented = entry('Mueller2019', {
			title: 'Learning with M{\\"u}ller trees',
			author: 'G{\\"u}nter M{\\"u}ller',
		})
		expect(match_query(accented, 'Müller')).toBe(true)
		expect(match_query(accented, 'Muller')).toBe(true)
		expect(match_query(accented, 'Günter')).toBe(true)
		// Raw TeX still matches (normalized on both sides).
		expect(match_query(accented, 'M{\\"u}ller')).toBe(true)
	})

	it('matches multi-word free-text order-independently within the entry', () => {
		const e2 = entry('DiffX2', {
			title: 'Differential Transformer',
			author: 'Alice Smith',
			year: '2020',
		})
		expect(match_query(e2, 'transformer differential')).toBe(true)
		// Entry-level: tokens may live in different slim fields.
		expect(match_query(e2, 'smith 2020')).toBe(true)
		expect(match_query(e2, 'differential smith')).toBe(true)
		// Missing token → no match.
		expect(match_query(e2, 'smith 2019')).toBe(false)
	})

	it('key:value still accent-folds and token-ANDs within that field', () => {
		const accented = entry('Mueller2019b', {
			title: 'Other',
			author: 'G{\\"u}nter M{\\"u}ller',
		})
		expect(match_query(accented, 'author:Muller')).toBe(true)
		expect(match_query(accented, 'author:Gunter Muller')).toBe(true)
		expect(match_query(accented, 'title:Muller')).toBe(false)
	})

	it('semicolon still ANDs independent clauses', () => {
		const e2 = entry('DiffX3', {
			title: 'Differential Transformer',
			author: 'Alice Smith',
			year: '2020',
		})
		expect(match_query(e2, 'differential;smith')).toBe(true)
		expect(match_query(e2, 'differential;jones')).toBe(false)
	})

	it('treats colons in titles as free-text, not as key:value', () => {
		const e2 = entry('Vaswani2017', {
			title: 'Attention Is All You Need: Transformers',
			author: 'Ashish Vaswani',
		})
		// Phrase with colon must still match (not parsed as field "Attention Is All You Need").
		expect(match_query(e2, 'Attention Is All You Need: Transformers')).toBe(true)
		expect(match_query(e2, 'need: transformers')).toBe(true)
		expect(match_query(e2, 'vaswani transformers')).toBe(true)
	})

	it('field-like key absent on entry does not free-text-fallback', () => {
		const e2 = entry('BookOnly', {
			title: 'Nature of Learning',
			// no journal field
		})
		// Must not match just because "Nature" appears in the title.
		expect(match_query(e2, 'journal:Nature')).toBe(false)
	})

	it('fuzzy: antibiofilm / magepix paper — partials, typos, any order', () => {
		const paper = entry('CeballosGarzon-antibiofilm_2025', {
			title:
				'Antibiofilm activity of manogepix, ibrexafungerp, amphotericin B, rezafungin, and caspofungin against <i>Candida</i> spp. biofilms of reference and clinical strains',
			author: 'Ceballos-Garzon, Andres and Lebrat, Julien and Holzapfel, Marion and Josa, Diego F. and Welsch, Jeremy and Mercer, Derry',
			year: '2025',
			journal: 'Antimicrobial Agents and Chemotherapy',
			doi: '10.1128/aac.00137-25',
		})
		// Full + typo
		expect(match_query(paper, 'antibiofilm magepix')).toBe(true)
		// Prefix stub + typo (user-reported shape)
		expect(match_query(paper, 'antibio magepix')).toBe(true)
		// Out of order
		expect(match_query(paper, 'magepix antibio')).toBe(true)
		expect(match_query(paper, 'manoge antibio')).toBe(true)
		// Prefix typo on a long word (full-word length-gate used to miss this)
		expect(match_query(paper, 'antbio manogepix')).toBe(true)
		expect(match_query(paper, 'manogepix')).toBe(true)
		// Unrelated typo should not match
		expect(match_query(paper, 'antibiofilm completelyunrelatedtypozz')).toBe(false)
	})

	it('caches the free-text corpus per entry object without leaking stale content across a new object', () => {
		// Same entry object queried repeatedly must stay consistent (cache reused, not stale-wrong).
		const e2 = entry('CacheX', { title: 'Original Title Xyzzy' })
		expect(match_query(e2, 'Xyzzy')).toBe(true)
		expect(match_query(e2, 'Xyzzy')).toBe(true) // second call hits the cache
		expect(match_query(e2, 'Nonexistentword')).toBe(false)

		// A distinct object (as upsert_entry always constructs on real field changes)
		// with different content must not reuse the old object's cached corpus.
		const e3 = entry('CacheX', { title: 'Completely Different Wobble' })
		expect(match_query(e3, 'Xyzzy')).toBe(false)
		expect(match_query(e3, 'Wobble')).toBe(true)
	})
})

describe('query_matches_citekey', () => {
	it('true when the free-text query matches within the citekey', () => {
		const e = entry('Smith2020', { title: 'Unrelated Title' })
		expect(query_matches_citekey(e, 'Smith2020')).toBe(true)
		expect(query_matches_citekey(e, 'smith')).toBe(true)
	})

	it('false when the query only matches other fields, not the citekey', () => {
		const e = entry('DiffX', { title: 'Differential Transformer' })
		expect(query_matches_citekey(e, 'Differential')).toBe(false)
	})

	it('false for a query that is entirely key:value clauses (no free-text component)', () => {
		const e = entry('Smith2020', { author: 'Smith' })
		expect(query_matches_citekey(e, 'author:Smith')).toBe(false)
	})

	it('multi-clause query only counts as a key match if every free-text clause hits the citekey', () => {
		const e = entry('Smith2020', { title: 'Other' })
		// "Smith2020" hits the citekey, "Other" does not -> not a pure key match.
		expect(query_matches_citekey(e, 'Smith2020;Other')).toBe(false)
		expect(query_matches_citekey(e, 'Smith2020;2020')).toBe(true)
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

	it('ranks citekey matches above other-field matches, even out of alpha order', () => {
		const d: BibtexDict = {}
		// Alphabetically "AAA..." would sort before "ZZZ...", but only the
		// second entry matches via its citekey — it should be ranked first.
		d['AAA_Other'] = entry('AAA_Other', { title: 'Mentions Smith2020 in the title' })
		d['ZZZ_Smith2020'] = entry('ZZZ_Smith2020', { title: 'Unrelated' })
		const r = list_ids_for_panel(d, 'Smith2020')
		expect(r.ids).toEqual(['ZZZ_Smith2020', 'AAA_Other'])
		expect(query_match_score(d['ZZZ_Smith2020']!, 'Smith2020')).toBeGreaterThan(
			query_match_score(d['AAA_Other']!, 'Smith2020'),
		)
	})

	it('keeps alpha order within the same score tier', () => {
		const d: BibtexDict = {}
		d['Zebra_key'] = entry('Zebra_key', {}) // citekey match
		d['Alpha_key'] = entry('Alpha_key', {}) // citekey match
		d['Middle'] = entry('Middle', { title: 'key mention in title' }) // other-field match
		const r = list_ids_for_panel(d, 'key')
		expect(r.ids).toEqual(['Alpha_key', 'Zebra_key', 'Middle'])
	})

	it('ranks exact title word above weaker substring/prefix hits', () => {
		const d: BibtexDict = {}
		d['Exact'] = entry('Exact', { title: 'The UNITE database' })
		d['Prefix'] = entry('Prefix', { title: 'Across the United States' })
		const r = list_ids_for_panel(d, 'UNITE')
		expect(r.ids[0]).toBe('Exact')
		expect(r.ids).toContain('Prefix')
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

	it('ranks citekey matches above other-field matches, even out of alpha order', () => {
		const d: BibtexDict = {}
		d['AAA_Other'] = entry('AAA_Other', { title: 'Mentions Smith2020 in the title' })
		d['ZZZ_Smith2020'] = entry('ZZZ_Smith2020', { title: 'Unrelated' })
		const r = list_ids_for_suggest(d, 'Smith2020')
		expect(r.ids).toEqual(['ZZZ_Smith2020', 'AAA_Other'])
	})
})

describe('has_any_match', () => {
	it('agrees with list_ids_for_suggest(...).ids.length > 0 across a small mixed fixture', () => {
		const d = dict_of(20, (i) =>
			entry(`Q${i}`, { title: i < 3 ? 'NeedleHere' : 'Hay' }),
		)
		expect(has_any_match(d, 'NeedleHere')).toBe(list_ids_for_suggest(d, 'NeedleHere').ids.length > 0)
		expect(has_any_match(d, 'NoSuchTokenAnywhere')).toBe(list_ids_for_suggest(d, 'NoSuchTokenAnywhere').ids.length > 0)
		expect(has_any_match(d, '')).toBe(list_ids_for_suggest(d, '').ids.length > 0)
	})

	it('true on empty query for a non-empty dict, false for an empty dict', () => {
		expect(has_any_match(dict_of(5), '')).toBe(true)
		expect(has_any_match({}, '')).toBe(false)
	})

	it('short-circuits without scanning the whole dict once a match is found', () => {
		const d = dict_of(10_000, (i) =>
			entry(`Q${String(i).padStart(5, '0')}`, { title: i === 0 ? 'NeedleHere' : 'Hay' }),
		)
		let reads = 0
		const counting_proxy = new Proxy(d, {
			get(target, prop, receiver) {
				reads++
				return Reflect.get(target, prop, receiver)
			},
		})
		expect(has_any_match(counting_proxy, 'NeedleHere')).toBe(true)
		// Only the first entry (which matches) should have been read, not all 10k.
		expect(reads).toBeLessThan(10)
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

	it('custom compare determines order when query is empty', () => {
		const d = dict_of(20)
		const ids = filtered_ids(d, '', (a, b) => b.localeCompare(a))
		expect(ids[0] > ids[1]).toBe(true)
	})

	it('non-empty query ranks by relevance like list_ids_for_panel (not bare alpha)', () => {
		const d: BibtexDict = {}
		d['Exact'] = entry('Exact', { title: 'The UNITE database' })
		d['Prefix'] = entry('Prefix', { title: 'Across the United States' })
		const ids = filtered_ids(d, 'UNITE')
		expect(ids[0]).toBe('Exact')
		expect(ids).toEqual(list_ids_for_panel(d, 'UNITE').ids)
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

describe('should_repaint_window', () => {
	it('first paint (prev null) always repaints', () => {
		const list_ref = {}
		expect(should_repaint_window(null, { list_ref, start: 0, end: 20 })).toBe(true)
	})

	it('same list_ref and same range is a no-op', () => {
		const list_ref = {}
		const prev = { list_ref, start: 5, end: 25 }
		expect(should_repaint_window(prev, { list_ref, start: 5, end: 25 })).toBe(false)
	})

	it('same list_ref but shifted range repaints', () => {
		const list_ref = {}
		const prev = { list_ref, start: 5, end: 25 }
		expect(should_repaint_window(prev, { list_ref, start: 6, end: 26 })).toBe(true)
	})

	it('different list_ref (fresh query/sort) repaints even with identical bounds', () => {
		const prev = { list_ref: {}, start: 0, end: 20 }
		// Same {start, end} as prev, but a different list_ref — must not be
		// mistaken for "nothing changed" (guards a just-emptied/rebuilt list).
		expect(should_repaint_window(prev, { list_ref: {}, start: 0, end: 20 })).toBe(true)
	})
})

describe('diff_window_ids', () => {
	it('ids in both old and new window are neither added nor removed', () => {
		const { added, removed } = diff_window_ids(['A', 'B', 'C'], ['B', 'C', 'D'])
		expect(added).toEqual(['D'])
		expect(removed).toEqual(['A'])
	})

	it('no overlap: everything old is removed, everything new is added', () => {
		const { added, removed } = diff_window_ids(['A', 'B'], ['C', 'D'])
		expect(added).toEqual(['C', 'D'])
		expect(removed).toEqual(['A', 'B'])
	})

	it('identical windows: nothing added or removed', () => {
		const { added, removed } = diff_window_ids(['A', 'B'], ['A', 'B'])
		expect(added).toEqual([])
		expect(removed).toEqual([])
	})

	it('empty mounted set: everything is added, nothing removed', () => {
		const { added, removed } = diff_window_ids([], ['A', 'B'])
		expect(added).toEqual(['A', 'B'])
		expect(removed).toEqual([])
	})
})
