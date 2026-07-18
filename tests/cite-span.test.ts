import { describe, expect, it } from 'vitest'
import {
	cite_span_key_at_offset,
	cursor_inside_span,
	find_cite_spans_in_line,
	selection_requires_decoration_rebuild,
	text_may_contain_bibtex_block,
} from 'src/cite-span'

describe('cite-span / cursor management', () => {
	it('finds compact and expanded cite spans on a line', () => {
		const line = 'See `{Alpha2020}` and `[Beta2021]` here'
		const spans = find_cite_spans_in_line(line, 100)
		expect(spans).toHaveLength(2)
		expect(spans[0]).toMatchObject({ id: 'Alpha2020', expand: false, from: 104 })
		expect(spans[1]).toMatchObject({ id: 'Beta2021', expand: true })
		expect(spans[0].to - spans[0].from).toBe('`{Alpha2020}`'.length)
	})

	it('returns span key only when caret is inside (inclusive ends)', () => {
		const line = 'x`{A}`y'
		// offsets: 0=x, 1=`, 2={, 3=A, 4=}, 5=`, 6=y
		expect(cite_span_key_at_offset(line, 0, 0)).toBeNull()
		expect(cite_span_key_at_offset(line, 0, 1)).toBe('1:6')
		expect(cite_span_key_at_offset(line, 0, 3)).toBe('1:6')
		expect(cite_span_key_at_offset(line, 0, 6)).toBe('1:6') // exclusive end index is 6; inclusive uses pos <= to
		expect(cite_span_key_at_offset(line, 0, 7)).toBeNull()
	})

	it('does not rebuild decorations when caret stays outside cites', () => {
		expect(selection_requires_decoration_rebuild(null, null)).toBe(false)
	})

	it('rebuilds when caret enters or leaves a cite', () => {
		expect(selection_requires_decoration_rebuild(null, '10:20')).toBe(true)
		expect(selection_requires_decoration_rebuild('10:20', null)).toBe(true)
		expect(selection_requires_decoration_rebuild('10:20', '30:40')).toBe(true)
		expect(selection_requires_decoration_rebuild('10:20', '10:20')).toBe(false)
	})

	it('cursor_inside_span matches decoration policy', () => {
		expect(cursor_inside_span(5, 5, 10)).toBe(true)
		expect(cursor_inside_span(10, 5, 10)).toBe(true)
		expect(cursor_inside_span(4, 5, 10)).toBe(false)
		expect(cursor_inside_span(11, 5, 10)).toBe(false)
	})

	it('gates idle rename work on bibtex fence presence', () => {
		expect(text_may_contain_bibtex_block('hello world')).toBe(false)
		expect(text_may_contain_bibtex_block('```bibtex\n@a{b,\n}\n```')).toBe(true)
	})
})
