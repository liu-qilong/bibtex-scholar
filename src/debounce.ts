import type { PopupClock } from 'src/citation-popup'

const default_clock: PopupClock = {
	setTimeout: (fn, ms) => window.setTimeout(fn, ms) as unknown as number,
	clearTimeout: (id) => window.clearTimeout(id),
}

/**
 * Trailing-edge debouncer — coalesces rapid repeated {@link trigger} calls
 * (e.g. a search box's per-keystroke callback) into one call after `delay_ms`
 * of quiet. Clock-injectable (same convention as {@link PopupClock} /
 * CitationPopupController) so tests can advance time deterministically
 * instead of using real timers.
 */
export class Debouncer {
	private timer: number | null = null
	private readonly clock: PopupClock

	constructor(private readonly delay_ms: number, clock: PopupClock = default_clock) {
		this.clock = clock
	}

	/** Schedule `fn` to run after `delay_ms` of no further `trigger` calls; cancels any pending call. */
	trigger(fn: () => void): void {
		this.cancel()
		this.timer = this.clock.setTimeout(fn, this.delay_ms)
	}

	/** Cancel any pending call without running it. Safe to call with nothing pending. */
	cancel(): void {
		if (this.timer != null) {
			this.clock.clearTimeout(this.timer)
			this.timer = null
		}
	}
}
