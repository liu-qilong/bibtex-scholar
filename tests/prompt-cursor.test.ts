import { describe, expect, it } from 'vitest'

/**
 * Mirrors EditorPrompt.selectSuggestion insert + caret math without Obsidian.
 * Inserted text is: id, optionally closing bracket, optionally trailing backtick.
 */
function suggest_insert_and_caret(
	id: string,
	bracket_start: '{' | '[',
	bracket_end: string,
	code_end: string,
	start_ch: number,
): { str: string, caret_ch: number } {
	let str = id
	if (bracket_end === '') {
		str += bracket_start === '{' ? '}' : ']'
	}
	if (code_end === '') {
		str += '`'
	}
	return { str, caret_ch: start_ch + str.length }
}

describe('EditorPrompt caret after suggest (no +2 off-by-one)', () => {
	it('places caret after id+closers when both closers missing', () => {
		const { str, caret_ch } = suggest_insert_and_caret('Alpha2020', '{', '', '', 2)
		expect(str).toBe('Alpha2020}`')
		expect(caret_ch).toBe(2 + 'Alpha2020}`'.length)
	})

	it('places caret after id only when closers already present', () => {
		const { str, caret_ch } = suggest_insert_and_caret('Alpha2020', '{', '}', '`', 2)
		expect(str).toBe('Alpha2020')
		expect(caret_ch).toBe(2 + 'Alpha2020'.length)
	})

	it('places caret after id+} when only backtick missing', () => {
		const { str, caret_ch } = suggest_insert_and_caret('Alpha2020', '[', ']', '', 2)
		expect(str).toBe('Alpha2020`')
		expect(caret_ch).toBe(2 + 'Alpha2020`'.length)
	})
})
