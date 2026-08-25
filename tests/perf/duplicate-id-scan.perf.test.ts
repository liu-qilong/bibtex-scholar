/**
 * E9 — same-note duplicate-ID check: per-entry regex scan (upstream's shape,
 * and this fork's shape before this fix) vs a count map built once per note
 * and reused for every entry.
 *
 * `check_duplicate_id`'s same-file half used to construct a fresh `RegExp`
 * and rescan the *entire* note text for every single entry — O(entries ·
 * notesize) per note, the "G7" quadratic from
 * `external_UPSTREAM-BIBTEX-SCHOLAR.md`. `count_citekeys_in_note` (added
 * alongside this experiment) scans the note once and returns occurrence
 * counts by normalized citekey; `bibtex_codeblock_processor` now builds this
 * once per block render and reuses it for every entry in that block
 * (`src/main.ts`).
 *
 * Run: `npm run test:perf`
 */

import { describe, expect, it } from 'vitest'
import { check_duplicate_id, count_citekeys_in_note, type BibtexDict } from 'src/bibtex'
import { bench, format_row, type BenchSample } from './bench'

function build_note_text(n: number): string {
	let s = ''
	for (let i = 0; i < n; i++) {
		s += `@article{k${i},\n  title={Entry ${i}},\n  year={2020},\n}\n`
	}
	return s
}

const N = 2_000

describe('E9 same-note duplicate-ID check: regex-per-entry vs once-per-note count map', () => {
	const dict: BibtexDict = {}
	const note = build_note_text(N)
	const ids = Array.from({ length: N }, (_, i) => `k${i}`)

	it(
		'one ```bibtex block with N entries — realistic large-library note shape',
		() => {
			const regex_per_entry = bench(
				() => {
					let hits = 0
					for (const id of ids) {
						if (check_duplicate_id(dict, id, 'note.md', note)) hits++
					}
					return hits
				},
				{ runs: 1, warmup: 0 },
			)

			const once_per_note = bench(
				() => {
					const counts = count_citekeys_in_note(note)
					let hits = 0
					for (const id of ids) {
						if (check_duplicate_id(dict, id, 'note.md', note, undefined, counts)) hits++
					}
					return hits
				},
				{ runs: 3, warmup: 1 },
			)

			// eslint-disable-next-line no-console
			console.log(
				`\n### E9 same-note duplicate-ID scan (N=${N} entries, one note)\n` +
					'| Experiment | Regex per entry (old shape) | Count map once per note | Speedup |\n' +
					'|---|---|---|---|\n' +
					format_row(
						'N duplicate-ID checks in one note',
						{ label: 'regex-per-entry', ms: regex_per_entry.ms, work: regex_per_entry.work } as BenchSample,
						{ label: 'once-per-note', ms: once_per_note.ms, work: once_per_note.work } as BenchSample,
					) +
					'\n',
			)

			expect(regex_per_entry.work).toBe(0) // no duplicates in this fixture
			expect(once_per_note.work).toBe(0)
			// Structural win regardless of machine noise: O(N·notesize) → O(notesize).
			expect(once_per_note.ms).toBeLessThan(regex_per_entry.ms * 0.5)
		},
		30_000,
	)

	it('correctness: count-map path agrees with the regex-scan path on a real duplicate', () => {
		const dup_note = note + '@article{k5,\n  title={Duplicate},\n}\n'
		const counts = count_citekeys_in_note(dup_note)
		expect(check_duplicate_id(dict, 'k5', 'note.md', dup_note)).toBe(true)
		expect(check_duplicate_id(dict, 'k5', 'note.md', dup_note, undefined, counts)).toBe(true)
		expect(check_duplicate_id(dict, 'k6', 'note.md', dup_note, undefined, counts)).toBe(false)
	})
})
