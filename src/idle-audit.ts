/**
 * Idle / unload trust checks (Phase C).
 * "Idle" means: no open citation popup, no pending coalesced save, no rename debounce timers.
 */

export type PerfCounters = {
	/** modify handler returned early (no ```bibtex / not md / renaming). */
	modify_early_exits: number
	/** modify handler scheduled a rename debounce timer. */
	modify_scheduled: number
	/** save_coalescer.schedule calls. */
	save_schedules: number
	/** completed persist flushes. */
	save_flushes: number
	/** files read during inline-cite vault scans. */
	rename_scan_files_read: number
	/** times a decoration rebuild was requested (optional / editor). */
	decoration_rebuilds: number
}

export function create_perf_counters(): PerfCounters {
	return {
		modify_early_exits: 0,
		modify_scheduled: 0,
		save_schedules: 0,
		save_flushes: 0,
		rename_scan_files_read: 0,
		decoration_rebuilds: 0,
	}
}

export type IdleSnapshot = {
	popup_active: boolean
	save_dirty: boolean
	rename_timer_count: number
	counters: PerfCounters
}

/**
 * True when the plugin is not holding interactive or deferred work that should
 * be cleared on unload or quiet idle.
 */
export function is_plugin_idle(snap: Pick<IdleSnapshot, 'popup_active' | 'save_dirty' | 'rename_timer_count'>): boolean {
	return !snap.popup_active && !snap.save_dirty && snap.rename_timer_count === 0
}

/**
 * After unload/dispose: list violations (empty = healthy).
 */
export function audit_idle_after_unload(snap: IdleSnapshot): string[] {
	const problems: string[] = []
	if (snap.popup_active) {
		problems.push('citation popup still active after unload')
	}
	if (snap.save_dirty) {
		problems.push('coalesced save still dirty after unload flush')
	}
	if (snap.rename_timer_count > 0) {
		problems.push(`${snap.rename_timer_count} rename timer(s) still pending after unload`)
	}
	return problems
}
