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
}

/**
 * Schedule / flush durable writes. Concurrent flush calls serialize;
 * mutations during an in-flight write re-queue another flush.
 */
export class SaveCoalescer {
	private readonly delay_ms: number
	private readonly clock: SaveCoalesceClock
	private readonly persist: () => Promise<void>

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
	}

	/** Mark dirty and schedule a write soon. Does not wait for disk. */
	schedule(): void {
		this.dirty = true
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

		// Serialize concurrent flush() callers.
		while (this.inflight) {
			await this.inflight
		}

		if (!this.dirty) return

		this.dirty = false
		const run = this.persist()
		this.inflight = run
		try {
			await run
		} finally {
			this.inflight = null
		}

		// Mutations during await: write again.
		if (this.dirty) {
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
