// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
	convert_tex_special,
	display_bibtex_plain_text,
	display_bibtex_segments,
	display_bibtex_text,
	find_matching_brace,
	fuzzy_edit_budget,
	levenshtein_within,
	normalize_for_search,
	render_display_text,
	search_tokens,
	token_matches_haystack,
	token_matches_word,
} from 'src/tex-display'

describe('find_matching_brace', () => {
	it('matches nested braces', () => {
		expect(find_matching_brace('{a{b}c}', 0)).toBe(6)
		expect(find_matching_brace('x{a{b}c}y', 1)).toBe(7)
	})

	it('returns -1 when unbalanced', () => {
		expect(find_matching_brace('{abc', 0)).toBe(-1)
	})
})

describe('convert_tex_special', () => {
	it('maps common accents with bare and braced bases', () => {
		expect(convert_tex_special("\\'e")).toBe('é')
		expect(convert_tex_special("\\'{e}")).toBe('é')
		expect(convert_tex_special('\\"{u}')).toBe('ü')
		expect(convert_tex_special('\\"u')).toBe('ü')
		expect(convert_tex_special('\\`a')).toBe('à')
		expect(convert_tex_special('\\^o')).toBe('ô')
		expect(convert_tex_special('\\~n')).toBe('ñ')
	})

	it('maps letter accents (cedilla, caron, …)', () => {
		expect(convert_tex_special('\\c{c}')).toBe('ç')
		expect(convert_tex_special('\\c c')).toBe('ç')
		expect(convert_tex_special('\\v{s}')).toBe('š')
		expect(convert_tex_special('\\v{z}')).toBe('ž')
		expect(convert_tex_special('\\v{S}')).toBe('Š')
		expect(convert_tex_special("\\'{c}")).toBe('ć')
		expect(convert_tex_special('\\u{o}')).toBe('ŏ')
		expect(convert_tex_special('\\H{o}')).toBe('ő')
		expect(convert_tex_special('\\k{a}')).toBe('ą')
	})

	it('maps symbol commands', () => {
		expect(convert_tex_special('\\ae')).toBe('æ')
		expect(convert_tex_special('\\AE')).toBe('Æ')
		expect(convert_tex_special('\\ss')).toBe('ß')
		expect(convert_tex_special('\\o')).toBe('ø')
		expect(convert_tex_special('\\O')).toBe('Ø')
		expect(convert_tex_special('\\l')).toBe('ł')
		expect(convert_tex_special('\\aa')).toBe('å')
		expect(convert_tex_special('\\i')).toBe('ı')
	})

	it('maps escaped symbols', () => {
		expect(convert_tex_special('\\&')).toBe('&')
		expect(convert_tex_special('\\%')).toBe('%')
		expect(convert_tex_special('\\_')).toBe('_')
		expect(convert_tex_special('\\$')).toBe('$')
	})

	it('returns null for unknown commands so callers keep the original braces', () => {
		expect(convert_tex_special('\\unknowncmd')).toBeNull()
		expect(convert_tex_special('\\textbf{x}')).toBeNull()
	})

	it('handles accent over nested special (dotless i)', () => {
		// {\'{\i}} → body is \'{\i} → í
		expect(convert_tex_special("\\'{\\i}")).toBe('í')
	})
})

