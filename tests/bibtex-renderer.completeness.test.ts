/**
 * Completeness harness for BibTeX structural parse + display rendering.
 *
 * Maps the “renderer completeness skeleton” to our real API:
 * - Structure: `parse_bibtex` (custom regex stack — same lineage as upstream)
 * - Display: `display_bibtex_*` / segments (custom TeX markup walker)
 *
 * Open gaps are `it.todo` — executable contracts. Prose index:
 * `docs/roadmap.md` → Technical debt. Promote each todo to a real `it` when fixed.
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { parse_bibtex } from 'src/bibtex'
import {
	display_bibtex_plain_text,
	display_bibtex_segments,
	display_bibtex_text,
} from 'src/tex-display'

describe('BibTeX renderer – completeness', () => {
	// 1. Classic scientific italics + accent macros
	it('handles {\\itshape …} and accent commands (deHoog / Göttlich)', async () => {
		const bib = `
@article{deHoog_2005,
  title = {Evolution, taxonomy and ecology of the genus {\\itshape Thelebolus} in Antarctica},
  author = {de Hoog, G. S. and G{\\"o}ttlich, E. and Platas, G. and Genilloud, O. and Leotta, G. and van Brummelen, J.},
  journal = {Studies in Mycology},
  volume = {51},
  pages = {33--76},
  year = {2005},
  publisher = {Centraalbureau voor Schimmelcultures},
}`
		const entries = await parse_bibtex(bib)
		expect(entries).toHaveLength(1)
		const entry = entries[0]
		expect(entry.id).toBe('deHoog_2005')

		// Structure: raw field still carries TeX markup (export path).
		expect(entry.title).toContain('itshape')
		expect(entry.author).toContain('\\"o')

		// Display: italics as segment + accents folded to Unicode.
		const title_segs = display_bibtex_segments(entry.title)
		expect(title_segs.some((s) => s.italic && s.text === 'Thelebolus')).toBe(true)
		expect(display_bibtex_plain_text(entry.title)).toBe(
			'Evolution, taxonomy and ecology of the genus Thelebolus in Antarctica',
		)
		expect(display_bibtex_plain_text(entry.author)).toContain('Göttlich')
		expect(display_bibtex_text(entry.author)).toContain('Göttlich')
	})

	// 2. Nested braces + mixed font markup (+ math left for later)
	it('preserves nested font switches (bold + italic)', async () => {
		const bib = `
@article{test_nested,
  title = {A study of alpha-diversity in {\\bfseries {\\itshape Aspergillus} section {\\itshape Fumigati}}},
  author = {Smith, J. and {van der} Waals, A.},
  year = {2021}
}`
		const [entry] = await parse_bibtex(bib)
		const segs = display_bibtex_segments(entry.title)
		expect(segs.some((s) => s.italic && s.bold && s.text === 'Aspergillus')).toBe(true)
		expect(segs.some((s) => s.italic && s.bold && s.text === 'Fumigati')).toBe(true)
		expect(display_bibtex_plain_text(entry.title)).toContain('Aspergillus section Fumigati')
		// Protective braces around name particles strip for display.
		expect(display_bibtex_plain_text(entry.author)).toContain('van der Waals')
	})

	it.todo('renders simple math mode ($\\alpha$) as a readable symbol')

	// 3. Quoted vs braced fields + trailing commas + empty fields
	it('accepts braced fields, trailing commas, and empty values', async () => {
		const bib = `
@book{test_braced,
  title = {A book title},
  author = {Author, A.},
  year = {1999},
  note = {},
  publisher = {Some Press},
}`
		const entries = await parse_bibtex(bib)
		expect(entries).toHaveLength(1)
		expect(entries[0].title).toBe('A book title')
		expect(entries[0].note).toBe('')
		expect(entries[0].publisher).toBe('Some Press')
	})

	// Custom parser currently keeps outer quotes in the value — structural debt.
	it.todo('strips outer quotes from quoted field values (title = "…")')

	// 4. Multi-author “and” + corporate authors + name particles
	it('keeps complex author strings intact for display (no structured name split)', async () => {
		const bib = `
@article{test_authors,
  author = {de la Cruz, M. and {NASA} and O'Brien, P. and {van} Houten, K.},
  title = {Something},
  year = {2018}
}`
		const [entry] = await parse_bibtex(bib)
		const plain = display_bibtex_plain_text(entry.author)
		expect(plain).toContain('de la Cruz')
		expect(plain).toContain('NASA')
		expect(plain).toContain("O'Brien")
		expect(plain).toContain('van Houten')
	})

	it.todo('parses author lists into structured names (particles, corporate)')

	// 5. Cross-ref / string / preamble — not supported by the regex parser
	it.todo('resolves @string abbreviations into field values')
	it.todo('inherits fields via simple crossref')

	// 6. Edge / stress cases
	it('survives common edge cases without throwing', async () => {
		const cases = [
			`@misc{empty, title = {}}`,
			`@article{percent, title = {50\\% survival}}`,
			`@article{tilde, title = {A~non-breaking space}}`,
			`@article{underscore, title = {gene\\_name}}`,
			`@article{braces, title = {{Title with outer braces}}}`,
		]
		for (const bib of cases) {
			await expect(parse_bibtex(bib)).resolves.toBeDefined()
		}

		const [empty] = await parse_bibtex(cases[0])
		expect(empty.title).toBe('')

		const [pct] = await parse_bibtex(cases[1])
		expect(display_bibtex_plain_text(pct.title)).toBe('50% survival')

		const [tilde] = await parse_bibtex(cases[2])
		expect(display_bibtex_plain_text(tilde.title)).toBe('A\u00A0non-breaking space')

		const [us] = await parse_bibtex(cases[3])
		expect(display_bibtex_plain_text(us.title)).toBe('gene_name')

		// Display layer strips protective outer braces when given raw TeX.
		expect(display_bibtex_plain_text('{{Title with outer braces}}')).toBe(
			'Title with outer braces',
		)
		// Custom parse_bibtex currently mangles double-wrapped values (adds quotes) —
		// documented structural debt; only require parse-does-not-throw above.
	})
})
