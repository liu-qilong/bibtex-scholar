import { describe, expect, it } from 'vitest'
import {
	audit_idle_after_unload,
	create_perf_counters,
	format_scale_report,
	is_plugin_idle,
} from 'src/idle-audit'
import { CitationPopupController } from 'src/citation-popup'
import { SaveCoalescer } from 'src/save-coalesce'

describe('idle audit (Phase C)', () => {
	it('is_plugin_idle requires no popup, no dirty save, no rename timers', () => {
		expect(is_plugin_idle({
			popup_active: false,
			save_dirty: false,
			rename_timer_count: 0,
		})).toBe(true)

		expect(is_plugin_idle({
			popup_active: true,
			save_dirty: false,
			rename_timer_count: 0,
		})).toBe(false)

		expect(is_plugin_idle({
			popup_active: false,
			save_dirty: true,
			rename_timer_count: 0,
		})).toBe(false)

		expect(is_plugin_idle({
			popup_active: false,
			save_dirty: false,
			rename_timer_count: 2,
		})).toBe(false)
	})

	it('audit_idle_after_unload reports each violation', () => {
		const problems = audit_idle_after_unload({
			popup_active: true,
			save_dirty: true,
			rename_timer_count: 1,
			counters: create_perf_counters(),
		})
		expect(problems).toHaveLength(3)
	})

	it('dispose + flush leave an idle-clean snapshot', async () => {
		const timers = new Map<number, { due: number, fn: () => void }>()
		let now = 0
		let next = 1
		const clock = {
			setTimeout: (fn: () => void, ms: number) => {
				const id = next++
				timers.set(id, { due: now + ms, fn })
				return id
			},
			clearTimeout: (id: number) => { timers.delete(id) },
		}

		const popup = new CitationPopupController({ clock, document: null })
		popup.register('x', () => {})
		popup.toggle_trigger('x')
		expect(popup.get_active_id()).toBe('x')

		let persists = 0
		const save = new SaveCoalescer({
			delay_ms: 50,
			clock,
			persist: async () => { persists++ },
		})
		save.schedule()

		const rename_timers = new Map<string, number>()
		rename_timers.set('a.md', clock.setTimeout(() => {}, 400))

		// unload sequence
		for (const t of rename_timers.values()) clock.clearTimeout(t)
		rename_timers.clear()
		popup.dispose()
		await save.flush()
		save.cancel()

		const snap = {
			popup_active: popup.get_active_id() != null,
			save_dirty: save.is_dirty(),
			rename_timer_count: rename_timers.size,
			counters: create_perf_counters(),
		}
		expect(audit_idle_after_unload(snap)).toEqual([])
		expect(is_plugin_idle(snap)).toBe(true)
		expect(persists).toBe(1)
	})

	it('perf counters start at zero', () => {
		const c = create_perf_counters()
		expect(Object.values(c).every((n) => n === 0)).toBe(true)
	})

	it('format_scale_report summarizes entry and mount counters', () => {
		const c = create_perf_counters()
		c.panel_rows_mounted = 50
		c.suggest_returned = 25
		c.suggest_matched = 400
		c.rescan_ms = 1200
		c.rescan_files_read = 300
		c.rescan_files_skipped = 200
		const s = format_scale_report(c, { entry_count: 10_000, cache_json_bytes: 2_500_000 })
		expect(s).toContain('entries=10000')
		expect(s).toContain('cache≈')
		expect(s).toContain('panel_rows=50')
		expect(s).toContain('suggest=25/400')
		expect(s).toContain('rescan=1200ms')
	})
})