describe('display_bibtex_text', () => {
	it('leaves plain unicode and plain ascii alone', () => {
		expect(display_bibtex_text('Hello Müller')).toBe('Hello Müller')
		expect(display_bibtex_text('')).toBe('')
	})

	it('converts special-character groups in context', () => {
		expect(display_bibtex_text('M{\\"u}ller')).toBe('Müller')
		expect(display_bibtex_text("Schr{\\\"o}dinger")).toBe('Schrödinger')
		expect(display_bibtex_text("{\\'E}cole")).toBe('École')
		expect(display_bibtex_text('Ja{\\c{c}}on')).toBe('Jaçon')
		// User-reported caron / acute (braced special groups)
		expect(display_bibtex_text("{\\'{c}}")).toBe('ć')
		expect(display_bibtex_text('{\\v{z}}')).toBe('ž')
		expect(display_bibtex_text('{\\v{s}}')).toBe('š')
		expect(display_bibtex_text('{\\v{S}}')).toBe('Š')
	})

	it('converts bare TeX accents mid-string (no outer special braces)', () => {
		// Common in some exports / author strings — used to strip `{z}` as
		// protective and leave a broken "\\vz" / "\\'c".
		expect(display_bibtex_text('\\v{z}')).toBe('ž')
		expect(display_bibtex_text("\\'{c}")).toBe('ć')
		expect(display_bibtex_text('\\v{s}')).toBe('š')
		expect(display_bibtex_text('\\v{S}')).toBe('Š')
		expect(display_bibtex_text("Gaji\\'{c}")).toBe('Gajić')
		expect(display_bibtex_text('\\v{Z}ivkovi\\\'{c}')).toBe('Živković')
	})

	it('converts specials inside protective braces that do not start with \\', () => {
		// Leading space → not a special group; must still find bare accents inside.
		expect(display_bibtex_text('{ \\v{z} }')).toBe(' ž ')
		expect(display_bibtex_text("{ \\'{c} }")).toBe(' ć ')
	})

	it('strips protective / case-preservation braces', () => {
		expect(display_bibtex_text('Transfusion{:} Predict')).toBe('Transfusion: Predict')
		expect(display_bibtex_text('{GPU} Programming')).toBe('GPU Programming')
		expect(display_bibtex_text('Johannes {de} Boor')).toBe('Johannes de Boor')
		expect(display_bibtex_text('{{Nested}}')).toBe('Nested')
	})

	it('combines protective braces with specials inside', () => {
		expect(display_bibtex_text("{M{\\\"u}ller}")).toBe('Müller')
		expect(display_bibtex_text("The {{\\'E}cole} Method")).toBe('The École Method')
		expect(display_bibtex_text("Author {\\v{Z}}ivkovi{\\'{c}}")).toBe('Author Živković')
		expect(display_bibtex_text("K{\\v{r}}{\\'{i}}{\\v{z}}ek")).toBe('Křížek')
	})

	it('keeps unknown specials braced so nothing is invented', () => {
		expect(display_bibtex_text('A {\\foo{bar}} B')).toBe('A {\\foo{bar}} B')
	})

	it('strips {\\itshape …} / \\textit{…} to plain body text', () => {
		expect(
			display_bibtex_text(
				'Evolution of the genus {\\itshape Thelebolus} in Antarctica',
			),
		).toBe('Evolution of the genus Thelebolus in Antarctica')
		expect(display_bibtex_text('Genus \\textit{Aspergillus} spp.')).toBe(
			'Genus Aspergillus spp.',
		)
	})

	it('maps bare ~ to a non-breaking space', () => {
		expect(display_bibtex_text('A~B')).toBe('A\u00A0B')
	})

	it('leaves unbalanced braces mostly intact', () => {
		expect(display_bibtex_text('no close {here')).toBe('no close {here')
	})

	it('handles a realistic DBLP-style title/author', () => {
		const title = 'Transfusion{:} Predict the Next Token and Diffuse Images with One Multi-Modal Model'
		expect(display_bibtex_text(title)).toBe(
			'Transfusion: Predict the Next Token and Diffuse Images with One Multi-Modal Model',
		)
		const author = 'Fran{\\c{c}}ois Chollet and G{\\"u}nter Klambauer'
		expect(display_bibtex_text(author)).toBe('François Chollet and Günter Klambauer')
	})

	it('is idempotent on already-rendered text', () => {
		const once = display_bibtex_text('M{\\"u}ller')
		expect(display_bibtex_text(once)).toBe(once)
	})
})

describe('normalize_for_search', () => {
	it('folds TeX, Unicode, and ASCII accents to the same form', () => {
		expect(normalize_for_search('M{\\"u}ller')).toBe('muller')
		expect(normalize_for_search('Müller')).toBe('muller')
		expect(normalize_for_search('Muller')).toBe('muller')
		expect(normalize_for_search('G{\\"u}nter')).toBe('gunter')
		expect(normalize_for_search('François')).toBe('francois')
		expect(normalize_for_search('Fran{\\c{c}}ois')).toBe('francois')
	})

	it('strips protective braces and collapses whitespace', () => {
		expect(normalize_for_search('Transfusion{:} Predict')).toBe('transfusion: predict')
		expect(normalize_for_search('  multi   space  ')).toBe('multi space')
	})

	it('is idempotent', () => {
		const once = normalize_for_search('M{\\"u}ller')
		expect(normalize_for_search(once)).toBe(once)
	})
})

