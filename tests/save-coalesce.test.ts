import { describe, expect, it, vi } from 'vitest'
import { SaveCoalescer } from 'src/save-coalesce'

function fake_clock() {
	let now = 0
	const timers = new Map<number, { due: number, fn: () => void }>()
	let next_id = 1
	return {
		now: () => now,
		advance: (ms: number) => {
			now += ms
			const due = [...timers.entries()].filter(([, t]) => t.due <= now)
			for (const [id, t] of due) {
				timers.delete(id)
				t.fn()
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

describe('SaveCoalescer / idle write pressure', () => {
	it('coalesces many schedule() calls into one persist', async () => {
		const { clock, advance } = fake_clock()
		const persist = vi.fn(async () => {})
		const c = new SaveCoalescer({ delay_ms: 80, clock, persist })

		c.schedule()
		c.schedule()
		c.schedule()
		expect(persist).not.toHaveBeenCalled()

		advance(80)
		// flush is async fire-and-forget from timer
		await Promise.resolve()
		await Promise.resolve()
		expect(persist).toHaveBeenCalledTimes(1)
	})

	it('flush writes immediately and clears dirty', async () => {
		const { clock } = fake_clock()
		const persist = vi.fn(async () => {})
		const c = new SaveCoalescer({ delay_ms: 80, clock, persist })
		c.schedule()
		await c.flush()
		expect(persist).toHaveBeenCalledTimes(1)
		expect(c.is_dirty()).toBe(false)
	})

	it('re-persists if mutated during an in-flight write', async () => {
		const { clock } = fake_clock()
		let resolve_first!: () => void
		let calls = 0
		const persist = vi.fn(() => {
			calls++
			if (calls === 1) {
				return new Promise<void>((r) => {
					resolve_first = r
				})
			}
			return Promise.resolve()
		})
		const c = new SaveCoalescer({ delay_ms: 10, clock, persist })
		c.schedule()
		const flush_p = c.flush()
		// still in first persist
		c.schedule()
		resolve_first()
		await flush_p
		expect(persist).toHaveBeenCalledTimes(2)
	})
})
