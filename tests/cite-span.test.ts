import { describe, expect, it } from 'vitest'
import {
	cite_span_key_at_offset,
	cursor_inside_span,
	find_cite_spans_in_line,
	selection_requires_decoration_rebuild,
	spans_showing_chips,
	text_may_contain_bibtex_block,
} from 'src/cite-span'
import { should_render_cite_widgets } from 'src/editor'
import { fields_shallow_equal } from '../src/hover'

describe('cite-span / cursor management', () => {
	it('finds compact and expanded cite spans on a line', () => {
		const line = 'See `{Alpha2020}` and `[Beta2021]` here'
		const spans = find_cite_spans_in_line(line, 100)
		expect(spans).toHaveLength(2)
		expect(spans[0]).toMatchObject({ id: 'Alpha2020', expand: false, from: 104 })
		expect(spans[1]).toMatchObject({ id: 'Beta2021', expand: true })
		expect(spans[0].to - spans[0].from).toBe('`{Alpha2020}`'.length)
	})

	it('returns span key only when caret is inside [from, to)', () => {
		const line = 'x`{A}`y'
		// offsets: 0=x, 1=`, 2={, 3=A, 4=}, 5=`, 6=y  — span is [1, 6)
		expect(cite_span_key_at_offset(line, 0, 0)).toBeNull()
		expect(cite_span_key_at_offset(line, 0, 1)).toBe('1:6')
		expect(cite_span_key_at_offset(line, 0, 3)).toBe('1:6')
		expect(cite_span_key_at_offset(line, 0, 5)).toBe('1:6')
		expect(cite_span_key_at_offset(line, 0, 6)).toBeNull() // exclusive end = outside
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

	it('does not rebuild when caret moves within the same cite span', () => {
		// Mid-edit: head walks inside the raw `` `{id}` `` without re-entering
		expect(selection_requires_decoration_rebuild('5:18', '5:18')).toBe(false)
	})

	it('cursor_inside_span is half-open [from, to)', () => {
		expect(cursor_inside_span(5, 5, 10)).toBe(true)
		expect(cursor_inside_span(9, 5, 10)).toBe(true)
		expect(cursor_inside_span(10, 5, 10)).toBe(false) // exclusive end
		expect(cursor_inside_span(4, 5, 10)).toBe(false)
		expect(cursor_inside_span(11, 5, 10)).toBe(false)
	})

	it('gates idle rename work on bibtex fence presence', () => {
		expect(text_may_contain_bibtex_block('hello world')).toBe(false)
		expect(text_may_contain_bibtex_block('```bibtex\n@a{b,\n}\n```')).toBe(true)
	})

	it('cite widgets only in live preview — not pure source mode', () => {
		expect(should_render_cite_widgets(true)).toBe(true)
		expect(should_render_cite_widgets(false)).toBe(false)
	})

	describe('spans_showing_chips (decoration filter)', () => {
		const line = 'A `{Alpha}` mid `{Beta}` z'
		// Alpha span: indexOf '`{Alpha}`'
		const alpha_from = line.indexOf('`{Alpha}`')
		const alpha_to = alpha_from + '`{Alpha}`'.length
		const beta_from = line.indexOf('`{Beta}`')
		const beta_to = beta_from + '`{Beta}`'.length

		it('shows every chip when caret is before all cites', () => {
			const chips = spans_showing_chips(line, 0, 0)
			expect(chips.map((c) => c.id)).toEqual(['Alpha', 'Beta'])
		})

		it('hides only the span under the caret', () => {
			expect(spans_showing_chips(line, 0, alpha_from).map((c) => c.id)).toEqual(['Beta'])
			expect(spans_showing_chips(line, 0, alpha_from + 3).map((c) => c.id)).toEqual(['Beta'])
			expect(spans_showing_chips(line, 0, beta_from + 1).map((c) => c.id)).toEqual(['Alpha'])
		})

		it('shows both chips when caret sits on exclusive end of a span', () => {
			// Half-open: pos === to is outside → chip may replace again
			expect(spans_showing_chips(line, 0, alpha_to).map((c) => c.id)).toEqual(['Alpha', 'Beta'])
			expect(spans_showing_chips(line, 0, beta_to).map((c) => c.id)).toEqual(['Alpha', 'Beta'])
		})

		it('shows both chips when caret is between two cites', () => {
			const between = line.indexOf(' mid ')
			expect(spans_showing_chips(line, 0, between).map((c) => c.id)).toEqual(['Alpha', 'Beta'])
		})

		it('respects absolute line_from offsets in span geometry', () => {
			const line_from = 500
			const chips = spans_showing_chips(line, line_from, line_from) // caret at line start
			expect(chips).toHaveLength(2)
			expect(chips[0].from).toBe(line_from + alpha_from)
			expect(chips[0].to).toBe(line_from + alpha_to)
		})

		it('walk: entering then leaving a span matches rebuild keys', () => {
			const keys = [0, alpha_from - 1, alpha_from, alpha_from + 2, alpha_to - 1, alpha_to, line.length]
				.map((pos) => cite_span_key_at_offset(line, 0, pos))

			// outside, outside, inside Alpha, inside, inside, outside, outside
			expect(keys[0]).toBeNull()
			expect(keys[1]).toBeNull()
			expect(keys[2]).toBe(`${alpha_from}:${alpha_to}`)
			expect(keys[3]).toBe(`${alpha_from}:${alpha_to}`)
			expect(keys[4]).toBe(`${alpha_from}:${alpha_to}`)
			expect(keys[5]).toBeNull()
			expect(keys[6]).toBeNull()

			// Rebuild flags for consecutive steps of that walk
			const rebuilds = keys.slice(0, -1).map((k, i) =>
				selection_requires_decoration_rebuild(k, keys[i + 1]),
			)
			// null→null no; null→Alpha yes; Alpha→Alpha no; …; Alpha→null yes; null→null no
			expect(rebuilds).toEqual([false, true, false, false, true, false])
		})
	})

	it('ignores non-cite backtick spans and unclosed patterns', () => {
		expect(find_cite_spans_in_line('use `code` and `{not closed')).toEqual([])
		expect(find_cite_spans_in_line('plain {Alpha} without ticks')).toEqual([])
		// Nested-ish / empty id is not a valid match (pattern requires [^\}\]]+)
		expect(find_cite_spans_in_line('`{}`')).toEqual([])
	})
})

describe('fields_shallow_equal (widget content eq)', () => {
	it('matches equal maps and rejects field updates', () => {
		expect(fields_shallow_equal({ id: 'A', title: 't' }, { id: 'A', title: 't' })).toBe(true)
		expect(fields_shallow_equal({ id: 'A', title: 't' }, { id: 'A', title: 'other' })).toBe(false)
		expect(fields_shallow_equal({ id: 'A' }, { id: 'A', year: '2020' })).toBe(false)
	})
})
