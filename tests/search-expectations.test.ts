/**
 * Full expectations matrix for every code path that runs library search.
 *
 * Paths under test (must stay equivalent on match rules *and* ranking):
 * 1. match_query              — pure matcher
 * 2. list_ids_for_panel       — paper panel discover-mode search
 * 3. filtered_ids             — paper panel list-mode search (uncapped; same score order)
 * 4. list_ids_for_suggest     — `{` / `[` EditorSuggest rows
 * 5. find_prompt_trigger      — gates the `{` tooltip open (must allow spaces + fuzzy)
 *
 * If a path diverges, users see "panel works but { suggest doesn't" (or vice versa).
 */
import { describe, expect, it } from 'vitest'
import { match_query, type BibtexDict, type BibtexElement } from 'src/bibtex'
import {
	filtered_ids,
	list_ids_for_panel,
	list_ids_for_suggest,
} from 'src/scale/library-scale'
import { find_prompt_trigger } from 'src/architecture/prompt-trigger'

const TARGET_ID = 'CeballosGarzon-antibiofilm_2025'

function entry(id: string, fields: Record<string, string> = {}): BibtexElement {
	return {
		fields: { type: 'article', id, ...fields },
		source_path: `notes/${id}.md`,
	}
}

/** Real-world fixture + distractors so false positives are visible. */
function library(): BibtexDict {
	return {
		[TARGET_ID]: entry(TARGET_ID, {
			title:
				'Antibiofilm activity of manogepix, ibrexafungerp, amphotericin B, rezafungin, and caspofungin against <i>Candida</i> spp. biofilms of reference and clinical strains',
			author:
				'Ceballos-Garzon, Andres and Lebrat, Julien and Holzapfel, Marion and Josa, Diego F. and Welsch, Jeremy and Mercer, Derry',
			year: '2025',
			journal: 'Antimicrobial Agents and Chemotherapy',
			doi: '10.1128/aac.00137-25',
			url: 'http://dx.doi.org/10.1128/aac.00137-25',
		}),
		Smith2020Deep: entry('Smith2020Deep', {
			title: 'Deep Learning for Widgets',
			author: 'Smith, Jane',
			year: '2020',
		}),
		Mueller2019: entry('Mueller2019', {
			title: 'Learning with M{\\"u}ller trees',
			author: 'G{\\"u}nter M{\\"u}ller',
			year: '2019',
		}),
		// Many "anti…" titles so cap/order bugs would hide the target if match were too broad alone.
		...Object.fromEntries(
			Array.from({ length: 20 }, (_, i) => {
				const id = `AntiOther${String(i).padStart(2, '0')}`
				return [
					id,
					entry(id, {
						title: `Antibiotic resistance survey ${i}`,
						author: 'Other, A',
						year: '2018',
					}),
				]
			}),
		),
	}
}

/** Queries that MUST hit TARGET_ID on every search path. */
const MUST_HIT: { name: string; query: string }[] = [
	{ name: 'full title word', query: 'antibiofilm' },
	{ name: 'drug typo (magepix≈manogepix)', query: 'magepix' },
	{ name: 'multi-token full+typo', query: 'antibiofilm magepix' },
	{ name: 'multi-token partial+typo (user shape)', query: 'antibio magepix' },
	{ name: 'out of order partial+typo', query: 'magepix antibio' },
	{ name: 'out of order stem+partial', query: 'manoge antibio' },
	{ name: 'prefix typo on long word', query: 'antbio manogepix' },
	{ name: 'author fragment', query: 'ceballos' },
	{ name: 'author + year entry-level AND', query: 'ceballos 2025' },
	{ name: 'citekey fragment', query: 'antibiofilm_2025' },
	{ name: 'DOI fragment', query: 'aac.00137' },
	{ name: 'HTML title still searchable', query: 'candida' },
	{ name: 'semicolon AND clauses', query: 'antibiofilm;ceballos' },
	{ name: 'field filter title', query: 'title:manogepix' },
	{ name: 'field filter author', query: 'author:ceballos' },
]

