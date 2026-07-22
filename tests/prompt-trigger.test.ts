import { describe, expect, it } from 'vitest'
import { find_prompt_trigger } from 'src/prompt-trigger'

const has_smith = (query: string) => query === '' || 'Smith2020'.startsWith(query)

describe('find_prompt_trigger', () => {
	it('triggers right after the opening bracket with an empty query', () => {
		const result = find_prompt_trigger('`{', 2, has_smith)
		expect(result).toEqual({
			query: '',
			bracket_start: '{',
			bracket_end: '',
			code_end: '',
			content_start: 2,
			content_end: 2,
		})
	})

	it('triggers while typing a query prefix that matches a cached citekey', () => {
		const result = find_prompt_trigger('`{Smi', 5, has_smith)
		expect(result?.query).toBe('Smi')
	})

	it('does not trigger when no cached citekey matches the query', () => {
		expect(find_prompt_trigger('`{Zzz', 5, has_smith)).toBeNull()
	})

	it('retriggers inside an already-closed citation when the id matches (edit-in-place)', () => {
		const result = find_prompt_trigger('`{Smith2020}`', 11, has_smith)
		expect(result).toMatchObject({ query: 'Smith2020', bracket_end: '}', code_end: '`' })
	})

	it('does not retrigger on a code span that only coincidentally looks like a citation', () => {
		// `{key: value}` — a JSON-ish snippet; no cached citekey starts with "key:" or "key".
		const has_no_match = () => false
		expect(find_prompt_trigger('`{key: value}`', 6, has_no_match)).toBeNull()
	})

	it('rules out the malformed `{test} case (closing bracket, no closing backtick)', () => {
		const always_true = () => true
		expect(find_prompt_trigger('`{test}', 6, always_true)).toBeNull()
	})

	it('does not trigger when the cursor is not at a content boundary', () => {
		expect(find_prompt_trigger('`{Smith2020}` text', 3, has_smith)).toBeNull()
	})

	it('finds the right one of two citations on the same line', () => {
		const has_doe = (query: string) => query === '' || 'Doe2021'.startsWith(query)
		const line = '`{Smith2020}` and `{Doe2021}`'
		expect(find_prompt_trigger(line, 27, has_doe)).toMatchObject({ query: 'Doe2021' })
	})
})
