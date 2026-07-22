/**
 * In-memory registry for *pinned* citation cards.
 *
 * Separate from {@link CitationPopupController}: pins have no hover debounce
 * or close-grace timers. Keys are paper ids (not chip instance ids), so the
 * same paper cannot be pinned twice. Generic payload keeps this module free of
 * DOM/React/Obsidian imports.
 */

export type PinPosition = { top: number, left: number }

export type PinEntry<T> = {
	payload: T
	pos: PinPosition
	/** Stacking order; higher draws on top. */
	z: number
}

export class PinRegistry<T> {
	private pins = new Map<string, PinEntry<T>>()
	private listeners = new Set<() => void>()
	private next_z = 1

	/**
	 * Pin a card. Re-pinning an already-pinned id is a no-op (returns false)
	 * so an existing drag position is not reset.
	 */
	pin(id: string, payload: T, pos: PinPosition): boolean {
		if (this.pins.has(id)) {
			return false
		}
		this.pins.set(id, { payload, pos, z: this.next_z++ })
		this.notify()
		return true
	}

	unpin(id: string): boolean {
		if (!this.pins.delete(id)) {
			return false
		}
		this.notify()
		return true
	}

	unpin_all(): void {
		if (this.pins.size === 0) {
			return
		}
		this.pins.clear()
		this.notify()
	}

	is_pinned(id: string): boolean {
		return this.pins.has(id)
	}

	/** Update a pin's position (drag). Missing id is ignored. */
	move(id: string, pos: PinPosition): void {
		const entry = this.pins.get(id)
		if (!entry) {
			return
		}
		entry.pos = pos
		this.notify()
	}

	/**
	 * Replace payload without moving the card (e.g. bibtex fields refreshed).
	 * No-op if not pinned. Notifies subscribers so open cards re-render.
	 */
	update_payload(id: string, payload: T): boolean {
		const entry = this.pins.get(id)
		if (!entry) {
			return false
		}
		entry.payload = payload
		this.notify()
		return true
	}

	/** Raise a pin above siblings (click / start-drag). */
	bring_to_front(id: string): void {
		const entry = this.pins.get(id)
		if (!entry) {
			return
		}
		entry.z = this.next_z++
		this.notify()
	}

	/** Highest-z pin — Esc dismisses this one only, not every pinned card. */
	front_id(): string | null {
		let front: string | null = null
		let front_z = -Infinity
		for (const [id, entry] of this.pins) {
			if (entry.z > front_z) {
				front_z = entry.z
				front = id
			}
		}
		return front
	}

	entries(): [string, PinEntry<T>][] {
		return Array.from(this.pins.entries())
	}

	/** Subscribe to any mutation. Returns an unsubscribe function. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	private notify(): void {
		for (const listener of this.listeners) {
			listener()
		}
	}
}