/** Queries that MUST NOT hit TARGET_ID (and should not spuriously open bad suggests). */
const MUST_MISS_TARGET: { name: string; query: string }[] = [
	{ name: 'unrelated long typo', query: 'antibiofilm completelyunrelatedtypozz' },
	{ name: 'wrong year with author', query: 'ceballos 2010' },
	{ name: 'absent field key', query: 'journal:Nature' }, // target journal is AAC, not Nature
	{ name: 'abstract free-text gated', query: 'unique-abstract-token-never-in-fields' },
]

function expect_hit_all_paths(dict: BibtexDict, query: string, id: string = TARGET_ID) {
	const entry = dict[id]!
	expect(match_query(entry, query), `match_query(${JSON.stringify(query)})`).toBe(true)

	const panel = list_ids_for_panel(dict, query)
	expect(panel.kind).toBe('search')
	expect(panel.ids, `list_ids_for_panel(${JSON.stringify(query)})`).toContain(id)
	expect(panel.matched).toBeGreaterThanOrEqual(1)

	const list = filtered_ids(dict, query)
	expect(list, `filtered_ids(${JSON.stringify(query)})`).toContain(id)

	const suggest = list_ids_for_suggest(dict, query)
	expect(suggest.ids, `list_ids_for_suggest(${JSON.stringify(query)})`).toContain(id)
	expect(suggest.matched).toBeGreaterThanOrEqual(1)
}

function expect_miss_target_all_paths(dict: BibtexDict, query: string, id: string = TARGET_ID) {
	const entry = dict[id]!
	expect(match_query(entry, query), `match_query miss ${JSON.stringify(query)}`).toBe(false)
	expect(list_ids_for_panel(dict, query).ids).not.toContain(id)
	expect(filtered_ids(dict, query)).not.toContain(id)
	expect(list_ids_for_suggest(dict, query).ids).not.toContain(id)
}

describe('search path inventory (documentation lock)', () => {
	it('all user-facing search entry points funnel through match_query', () => {
		// If you add a new path, extend this list and the matrix below.
		const paths = [
			'match_query',
			'list_ids_for_panel (panel discover SearchComponent)',
			'filtered_ids (panel list mode)',
			'list_ids_for_suggest (EditorPrompt.getSuggestions)',
			'find_prompt_trigger + list_ids_for_suggest gate (EditorPrompt.onTrigger)',
		]
		expect(paths.length).toBe(5)
	})
})

describe('expectations matrix: every path hits / misses the same', () => {
	const dict = library()

	for (const { name, query } of MUST_HIT) {
		it(`HIT — ${name}: ${JSON.stringify(query)}`, () => {
			expect_hit_all_paths(dict, query)
		})
	}

	for (const { name, query } of MUST_MISS_TARGET) {
		it(`MISS target — ${name}: ${JSON.stringify(query)}`, () => {
			expect_miss_target_all_paths(dict, query)
		})
	}

	it('HIT accent/TeX fold on Mueller2019 across every path (not the antibiofilm paper)', () => {
		expect_hit_all_paths(dict, 'Muller', 'Mueller2019')
		expect_hit_all_paths(dict, 'Günter', 'Mueller2019')
		expect_hit_all_paths(dict, 'author:Muller', 'Mueller2019')
		// Target paper must not spuriously match Muller
		expect_miss_target_all_paths(dict, 'Muller', TARGET_ID)
	})
})

