import { describe, expect, it } from 'vitest'
import {
	audit_bibtex_dict,
	CARD_FONT_SIZE_MAX,
	CARD_FONT_SIZE_MIN,
	entry_count,
	missing_pdf_ids,
	normalize_card_font_size,
	normalize_plugin_cache,
	rebuild_dict_from_hits,
	remove_entries_for_path,
	retarget_source_paths,
	upsert_entry,
	type ScanHit,
} from 'src/cache-ops'
import type { BibtexField } from 'src/bibtex'

function fields(partial: Partial<BibtexField> & { id: string }): BibtexField {
	return {
		type: 'article',
		...partial,
	} as BibtexField
}

function hit(partial: Partial<ScanHit> & { id: string; path: string; line: number }): ScanHit {
	const f = fields({ id: partial.id, doi: partial.doi, title: partial.id })
	return {
		id: partial.id,
		path: partial.path,
		line: partial.line,
		doi: partial.doi,
		fields: partial.fields ?? f,
	}
}

describe('cache-ops / data integrity', () => {
	it('normalize_plugin_cache recovers from null and bad shapes', () => {
		expect(normalize_plugin_cache(null).bibtex_dict).toEqual({})
		expect(normalize_plugin_cache(undefined).note_folder).toBe('note')
		expect(normalize_plugin_cache({ bibtex_dict: 'nope' } as unknown).bibtex_dict).toEqual({})
		const ok = normalize_plugin_cache({
			bibtex_dict: { A: { fields: fields({ id: 'A' }), source: '@a', source_path: 'a.md' } },
			note_folder: 'N',
		})
		expect(ok.note_folder).toBe('N')
		expect(ok.bibtex_dict.A.fields.id).toBe('A')
		expect(ok.card_font_size).toBe(13)
		expect(ok.card_wide).toBe(false)
	})

	it('normalize_card_font_size clamps to allowed range', () => {
		expect(normalize_card_font_size(undefined)).toBe(13)
		expect(normalize_card_font_size('15')).toBe(15)
		expect(normalize_card_font_size(3)).toBe(CARD_FONT_SIZE_MIN)
		expect(normalize_card_font_size(99)).toBe(CARD_FONT_SIZE_MAX)
		expect(normalize_plugin_cache({ card_font_size: 100 }).card_font_size).toBe(CARD_FONT_SIZE_MAX)
	})

	it('normalize_plugin_cache preserves card_wide toggle', () => {
		expect(normalize_plugin_cache({ card_wide: true }).card_wide).toBe(true)
		expect(normalize_plugin_cache({ card_wide: 'yes' } as unknown).card_wide).toBe(false)
	})

	it('normalize_plugin_cache defaults missing_pdf_enabled to off, preserves true', () => {
		expect(normalize_plugin_cache(undefined).missing_pdf_enabled).toBe(false)
		expect(normalize_plugin_cache({ missing_pdf_enabled: true }).missing_pdf_enabled).toBe(true)
		expect(normalize_plugin_cache({ missing_pdf_enabled: 'yes' } as unknown).missing_pdf_enabled).toBe(false)
	})

	it('missing_pdf_ids filters by the injected predicate and sorts the result', () => {
		const dict = rebuild_dict_from_hits([
			hit({ id: 'Zed', path: 'z.md', line: 0 }),
			hit({ id: 'Alpha', path: 'a.md', line: 0 }),
			hit({ id: 'HasPdf', path: 'h.md', line: 0 }),
		])
		const has_pdf = (id: string) => id === 'HasPdf'
		expect(missing_pdf_ids(dict, has_pdf)).toEqual(['Alpha', 'Zed'])
	})

	it('missing_pdf_ids is empty when every entry has a PDF', () => {
		const dict = rebuild_dict_from_hits([hit({ id: 'A', path: 'a.md', line: 0 })])
		expect(missing_pdf_ids(dict, () => true)).toEqual([])
	})

	it('rebuild_dict_from_hits: first path+line wins for id and doi', () => {
		const hits: ScanHit[] = [
			hit({ id: 'B', path: 'b.md', line: 1, doi: '10.1/x' }),
			hit({ id: 'A', path: 'a.md', line: 5, doi: '10.1/x' }),
			hit({ id: 'A', path: 'a.md', line: 1, doi: '10.1/y' }),
			hit({ id: 'C', path: 'c.md', line: 0, doi: '10.1/x' }),
		]
		const dict = rebuild_dict_from_hits(hits)
		// sorted: a.md:1 A, a.md:5 A(skip id), b.md:1 B(skip doi 10.1/x taken by A? wait A has 10.1/y)
		// order: a.md L1 A doi 10.1/y, a.md L5 A skip id, b.md L1 B doi 10.1/x, c.md L0 C skip doi
		expect(Object.keys(dict).sort()).toEqual(['A', 'B'])
		expect(dict.A.fields.doi).toBe('10.1/y')
		expect(dict.A.source_path).toBe('a.md')
		expect(dict.B.fields.doi).toBe('10.1/x')
		expect(dict.C).toBeUndefined()
	})

	it('rebuild is pure — does not mutate input order for callers that reuse hits', () => {
		const hits = [
			hit({ id: 'Z', path: 'z.md', line: 0 }),
			hit({ id: 'A', path: 'a.md', line: 0 }),
		]
		const copy = hits.map((h) => h.id)
		rebuild_dict_from_hits(hits)
		expect(hits.map((h) => h.id)).toEqual(copy)
	})

	it('retarget and remove by path keep dict consistent', () => {
		const dict = rebuild_dict_from_hits([
			hit({ id: 'A', path: 'old.md', line: 0 }),
			hit({ id: 'B', path: 'keep.md', line: 0 }),
		])
		expect(retarget_source_paths(dict, 'old.md', 'new.md')).toBe(true)
		expect(dict.A.source_path).toBe('new.md')
		expect(remove_entries_for_path(dict, 'keep.md')).toBe(1)
		expect(dict.B).toBeUndefined()
		expect(entry_count(dict)).toBe(1)
	})

	it('upsert_entry is idempotent for same source payload', () => {
		const dict = {}
		const f = fields({ id: 'A', title: 't' })
		const src = '@article{A, title = {t},}'
		expect(upsert_entry(dict, 'A', f, src, 'a.md')).toBe(true)
		expect(upsert_entry(dict, 'A', f, src, 'a.md')).toBe(false)
		expect(upsert_entry(dict, 'A', f, src + ' ', 'a.md')).toBe(true)
	})

	it('audit_bibtex_dict flags key/id mismatch and shared DOI', () => {
		const dict = rebuild_dict_from_hits([
			hit({ id: 'A', path: 'a.md', line: 0, doi: '10/x' }),
		])
		// poison
		dict.B = {
			fields: fields({ id: 'NotB', doi: '10/x' }),
			source: 'x',
			source_path: 'b.md',
		}
		const problems = audit_bibtex_dict(dict)
		expect(problems.some((p) => p.includes('fields.id'))).toBe(true)
		expect(problems.some((p) => p.includes('DOI'))).toBe(true)
	})

	it('healthy dict audits clean', () => {
		const dict = rebuild_dict_from_hits([
			hit({ id: 'A', path: 'a.md', line: 0, doi: '10/a' }),
			hit({ id: 'B', path: 'b.md', line: 0, doi: '10/b' }),
		])
		expect(audit_bibtex_dict(dict)).toEqual([])
	})
})
