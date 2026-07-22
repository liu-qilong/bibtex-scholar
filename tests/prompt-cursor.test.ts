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

	/**
	 * After a full insert of `` `{id}` ``, the caret sits at the exclusive end of
	 * the cite span → outside [from, to) → chip may re-render immediately.
	 * Guard against regressing to start_ch + id.length + 2 (old off-by-one).
	 */
	it('full insert lands caret at exclusive end of the completed cite span', () => {
		// User typed `` `{ `` with Obsidian auto-pairing often leaving `` `{<cursor>` ``
		// content_start = 2 (after `{`); insert closes both bracket and backtick.
		const content_start = 2
		const { str, caret_ch } = suggest_insert_and_caret('Paper2024', '{', '', '', content_start)
		const completed = '`{' + str // full inline cite as it appears on the line
		expect(completed).toBe('`{Paper2024}`')
		// Caret column on the line = content_start + inserted length = end of span
		expect(caret_ch).toBe(content_start + str.length)
		expect(caret_ch).toBe(completed.length)
		// Half-open: caret at `to` is outside → cursor_inside_span would be false
		expect(caret_ch >= completed.length).toBe(true)
	})

	it('bracket form [id] full insert also lands at exclusive end', () => {
		const content_start = 2
		const { str, caret_ch } = suggest_insert_and_caret('Paper2024', '[', '', '', content_start)
		expect(str).toBe('Paper2024]`')
		expect(caret_ch).toBe(content_start + 'Paper2024]`'.length)
	})
})