describe('search_tokens', () => {
	it('splits on whitespace after normalize', () => {
		expect(search_tokens('  Müller  Trees ')).toEqual(['muller', 'trees'])
		expect(search_tokens('')).toEqual([])
		expect(search_tokens('   ')).toEqual([])
	})
})

describe('normalize_for_search HTML', () => {
	it('strips simple HTML tags so markup does not glue or block tokens', () => {
		expect(normalize_for_search('against <i>Candida</i> spp.')).toBe('against candida spp.')
	})
})

describe('fuzzy token match', () => {
	it('sets edit budget by token length', () => {
		expect(fuzzy_edit_budget(3)).toBe(0)
		expect(fuzzy_edit_budget(4)).toBe(1)
		expect(fuzzy_edit_budget(6)).toBe(1)
		expect(fuzzy_edit_budget(7)).toBe(2)
	})

	it('levenshtein_within early-exits past budget', () => {
		expect(levenshtein_within('magepix', 'manogepix', 2)).toBe(2)
		expect(levenshtein_within('magepix', 'manogepix', 1)).toBe(2) // max+1
		expect(levenshtein_within('abc', 'xyz', 0)).toBe(1)
	})

	it('token_matches_haystack: exact substring and fuzzy word', () => {
		const hay = normalize_for_search(
			'Antibiofilm activity of manogepix against <i>Candida</i> spp.',
		)
		expect(token_matches_haystack('antibiofilm', hay)).toBe(true)
		expect(token_matches_haystack('antibio', hay)).toBe(true) // prefix / substring
		expect(token_matches_haystack('magepix', hay)).toBe(true) // ≈ manogepix
		expect(token_matches_haystack('manogepix', hay)).toBe(true)
		expect(token_matches_haystack('antbio', hay)).toBe(true) // fuzzy prefix of antibiofilm
		expect(token_matches_haystack('zzzzzzzz', hay)).toBe(false)
		// Short tokens: exact only (no fuzzy)
		expect(token_matches_haystack('cat', 'cut the cake')).toBe(false)
	})

	it('fuzzy requires shared first character (unite ≉ nitesh)', () => {
		expect(token_matches_word('unite', 'nitesh')).toBe(false)
		expect(token_matches_haystack('unite', 'nitesh kumar')).toBe(false)
	})

	it('reverse stem allows only a small overrun (smithh≈smith, not liush≈liu)', () => {
		expect(token_matches_word('smithh', 'smith')).toBe(true)
		expect(token_matches_word('liush', 'liu')).toBe(false)
	})
})

