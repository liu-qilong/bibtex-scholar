// @vitest-environment jsdom
/**
 * DOM behavior tests for the floating citation popup.
 *
 * Imports the real `src/hover` by relative path — vitest.config.ts aliases the
 * bare `src/hover` specifier to a stub for every other test file (to keep pure
 * logic tests off React), so this file deliberately routes around that alias
 * to exercise the actual component tree end to end.
 */
import { act, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BibtexElement } from 'src/bibtex'
import { citation_popup, OPEN_DEBOUNCE_MS } from 'src/citation-popup'
import { render_hover } from '../src/hover'

const bibtex: BibtexElement = {
	fields: {
		type: 'article',
		id: 'Doe2020Widgets',
		title: 'On the Widgets',
		author: 'Doe, Jane',
		year: '2020',
		doi: '10.1234/widgets',
	},
	source: '@article{Doe2020Widgets,}\n',
	source_path: 'refs/widgets.md',
}

function make_fake_app(portal_root: HTMLElement) {
	return {
		workspace: {
			containerEl: portal_root,
			trigger: () => {},
			getLeavesOfType: () => [],
			getLeftLeaf: () => null,
			revealLeaf: async () => {},
			setActiveLeaf: () => {},
		},
		metadataCache: {
			getFirstLinkpathDest: () => null,
		},
		vault: {
			adapter: { exists: async () => false },
		},
	}
}

function make_fake_plugin() {
	return {
		cache: {
			card_font_size: 13,
			card_wide: false,
			note_folder: 'note',
			pdf_folder: 'pdf',
			template_path: '',
		},
		open_line: async () => {},
		uncache_bibtex_with_id: async () => {},
	}
}

/** Mount a fresh chip host + portal root, wired to the same fake app/plugin. */
function mount(expand = false) {
	const host = document.createElement('span')
	document.body.appendChild(host)
	const portal_root = document.createElement('div')
	document.body.appendChild(portal_root)

	const app = make_fake_app(portal_root)
	const plugin = make_fake_plugin()

	act(() => {
		render_hover(host, bibtex, plugin as any, app as any, expand)
	})

	return {
		host,
		portal_root,
		chip_button: () => host.querySelector('.bibtex-hover-chip button') as HTMLButtonElement,
		// `chip_ref` (the actual position_floating_card anchor) is the wrapping span, not the button.
		chip_el: () => host.querySelector('.bibtex-hover-chip') as HTMLSpanElement,
		card: () => portal_root.querySelector('.bibtex-hover-card') as HTMLDivElement | null,
	}
}

describe('citation popup DOM behavior', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		citation_popup.dispose()
		cleanup()
		document.body.innerHTML = ''
		vi.useRealTimers()
	})

	it('click opens immediately, portals under the given root, sets aria-expanded', async () => {
		const { chip_button, card, portal_root } = mount()

		expect(card()).toBeNull()
		expect(chip_button().getAttribute('aria-expanded')).toBe('false')

		await act(async () => {
			fireEvent.click(chip_button())
		})

		const opened = card()
		expect(opened).not.toBeNull()
		expect(portal_root.contains(opened)).toBe(true)
		expect(chip_button().getAttribute('aria-expanded')).toBe('true')

		// Click again toggles closed.
		await act(async () => {
			fireEvent.click(chip_button())
		})
		expect(card()).toBeNull()
	})

	it('hover opens only after the debounce, not before', async () => {
		const { chip_button, card } = mount()

		await act(async () => {
			fireEvent.mouseEnter(chip_button())
		})
		await act(async () => {
			vi.advanceTimersByTime(OPEN_DEBOUNCE_MS - 1)
		})
		expect(card()).toBeNull()

		await act(async () => {
			vi.advanceTimersByTime(1)
		})
		expect(card()).not.toBeNull()
	})

	it('clicking outside the chip and card closes it', async () => {
		const { chip_button, card } = mount()

		await act(async () => {
			fireEvent.click(chip_button())
		})
		expect(card()).not.toBeNull()

		// HoverPopup defers binding the outside-click listener by one tick.
		await act(async () => {
			vi.advanceTimersByTime(0)
		})

		await act(async () => {
			fireEvent.pointerDown(document.body)
		})
		expect(card()).toBeNull()
	})

	it('Escape dismisses the open card without moving focus', async () => {
		const { chip_button, card } = mount()

		await act(async () => {
			fireEvent.click(chip_button())
		})
		expect(card()).not.toBeNull()

		const focused_before = document.activeElement

		await act(async () => {
			fireEvent.keyDown(document, { key: 'Escape' })
		})

		expect(card()).toBeNull()
		expect(document.activeElement).toBe(focused_before)
	})

	it('`[id]` (expand) opens on mount with no debounce', async () => {
		const { card } = mount(true)
		// No timer advance at all — should already be open.
		expect(card()).not.toBeNull()
	})

	it('flips the header to the end of the card when there is no room below', async () => {
		const { chip_button, chip_el, card } = mount()

		await act(async () => {
			fireEvent.click(chip_button())
		})
		const el = card()!
		expect(el.classList.contains('is-flipped')).toBe(false)

		// First layout pass ran against jsdom's zeroed rects (→ 'below').
		// Force a tall card near the bottom of the viewport, then trigger a
		// resize so position_floating_card recomputes placement for real.
		vi.spyOn(chip_el(), 'getBoundingClientRect').mockReturnValue({
			top: 700, bottom: 720, left: 50, right: 90, width: 40, height: 20,
			x: 50, y: 700, toJSON: () => ({}),
		} as DOMRect)
		vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
			top: 0, bottom: 400, left: 0, right: 300, width: 300, height: 400,
			x: 0, y: 0, toJSON: () => ({}),
		} as DOMRect)

		await act(async () => {
			fireEvent(window, new Event('resize'))
		})

		expect(el.classList.contains('is-flipped')).toBe(true)
	})
})
