import { describe, expect, it } from 'vitest'
import {
	card_affordance_copy,
	delete_uncache_notice_text,
	duplicate_block_notice,
	paint_duplicate_tag_state,
	rename_notice_text,
	unknown_cite_title,
} from 'src/ux-copy'

describe('ux-copy / user-facing messages', () => {
	it('unknown_cite_title names the key and points at recache (no toast wording)', () => {
		const t = unknown_cite_title('Missing2020')
		expect(t).toContain('Missing2020')
		expect(t.toLowerCase()).toContain('cache')
		expect(t.toLowerCase()).toContain('recache')
	})

	it('duplicate_block_notice explains first-wins and stays singular for one hit', () => {
		const msg = duplicate_block_notice({
			id_hits: 1,
			doi_hits: 0,
			example_id: 'Doe2020',
			example_owner_path: 'refs/a.md',
		})
		expect(msg).toContain('Not cached')
		expect(msg).toContain('first copy')
		expect(msg).toContain('Doe2020')
		expect(msg).toContain('refs/a.md')
		expect(msg).not.toContain('duplicate citekeys') // plural form
	})

	it('duplicate_block_notice pluralizes and can combine id + DOI hits', () => {
		const msg = duplicate_block_notice({ id_hits: 2, doi_hits: 1 })
		expect(msg).toContain('2 duplicate citekeys')
		expect(msg).toContain('duplicate DOI')
	})

	it('paint_duplicate_tag_state is red-labelled "not cached" with owner in title', () => {
		const s = paint_duplicate_tag_state('notes/paper.md')
		expect(s.clashing).toBe(true)
		expect(s.text).toBe('not cached')
		expect(s.title).toContain('notes/paper.md')
		expect(s.title.toLowerCase()).toContain('first copy')
	})

	it('delete_uncache_notice_text pluralizes entry count and includes path', () => {
		expect(delete_uncache_notice_text(1, 'a.md')).toContain('1 BibTeX entry')
		expect(delete_uncache_notice_text(3, 'a.md')).toContain('3 BibTeX entries')
		expect(delete_uncache_notice_text(3, 'a.md')).toContain('a.md')
	})

	it('rename_notice_text names both keys and pluralizes citations/files', () => {
		expect(rename_notice_text('Smith2020', 'Jones2021', 1, 1)).toBe(
			'Renamed Smith2020 → Jones2021 (1 citation in 1 file).',
		)
		expect(rename_notice_text('Smith2020', 'Jones2021', 3, 2)).toBe(
			'Renamed Smith2020 → Jones2021 (3 citations in 2 files).',
		)
	})

	it('card_affordance_copy differs for preview vs pin (line always readable)', () => {
		const preview = card_affordance_copy(false)
		expect(preview.line).toMatch(/Esc/)
		expect(preview.line).toMatch(/click outside/i)
		expect(preview.line).not.toMatch(/Pinned/)
		expect(preview.detail.length).toBeGreaterThan(preview.line.length)

		const pinned = card_affordance_copy(true)
		expect(pinned.line).toMatch(/Pinned/)
		expect(pinned.line).toMatch(/Esc/)
		expect(pinned.line).toMatch(/drag/i)
		expect(pinned.detail).toMatch(/notes/i)
	})
})
