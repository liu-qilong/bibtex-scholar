import { describe, expect, it } from 'vitest'
import { PinRegistry } from 'src/pin-registry'

describe('PinRegistry', () => {
	it('pins and unpins, notifying subscribers', () => {
		const reg = new PinRegistry<string>()
		let notifications = 0
		reg.subscribe(() => { notifications++ })

		expect(reg.pin('a', 'payload-a', { top: 0, left: 0 })).toBe(true)
		expect(reg.is_pinned('a')).toBe(true)
		expect(notifications).toBe(1)

		expect(reg.unpin('a')).toBe(true)
		expect(reg.is_pinned('a')).toBe(false)
		expect(notifications).toBe(2)
	})

	it('dedupes by id — pinning an already-pinned id is a no-op', () => {
		const reg = new PinRegistry<string>()
		let notifications = 0
		reg.subscribe(() => { notifications++ })

		expect(reg.pin('a', 'first', { top: 0, left: 0 })).toBe(true)
		expect(reg.pin('a', 'second', { top: 10, left: 10 })).toBe(false)
		expect(notifications).toBe(1)
		// Original payload/position untouched by the rejected re-pin.
		const [, entry] = reg.entries()[0]
		expect(entry.payload).toBe('first')
		expect(entry.pos).toEqual({ top: 0, left: 0 })
	})

	it('unpin on a non-pinned id is a safe no-op (no notify)', () => {
		const reg = new PinRegistry<string>()
		let notifications = 0
		reg.subscribe(() => { notifications++ })
		expect(reg.unpin('missing')).toBe(false)
		expect(notifications).toBe(0)
	})

	it('unpin_all clears everything in one notification', () => {
		const reg = new PinRegistry<string>()
		reg.pin('a', 'a', { top: 0, left: 0 })
		reg.pin('b', 'b', { top: 0, left: 0 })
		let notifications = 0
		reg.subscribe(() => { notifications++ })

		reg.unpin_all()
		expect(reg.entries()).toHaveLength(0)
		expect(notifications).toBe(1)

		// Second call on an already-empty registry doesn't notify again.
		reg.unpin_all()
		expect(notifications).toBe(1)
	})

	it('move updates position and notifies', () => {
		const reg = new PinRegistry<string>()
		reg.pin('a', 'a', { top: 0, left: 0 })
		reg.move('a', { top: 50, left: 60 })
		expect(reg.entries()[0][1].pos).toEqual({ top: 50, left: 60 })
	})

	it('bring_to_front reorders which pin is front_id', () => {
		const reg = new PinRegistry<string>()
		reg.pin('a', 'a', { top: 0, left: 0 })
		reg.pin('b', 'b', { top: 0, left: 0 })
		expect(reg.front_id()).toBe('b') // most recently pinned starts front

		reg.bring_to_front('a')
		expect(reg.front_id()).toBe('a')
	})

	it('front_id is null when nothing is pinned', () => {
		const reg = new PinRegistry<string>()
		expect(reg.front_id()).toBeNull()
	})

	it('subscribe returns an unsubscribe function', () => {
		const reg = new PinRegistry<string>()
		let notifications = 0
		const unsubscribe = reg.subscribe(() => { notifications++ })
		unsubscribe()
		reg.pin('a', 'a', { top: 0, left: 0 })
		expect(notifications).toBe(0)
	})
})