describe('display_bibtex_segments', () => {
	it('plain text with no tags is a single non-italic segment', () => {
		expect(display_bibtex_segments('Plain title')).toEqual([
			{ text: 'Plain title', italic: false, bold: false },
		])
	})

	it('splits <i>…</i> into a marked italic segment', () => {
		expect(display_bibtex_segments('Activity against <i>Candida</i> spp.')).toEqual([
			{ text: 'Activity against ', italic: false, bold: false },
			{ text: 'Candida', italic: true, bold: false },
			{ text: ' spp.', italic: false, bold: false },
		])
	})

	it('splits <em>…</em> the same way as <i>', () => {
		expect(display_bibtex_segments('An <em>in vitro</em> study')).toEqual([
			{ text: 'An ', italic: false, bold: false },
			{ text: 'in vitro', italic: true, bold: false },
			{ text: ' study', italic: false, bold: false },
		])
	})

	it('handles multiple italic spans in one title', () => {
		expect(display_bibtex_segments('<i>Candida</i> vs <i>Aspergillus</i>')).toEqual([
			{ text: 'Candida', italic: true, bold: false },
			{ text: ' vs ', italic: false, bold: false },
			{ text: 'Aspergillus', italic: true, bold: false },
		])
	})

	it('mismatched tag names are left as literal text (nothing invented)', () => {
		expect(display_bibtex_segments('<i>Candida</em>')).toEqual([
			{ text: '<i>Candida</em>', italic: false, bold: false },
		])
	})

	it('an unclosed tag is left as literal text', () => {
		expect(display_bibtex_segments('<i>Candida spp.')).toEqual([
			{ text: '<i>Candida spp.', italic: false, bold: false },
		])
	})

	it('tags with attributes are not recognized (only bare <i>/<em>)', () => {
		expect(display_bibtex_segments('<i class="x">Candida</i>')).toEqual([
			{ text: '<i class="x">Candida</i>', italic: false, bold: false },
		])
	})

	it('TeX specials are converted before tag splitting', () => {
		expect(display_bibtex_segments('<i>M{\\"u}ller</i> et al.')).toEqual([
			{ text: 'Müller', italic: true, bold: false },
			{ text: ' et al.', italic: false, bold: false },
		])
	})

	it('marks {\\itshape …} as italic (foundational BibTeX font switch)', () => {
		expect(
			display_bibtex_segments(
				'Evolution of the genus {\\itshape Thelebolus} in Antarctica',
			),
		).toEqual([
			{ text: 'Evolution of the genus ', italic: false, bold: false },
			{ text: 'Thelebolus', italic: true, bold: false },
			{ text: ' in Antarctica', italic: false, bold: false },
		])
	})

	it('marks \\textit{…} / \\emph{…} as italic', () => {
		expect(display_bibtex_segments('Genus \\textit{Aspergillus} spp.')).toEqual([
			{ text: 'Genus ', italic: false, bold: false },
			{ text: 'Aspergillus', italic: true, bold: false },
			{ text: ' spp.', italic: false, bold: false },
		])
		expect(display_bibtex_segments('An \\emph{in vitro} assay')).toEqual([
			{ text: 'An ', italic: false, bold: false },
			{ text: 'in vitro', italic: true, bold: false },
			{ text: ' assay', italic: false, bold: false },
		])
	})

	it('marks {\\bfseries …} / \\textbf{…} as bold', () => {
		expect(display_bibtex_segments('See {\\bfseries Important} note')).toEqual([
			{ text: 'See ', italic: false, bold: false },
			{ text: 'Important', italic: false, bold: true },
			{ text: ' note', italic: false, bold: false },
		])
		expect(display_bibtex_segments('See \\textbf{Important} note')).toEqual([
			{ text: 'See ', italic: false, bold: false },
			{ text: 'Important', italic: false, bold: true },
			{ text: ' note', italic: false, bold: false },
		])
	})

	it('nests bold + italic font switches', () => {
		expect(
			display_bibtex_segments('{\\bfseries {\\itshape Aspergillus} section}'),
		).toEqual([
			{ text: 'Aspergillus', italic: true, bold: true },
			{ text: ' section', italic: false, bold: true },
		])
	})

	it('converts bare ~ to a non-breaking space', () => {
		expect(display_bibtex_segments('A~non-breaking space')).toEqual([
			{ text: 'A\u00A0non-breaking space', italic: false, bold: false },
		])
		expect(display_bibtex_plain_text('A~non-breaking space')).toBe('A\u00A0non-breaking space')
	})
})

describe('display_bibtex_plain_text', () => {
	it('flattens italic markup back to plain text', () => {
		expect(display_bibtex_plain_text('Activity against <i>Candida</i> spp.')).toBe('Activity against Candida spp.')
	})

	it('is unchanged for text with no tags', () => {
		expect(display_bibtex_plain_text('Plain title')).toBe('Plain title')
	})
})

describe('render_display_text', () => {
	it('renders a non-italic segment as a plain text node', () => {
		const el = document.createElement('div')
		render_display_text(el, 'Plain title')
		expect(el.innerHTML).toBe('Plain title')
	})

	it('renders <i>…</i> as a real <em> element, not literal tag text', () => {
		const el = document.createElement('div')
		render_display_text(el, 'Activity against <i>Candida</i> spp.')
		expect(el.innerHTML).toBe('Activity against <em>Candida</em> spp.')
		expect(el.querySelector('em')?.textContent).toBe('Candida')
	})

	it('appends without clearing existing children', () => {
		const el = document.createElement('div')
		el.append('[')
		render_display_text(el, 'Title')
		el.append(']')
		expect(el.textContent).toBe('[Title]')
	})

	it('never introduces attributes or extra elements beyond a bare <em>', () => {
		const el = document.createElement('div')
		render_display_text(el, '<i class="x" onmouseover="evil()">Candida</i>')
		// Attributed tags are not recognized as italic — rendered as literal text, not executed/parsed as an element.
		expect(el.querySelector('em')).toBeNull()
		expect(el.textContent).toBe('<i class="x" onmouseover="evil()">Candida</i>')
	})
})
