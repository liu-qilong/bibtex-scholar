import { describe, expect, it } from 'vitest'
import { check_duplicate_id, type BibtexDict, type BibtexField } from 'src/bibtex'
import { build_id_index, id_index_claim, id_index_clear_owner, resolve_id } from 'src/citekey-index'
import { delete_entry, rebuild_dict_from_hits, upsert_entry, type ScanHit } from 'src/cache-ops'

function fields(partial: Partial<BibtexField> & { id: string }): BibtexField {
	return { type: 'article', ...partial } as BibtexField
}

function entry(id: string, path: string) {
	return {
		fields: fields({ id, title: id }),
		source: `@article{${id},}`,
		source_path: path,
	}
}

describe('citekey index', () => {
	it('build_id_index maps normalized citekey to the first literal owner', () => {
		const dict: BibtexDict = {
			Smith2020: entry('Smith2020', 'a.md'),
			Doe2021: entry('Doe2021', 'b.md'),
		}
		const index = build_id_index(dict)
		expect(index.get('smith2020')).toBe('Smith2020')
		expect(index.get('doe2021')).toBe('Doe2021')
		expect(index.size).toBe(2)
	})

	it('resolve_id finds the canonical citekey regardless of query casing', () => {
		const index = build_id_index({ Smith2020: entry('Smith2020', 'a.md') })
		expect(resolve_id(index, 'smith2020')).toBe('Smith2020')
		expect(resolve_id(index, 'SMITH2020')).toBe('Smith2020')
		expect(resolve_id(index, 'Smith2020')).toBe('Smith2020')
		expect(resolve_id(index, 'unknown')).toBeUndefined()
	})

	it('id_index_claim / id_index_clear_owner keep the index consistent', () => {
		const index = build_id_index({})
		id_index_claim(index, 'Smith2020')
		expect(resolve_id(index, 'smith2020')).toBe('Smith2020')
		id_index_clear_owner(index, 'Smith2020')
		expect(resolve_id(index, 'smith2020')).toBeUndefined()
	})

	it('check_duplicate_id with an id_index catches a case-different cross-file collision', () => {
		const dict: BibtexDict = { Smith2020: entry('Smith2020', 'a.md') }
		const index = build_id_index(dict)
		// same key re-rendered from its own file: ok
		expect(check_duplicate_id(dict, 'Smith2020', 'a.md', '@article{Smith2020,}', index)).toBe(false)
		// a different file introducing a case variant of an existing key: duplicate
		expect(check_duplicate_id(dict, 'smith2020', 'b.md', '@article{smith2020,}', index)).toBe(true)
		// linear fallback (no index) matches the same semantics
		expect(check_duplicate_id(dict, 'smith2020', 'b.md', '@article{smith2020,}')).toBe(true)
	})

	it('check_duplicate_id flags case-different repeats within the same file', () => {
		const dict: BibtexDict = {}
		const content = '@article{Smith2020,}\n@article{smith2020,}'
		expect(check_duplicate_id(dict, 'Smith2020', 'a.md', content)).toBe(true)
	})

	it('upsert_entry / delete_entry keep the id index consistent with the dict', () => {
		const dict: BibtexDict = {}
		const index = build_id_index(dict)
		const f = fields({ id: 'Smith2020', title: 't' })
		expect(upsert_entry(dict, 'Smith2020', f, '@a', 'a.md', undefined, undefined, index)).toBe(true)
		expect(resolve_id(index, 'smith2020')).toBe('Smith2020')

		expect(delete_entry(dict, 'Smith2020', undefined, index)).toBe(true)
		expect(resolve_id(index, 'smith2020')).toBeUndefined()
		expect(dict.Smith2020).toBeUndefined()
	})

	it('rebuild_dict_from_hits + build_id_index align on the case-insensitive winner', () => {
		const hits: ScanHit[] = [
			{ id: 'Smith2020', path: 'a.md', line: 0, fields: fields({ id: 'Smith2020' }) },
			{ id: 'smith2020', path: 'b.md', line: 0, fields: fields({ id: 'smith2020' }) },
		]
		const dict = rebuild_dict_from_hits(hits)
		const index = build_id_index(dict)
		expect(Object.keys(dict)).toEqual(['Smith2020'])
		expect(resolve_id(index, 'smith2020')).toBe('Smith2020')
	})
})
