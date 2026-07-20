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
	/** Last paper-panel list: chips actually mounted (must stay ≤ PANEL_RESULT_CAP). */
	panel_rows_mounted: number
	/** Last EditorSuggest row count returned. */
	suggest_returned: number
	/** Last EditorSuggest match count before cap. */
	suggest_matched: number
	/** Last vault rescan wall time (ms). */
	rescan_ms: number
	/** Last rescan: markdown files actually read. */
	rescan_files_read: number
	/** Last rescan: files skipped (no bibtex gate / unchanged fingerprint later). */
	rescan_files_skipped: number
}

export function create_perf_counters(): PerfCounters {
	return {
		modify_early_exits: 0,
		modify_scheduled: 0,
		save_schedules: 0,
		save_flushes: 0,
		rename_scan_files_read: 0,
		decoration_rebuilds: 0,
		panel_rows_mounted: 0,
		suggest_returned: 0,
		suggest_matched: 0,
		rescan_ms: 0,
		rescan_files_read: 0,
		rescan_files_skipped: 0,
	}
}

/** Human-readable scale snapshot for a debug Notice / console. */
export function format_scale_report(
	counters: PerfCounters,
	opts: { entry_count: number; cache_json_bytes?: number },
): string {
	const bytes = opts.cache_json_bytes
	const size = bytes == null
		? ''
		: bytes < 1024
			? `${bytes} B`
			: bytes < 1024 * 1024
				? `${(bytes / 1024).toFixed(1)} KB`
				: `${(bytes / (1024 * 1024)).toFixed(2)} MB`
	const lines = [
		`entries=${opts.entry_count}`,
		size ? `cache≈${size}` : null,
		`panel_rows=${counters.panel_rows_mounted}`,
		`suggest=${counters.suggest_returned}/${counters.suggest_matched}`,
		`rescan=${counters.rescan_ms}ms read=${counters.rescan_files_read} skip=${counters.rescan_files_skipped}`,
	].filter(Boolean)
	return lines.join(' · ')
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