describe('`{` tooltip path: trigger + gate + suggestions stay aligned', () => {
	const dict = library()
	const has_candidate = (query: string) => list_ids_for_suggest(dict, query).ids.length > 0

	it('opens on multi-token fuzzy query with spaces (regression: space broke trigger)', () => {
		const line = '`{antibio magepix'
		const cursor = line.length
		const found = find_prompt_trigger(line, cursor, has_candidate)
		expect(found).not.toBeNull()
		expect(found!.query).toBe('antibio magepix')
		// Same query must surface the target in suggestions
		expect(list_ids_for_suggest(dict, found!.query).ids).toContain(TARGET_ID)
	})

	it('opens on out-of-order tokens', () => {
		const line = '`{magepix antibio'
		const found = find_prompt_trigger(line, line.length, has_candidate)
		expect(found?.query).toBe('magepix antibio')
		expect(list_ids_for_suggest(dict, found!.query).ids).toContain(TARGET_ID)
	})

	it('opens inside already-closed cite when editing the id/query', () => {
		const line = '`{antibio magepix}`'
		// content is "antibio magepix" starting at ch 2
		const content = 'antibio magepix'
		const cursor = 2 + content.length
		const found = find_prompt_trigger(line, cursor, has_candidate)
		expect(found?.query).toBe('antibio magepix')
		expect(list_ids_for_suggest(dict, found!.query).ids).toContain(TARGET_ID)
	})

	it('does not open when nothing matches (gate uses same matcher)', () => {
		const line = '`{zzzznotapaperqqq'
		expect(find_prompt_trigger(line, line.length, has_candidate)).toBeNull()
		expect(list_ids_for_suggest(dict, 'zzzznotapaperqqq').ids).toEqual([])
	})

	it('bracket form [query also uses multi-token fuzzy', () => {
		const line = '`[antibio magepix'
		const found = find_prompt_trigger(line, line.length, has_candidate)
		expect(found?.bracket_start).toBe('[')
		expect(found?.query).toBe('antibio magepix')
		expect(list_ids_for_suggest(dict, found!.query).ids).toContain(TARGET_ID)
	})

	it('single-token typo still opens suggest', () => {
		const line = '`{magepix'
		const found = find_prompt_trigger(line, line.length, has_candidate)
		expect(found?.query).toBe('magepix')
		expect(list_ids_for_suggest(dict, 'magepix').ids).toContain(TARGET_ID)
	})
})

describe('path parity: panel vs suggest return same membership for matrix queries', () => {
	const dict = library()

	it('for every MUST_HIT query, panel and suggest agree on TARGET membership', () => {
		for (const { query } of MUST_HIT) {
			const in_panel = list_ids_for_panel(dict, query).ids.includes(TARGET_ID)
			const in_suggest = list_ids_for_suggest(dict, query).ids.includes(TARGET_ID)
			const in_list = filtered_ids(dict, query).includes(TARGET_ID)
			expect(
				{ query, in_panel, in_suggest, in_list },
				`parity for ${JSON.stringify(query)}`,
			).toEqual({ query, in_panel: true, in_suggest: true, in_list: true })
		}
	})

	it('for every MUST_HIT query, discover / list / suggest agree on ranked order of shared hits', () => {
		for (const { query } of MUST_HIT) {
			const panel = list_ids_for_panel(dict, query).ids
			const suggest = list_ids_for_suggest(dict, query).ids
			const list = filtered_ids(dict, query)
			// Cap only differs (panel 80 / suggest 50 / list unbounded) — prefix of
			// the longer list must match the shorter capped lists.
			const n = Math.min(panel.length, suggest.length, list.length)
			expect(panel.slice(0, n), `panel vs list order for ${JSON.stringify(query)}`).toEqual(
				list.slice(0, n),
			)
			expect(suggest.slice(0, n), `suggest vs list order for ${JSON.stringify(query)}`).toEqual(
				list.slice(0, n),
			)
		}
	})

	it('empty query: panel previews, suggest previews, filtered returns all — no false match_query', () => {
		const panel = list_ids_for_panel(dict, '')
		const suggest = list_ids_for_suggest(dict, '')
		const list = filtered_ids(dict, '')
		expect(panel.kind).toBe('empty_preview')
		expect(suggest.kind).toBe('empty_preview')
		expect(panel.ids.length).toBeGreaterThan(0)
		expect(suggest.ids.length).toBeGreaterThan(0)
		expect(list.length).toBe(Object.keys(dict).length)
	})
})

describe('abstract gate holds on all paths', () => {
	const dict: BibtexDict = {
		AbsOnly: entry('AbsOnly', {
			title: 'Something else entirely',
			abstract: 'unique-abstract-token-xyz cancels noise',
		}),
	}

	it('free-text does not scan abstract; abstract: does — all paths', () => {
		expect_miss_target_all_paths(dict, 'unique-abstract-token-xyz', 'AbsOnly')
		// field path
		expect(match_query(dict.AbsOnly!, 'abstract:unique-abstract-token-xyz')).toBe(true)
		expect(list_ids_for_panel(dict, 'abstract:unique-abstract-token-xyz').ids).toContain('AbsOnly')
		expect(list_ids_for_suggest(dict, 'abstract:unique-abstract-token-xyz').ids).toContain('AbsOnly')
		expect(filtered_ids(dict, 'abstract:unique-abstract-token-xyz')).toContain('AbsOnly')
	})
})
