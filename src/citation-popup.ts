/**
 * Shared citation popup open/close controller (Phases 1–4).
 *
 * Spec: docs/true-popup-phase0.md
 * - Open debounce 250ms (compact `{id}` hover)
 * - Close grace 150ms (chip ↔ card transit)
 * - `[id]` open on mount via open_for_expand
 * - One global open popup
 * - ESC dismisses and suppresses reopen until full leave of chip+card
 * - Phase 4: click-outside closes; chip click toggles (immediate open)
 *
 * Card rendering is owned by HoverPopup (portal + fixed position).
 */

export const OPEN_DEBOUNCE_MS = 250
export const CLOSE_GRACE_MS = 150

export type CitationPopupListener = (open: boolean) => void

let next_instance_id = 0

/** Stable id per HoverPopup mount (not cite key — same key can appear many times). */
export function create_citation_popup_id(): string {
	next_instance_id += 1
	return `bibtex-cite-popup-${next_instance_id}`
}

class CitationPopupController {
	private listeners = new Map<string, CitationPopupListener>()
	private active_id: string | null = null
	private pending_open_id: string | null = null
	private open_timer: number | null = null
	private close_timer: number | null = null
	/** Suppressed until pointer fully leaves chip+card for that instance. */
	private dismissed = new Set<string>()
	private over_trigger = new Set<string>()
	private over_card = new Set<string>()
	private esc_bound = false

	/**
	 * Register an open-state listener. Returns unregister (call on unmount).
	 */
	register(id: string, listener: CitationPopupListener): () => void {
		this.listeners.set(id, listener)
		if (this.active_id === id) {
			listener(true)
		}
		return () => this.unregister(id)
	}

	unregister(id: string) {
		this.listeners.delete(id)
		this.over_trigger.delete(id)
		this.over_card.delete(id)
		this.dismissed.delete(id)
		if (this.pending_open_id === id) {
			this.clear_open_timer()
		}
		if (this.active_id === id) {
			this.close_now(id)
		}
	}

	/**
	 * Open without debounce and without marking the pointer over the chip.
	 * Used for `` `[id]` `` open-on-mount so ESC dismiss is not stuck
	 * (no synthetic hover that never receives a leave).
	 */
	open_for_expand(id: string) {
		if (this.dismissed.has(id)) {
			return
		}
		if (this.active_id === id) {
			return
		}
		this.open_now(id)
	}

	/**
	 * Pointer entered the cite chip. Opens after {@link OPEN_DEBOUNCE_MS}
	 * unless dismissed for this interaction.
	 */
	enter_trigger(id: string) {
		this.over_trigger.add(id)
		this.clear_close_timer_for(id)

		if (this.dismissed.has(id)) {
			return
		}
		if (this.active_id === id) {
			return
		}

		this.clear_open_timer()
		this.pending_open_id = id
		this.open_timer = window.setTimeout(() => {
			this.open_timer = null
			this.pending_open_id = null
			if (!this.over_trigger.has(id) && !this.over_card.has(id)) {
				return
			}
			if (this.dismissed.has(id)) {
				return
			}
			this.open_now(id)
		}, OPEN_DEBOUNCE_MS)
	}

	leave_trigger(id: string) {
		this.over_trigger.delete(id)
		if (this.pending_open_id === id) {
			this.clear_open_timer()
		}
		this.schedule_close_if_idle(id)
	}

	enter_card(id: string) {
		this.over_card.add(id)
		this.clear_close_timer_for(id)
	}

	leave_card(id: string) {
		this.over_card.delete(id)
		this.schedule_close_if_idle(id)
	}

	/**
	 * Chip click / keyboard activate (Phase 4).
	 * Immediate open (no debounce); second activate closes with dismiss suppress while still over chip.
	 */
	toggle_trigger(id: string) {
		if (this.active_id === id) {
			this.dismiss()
			return
		}
		this.dismissed.delete(id)
		this.over_trigger.add(id)
		this.clear_open_timer()
		this.open_now(id)
	}

	/**
	 * Pointer down outside chip and card (Phase 4).
	 * Closes without hover-suppress so the next intentional hover/click can open again.
	 */
	close_outside() {
		const id = this.active_id
		if (!id) {
			return
		}
		this.clear_open_timer()
		this.clear_close_timer()
		this.close_now(id)
		this.dismissed.delete(id)
	}

	/** ESC: close immediately; suppress reopen only while pointer still over chip/card. */
	dismiss() {
		const id = this.active_id
		if (!id) {
			return
		}
		this.clear_open_timer()
		this.clear_close_timer()
		this.close_now(id)
		if (this.over_trigger.has(id) || this.over_card.has(id)) {
			this.dismissed.add(id)
		}
	}

	is_open(id: string): boolean {
		return this.active_id === id
	}

	get_active_id(): string | null {
		return this.active_id
	}

	private schedule_close_if_idle(id: string) {
		if (this.over_trigger.has(id) || this.over_card.has(id)) {
			return
		}

		if (this.active_id !== id && this.pending_open_id !== id) {
			this.dismissed.delete(id)
			return
		}

		this.clear_close_timer()
		this.close_timer = window.setTimeout(() => {
			this.close_timer = null
			if (this.over_trigger.has(id) || this.over_card.has(id)) {
				return
			}
			if (this.active_id === id) {
				this.close_now(id)
			}
			this.dismissed.delete(id)
		}, CLOSE_GRACE_MS)
	}

	private open_now(id: string) {
		this.clear_open_timer()
		this.clear_close_timer()

		if (this.active_id && this.active_id !== id) {
			const prev = this.active_id
			this.active_id = null
			this.notify(prev, false)
		}

		this.active_id = id
		this.notify(id, true)
		this.bind_esc()
	}

	private close_now(id: string) {
		if (this.active_id !== id) {
			return
		}
		this.active_id = null
		this.notify(id, false)
		if (!this.active_id) {
			this.unbind_esc()
		}
	}

	private notify(id: string, open: boolean) {
		this.listeners.get(id)?.(open)
	}

	private on_esc = (e: KeyboardEvent) => {
		if (e.key !== 'Escape' && e.key !== 'Esc') {
			return
		}
		if (!this.active_id) {
			return
		}
		e.preventDefault()
		e.stopPropagation()
		this.dismiss()
	}

	private bind_esc() {
		if (this.esc_bound) {
			return
		}
		document.addEventListener('keydown', this.on_esc, true)
		this.esc_bound = true
	}

	private unbind_esc() {
		if (!this.esc_bound) {
			return
		}
		document.removeEventListener('keydown', this.on_esc, true)
		this.esc_bound = false
	}

	private clear_open_timer() {
		if (this.open_timer != null) {
			window.clearTimeout(this.open_timer)
			this.open_timer = null
		}
		this.pending_open_id = null
	}

	private clear_close_timer() {
		if (this.close_timer != null) {
			window.clearTimeout(this.close_timer)
			this.close_timer = null
		}
	}

	private clear_close_timer_for(id: string) {
		if (this.active_id === id || this.pending_open_id === id || this.over_trigger.has(id) || this.over_card.has(id)) {
			this.clear_close_timer()
		}
	}
}

/** Process-wide singleton — one global citation popup. */
export const citation_popup = new CitationPopupController()
