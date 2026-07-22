import { describe, expect, it, beforeEach } from 'vitest'
import {
	CitationPopupController,
	CLOSE_GRACE_MS,
	OPEN_DEBOUNCE_MS,
	__reset_citation_popup_ids_for_tests,
	create_citation_popup_id,
} from 'src/citation-popup'

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

describe('CitationPopupController stability', () => {
	beforeEach(() => {
		__reset_citation_popup_ids_for_tests()
	})

	it('debounces open; leave before deadline never opens', () => {
		const { clock, advance } = fake_clock()
		const ctl = new CitationPopupController({ clock, document: null })
		const opens: boolean[] = []
		ctl.register('a', (o) => opens.push(o))

		ctl.enter_trigger('a')
		advance(OPEN_DEBOUNCE_MS - 1)
		expect(ctl.is_open('a')).toBe(false)
		ctl.leave_trigger('a')
		advance(OPEN_DEBOUNCE_MS)
		expect(ctl.is_open('a')).toBe(false)
		expect(opens.filter(Boolean)).toHaveLength(0)
	})

	it('opens after debounce and closes after leave + grace', () => {
		const { clock, advance } = fake_clock()
		const ctl = new CitationPopupController({ clock, document: null })
		ctl.register('a', () => {})

		ctl.enter_trigger('a')
		advance(OPEN_DEBOUNCE_MS)
		expect(ctl.is_open('a')).toBe(true)

		ctl.leave_trigger('a')
		advance(CLOSE_GRACE_MS - 1)
		expect(ctl.is_open('a')).toBe(true)
		advance(1)
		expect(ctl.is_open('a')).toBe(false)
	})

	it('enter_trigger honors a custom open debounce (e.g. doubled for dense chip lists)', () => {
		const { clock, advance } = fake_clock()
		const ctl = new CitationPopupController({ clock, document: null })
		ctl.register('a', () => {})

		ctl.enter_trigger('a', OPEN_DEBOUNCE_MS * 2)
		advance(OPEN_DEBOUNCE_MS)
		expect(ctl.is_open('a')).toBe(false)
		advance(OPEN_DEBOUNCE_MS - 1)
		expect(ctl.is_open('a')).toBe(false)
		advance(1)
		expect(ctl.is_open('a')).toBe(true)
	})

	it('chip→card transit within grace keeps open (single interaction)', () => {
		const { clock, advance } = fake_clock()
		const ctl = new CitationPopupController({ clock, document: null })
		ctl.register('a', () => {})
		ctl.enter_trigger('a')
		advance(OPEN_DEBOUNCE_MS)
		ctl.leave_trigger('a')
		advance(CLOSE_GRACE_MS - 10)
		ctl.enter_card('a')
		advance(CLOSE_GRACE_MS)
		expect(ctl.is_open('a')).toBe(true)
	})

	it('enforces one global open popup', () => {
		const { clock, advance } = fake_clock()
		const ctl = new CitationPopupController({ clock, document: null })
		const a_states: boolean[] = []
		const b_states: boolean[] = []
		ctl.register('a', (o) => a_states.push(o))
		ctl.register('b', (o) => b_states.push(o))

		ctl.toggle_trigger('a')
		expect(ctl.get_active_id()).toBe('a')
		ctl.toggle_trigger('b')
		expect(ctl.get_active_id()).toBe('b')
		expect(ctl.is_open('a')).toBe(false)
		expect(ctl.is_open('b')).toBe(true)
		advance(0)
		expect(a_states).toContain(false)
	})

	it('ESC dismiss suppresses reopen until full leave', () => {
		const { clock, advance } = fake_clock()
		const ctl = new CitationPopupController({ clock, document: null })
		ctl.register('a', () => {})
		ctl.enter_trigger('a')
		advance(OPEN_DEBOUNCE_MS)
		ctl.dismiss()
		expect(ctl.is_open('a')).toBe(false)
		// still over trigger from enter_trigger
		ctl.enter_trigger('a')
		advance(OPEN_DEBOUNCE_MS)
		expect(ctl.is_open('a')).toBe(false)
		ctl.leave_trigger('a')
		advance(CLOSE_GRACE_MS)
		ctl.enter_trigger('a')
		advance(OPEN_DEBOUNCE_MS)
		expect(ctl.is_open('a')).toBe(true)
	})

	it('subscribe_active fires immediately with the current value, then on every open/close', () => {
		const { clock } = fake_clock()
		const ctl = new CitationPopupController({ clock, document: null })
		ctl.register('a', () => {})
		ctl.register('b', () => {})
		const seen: (string | null)[] = []
		const unsubscribe = ctl.subscribe_active((id) => seen.push(id))
		expect(seen).toEqual([null])

		ctl.toggle_trigger('a')
		expect(seen).toEqual([null, 'a'])
		ctl.toggle_trigger('b')
		expect(seen).toEqual([null, 'a', 'b'])
		ctl.dismiss()
		expect(seen).toEqual([null, 'a', 'b', null])

		unsubscribe()
		ctl.toggle_trigger('a')
		expect(seen).toEqual([null, 'a', 'b', null])
	})

	it('subscribe_active fires immediately with the id if already active when subscribed', () => {
		const { clock } = fake_clock()
		const ctl = new CitationPopupController({ clock, document: null })
		ctl.register('a', () => {})
		ctl.toggle_trigger('a')

		const seen: (string | null)[] = []
		ctl.subscribe_active((id) => seen.push(id))
		expect(seen).toEqual(['a'])
	})

	it('dispose clears active state and timers', () => {
		const { clock, advance } = fake_clock()
		const ctl = new CitationPopupController({ clock, document: null })
		ctl.register('a', () => {})
		ctl.enter_trigger('a')
		ctl.dispose()
		advance(OPEN_DEBOUNCE_MS + CLOSE_GRACE_MS)
		expect(ctl.get_active_id()).toBeNull()
	})

	it('dispose drops active subscribers so a remount does not double-notify ghosts', () => {
		const { clock } = fake_clock()
		const ctl = new CitationPopupController({ clock, document: null })
		const seen: (string | null)[] = []
		ctl.subscribe_active((id) => seen.push(id))
		ctl.register('a', () => {})
		ctl.toggle_trigger('a')
		expect(seen).toEqual([null, 'a'])

		ctl.dispose()
		// Ghost listener must not receive this open after dispose.
		ctl.register('b', () => {})
		ctl.toggle_trigger('b')
		expect(seen).toEqual([null, 'a', null])
		expect(ctl.get_active_id()).toBe('b')
	})

	it('create_citation_popup_id is unique', () => {
		expect(create_citation_popup_id()).not.toBe(create_citation_popup_id())
	})
})
