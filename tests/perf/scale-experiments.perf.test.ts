/**
 * Scale experiments: upstream-shaped baseline vs this fork.
 *
 * These are *experiments*, not micro-flake unit tests. They measure:
 *   - structural work (DOM mount proxies, bytes examined, files read, dict probes)
 *   - relative wall time where the fork changes *complexity class* (DOI index,
 *     mount caps) — not every path is a pure CPU win (fuzzy+TeX search is
 *     intentionally richer than upstream `.includes`)
 *
 * Obsidian is mocked via vitest alias (`tests/mocks/obsidian.ts`); vault I/O is
 * an in-memory Map injected into pure scan helpers — same coupling pattern as
 * production (`VaultRead` / path list), without Electron.
 *
 * Run: `npm run test:perf`
 *
 * See SPEED.md and docs/stability-trust.md for the design budgets under test.
 */

import { describe, expect, it } from 'vitest'
import {
	check_duplicate_doi,
	FREE_TEXT_MATCH_FIELDS,
	match_query,
	type BibtexDict,
	type BibtexElement,
} from 'src/bibtex'
import {
	build_doi_index,
	doi_is_duplicate,
} from 'src/architecture/doi-index'
import {
	list_ids_for_panel,
	list_ids_for_suggest,
	PANEL_RESULT_CAP,
	SUGGEST_RESULT_CAP,
	visible_window,
	PANEL_EMPTY_PREVIEW,
} from 'src/scale/library-scale'
import { collect_hits_from_markdown } from 'src/core/cache-ops'
import { scan_bibtex_hits_chunked } from 'src/scale/vault-scan'
import { bench, format_row, type BenchSample } from './bench'
import {
	upstream_check_duplicate_doi,
	upstream_full_vault_read,
	upstream_list_ids,
	upstream_match_query,
} from './baseline-upstream'
import {
	build_mock_vault_files,
	build_public_seed_dict,
	changed_path_set,
} from './corpora'

const N = 5_000
/** Multi-keystroke queries (simulate typing into the panel). */
const KEYSTROKES = ['tr', 'tra', 'tran', 'trans', 'transf'] as const

function report(title: string, rows: string[]) {
	// eslint-disable-next-line no-console
	console.log(
		`\n### ${title}\n` +
			`| Experiment | Upstream-shaped | This fork | Speedup / ratio |\n` +
			`|---|---|---|---|\n` +
			rows.join('\n') +
			'\n',
	)
}

/** Bytes touched by upstream free-text: every field value, every keystroke. */
function upstream_bytes_examined(dict: BibtexDict, queries: readonly string[]): number {
	let bytes = 0
	for (const q of queries) {
		for (const id of Object.keys(dict)) {
			const e = dict[id]!
			for (const key of Object.keys(e.fields)) {
				bytes += String(e.fields[key] ?? '').length
			}
			// Still run the real matcher so hit counts stay meaningful.
			void upstream_match_query(e, q)
		}
	}
	return bytes
}

/**
 * Bytes touched by fork free-text after corpus build: slim fields only, once
 * per entry for corpus materialization + token checks on the cached corpus.
 * (Models Steady-state keystrokes once WeakMap is warm.)
 */
function fork_slim_bytes_steady(dict: BibtexDict, queries: readonly string[]): number {
	// Warm corpus cache via real match_query.
	for (const id of Object.keys(dict)) {
		match_query(dict[id]!, queries[0] ?? 'a')
	}
	let bytes = 0
	for (const id of Object.keys(dict)) {
		const e = dict[id]!
		for (const key of FREE_TEXT_MATCH_FIELDS) {
			const raw = e.fields[key]
			if (raw != null) bytes += String(raw).length
		}
	}
	// Steady-state: each further keystroke only scans the slim corpus length.
	const corpus_len_total = bytes
	return corpus_len_total * queries.length
}

function abstract_bytes(dict: BibtexDict): number {
	let b = 0
	for (const id of Object.keys(dict)) {
		b += String(dict[id]!.fields.abstract ?? '').length
	}
	return b
}

