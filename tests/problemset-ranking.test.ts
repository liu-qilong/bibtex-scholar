/**
 * Ranking/fuzzy regressions from real library fragments where weak hits
 * used to outrank the paper the user was looking for (UNITE / liush cases).
 */
import { describe, expect, it } from 'vitest'
import {
	normalize_for_search,
	token_match_quality,
	token_matches_word,
	MATCH_Q,
} from 'src/display/tex-display'
import { match_query, type BibtexDict, type BibtexElement } from 'src/bibtex'
import { filtered_ids, list_ids_for_panel, list_ids_for_suggest } from 'src/scale/library-scale'

function entry(id: string, fields: Record<string, string> = {}): BibtexElement {
	return {
		fields: { type: 'article', id, ...fields },
		source_path: `notes/${id}.md`,
	}
}

/** Fixture library covering the three broken ranking queries. */
function problemset(): BibtexDict {
	return {
		Nilsson_2018: entry('Nilsson_2018', {
			title:
				'The UNITE database for molecular identification of fungi: handling dark taxa and parallel taxonomic classifications',
			author:
				'Nilsson, Rolf Henrik and Larsson, Karl-Henrik and Taylor, Andy F~S and Bengtsson-Palme, Johan and Jeppesen, Thomas S and Schigel, Dmitry and Kennedy, Peter and Picard, Kathryn and Gl\\"{o}ckner, Frank Oliver and Tedersoo, Leho and Saar, Irja and K\\~{o}ljalg, Urmas and Abarenkov, Kessy',
			year: '2018',
			journal: 'Nucleic Acids Research',
			doi: '10.1093/nar/gky1022',
		}),
		Fonseca_2025: entry('Fonseca_2025', {
			title:
				'Coccidioides genomes from low-incidence states reveal complex migration history across the western United States',
			author:
				'Fonseca, Emanuel M. and Fox, Shanaya and Carey, Adrienne L. and Barker, Bridget and Marchetti, Marco and Hirschi, Megan and Hanson, Kimberly E. and Walter, Katharine S.',
			year: '2025',
		}),
		LiuSh_2025: entry('LiuSh_2025', {
			title: 'Analysis of metagenomic data',
			author:
				'Liu, Shaopeng and Rodriguez, Judith S. and Munteanu, Viorel and Ronkowski, Cynthia and Sharma, Nitesh Kumar and Alser, Mohammed and Andreace, Francesco and Blekhman, Ran',
			year: '2025',
		}),
		Nieves_2025: entry('Nieves_2025', {
			title:
				'Harnessing the microbiome to improve clinical outcomes for cancer, transplant, and immunocompromised patients in the intensive care unit (ICU)',
			author:
				'Nieves, Lizbeth and Roach, Alexandra and Hunter, Joseph and Smeh, Sarah and Islas, Andrew and Islas, Ariana and Blattman, Joseph and Di Palma, Michelle',
			year: '2025',
		}),
		Liu_2022: entry('Liu_2022', {
			title:
				'Diagnostic accuracy of metagenomic next-generation sequencing in diagnosing infectious diseases: a meta-analysis',
			author: 'Liu, Jian and Zhang, Qiao and Dong, Yong-Quan and Yin, Jie and Qiu, Yun-Qing',
			year: '2022',
		}),
	}
}

function expect_first(dict: BibtexDict, query: string, id: string) {
	expect(match_query(dict[id]!, query), `match_query(${JSON.stringify(query)}) hits ${id}`).toBe(
		true,
	)
	const panel = list_ids_for_panel(dict, query)
	const suggest = list_ids_for_suggest(dict, query)
	const list = filtered_ids(dict, query)
	expect(panel.ids[0], `panel first for ${JSON.stringify(query)}`).toBe(id)
	expect(suggest.ids[0], `suggest first for ${JSON.stringify(query)}`).toBe(id)
	expect(list[0], `list-mode first for ${JSON.stringify(query)}`).toBe(id)
}

describe('search ranking regressions (UNITE / liush)', () => {
	const dict = problemset()

	it('"UNITE" ranks Nilsson_2018 (exact title word) first — not United/unit/nitesh hits', () => {
		expect_first(dict, 'UNITE', 'Nilsson_2018')
		// Weak relatives may still match but must not outrank the exact word.
		const ids = list_ids_for_panel(dict, 'UNITE').ids
		expect(ids.indexOf('Nilsson_2018')).toBe(0)
		// Author "Nitesh" must not fuzzy-match "unite" (no shared first letter).
		expect(match_query(dict.LiuSh_2025!, 'UNITE')).toBe(false)
	})

	it('"UNITE datab" ranks Nilsson_2018 first (not LiuSh via nitesh+data)', () => {
		expect_first(dict, 'UNITE datab', 'Nilsson_2018')
		// With first-char fuzzy anchor, LiuSh no longer matches at all.
		expect(match_query(dict.LiuSh_2025!, 'UNITE datab')).toBe(false)
		expect(list_ids_for_panel(dict, 'UNITE datab').ids).toEqual(['Nilsson_2018'])
	})

	it('"liush" ranks LiuSh_2025 first — not Liu_2022 via reverse-stem "liu"', () => {
		expect_first(dict, 'liush', 'LiuSh_2025')
		// Reverse stem must not claim "liu" for query "liush" (too much extra).
		expect(token_matches_word('liush', 'liu')).toBe(false)
		expect(match_query(dict.Liu_2022!, 'liush')).toBe(false)
		expect(list_ids_for_panel(dict, 'liush').ids).toEqual(['LiuSh_2025'])
	})
})

describe('token quality guards used by ranking fixes', () => {
	it('does not fuzzy-match across different first letters (unite ≉ nitesh)', () => {
		expect(token_match_quality('unite', 'nitesh')).toBe(MATCH_Q.NONE)
		expect(token_matches_word('unite', 'nitesh')).toBe(false)
	})

	it('still fuzzy-matches same-initial typos (magepix ≈ manogepix, antbio ≈ antibiofilm)', () => {
		expect(token_matches_word('magepix', 'manogepix')).toBe(true)
		expect(token_matches_word('antbio', 'antibiofilm')).toBe(true)
	})

	it('exact word outranks prefix/substring outranks reverse-stem', () => {
		expect(token_match_quality('unite', 'unite')).toBe(MATCH_Q.EXACT)
		expect(token_match_quality('unite', 'united')).toBe(MATCH_Q.PREFIX)
		expect(token_match_quality('unit', 'unite')).toBe(MATCH_Q.PREFIX) // unit is prefix of unite
		// reverse: query slightly past a complete short word
		expect(token_match_quality('unitt', 'unit')).toBe(MATCH_Q.REVERSE_STEM)
		expect(token_match_quality('unite', 'unit')).toBe(MATCH_Q.REVERSE_STEM)
	})

	it('citekey fragment liush matches LiuSh_2025 id words', () => {
		expect(token_matches_word('liush', normalize_for_search('liush'))).toBe(true)
		expect(token_match_quality('liush', 'liush')).toBe(MATCH_Q.EXACT)
	})
})
