/**
 * E8 — save_cache() write amplification: upstream-shaped (full serialize per
 * entry) vs this fork's SaveCoalescer, under the exact repro shape from
 * `external_UPSTREAM-BIBTEX-SCHOLAR.md`: one note with N separate ```bibtex
 * fences (one entry per block), each triggering a codeblock-paint save.
 *
 * Upstream (`liu-qilong/bibtex-scholar` 1.1.0): every paint does
 * `await this.saveData(this.cache)` — a full-cache serialize. Total bytes
 * written to import n entries is ~`per_entry_bytes * n²/2`.
 *
 * This fork routes every paint through `schedule_save_cache()` →
 * `SaveCoalescer.schedule()` (80ms trailing throttle, `src/infra/save-coalesce.ts`).
 * The open question this experiment answers: does that throttle actually
 * collapse the writes, or only *look* fixed because paints in the real repro
 * happen to land inside one 80ms window? We don't control Obsidian's paint
 * cadence, so we sweep it: 0ms (synchronous burst — all N paints before the
 * first timer fires), 20ms (faster than the window), and 100ms (slower than
 * the window — the adversarial case where coalescing buys nothing).
 *
 * Run: `npm run test:perf`
 */

import { describe, expect, it } from 'vitest'
import { SaveCoalescer } from 'src/infra/save-coalesce'
import { build_public_seed_dict } from './corpora'

function fake_clock() {
	let now = 0
	const timers = new Map<number, { due: number, fn: () => void }>()
	let next_id = 1
	return {
		advance: (ms: number) => {
			now += ms
			const due = [...timers.entries()].filter(([, t]) => t.due <= now)
			for (const [id, t] of due) {
				timers.delete(id)
				t.fn()
			}
		},
		clock: {
			setTimeout: (fn: () => void, ms: number) => {
				const id = next_id++
				timers.set(id, { due: now + ms, fn })
				return id
			},
			clearTimeout: (id: number) => {
				timers.delete(id)
			},
		},
	}
}

/** Drain pending microtasks (timer callbacks are `void this.flush()` — fire-and-forget). */
async function drain() {
	await Promise.resolve()
	await Promise.resolve()
	await Promise.resolve()
}

const BLOCK_N = 2_000

/** Upstream: full-cache serialize after every single entry. Closed form, not simulated. */
function upstream_total_bytes(n: number, per_entry_bytes: number): number {
	return (per_entry_bytes * n * (n + 1)) / 2
}

/**
 * Fork: real SaveCoalescer + fake clock. One `schedule()` per block paint,
 * `spacing_ms` real time between consecutive paints (0 = synchronous burst).
 */
async function run_fork_shaped(
	spacing_ms: number,
	per_entry_bytes: number,
): Promise<{ writes: number, bytes: number }> {
	const { clock, advance } = fake_clock()
	let writes = 0
	let bytes = 0
	let dict_size = 0
	const coalescer = new SaveCoalescer({
		delay_ms: 80,
		clock,
		persist: async () => {
			writes++
			bytes += dict_size * per_entry_bytes
		},
	})

	for (let i = 1; i <= BLOCK_N; i++) {
		dict_size = i
		coalescer.schedule()
		if (spacing_ms > 0) {
			advance(spacing_ms)
			await drain()
		}
	}
	advance(1_000) // settle any trailing timer
	await drain()
	await coalescer.flush()
	return { writes, bytes }
}

describe('E8 save-cache write amplification (repro shape: N one-entry ```bibtex blocks in one note)', () => {
	const seed = build_public_seed_dict({ n: 1, abstract_chars: 200 })
	const entry_bytes = JSON.stringify(Object.values(seed)[0]).length

	it('reports writes/bytes across paint-spacing scenarios', async () => {
		const up_bytes = upstream_total_bytes(BLOCK_N, entry_bytes)

		const burst = await run_fork_shaped(0, entry_bytes)
		const fast = await run_fork_shaped(20, entry_bytes)
		const slow = await run_fork_shaped(100, entry_bytes)

		// eslint-disable-next-line no-console
		console.log(
			'\n### E8 save-cache write amplification ' +
				`(N=${BLOCK_N} blocks, ~${entry_bytes} bytes/entry)\n` +
				'| Scenario | Writes | Total bytes written | vs upstream |\n' +
				'|---|---|---|---|\n' +
				`| upstream (per-entry save) | ${BLOCK_N} | ${up_bytes.toLocaleString()} | 1× (baseline) |\n` +
				`| fork, 0ms spacing (burst) | ${burst.writes} | ${burst.bytes.toLocaleString()} | ${(up_bytes / burst.bytes).toFixed(0)}× fewer bytes |\n` +
				`| fork, 20ms spacing (< 80ms window) | ${fast.writes} | ${fast.bytes.toLocaleString()} | ${(up_bytes / fast.bytes).toFixed(1)}× fewer bytes |\n` +
				`| fork, 100ms spacing (> 80ms window) | ${slow.writes} | ${slow.bytes.toLocaleString()} | ${(up_bytes / slow.bytes).toFixed(1)}× fewer bytes |\n`,
		)

		// Burst (paints faster than the render pass takes to clear one 80ms
		// window): the fix works as intended — collapses to ~1 write.
		expect(burst.writes).toBeLessThanOrEqual(2)
		expect(burst.bytes).toBeLessThanOrEqual(BLOCK_N * entry_bytes * 1.01)

		// Fast-but-spaced (20ms apart, still under the window): real win, but
		// bounded by the window/spacing ratio, not by N — total bytes stays
		// quadratic-shaped, just scaled down (~4x here), not eliminated.
		expect(fast.writes).toBeGreaterThan(burst.writes)
		expect(fast.bytes).toBeLessThan(up_bytes)
		expect(fast.bytes).toBeGreaterThan(burst.bytes * 2)

		// Slow (paints spaced *past* the debounce window): the adversarial case
		// — coalescing buys effectively nothing, one write per paint, same
		// quadratic-shaped total as upstream. This is the scenario the fix's
		// adequacy depends on Obsidian's actual paint cadence NOT hitting.
		expect(slow.writes).toBeGreaterThan(BLOCK_N * 0.9)
		expect(slow.bytes).toBeGreaterThan(up_bytes * 0.9)
	}, 30_000)
})
