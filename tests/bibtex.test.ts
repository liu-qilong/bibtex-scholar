import { describe, expect, it } from 'vitest'
import { normalize_id, replace_inline_citekey } from 'src/bibtex'

describe('normalize_id', () => {
	it('case-folds for internal matching only', () => {
		expect(normalize_id('Smith2020')).toBe('smith2020')
		expect(normalize_id('smith2020')).toBe('smith2020')
	})
})

describe('replace_inline_citekey', () => {
	it('replaces inline cites regardless of the cite\'s casing vs. old_id', () => {
		const content = 'See `{Smith2020}` and `[smith2020]` and `{SMITH2020}`.'
		const out = replace_inline_citekey(content, 'Smith2020', 'Jones2021')
		expect(out).toBe('See `{Jones2021}` and `[Jones2021]` and `{Jones2021}`.')
	})

	it('leaves cites outside a ```bibtex fence untouched when unrelated', () => {
		const content = [
			'```bibtex',
			'@article{Smith2020, title={x}}',
			'```',
			'`{Smith2020}` here',
		].join('\n')
		const out = replace_inline_citekey(content, 'Smith2020', 'Jones2021')
		expect(out).toContain('@article{Smith2020, title={x}}')
		expect(out).toContain('`{Jones2021}` here')
	})
})
