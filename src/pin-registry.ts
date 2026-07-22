/**
 * Registry for pinned citation cards — independent of `citation-popup.ts`'s
 * hover/debounce state machine (pinning has no debounce/grace-timer concept).
 * Generic over the payload so this stays DOM/Obsidian-free and unit-testable,
 * same convention as `CitationPopupController`.
 */

export type PinPosition = { top: number, left: number }

type PinEntry<T> = { payload: T, pos: PinPosition, z: number }

export class PinRegistry<T> {
    private pins = new Map<string, PinEntry<T>>()
    private listeners = new Set<() => void>()
    private next_z = 1

    /** Dedup by id (paper id, not chip instance) — pinning an already-pinned id is a no-op. */
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

    move(id: string, pos: PinPosition): void {
        const entry = this.pins.get(id)
        if (!entry) {
            return
        }
        entry.pos = pos
        this.notify()
    }

    bring_to_front(id: string): void {
        const entry = this.pins.get(id)
        if (!entry) {
            return
        }
        entry.z = this.next_z++
        this.notify()
    }

    /** Highest z-order pin — Esc dismisses this one, not all pinned cards. */
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

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    private notify(): void {
        for (const listener of this.listeners) {
            listener()
        }
    }
}
