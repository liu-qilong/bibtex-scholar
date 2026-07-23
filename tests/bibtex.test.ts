import { describe, expect, it } from 'vitest'
import {
	find_bibtex_block_line_range,
	is_pending_same_file_rename,
	normalize_id,
	replace_bibtex_fence_citekey,
	replace_inline_citekey,
	type BibtexElement,
} from 'src/bibtex'

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

describe('is_pending_same_file_rename', () => {
	const owner: BibtexElement = {
		fields: { type: 'article', id: 'Smith2020', doi: '10.1/x' },
		source_path: 'notes/a.md',
	}

	it('is true when the owner\'s old id has vanished from this same file (in-place rename)', () => {
		const current_ids = new Set(['Jones2021'])
		expect(is_pending_same_file_rename(owner, 'Smith2020', 'Jones2021', 'notes/a.md', current_ids)).toBe(true)
	})

	it('is false when the old id still appears in the file (genuine intra-file DOI duplicate)', () => {
		const current_ids = new Set(['Smith2020', 'Jones2021'])
		expect(is_pending_same_file_rename(owner, 'Smith2020', 'Jones2021', 'notes/a.md', current_ids)).toBe(false)
	})

	it('is false when the owner entry lives in a different file (cross-file duplicate)', () => {
		const current_ids = new Set(['Jones2021'])
		expect(is_pending_same_file_rename(owner, 'Smith2020', 'Jones2021', 'notes/b.md', current_ids)).toBe(false)
	})

	it('is false when the "owner" is the same id as the current one', () => {
		const current_ids = new Set(['Smith2020'])
		expect(is_pending_same_file_rename(owner, 'Smith2020', 'Smith2020', 'notes/a.md', current_ids)).toBe(false)
	})

	it('is false when there is no owner entry', () => {
		const current_ids = new Set(['Jones2021'])
		expect(is_pending_same_file_rename(undefined, 'Smith2020', 'Jones2021', 'notes/a.md', current_ids)).toBe(false)
	})
})

describe('find_bibtex_block_line_range', () => {
	it('finds the 0-based line span of the block containing the id', async () => {
		const body = [
			'intro line',
			'```bibtex',
			'@article{Smith2020, title={x}}',
			'```',
			'trailing line',
		].join('\n')
		const range = await find_bibtex_block_line_range(body, 'Smith2020')
		expect(range).toEqual({ start: 1, end: 3 })
	})

	it('picks the block that actually contains the id when there are several', async () => {
		const body = [
			'```bibtex',
			'@article{Alpha2020, title={a}}',
			'```',
			'',
			'```bibtex',
			'@article{Beta2021, title={b}}',
			'```',
		].join('\n')
		const range = await find_bibtex_block_line_range(body, 'Beta2021')
		expect(range).toEqual({ start: 4, end: 6 })
	})

	it('returns undefined when the id is not present in any block', async () => {
		const body = '```bibtex\n@article{Smith2020, title={x}}\n```'
		expect(await find_bibtex_block_line_range(body, 'Nope')).toBeUndefined()
	})
})

describe('replace_bibtex_fence_citekey', () => {
	it('rewrites the defining header inside the fence', () => {
		const content = [
			'```bibtex',
			'@article{Smith2020, title={x}, doi={10.1/x}}',
			'```',
		].join('\n')
		const out = replace_bibtex_fence_citekey(content, 'Smith2020', 'Jones2021')
		expect(out).toContain('@article{Jones2021, title={x}, doi={10.1/x}}')
		expect(out).not.toContain('Smith2020')
	})

	it('is a no-op when old_id is not the fence\'s own citekey (already renamed)', () => {
		const content = '```bibtex\n@article{Jones2021, title={x}}\n```'
		expect(replace_bibtex_fence_citekey(content, 'Smith2020', 'Jones2021')).toBe(content)
	})

	it('leaves inline cites and surrounding prose untouched', () => {
		const content = [
			'See `{Smith2020}` for background.',
			'```bibtex',
			'@article{Smith2020, title={x}}',
			'```',
		].join('\n')
		const out = replace_bibtex_fence_citekey(content, 'Smith2020', 'Jones2021')
		expect(out).toContain('`{Smith2020}`')
		expect(out).toContain('@article{Jones2021,')
	})
})
