import { describe, expect, it } from 'vitest'
import { check_duplicate_doi, type BibtexDict, type BibtexField } from 'src/bibtex'
import {
	build_doi_index,
	doi_index_on_delete,
	doi_index_on_upsert,
	doi_is_duplicate,
} from 'src/doi-index'
import { delete_entry, rebuild_dict_from_hits, upsert_entry, type ScanHit } from 'src/cache-ops'

function fields(partial: Partial<BibtexField> & { id: string }): BibtexField {
	return { type: 'article', ...partial } as BibtexField
}

function entry(id: string, path: string, doi?: string) {
	return {
		fields: fields({ id, doi, title: id }),
		source: `@article{${id},}`,
		source_path: path,
	}
}

describe('DOI index (Phase A)', () => {
	it('build_doi_index maps first owner only', () => {
		const dict: BibtexDict = {
			A: entry('A', 'a.md', '10/x'),
			B: entry('B', 'b.md', '10/y'),
		}
		const index = build_doi_index(dict)
		expect(index.get('10/x')).toBe('A')
		expect(index.get('10/y')).toBe('B')
		expect(index.size).toBe(2)
	})

	it('O(1) check matches linear check_duplicate_doi semantics', () => {
		const dict: BibtexDict = {
			A: entry('A', 'a.md', '10/x'),
			B: entry('B', 'b.md', '10/y'),
		}
		const index = build_doi_index(dict)

		// same id + path re-render: ok
		expect(doi_is_duplicate(index, dict, '10/x', 'A', 'a.md')).toBe(false)
		expect(check_duplicate_doi(dict, '10/x', 'A', 'a.md', index)).toBe(false)
		expect(check_duplicate_doi(dict, '10/x', 'A', 'a.md')).toBe(false)

		// different id same doi: clash
		expect(doi_is_duplicate(index, dict, '10/x', 'C', 'c.md')).toBe(true)
		expect(check_duplicate_doi(dict, '10/x', 'C', 'c.md', index)).toBe(true)
		expect(check_duplicate_doi(dict, '10/x', 'C', 'c.md')).toBe(true)

		// free doi
		expect(doi_is_duplicate(index, dict, '10/z', 'C', 'c.md')).toBe(false)
	})

	it('upsert/delete keep index consistent with dict', () => {
		const dict: BibtexDict = {}
		const index = build_doi_index(dict)
		const f = fields({ id: 'A', doi: '10/a', title: 't' })
		expect(upsert_entry(dict, 'A', f, '@a', 'a.md', index)).toBe(true)
		expect(index.get('10/a')).toBe('A')

		// change doi
		const f2 = fields({ id: 'A', doi: '10/b', title: 't' })
		expect(upsert_entry(dict, 'A', f2, '@a2', 'a.md', index)).toBe(true)
		expect(index.has('10/a')).toBe(false)
		expect(index.get('10/b')).toBe('A')

		expect(delete_entry(dict, 'A', index)).toBe(true)
		expect(index.has('10/b')).toBe(false)
		expect(dict.A).toBeUndefined()
	})

	it('rebuild_dict_from_hits + build_doi_index align', () => {
		const hits: ScanHit[] = [
			{
				id: 'A', path: 'a.md', line: 0, doi: '10/x',
				fields: fields({ id: 'A', doi: '10/x' }),
			},
			{
				id: 'B', path: 'b.md', line: 0, doi: '10/x',
				fields: fields({ id: 'B', doi: '10/x' }),
			},
		]
		const dict = rebuild_dict_from_hits(hits)
		const index = build_doi_index(dict)
		expect(Object.keys(dict)).toEqual(['A'])
		expect(index.get('10/x')).toBe('A')
		expect(check_duplicate_doi(dict, '10/x', 'B', 'b.md', index)).toBe(true)
	})

	it('doi_index_on_upsert handles rename of key with same doi', () => {
		const dict: BibtexDict = { Old: entry('Old', 'a.md', '10/x') }
		const index = build_doi_index(dict)
		const prev = dict.Old
		doi_index_on_delete(index, 'Old', prev)
		delete dict.Old
		const next = fields({ id: 'New', doi: '10/x' })
		doi_index_on_upsert(index, 'New', undefined, next.doi)
		dict.New = { fields: next, source: '@n', source_path: 'a.md' }
		expect(index.get('10/x')).toBe('New')
		expect(check_duplicate_doi(dict, '10/x', 'Other', 'o.md', index)).toBe(true)
	})
})
