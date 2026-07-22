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
import {
	HoverRenderChild,
	HoverWidget,
	render_hover,
	unmount_card_manager,
	unmount_hover,
	unmount_hover_hosts,
} from '../src/hover'

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

/**
 * Mount a chip host under a given app/plugin (shared portal_root), so multiple
 * chips can be exercised against the one shared card-manager root.
 */
function mount_chip(app: unknown, plugin: unknown, bibtex_entry: BibtexElement, expand = false, dense = false) {
	const host = document.createElement('span')
	document.body.appendChild(host)

	act(() => {
		render_hover(host, bibtex_entry, plugin as any, app as any, expand, dense)
	})

	return {
		host,
		chip_button: () => host.querySelector('.bibtex-hover-chip button') as HTMLButtonElement,
		// `chip_ref` (the actual position_floating_card anchor) is the wrapping span, not the button.
		chip_el: () => host.querySelector('.bibtex-hover-chip') as HTMLSpanElement,
	}
}

/** Mount a fresh chip host + portal root, wired to the same fake app/plugin. */
function mount(expand = false, dense = false) {
	const portal_root = document.createElement('div')
	document.body.appendChild(portal_root)

	const app = make_fake_app(portal_root)
	const plugin = make_fake_plugin()

	const chip = mount_chip(app, plugin, bibtex, expand, dense)

	return {
		...chip,
		portal_root,
		card: () => portal_root.querySelector('.bibtex-hover-card') as HTMLDivElement | null,
	}
}