describe('scale experiments (public-seed corpus, N=5000)', () => {
	const dict = build_public_seed_dict({
		n: N,
		abstract_chars: 2000,
		doi_collision_every: 50,
	})
	const ids = Object.keys(dict)

	it('E1 free-text footprint: abstract excluded + multi-keystroke work', () => {
		const abs = abstract_bytes(dict)
		const up_bytes = upstream_bytes_examined(dict, KEYSTROKES)
		const fork_bytes = fork_slim_bytes_steady(dict, KEYSTROKES)

		// Wall clock (reported for PR prose). Fork may be *slower* here because
		// match_query does TeX fold + token fuzzy — a quality tradeoff. The
		// structural win is bytes/fields examined (abstract out of free-text).
		const baseline = bench(() => {
			let hits = 0
			for (const q of KEYSTROKES) {
				for (const id of ids) {
					if (upstream_match_query(dict[id]!, q)) hits++
				}
			}
			return hits
		}, { runs: 3, warmup: 1 })

		const fork = bench(() => {
			let hits = 0
			for (const q of KEYSTROKES) {
				for (const id of ids) {
					if (match_query(dict[id]!, q)) hits++
				}
			}
			return hits
		}, { runs: 3, warmup: 1 })

		const b: BenchSample = {
			label: 'upstream',
			ms: baseline.ms,
			work: up_bytes,
		}
		const f: BenchSample = {
			label: 'fork',
			ms: fork.ms,
			work: fork_bytes,
		}
		report('E1 free-text (work = field-bytes × keystrokes model)', [
			format_row('search keystrokes', b, f),
			`| abstract bytes in corpus | ${abs} (always free-text) | 0 (opt-in abstract: only) | — |`,
			`| note | simple .includes over all fields | TeX+fuzzy on slim corpus; CPU may exceed baseline | quality vs cost |`,
		])

		// Structural: fork free-text model examines far fewer bytes (no abstracts).
		expect(abs).toBeGreaterThan(N * 1500)
		expect(fork_bytes).toBeLessThan(up_bytes * 0.35)
		// Semantic: free-text does not hit abstract-only tokens.
		const abs_token = 'unique-abstract-token-never-in-title-xyz'
		const with_abs: BibtexElement = {
			...dict[ids[0]!]!,
			fields: {
				...dict[ids[0]!]!.fields,
				abstract: `${abs_token} padding`,
				title: 'Unrelated title',
			},
		}
		expect(upstream_match_query(with_abs, abs_token)).toBe(true)
		expect(match_query(with_abs, abs_token)).toBe(false)
		expect(match_query(with_abs, `abstract:${abs_token}`)).toBe(true)
	})

	it('E2 panel open / search: mount budget (DOM proxy)', () => {
		const up_empty = upstream_list_ids(dict, '')
		const fork_empty = list_ids_for_panel(dict, '')
		expect(up_empty.mounts).toBe(N)
		expect(fork_empty.ids.length).toBe(PANEL_EMPTY_PREVIEW)

		const q = 'Deep'
		const up_q_t = bench(() => {
			const r = upstream_list_ids(dict, q)
			return r.mounts
		}, { runs: 3 })
		const fork_q_t = bench(() => {
			const r = list_ids_for_panel(dict, q)
			return r.ids.length
		}, { runs: 3 })

		report('E2 panel search mounts', [
			format_row(`query "${q}"`, { label: 'upstream', ms: up_q_t.ms, work: up_q_t.work }, {
				label: 'fork',
				ms: fork_q_t.ms,
				work: fork_q_t.work,
			}),
			`| empty open mounts | ${up_empty.mounts} | ${fork_empty.ids.length} | ${(up_empty.mounts / fork_empty.ids.length).toFixed(0)}× fewer |`,
		])

		expect(fork_q_t.work).toBeLessThanOrEqual(PANEL_RESULT_CAP)
		expect(up_q_t.work).toBeGreaterThan(PANEL_RESULT_CAP)
		// O(viewport) vs O(library) on empty open — primary UX freeze avoidance.
		expect(fork_empty.ids.length / up_empty.mounts).toBeLessThan(0.02)
	})

	it('E3 EditorSuggest: capped list vs full dump', () => {
		const q = 'Adam'
		const up = bench(() => {
			const r = upstream_list_ids(dict, q)
			return r.mounts
		}, { runs: 3 })
		const fork = bench(() => {
			const r = list_ids_for_suggest(dict, q)
			return r.ids.length
		}, { runs: 3 })

		report('E3 suggest rows', [
			format_row(`query "${q}"`, { label: 'up', ms: up.ms, work: up.work }, {
				label: 'fork',
				ms: fork.ms,
				work: fork.work,
			}),
		])

		expect(fork.work).toBeLessThanOrEqual(SUGGEST_RESULT_CAP)
		expect(up.work).toBeGreaterThan(SUGGEST_RESULT_CAP)
	})

	it(
		'E4 DOI clash paint path: O(1) index vs linear scan',
		() => {
			const index = build_doi_index(dict)
			// Fewer runs — linear path is Θ(N²) work by design.
			const up = bench(
				() => {
					let examined = 0
					for (const id of ids) {
						const e = dict[id]!
						const r = upstream_check_duplicate_doi(
							dict,
							e.fields.doi,
							id,
							e.source_path,
						)
						examined += r.examined
					}
					return examined
				},
				{ runs: 1, warmup: 0 },
			)

			const fork = bench(
				() => {
					let examined = 0
					for (const id of ids) {
						const e = dict[id]!
						doi_is_duplicate(index, dict, e.fields.doi, id, e.source_path)
						examined += 1
					}
					return examined
				},
				{ runs: 3, warmup: 1 },
			)

			for (const id of [ids[0]!, ids[50]!, ids[51]!]) {
				const e = dict[id]!
				expect(check_duplicate_doi(dict, e.fields.doi, id, e.source_path, index)).toBe(
					upstream_check_duplicate_doi(dict, e.fields.doi, id, e.source_path).clash,
				)
			}

			report('E4 DOI paint checks (all entries once)', [
				format_row(
					'duplicate probes',
					{ label: 'up', ms: up.ms, work: up.work },
					{ label: 'fork', ms: fork.ms, work: fork.work },
				),
			])

			expect(up.work).toBeGreaterThan(N * 10)
			expect(fork.work).toBe(N)
			expect(fork.ms).toBeLessThan(up.ms * 0.05)
		},
		30_000,
	)

	it('E5 list-mode virtualization: viewport DOM vs full list length', () => {
		const total = N
		const row_h = 60
		const viewport_h = 600
		const scroll_top = 12_000
		const { start, end } = visible_window(scroll_top, viewport_h, row_h, total, 6)
		const mounted = end - start

		report('E5 virtual window', [
			`| list of ${total} | would mount ${total} (naive) | mounts ${mounted} (visible_window) | ${(total / mounted).toFixed(0)}× fewer |`,
		])

		expect(mounted).toBeLessThan(40)
		expect(mounted).toBeGreaterThan(5)
		expect(mounted / total).toBeLessThan(0.01)
	})

	it('E6 mock vault rescan: full re-read vs soft 10% + chunked hard', async () => {
		const small_n = 800
		const small = build_public_seed_dict({ n: small_n, abstract_chars: 400 })
		const files = build_mock_vault_files(small)
		const paths = [...files.keys()]
		const read = async (p: string) => files.get(p) ?? ''

		const t0 = performance.now()
		const full = await upstream_full_vault_read(paths, read)
		let up_hits = 0
		for (const p of paths) {
			const hits = await collect_hits_from_markdown(p, await read(p))
			up_hits += hits.length
		}
		const up_ms = performance.now() - t0

		const changed = changed_path_set(paths, 0.1)
		const t1 = performance.now()
		let fork_reads = 0
		let fork_hits = 0
		for (const p of paths) {
			if (!changed.has(p)) continue
			fork_reads++
			const hits = await collect_hits_from_markdown(p, await read(p))
			fork_hits += hits.length
		}
		const soft_ms = performance.now() - t1

		const t2 = performance.now()
		const chunked = await scan_bibtex_hits_chunked({
			paths,
			read,
			chunk_size: 32,
			yield_ms: 0,
			sleep: async () => {},
		})
		const hard_ms = performance.now() - t2

		report('E6 mock vault (800 notes, Obsidian-coupled via injected VaultRead)', [
			`| full re-read+parse | ${up_ms.toFixed(1)} ms (files ${full.files}, hits ${up_hits}) | soft 10%: ${soft_ms.toFixed(1)} ms (reads ${fork_reads}, hits ${fork_hits}) | reads ${(full.files / fork_reads).toFixed(1)}× fewer |`,
			`| hard chunked harvest | (same full cost class) | ${hard_ms.toFixed(1)} ms (hits ${chunked.hits.length}, read ${chunked.files_read}, skipped ${chunked.files_skipped}) | progressive/cancelable API |`,
		])

		expect(full.files).toBe(small_n)
		expect(fork_reads).toBe(changed.size)
		expect(fork_reads / full.files).toBeLessThan(0.15)
		expect(chunked.hits.length).toBeGreaterThanOrEqual(small_n)
		expect(chunked.files_read).toBe(small_n)
	})

	it('E7 corpus sanity: public seeds present and abstract-heavy', () => {
		const sample = dict[ids[0]!]!
		expect(sample.fields.title?.length).toBeGreaterThan(10)
		expect(String(sample.fields.abstract).length).toBeGreaterThan(1000)
		expect(ids.length).toBe(N)
		const vaswani = Object.values(dict).some((e) =>
			String(e.fields.title).includes('Attention Is All You Need'),
		)
		expect(vaswani).toBe(true)
	})
})

describe('scale experiments — work accounting (no timing flake)', () => {
	it('documents the O(viewport) vs O(n) story on a fixed dict', () => {
		const dict: BibtexDict = build_public_seed_dict({ n: 1_000, abstract_chars: 500 })
		const up = upstream_list_ids(dict, '')
		const panel = list_ids_for_panel(dict, '')
		const suggest = list_ids_for_suggest(dict, 'Neural')

		expect(up.mounts).toBe(1000)
		expect(panel.ids.length).toBeLessThanOrEqual(PANEL_EMPTY_PREVIEW)
		expect(suggest.ids.length).toBeLessThanOrEqual(SUGGEST_RESULT_CAP)
	})
})
