/**
 * Coalesce frequent cache persistence requests into fewer disk writes.
 * Obsidian's saveData is durable but not free — codeblock re-renders can
 * otherwise write once per entry per paint.
 */

export type SaveCoalesceClock = {
	setTimeout: (fn: () => void, ms: number) => number
	clearTimeout: (id: number) => void
}

export type SaveCoalesceOptions = {
	/** Debounce window in ms (default 80). */
	delay_ms?: number
	clock?: SaveCoalesceClock
	/** Actual persist implementation (e.g. plugin.saveData). */
	persist: () => Promise<void>
	/** Invoked after each successful persist (for perf counters). */
	on_flush?: () => void
	/** Invoked on each schedule() (for perf counters). */
	on_schedule?: () => void
}

/**
 * Schedule / flush durable writes. Concurrent flush calls serialize;
 * mutations during an in-flight write re-queue another flush.
 */
export class SaveCoalescer {
	private readonly delay_ms: number
	private readonly clock: SaveCoalesceClock
	private readonly persist: () => Promise<void>
	private readonly on_flush?: () => void
	private readonly on_schedule?: () => void

	private timer: number | null = null
	private dirty = false
	private inflight: Promise<void> | null = null

	constructor(opts: SaveCoalesceOptions) {
		this.delay_ms = opts.delay_ms ?? 80
		this.clock = opts.clock ?? {
			setTimeout: (fn, ms) => window.setTimeout(fn, ms) as unknown as number,
			clearTimeout: (id) => window.clearTimeout(id),
		}
		this.persist = opts.persist
		this.on_flush = opts.on_flush
		this.on_schedule = opts.on_schedule
	}

	/** Mark dirty and schedule a write soon. Does not wait for disk. */
	schedule(): void {
		this.dirty = true
		this.on_schedule?.()
		if (this.timer != null) return
		this.timer = this.clock.setTimeout(() => {
			this.timer = null
			void this.flush()
		}, this.delay_ms)
	}

	/** Cancel timer and write now if dirty. Awaits completion. */
	async flush(): Promise<void> {
		if (this.timer != null) {
			this.clock.clearTimeout(this.timer)
			this.timer = null
		}

		// One write at a time — concurrent flush() callers wait their turn.
		while (this.inflight) {
			await this.inflight
		}

		if (!this.dirty) return

		this.dirty = false
		const run = this.persist()
		this.inflight = run
		let wrote_ok = false
		try {
			await run
			wrote_ok = true
			this.on_flush?.()
		} catch (err) {
			// Keep the dirty bit so a later schedule/flush can retry. A failed
			// saveData must not look "clean" or cache changes are silently lost.
			this.dirty = true
			throw err
		} finally {
			this.inflight = null
		}

		// Only re-enter after a successful write: a concurrent schedule() during
		// the await left dirty=true. Never auto-retry failures here (would loop).
		if (wrote_ok && this.dirty) {
			await this.flush()
		}
	}

	/** Pending scheduled or unflushed work. */
	is_dirty(): boolean {
		return this.dirty || this.timer != null || this.inflight != null
	}

	/** Drop pending timer without writing (tests / unload after flush). */
	cancel(): void {
		if (this.timer != null) {
			this.clock.clearTimeout(this.timer)
			this.timer = null
		}
	}
}