describe('citation popup DOM behavior', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(async () => {
		citation_popup.dispose()
		unmount_card_manager()
		// unmount_card_manager unmounts via a queued microtask so React doesn't
		// warn about unmounting mid-render; let it drain before the next test's
		// ensure_card_manager() creates a fresh root.
		await Promise.resolve()
		cleanup()
		document.body.innerHTML = ''
		vi.useRealTimers()
	})

	it('chip root is contentEditable=false, so a CM6 host cannot treat its text as editable document content', () => {
		const { chip_el } = mount()
		// Regression guard for the "unpredictable editor cursor near a chip" bug:
		// without this, the browser lets the caret land inside the widget's own
		// rendered text, which doesn't map to any real document offset.
		expect(chip_el().closest('.bibtex-hover')?.getAttribute('contenteditable')).toBe('false')
	})

	it('chip button has no native title tooltip (moved to a hint on the open card instead)', () => {
		const { chip_button } = mount()
		expect(chip_button().hasAttribute('title')).toBe(false)
	})

	it('open card carries a `.bibtex-card-hint` with the dismiss instructions, not the chip', async () => {
		const { chip_button, card } = mount()
		await act(async () => {
			fireEvent.click(chip_button())
		})
		const hint = card()?.querySelector('.bibtex-card-hint')
		expect(hint).not.toBeNull()
		expect(hint?.getAttribute('title')).toMatch(/dismiss/i)
	})

	it('chip pointerdown preventDefault so a native <button> cannot steal focus from the CM editor', () => {
		const { chip_button } = mount()
		const btn = chip_button()
		// jsdom only focuses explicitly focusable nodes — tabIndex makes the proxy real.
		const editor_proxy = document.createElement('div')
		editor_proxy.tabIndex = 0
		document.body.appendChild(editor_proxy)
		editor_proxy.focus()
		expect(document.activeElement).toBe(editor_proxy)

		// Chips listen on pointerdown (also starts long-press for Live Preview edit).
		const ev = new PointerEvent('pointerdown', { bubbles: true, cancelable: true })
		btn.dispatchEvent(ev)
		expect(ev.defaultPrevented).toBe(true)
		expect(document.activeElement).not.toBe(btn)
	})

	it('HoverWidget.destroy unmounts via the CM-provided DOM (safe after eq-reuse swaps the instance)', async () => {
		const portal_root = document.createElement('div')
		document.body.appendChild(portal_root)
		const app = make_fake_app(portal_root)
		const plugin = make_fake_plugin()

		// First paint — the instance that actually ran toDOM / mount_chip.
		const painted = new HoverWidget(bibtex, plugin as any, app as any, false)
		const dom = painted.toDOM() as HTMLElement
		document.body.appendChild(dom)
		expect(dom.querySelector('.bibtex-hover-chip button')).not.toBeNull()

		// Open the card so we can assert destroy also tears down popup state.
		await act(async () => {
			fireEvent.click(dom.querySelector('.bibtex-hover-chip button') as HTMLButtonElement)
		})
		expect(portal_root.querySelector('.bibtex-hover-card')).not.toBeNull()

		// CM decoration rebuild: new widget instance, eq() true → same DOM kept.
		const reused = new HoverWidget(bibtex, plugin as any, app as any, false)
		expect(painted.eq(reused)).toBe(true)
		// reused never called toDOM — if destroy relied on this.host it would no-op.
		await act(async () => {
			reused.destroy(dom)
		})

		expect(dom.querySelector('.bibtex-hover-chip')).toBeNull()
		expect(portal_root.querySelector('.bibtex-hover-card')).toBeNull()
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

	it('scrolling dismisses the card for a dense (panel) chip instead of repositioning it', async () => {
		const { chip_button, card } = mount(false, true)

		await act(async () => {
			fireEvent.click(chip_button())
		})
		expect(card()).not.toBeNull()

		await act(async () => {
			document.dispatchEvent(new Event('scroll'))
		})
		expect(card()).toBeNull()
	})

	it('scrolling keeps the card open (repositioned) for a normal in-note chip', async () => {
		const { chip_button, card } = mount(false, false)

		await act(async () => {
			fireEvent.click(chip_button())
		})
		expect(card()).not.toBeNull()

		await act(async () => {
			document.dispatchEvent(new Event('scroll'))
		})
		expect(card()).not.toBeNull()
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

	it('opening a second chip swaps the shared card: first closes, second renders with its own content', async () => {
		const portal_root = document.createElement('div')
		document.body.appendChild(portal_root)
		const app = make_fake_app(portal_root)
		const plugin = make_fake_plugin()

		const bibtex_b: BibtexElement = {
			fields: {
				type: 'article',
				id: 'Roe2021Gadgets',
				title: 'On the Gadgets',
				author: 'Roe, John',
				year: '2021',
			},
			source: '@article{Roe2021Gadgets,}\n',
			source_path: 'refs/gadgets.md',
		}

		const chip_a = mount_chip(app, plugin, bibtex, false)
		const chip_b = mount_chip(app, plugin, bibtex_b, false)
		const card = () => portal_root.querySelector('.bibtex-hover-card') as HTMLDivElement | null

		await act(async () => {
			fireEvent.click(chip_a.chip_button())
		})
		expect(portal_root.querySelectorAll('.bibtex-hover-card')).toHaveLength(1)
		expect(card()!.textContent).toContain('Doe2020Widgets')
		expect(chip_a.chip_button().getAttribute('aria-expanded')).toBe('true')

		await act(async () => {
			fireEvent.click(chip_b.chip_button())
		})
		// Exactly one card mounted at a time — the shared root swapped, it did not add a second.
		expect(portal_root.querySelectorAll('.bibtex-hover-card')).toHaveLength(1)
		expect(card()!.textContent).toContain('Roe2021Gadgets')
		expect(card()!.textContent).not.toContain('Doe2020Widgets')
		expect(chip_a.chip_button().getAttribute('aria-expanded')).toBe('false')
		expect(chip_b.chip_button().getAttribute('aria-expanded')).toBe('true')
	})

	it('pinned card shows the Esc / drag affordance line', async () => {
		const { chip_button, card } = mount()
		await act(async () => {
			fireEvent.click(chip_button())
		})
		const pin_btn = card()!.querySelector('.bibtex-card-pin') as HTMLButtonElement
		await act(async () => {
			fireEvent.click(pin_btn)
		})
		const affordance = card()!.querySelector('.bibtex-card-pin-affordance')
		expect(affordance).not.toBeNull()
		expect(affordance!.textContent).toMatch(/Esc/i)
		expect(affordance!.textContent).toMatch(/drag/i)
		// Preview-only ⓘ hint is not used on pinned cards.
		expect(card()!.querySelector('.bibtex-card-hint')).toBeNull()
	})

	it('marks the card is-flipped when there is no room below (contents move, not header/actions)', async () => {
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

const bibtex_2: BibtexElement = {
	fields: {
		type: 'article',
		id: 'Smith2019Other',
		title: 'A Different Paper',
		author: 'Smith, John',
		year: '2019',
	},
	source: '@article{Smith2019Other,}\n',
	source_path: 'refs/other.md',
}

describe('pinned cards', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(async () => {
		citation_popup.dispose()
		unmount_card_manager()
		await Promise.resolve()
		cleanup()
		document.body.innerHTML = ''
		vi.useRealTimers()
	})

	it('pin button pins the card, and it survives what would normally close it', async () => {
		const { chip_button, card } = mount()

		await act(async () => {
			fireEvent.click(chip_button())
		})
		expect(card()).not.toBeNull()

		const pin_btn = card()!.querySelector('.bibtex-card-pin') as HTMLButtonElement
		await act(async () => {
			fireEvent.click(pin_btn)
		})
		expect(card()!.classList.contains('is-pinned')).toBe(true)

		// Outside-click grace tick, then the pointerdown that would normally close a transient card.
		await act(async () => {
			vi.advanceTimersByTime(0)
		})
		await act(async () => {
			fireEvent.pointerDown(document.body)
		})
		expect(card()).not.toBeNull()
	})

	it('pinning a second, different paper renders two simultaneous cards', async () => {
		const portal_root = document.createElement('div')
		document.body.appendChild(portal_root)
		const app = make_fake_app(portal_root)
		const plugin = make_fake_plugin()

		const chip_a = mount_chip(app, plugin, bibtex)
		const chip_b = mount_chip(app, plugin, bibtex_2)

		await act(async () => {
			fireEvent.click(chip_a.chip_button())
		})
		await act(async () => {
			fireEvent.click(
				portal_root.querySelector('.bibtex-hover-card .bibtex-card-pin') as HTMLButtonElement,
			)
		})

		await act(async () => {
			fireEvent.click(chip_b.chip_button())
		})
		await act(async () => {
			const cards = portal_root.querySelectorAll('.bibtex-hover-card')
			const unpinned = Array.from(cards).find((c) => !c.classList.contains('is-pinned'))!
			fireEvent.click(unpinned.querySelector('.bibtex-card-pin') as HTMLButtonElement)
		})

		const cards = portal_root.querySelectorAll('.bibtex-hover-card')
		expect(cards).toHaveLength(2)
		expect(Array.from(cards).every((c) => c.classList.contains('is-pinned'))).toBe(true)
	})

	it('unpinning one pinned card leaves the other open', async () => {
		const portal_root = document.createElement('div')
		document.body.appendChild(portal_root)
		const app = make_fake_app(portal_root)
		const plugin = make_fake_plugin()

		const chip_a = mount_chip(app, plugin, bibtex)
		const chip_b = mount_chip(app, plugin, bibtex_2)

		for (const chip of [chip_a, chip_b]) {
			await act(async () => {
				fireEvent.click(chip.chip_button())
			})
			await act(async () => {
				const cards = portal_root.querySelectorAll('.bibtex-hover-card')
				const unpinned = Array.from(cards).find((c) => !c.classList.contains('is-pinned'))!
				fireEvent.click(unpinned.querySelector('.bibtex-card-pin') as HTMLButtonElement)
			})
		}
		expect(portal_root.querySelectorAll('.bibtex-hover-card')).toHaveLength(2)

		const first_card = portal_root.querySelector('#bibtex-cite-card-Doe2020Widgets') as HTMLElement
		await act(async () => {
			fireEvent.click(first_card.querySelector('.bibtex-card-close') as HTMLButtonElement)
		})

		const remaining = portal_root.querySelectorAll('.bibtex-hover-card')
		expect(remaining).toHaveLength(1)
		expect(remaining[0].id).toBe('bibtex-cite-card-Smith2019Other')
	})

	it('Esc with no transient card open closes only the front-most pinned card, one at a time', async () => {
		const portal_root = document.createElement('div')
		document.body.appendChild(portal_root)
		const app = make_fake_app(portal_root)
		const plugin = make_fake_plugin()

		const chip_a = mount_chip(app, plugin, bibtex)
		const chip_b = mount_chip(app, plugin, bibtex_2)

		for (const chip of [chip_a, chip_b]) {
			await act(async () => {
				fireEvent.click(chip.chip_button())
			})
			await act(async () => {
				const cards = portal_root.querySelectorAll('.bibtex-hover-card')
				const unpinned = Array.from(cards).find((c) => !c.classList.contains('is-pinned'))!
				fireEvent.click(unpinned.querySelector('.bibtex-card-pin') as HTMLButtonElement)
			})
		}
		expect(portal_root.querySelectorAll('.bibtex-hover-card')).toHaveLength(2)

		// bibtex_2 was pinned last -> front-most -> first Esc target.
		await act(async () => {
			fireEvent.keyDown(document, { key: 'Escape' })
		})
		let remaining = portal_root.querySelectorAll('.bibtex-hover-card')
		expect(remaining).toHaveLength(1)
		expect(remaining[0].id).toBe('bibtex-cite-card-Doe2020Widgets')

		await act(async () => {
			fireEvent.keyDown(document, { key: 'Escape' })
		})
		remaining = portal_root.querySelectorAll('.bibtex-hover-card')
		expect(remaining).toHaveLength(0)
	})

	it('survives the originating chip being torn down (what a note switch does)', async () => {
		const { host, chip_button, portal_root, card } = mount()

		await act(async () => {
			fireEvent.click(chip_button())
		})
		const pin_btn = card()!.querySelector('.bibtex-card-pin') as HTMLButtonElement
		await act(async () => {
			fireEvent.click(pin_btn)
		})
		expect(card()!.classList.contains('is-pinned')).toBe(true)

		// Switching notes tears down the editor's CM widgets, which calls
		// unmount_hover on every chip host in the old note — including the one
		// that opened this pin. The pinned card lives in pin_registry, detached
		// from chip_registry, so it must not be affected.
		await act(async () => {
			unmount_hover(host)
		})

		expect(host.querySelector('.bibtex-hover-chip')).toBeNull()
		const remaining = portal_root.querySelectorAll('.bibtex-hover-card')
		expect(remaining).toHaveLength(1)
		expect(remaining[0].classList.contains('is-pinned')).toBe(true)
	})
})

describe('HoverWidget / chip lifecycle contracts', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(async () => {
		citation_popup.dispose()
		unmount_card_manager()
		await Promise.resolve()
		cleanup()
		document.body.innerHTML = ''
		vi.useRealTimers()
	})

	it('toDOM paints contenteditable=false on the CM widget root (not only the inner chip)', () => {
		const portal_root = document.createElement('div')
		document.body.appendChild(portal_root)
		const app = make_fake_app(portal_root)
		const plugin = make_fake_plugin()
		const widget = new HoverWidget(bibtex, plugin as any, app as any, false)
		const dom = widget.toDOM() as HTMLElement
		expect(dom.classList.contains('bibtex-cm-widget')).toBe(true)
		expect(dom.getAttribute('contenteditable')).toBe('false')
		// Nested chip wrapper also non-editable (defense in depth)
		expect(dom.querySelector('.bibtex-hover')?.getAttribute('contenteditable')).toBe('false')
	})

	it('eq is true only for same fields + expand; ignoreEvent always true', () => {
		const portal_root = document.createElement('div')
		document.body.appendChild(portal_root)
		const app = make_fake_app(portal_root)
		const plugin = make_fake_plugin()
		const a = new HoverWidget(bibtex, plugin as any, app as any, false)
		const a2 = new HoverWidget(bibtex, plugin as any, app as any, false)
		const expanded = new HoverWidget(bibtex, plugin as any, app as any, true)
		const other: BibtexElement = {
			...bibtex,
			fields: { ...bibtex.fields, id: 'Other2022' },
		}
		const b = new HoverWidget(other, plugin as any, app as any, false)
		const updated_title: BibtexElement = {
			...bibtex,
			fields: { ...bibtex.fields, title: 'Revised title' },
		}
		const c = new HoverWidget(updated_title, plugin as any, app as any, false)

		expect(a.eq(a2)).toBe(true)
		expect(a.eq(expanded)).toBe(false)
		expect(a.eq(b)).toBe(false)
		expect(a.eq(c)).toBe(false) // field content change → re-paint (A5)
		expect(a.ignoreEvent()).toBe(true)
		expect(a.ignoreEvent(new Event('mousedown'))).toBe(true)
	})

	it('unmount_hover while card is open closes the card and clears chip DOM', async () => {
		const { host, chip_button, card } = mount()
		await act(async () => {
			fireEvent.click(chip_button())
		})
		expect(card()).not.toBeNull()

		await act(async () => {
			unmount_hover(host)
		})
		expect(host.querySelector('.bibtex-hover-chip')).toBeNull()
		expect(card()).toBeNull()
	})

	it('unmount_hover is a no-op when nothing was mounted', () => {
		const orphan = document.createElement('span')
		document.body.appendChild(orphan)
		expect(() => unmount_hover(orphan)).not.toThrow()
	})

	it('destroy is safe to call twice (CM may tear down aggressively)', async () => {
		const portal_root = document.createElement('div')
		document.body.appendChild(portal_root)
		const app = make_fake_app(portal_root)
		const plugin = make_fake_plugin()
		const widget = new HoverWidget(bibtex, plugin as any, app as any, false)
		const dom = widget.toDOM() as HTMLElement
		document.body.appendChild(dom)

		await act(async () => {
			widget.destroy(dom)
			widget.destroy(dom)
		})
		expect(dom.querySelector('.bibtex-hover-chip')).toBeNull()
	})

	it('re-render on the same host updates the button label without stacking chips', () => {
		const portal_root = document.createElement('div')
		document.body.appendChild(portal_root)
		const app = make_fake_app(portal_root)
		const plugin = make_fake_plugin()
		const host = document.createElement('span')
		document.body.appendChild(host)

		act(() => {
			render_hover(host, bibtex, plugin as any, app as any, false)
		})
		expect(host.querySelectorAll('.bibtex-hover')).toHaveLength(1)
		expect(host.querySelector('button')?.textContent).toBe('Doe2020Widgets')

		const updated: BibtexElement = {
			...bibtex,
			fields: { ...bibtex.fields, id: 'Doe2020WidgetsRevised' },
		}
		act(() => {
			render_hover(host, updated, plugin as any, app as any, false)
		})
		// Same host → reuse instance_id path; still one chip, new label
		expect(host.querySelectorAll('.bibtex-hover')).toHaveLength(1)
		expect(host.querySelector('button')?.textContent).toBe('Doe2020WidgetsRevised')
	})

	it('unmount_hover_hosts clears every chip under a list root (panel empty path)', async () => {
		const portal_root = document.createElement('div')
		document.body.appendChild(portal_root)
		const app = make_fake_app(portal_root)
		const plugin = make_fake_plugin()
		const list = document.createElement('div')
		document.body.appendChild(list)

		const a = document.createElement('span')
		const b = document.createElement('span')
		list.appendChild(a)
		list.appendChild(b)
		act(() => {
			render_hover(a, bibtex, plugin as any, app as any, false)
			render_hover(b, bibtex, plugin as any, app as any, false)
		})
		expect(list.querySelectorAll('.bibtex-hover-chip')).toHaveLength(2)

		await act(async () => {
			// Open one card then wipe the list — card must go too
			fireEvent.click(a.querySelector('button') as HTMLButtonElement)
		})
		expect(portal_root.querySelector('.bibtex-hover-card')).not.toBeNull()

		await act(async () => {
			unmount_hover_hosts(list)
		})
		expect(list.querySelectorAll('.bibtex-hover-chip')).toHaveLength(0)
		expect(portal_root.querySelector('.bibtex-hover-card')).toBeNull()
	})

	it('HoverRenderChild unloads the chip when Obsidian discards the section', async () => {
		const portal_root = document.createElement('div')
		document.body.appendChild(portal_root)
		const app = make_fake_app(portal_root)
		const plugin = make_fake_plugin()
		const el = document.createElement('span')
		document.body.appendChild(el)

		const child = new HoverRenderChild(el, bibtex, plugin as any, app as any, false)
		act(() => {
			child.onload()
		})
		expect(el.querySelector('.bibtex-hover-chip')).not.toBeNull()

		await act(async () => {
			fireEvent.click(el.querySelector('button') as HTMLButtonElement)
		})
		expect(portal_root.querySelector('.bibtex-hover-card')).not.toBeNull()

		await act(async () => {
			child.onunload()
		})
		expect(el.querySelector('.bibtex-hover-chip')).toBeNull()
		expect(portal_root.querySelector('.bibtex-hover-card')).toBeNull()
	})

	it('eq-reuse then destroy on the painted instance also cleans up (either instance may win)', async () => {
		const portal_root = document.createElement('div')
		document.body.appendChild(portal_root)
		const app = make_fake_app(portal_root)
		const plugin = make_fake_plugin()

		const painted = new HoverWidget(bibtex, plugin as any, app as any, false)
		const dom = painted.toDOM() as HTMLElement
		document.body.appendChild(dom)

		const reused = new HoverWidget(bibtex, plugin as any, app as any, false)
		expect(painted.eq(reused)).toBe(true)

		// CM keeps `reused` as the live instance, but if it ever called destroy on
		// the painted one with the shared DOM, that must still work.
		await act(async () => {
			painted.destroy(dom)
		})
		expect(dom.querySelector('.bibtex-hover-chip')).toBeNull()
	})
})

