import { describe, expect, it } from 'vitest'
import { Debouncer } from 'src/debounce'

function fake_clock() {
	let now = 0
	const timers = new Map<number, { due: number, fn: () => void }>()
	let next_id = 1
	return {
		advance: (ms: number) => {
			now += ms
			for (const [id, t] of [...timers.entries()]) {
				if (t.due <= now) {
					timers.delete(id)
					t.fn()
				}
			}
		},
		clock: {
			setTimeout: (fn: () => void, ms: number) => {
				const id = next_id++
				timers.set(id, { due: now + ms, fn })
				return id
			},
			clearTimeout: (id: number) => {
				timers.delete(id)
			},
		},
	}
}

describe('Debouncer', () => {
	it('rapid triggers only invoke the callback once after the delay elapses', () => {
		const { clock, advance } = fake_clock()
		const d = new Debouncer(100, clock)
		let calls = 0
		d.trigger(() => calls++)
		advance(50)
		d.trigger(() => calls++) // resets the timer
		advance(50)
		expect(calls).toBe(0) // only 50ms since the last trigger
		advance(50)
		expect(calls).toBe(1)
	})

	it('cancel before the deadline never fires', () => {
		const { clock, advance } = fake_clock()
		const d = new Debouncer(100, clock)
		let calls = 0
		d.trigger(() => calls++)
		advance(50)
		d.cancel()
		advance(100)
		expect(calls).toBe(0)
	})

	it('cancel with nothing pending is a no-op', () => {
		const { clock } = fake_clock()
		const d = new Debouncer(100, clock)
		expect(() => d.cancel()).not.toThrow()
	})

	it('a later trigger after one fires works independently', () => {
		const { clock, advance } = fake_clock()
		const d = new Debouncer(100, clock)
		let calls = 0
		d.trigger(() => calls++)
		advance(100)
		expect(calls).toBe(1)
		d.trigger(() => calls++)
		advance(100)
		expect(calls).toBe(2)
	})
})
