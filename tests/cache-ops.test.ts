import { describe, expect, it } from 'vitest'
import {
	ABSTRACTS_IN_HOT_CACHE,
	audit_bibtex_dict,
	CARD_FONT_SIZE_MAX,
	CARD_FONT_SIZE_MIN,
	classify_path_fingerprints,
	collect_hits_from_markdown,
	entry_count,
	entry_source,
	file_fingerprint,
	format_bibtex_for_ids,
	hits_from_cached_entries,
	ids_under_path,
	merge_rescan_hits,
	missing_pdf_ids,
	probe_missing_pdf_chunked,
	normalize_card_font_size,
	normalize_panel_chip_font_size,
	normalize_plugin_cache,
	PANEL_CHIP_FONT_SIZE_MAX,
	PANEL_CHIP_FONT_SIZE_MIN,
	rebuild_dict_from_hits,
	remove_entries_for_path,
	restore_entries_snapshot,
	retarget_fingerprint,
	retarget_source_paths,
	slim_bibtex_dict,
	snapshot_entries_for_path,
	upsert_entry,
	type ScanHit,
} from 'src/cache-ops'
import { build_doi_index } from 'src/doi-index'
import { build_id_index } from 'src/citekey-index'
import { make_bibtex, type BibtexField } from 'src/bibtex'

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
		expect(ok.path_fingerprints).toEqual({})
	})

	it('normalize_plugin_cache slims reconstructible source (S3 migration)', () => {
		const fat = {
			bibtex_dict: {
				A: {
					fields: fields({ id: 'A', title: 'Hello', abstract: 'long text' }),
					source: '@article{A,\n  title = {Hello},\n  abstract = {long text},\n}\n',
					source_path: 'a.md',
					source_line: 3,
				},
			},
			path_fingerprints: { 'a.md': '1:2' },
		}
		const ok = normalize_plugin_cache(fat)
		expect(ok.bibtex_dict.A.source).toBeUndefined()
		expect(ok.bibtex_dict.A.fields.abstract).toBe('long text')
		expect(ok.bibtex_dict.A.source_line).toBe(3)
		expect(entry_source(ok.bibtex_dict.A)).toContain('Hello')
		expect(ok.path_fingerprints).toEqual({ 'a.md': '1:2' })
		expect(ABSTRACTS_IN_HOT_CACHE).toBe(true)
	})

	it('normalize_card_font_size clamps to allowed range', () => {
		expect(normalize_card_font_size(undefined)).toBe(13)
		expect(normalize_card_font_size('15')).toBe(15)
		expect(normalize_card_font_size(3)).toBe(CARD_FONT_SIZE_MIN)
		expect(normalize_card_font_size(99)).toBe(CARD_FONT_SIZE_MAX)
		expect(normalize_plugin_cache({ card_font_size: 100 }).card_font_size).toBe(CARD_FONT_SIZE_MAX)
	})

	it('normalize_panel_chip_font_size clamps to its own range, independent of card_font_size', () => {
		expect(normalize_panel_chip_font_size(undefined)).toBe(13)
		expect(normalize_panel_chip_font_size('15')).toBe(15)
		expect(normalize_panel_chip_font_size(3)).toBe(PANEL_CHIP_FONT_SIZE_MIN)
		expect(normalize_panel_chip_font_size(99)).toBe(PANEL_CHIP_FONT_SIZE_MAX)
		const cache = normalize_plugin_cache({ panel_chip_font_size: 18, card_font_size: 11 })
		expect(cache.panel_chip_font_size).toBe(18)
		expect(cache.card_font_size).toBe(11)
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

	it('normalize_plugin_cache defaults panel_double_debounce_enabled to off, preserves true', () => {
		expect(normalize_plugin_cache(undefined).panel_double_debounce_enabled).toBe(false)
		expect(normalize_plugin_cache({ panel_double_debounce_enabled: true }).panel_double_debounce_enabled).toBe(true)
		expect(normalize_plugin_cache({ panel_double_debounce_enabled: 'yes' } as unknown).panel_double_debounce_enabled).toBe(false)
		expect(normalize_plugin_cache({ quiet_duplicate_notices: true } as unknown).quiet_duplicate_notices).toBe(true)
		expect(normalize_plugin_cache({ quiet_duplicate_notices: 'yes' } as unknown).quiet_duplicate_notices).toBe(false)
		expect(normalize_plugin_cache({ export_bib_path: 'refs/all.bib' } as unknown).export_bib_path).toBe('refs/all.bib')
		expect(normalize_plugin_cache({} as unknown).export_bib_path).toBe('bibliography.bib')
	})

	it('normalize_plugin_cache defaults papers_view to discover, preserves list, rejects garbage', () => {
		expect(normalize_plugin_cache(undefined).papers_view).toBe('discover')
		expect(normalize_plugin_cache({ papers_view: 'list' }).papers_view).toBe('list')
		expect(normalize_plugin_cache({ papers_view: 'discover' }).papers_view).toBe('discover')
		expect(normalize_plugin_cache({ papers_view: 'grid' } as unknown).papers_view).toBe('discover')
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

	it('probe_missing_pdf_chunked yields, sorts missing, and supports cancel (S7)', async () => {
		const ids = Array.from({ length: 20 }, (_, i) => `P${String(i).padStart(2, '0')}`)
		const sleeps: number[] = []
		const progress: Array<[number, number]> = []
		const result = await probe_missing_pdf_chunked({
			ids,
			has_pdf: (id) => id === 'P05' || id === 'P10',
			chunk_size: 5,
			yield_ms: 0,
			sleep: async (ms) => { sleeps.push(ms) },
			on_progress: (done, total) => progress.push([done, total]),
		})
		expect(result.cancelled).toBe(false)
		expect(result.probed).toBe(20)
		expect(result.missing).not.toContain('P05')
		expect(result.missing).not.toContain('P10')
		expect(result.missing).toHaveLength(18)
		expect(result.missing[0] < result.missing[1]).toBe(true)
		expect(sleeps.length).toBeGreaterThanOrEqual(1)
		expect(progress.at(-1)).toEqual([20, 20])

		let n = 0
		const cancelled = await probe_missing_pdf_chunked({
			ids,
			has_pdf: () => false,
			chunk_size: 5,
			should_cancel: () => ++n >= 8,
			sleep: async () => {},
		})
		expect(cancelled.cancelled).toBe(true)
		expect(cancelled.probed).toBeLessThan(20)
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

	it('rebuild_dict_from_hits: dedupes citekeys case-insensitively, first path+line wins', () => {
		const dict = rebuild_dict_from_hits([
			hit({ id: 'smith2020', path: 'b.md', line: 0 }),
			hit({ id: 'Smith2020', path: 'a.md', line: 0 }),
		])
		expect(Object.keys(dict)).toEqual(['Smith2020'])
		expect(dict.Smith2020.source_path).toBe('a.md')
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

	it('snapshot + restore undoes a path removal without clobbering newer owners', () => {
		const dict = rebuild_dict_from_hits([
			hit({ id: 'A', path: 'gone.md', line: 0, doi: '10/a' }),
			hit({ id: 'B', path: 'keep.md', line: 0, doi: '10/b' }),
		])
		const doi_index = build_doi_index(dict)
		const id_index = build_id_index(dict)
		const snap = snapshot_entries_for_path(dict, 'gone.md')
		expect(Object.keys(snap)).toEqual(['A'])
		// Snapshot is a copy — mutating dict does not empty it.
		remove_entries_for_path(dict, 'gone.md', doi_index, id_index)
		expect(dict.A).toBeUndefined()
		expect(Object.keys(snap)).toEqual(['A'])

		const full = restore_entries_snapshot(dict, snap, doi_index, id_index)
		expect(full).toEqual({ restored: 1, skipped: 0 })
		expect(dict.A?.source_path).toBe('gone.md')
		expect(doi_index.get('10/a')).toBe('A')
		expect(id_index.get('a')).toBe('A')

		// If A was re-occupied after delete, skip rather than overwrite.
		dict.A = { fields: fields({ id: 'A', title: 'newer' }), source_path: 'other.md' }
		const again = restore_entries_snapshot(dict, snap, doi_index, id_index)
		expect(again).toEqual({ restored: 0, skipped: 1 })
		expect(dict.A.source_path).toBe('other.md')
		expect(dict.A.fields.title).toBe('newer')
	})

	it('ids_under_path matches by real path segment, not a same-prefixed sibling folder', () => {
		const dict = rebuild_dict_from_hits([
			hit({ id: 'A', path: 'notes/a.md', line: 0 }),
			hit({ id: 'B', path: 'notes/sub/b.md', line: 0 }),
			hit({ id: 'C', path: 'notes-archive/c.md', line: 0 }),
			hit({ id: 'D', path: 'other/d.md', line: 0 }),
		])
		expect(ids_under_path(dict, 'notes/').sort()).toEqual(['A', 'B'])
		expect(ids_under_path(dict, '')).toHaveLength(4)
	})

	it('format_bibtex_for_ids renders only the requested ids, sorted, abstract omitted', () => {
		const dict = rebuild_dict_from_hits([
			hit({ id: 'B', path: 'b.md', line: 0 }),
			hit({ id: 'A', path: 'a.md', line: 0 }),
		])
		dict.A.fields.abstract = 'should not appear'
		const out = format_bibtex_for_ids(dict, ['B', 'A', 'missing'])
		expect(out.indexOf('@article{A')).toBeLessThan(out.indexOf('@article{B'))
		expect(out).not.toContain('should not appear')
	})

	it('upsert_entry is idempotent for same make_bibtex payload (slim, no source stored)', () => {
		const dict = {}
		const f = fields({ id: 'A', title: 't' })
		const src = make_bibtex(f)
		expect(upsert_entry(dict, 'A', f, src, 'a.md')).toBe(true)
		expect(dict.A.source).toBeUndefined()
		expect(upsert_entry(dict, 'A', f, src, 'a.md')).toBe(false)
		expect(upsert_entry(dict, 'A', f, src + ' ', 'a.md')).toBe(true)
	})

	it('rebuild stores source_line and omits source (S3)', () => {
		const dict = rebuild_dict_from_hits([hit({ id: 'A', path: 'a.md', line: 4, doi: '10/a' })])
		expect(dict.A.source).toBeUndefined()
		expect(dict.A.source_line).toBe(4)
		expect(entry_source(dict.A)).toContain('@article{A')
		expect(slim_bibtex_dict(dict).A.source).toBeUndefined()
	})

	it('audit_bibtex_dict flags key/id mismatch and shared DOI', () => {
		const dict = rebuild_dict_from_hits([
			hit({ id: 'A', path: 'a.md', line: 0, doi: '10/x' }),
		])
		// poison
		dict.B = {
			fields: fields({ id: 'NotB', doi: '10/x' }),
			source_path: 'b.md',
		}
		const problems = audit_bibtex_dict(dict)
		expect(problems.some((p) => p.includes('fields.id'))).toBe(true)
		expect(problems.some((p) => p.includes('DOI'))).toBe(true)
	})

	it('healthy dict audits clean without stored source', () => {
		const dict = rebuild_dict_from_hits([
			hit({ id: 'A', path: 'a.md', line: 0, doi: '10/a' }),
			hit({ id: 'B', path: 'b.md', line: 0, doi: '10/b' }),
		])
		expect(audit_bibtex_dict(dict)).toEqual([])
	})

	it('collect_hits_from_markdown finds blocks and records 0-based line', async () => {
		const text = [
			'# Notes',
			'',
			'```bibtex',
			'@article{Alpha, title={A}, doi={10/a}}',
			'```',
			'',
			'```bibtex',
			'@article{Beta, title={B}}',
			'```',
		].join('\n')
		const hits = await collect_hits_from_markdown('papers/a.md', text)
		expect(hits.map((h) => h.id)).toEqual(['Alpha', 'Beta'])
		expect(hits[0].path).toBe('papers/a.md')
		expect(hits[0].line).toBe(2)
		expect(hits[0].doi).toBe('10/a')
		expect(hits[1].line).toBe(6)
	})

	it('collect_hits_from_markdown returns empty when no ```bibtex gate', async () => {
		const hits = await collect_hits_from_markdown('x.md', 'just `{Alpha}` text')
		expect(hits).toEqual([])
	})
})

describe('cache-ops / incremental rescan (S5)', () => {
	it('file_fingerprint is mtime:size', () => {
		expect(file_fingerprint(1000, 42)).toBe('1000:42')
	})

	it('classify_path_fingerprints: new / changed / unchanged / deleted', () => {
		const prev = { 'a.md': '1:1', 'b.md': '2:2', 'gone.md': '3:3' }
		const cur = { 'a.md': '1:1', 'b.md': '9:9', 'c.md': '4:4' }
		const c = classify_path_fingerprints(['a.md', 'b.md', 'c.md'], cur, prev)
		expect(c.unchanged).toEqual(['a.md'])
		expect(c.changed).toEqual(['b.md'])
		expect(c.new).toEqual(['c.md'])
		expect(c.deleted).toEqual(['gone.md'])
	})

	it('merge: unchanged cached winners + fresh hits; delete path drops winner', () => {
		const old = rebuild_dict_from_hits([
			hit({ id: 'Keep', path: 'keep.md', line: 0 }),
			hit({ id: 'Drop', path: 'drop.md', line: 0 }),
			hit({ id: 'Old', path: 'edit.md', line: 0, doi: '10/old' }),
		])
		// Soft scan: keep.md unchanged, drop.md deleted, edit.md re-parsed with new id
		const cached = hits_from_cached_entries(old, new Set(['keep.md']))
		const fresh = [hit({ id: 'New', path: 'edit.md', line: 0, doi: '10/new' })]
		const merged = merge_rescan_hits(cached, fresh)
		const dict = rebuild_dict_from_hits(merged)
		expect(Object.keys(dict).sort()).toEqual(['Keep', 'New'])
		expect(dict.Drop).toBeUndefined()
		expect(dict.Old).toBeUndefined()
		expect(dict.New.fields.doi).toBe('10/new')
	})

	it('merge conflict: first path wins for duplicate citekey across cached + fresh', () => {
		const old = rebuild_dict_from_hits([
			hit({ id: 'Same', path: 'a.md', line: 0, doi: '10/a' }),
		])
		const cached = hits_from_cached_entries(old, new Set(['a.md']))
		// b.md changed and also claims Same — a.md sorts first, keeps winner
		const fresh = [hit({ id: 'Same', path: 'b.md', line: 0, doi: '10/b' })]
		const dict = rebuild_dict_from_hits(merge_rescan_hits(cached, fresh))
		expect(dict.Same.source_path).toBe('a.md')
		expect(dict.Same.fields.doi).toBe('10/a')
	})

	it('merge conflict: DOI first-wins when cached winner holds DOI', () => {
		const old = rebuild_dict_from_hits([
			hit({ id: 'A', path: 'a.md', line: 0, doi: '10/shared' }),
		])
		const cached = hits_from_cached_entries(old, new Set(['a.md']))
		const fresh = [hit({ id: 'B', path: 'b.md', line: 0, doi: '10/shared' })]
		const dict = rebuild_dict_from_hits(merge_rescan_hits(cached, fresh))
		expect(dict.A).toBeDefined()
		expect(dict.B).toBeUndefined()
	})

	it('retarget_fingerprint moves key on rename', () => {
		const fps = { 'old.md': '1:1', 'other.md': '2:2' }
		expect(retarget_fingerprint(fps, 'old.md', 'new.md')).toBe(true)
		expect(fps['new.md']).toBe('1:1')
		expect(fps['old.md']).toBeUndefined()
		expect(retarget_fingerprint(fps, 'missing.md', 'x.md')).toBe(false)
	})
})
