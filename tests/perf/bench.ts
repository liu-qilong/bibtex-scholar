/**
 * Tiny timing helpers for scale experiments.
 * Prefer median of several runs over single-shot wall clock.
 */

export type BenchSample = {
	label: string
	/** Median wall time in ms over `runs` iterations (after warmup). */
	ms: number
	/** Optional structural counter (mounts, field scans, file reads, …). */
	work?: number
	detail?: string
}

export function median(xs: number[]): number {
	if (xs.length === 0) return 0
	const s = [...xs].sort((a, b) => a - b)
	const mid = Math.floor(s.length / 2)
	return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!
}

/**
 * Run `fn` `warmup` times (discarded), then `runs` times; return median ms.
 * `fn` may return a work counter; last run's value is kept.
 */
export function bench(
	fn: () => number | void,
	opts: { runs?: number; warmup?: number } = {},
): { ms: number; work: number } {
	const runs = opts.runs ?? 5
	const warmup = opts.warmup ?? 1
	for (let i = 0; i < warmup; i++) fn()
	const times: number[] = []
	let work = 0
	for (let i = 0; i < runs; i++) {
		const t0 = performance.now()
		const w = fn()
		times.push(performance.now() - t0)
		if (typeof w === 'number') work = w
	}
	return { ms: median(times), work }
}

/** Format a comparison row for console / PR paste. */
export function format_row(
	name: string,
	baseline: BenchSample,
	fork: BenchSample,
): string {
	const ratio =
		baseline.ms > 0 && fork.ms > 0 ? (baseline.ms / fork.ms).toFixed(2) : 'n/a'
	const b_work = baseline.work != null ? String(baseline.work) : '—'
	const f_work = fork.work != null ? String(fork.work) : '—'
	return (
		`| ${name} | ${baseline.ms.toFixed(1)} ms (work ${b_work}) | ` +
		`${fork.ms.toFixed(1)} ms (work ${f_work}) | ${ratio}× |`
	)
}
