// @vitest-environment jsdom
/**
 * CodeMirror integration tests for Live Preview cite decorations.
 *
 * Mounts a real EditorView + createHoverWidgetPlugin against the vitest
 * Obsidian/hover mocks (lightweight WidgetType, real StateField for LP).
 * Asserts the cursor policy users feel: chip outside cite, raw text inside,
 * Source mode empty, multi-cite isolation, case-insensitive resolve.
 */
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { build_id_index } from 'src/citekey-index'
import { cite_span_key_at, createHoverWidgetPlugin } from 'src/editor'
import { setEditorLivePreview, editorLivePreviewField } from 'obsidian'
import type { BibtexElement } from 'src/bibtex'

const doe: BibtexElement = {
	fields: {
		type: 'article',
		id: 'Doe2020Widgets',
		title: 'On the Widgets',
		author: 'Doe, Jane',
		year: '2020',
	},
	source: '@article{Doe2020Widgets,}\n',
	source_path: 'refs/widgets.md',
}

const roe: BibtexElement = {
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

function make_plugin(entries: BibtexElement[] = [doe]) {
	const bibtex_dict: Record<string, BibtexElement> = {}
	for (const e of entries) {
		bibtex_dict[e.fields.id] = e
	}
	return {
		cache: { bibtex_dict },
		id_index: build_id_index(bibtex_dict),
	}
}

function make_app() {
	const portal_root = document.createElement('div')
	document.body.appendChild(portal_root)
	return {
		workspace: { containerEl: portal_root },
	}
}

function chip_nodes(view: EditorView): NodeListOf<Element> {
	return view.dom.querySelectorAll('.bibtex-cm-widget')
}

function chip_ids(view: EditorView): string[] {
	return Array.from(chip_nodes(view)).map(
		(n) => (n as HTMLElement).dataset.citeId ?? n.textContent ?? '',
	)
}

/** Build an EditorView with the hover plugin; parent must be in the document for widgets to paint. */
function mount_editor(doc: string, plugin: ReturnType<typeof make_plugin>, caret = 0) {
	const parent = document.createElement('div')
	document.body.appendChild(parent)
	const app = make_app()
	const view = new EditorView({
		parent,
		state: EditorState.create({
			doc,
			selection: EditorSelection.cursor(caret),
			extensions: [
				editorLivePreviewField,
				createHoverWidgetPlugin(plugin as any, app as any),
			],
		}),
	})
	return { view, parent, app }
}

function set_caret(view: EditorView, pos: number) {
	view.dispatch({ selection: EditorSelection.cursor(pos) })
}

function set_live_preview(view: EditorView, on: boolean) {
	view.dispatch({ effects: setEditorLivePreview.of(on) })
}

/** Offset of `needle` in `doc`, or throw. */
function at(doc: string, needle: string): number {
	const i = doc.indexOf(needle)
	if (i < 0) throw new Error(`needle not found: ${needle}`)
	return i
}

describe('editor decorations / cursor policy (CM EditorView)', () => {
	const views: EditorView[] = []

	afterEach(() => {
		for (const v of views) {
			v.destroy()
		}
		views.length = 0
		document.body.innerHTML = ''
	})

	function track(view: EditorView) {
		views.push(view)
		return view
	}

	it('shows a chip when the caret is outside a known cite span', () => {
		const doc = 'See `{Doe2020Widgets}` here'
		const { view } = mount_editor(doc, make_plugin(), 0)
		track(view)
		expect(chip_ids(view)).toEqual(['Doe2020Widgets'])
		const widget = chip_nodes(view)[0] as HTMLElement
		expect(widget.getAttribute('contenteditable')).toBe('false')
	})

	it('hides the chip (raw text) when the caret is inside the cite span', () => {
		const doc = 'See `{Doe2020Widgets}` here'
		// Caret on the id character inside the span
		const inside = at(doc, 'Doe2020Widgets')
		const { view } = mount_editor(doc, make_plugin(), inside)
		track(view)
		expect(chip_nodes(view)).toHaveLength(0)
	})

	it('derenders when caret enters a cite and re-chips when caret leaves', () => {
		const doc = 'See `{Doe2020Widgets}` here'
		const span_from = at(doc, '`{Doe2020Widgets}`')
		const span_to = span_from + '`{Doe2020Widgets}`'.length
		const { view } = mount_editor(doc, make_plugin(), 0)
		track(view)
		expect(chip_nodes(view)).toHaveLength(1)

		// Enter at half-open start → inside → no chip
		set_caret(view, span_from)
		expect(chip_nodes(view)).toHaveLength(0)

		// Stay inside (mid-id) → still no chip (no thrash / still derendered)
		set_caret(view, span_from + 3)
		expect(chip_nodes(view)).toHaveLength(0)

		// Exclusive end is outside → chip returns
		set_caret(view, span_to)
		expect(chip_ids(view)).toEqual(['Doe2020Widgets'])

		// Just before the span is outside → chip stays
		set_caret(view, span_from - 1)
		expect(chip_nodes(view)).toHaveLength(1)
	})

	it('only derenders the cite under the caret when several cites share a line', () => {
		const doc = 'A `{Doe2020Widgets}` and `{Roe2021Gadgets}` end'
		const doe_from = at(doc, '`{Doe2020Widgets}`')
		const roe_from = at(doc, '`{Roe2021Gadgets}`')
		const { view } = mount_editor(doc, make_plugin([doe, roe]), 0)
		track(view)
		expect(chip_ids(view).sort()).toEqual(['Doe2020Widgets', 'Roe2021Gadgets'].sort())

		set_caret(view, doe_from + 2) // inside Doe
		expect(chip_ids(view)).toEqual(['Roe2021Gadgets'])

		set_caret(view, roe_from + 2) // inside Roe
		expect(chip_ids(view)).toEqual(['Doe2020Widgets'])

		set_caret(view, doc.length) // past both
		expect(chip_ids(view).sort()).toEqual(['Doe2020Widgets', 'Roe2021Gadgets'].sort())
	})

	it('does not thrash decorations when caret moves only outside cites', () => {
		const doc = 'Hello `{Doe2020Widgets}` world'
		const { view } = mount_editor(doc, make_plugin(), 0)
		track(view)
		const first = chip_nodes(view)[0]
		expect(first).toBeTruthy()

		// Move caret within the prefix "Hello " — both keys null, no rebuild required
		set_caret(view, 1)
		set_caret(view, 2)
		// Widget DOM should still be present (eq reuse path under the hood)
		expect(chip_nodes(view)).toHaveLength(1)
		expect(chip_ids(view)).toEqual(['Doe2020Widgets'])
	})

	it('paints no chips in pure Source mode (live preview off)', () => {
		const doc = 'See `{Doe2020Widgets}` here'
		const { view } = mount_editor(doc, make_plugin(), 0)
		track(view)
		expect(chip_nodes(view)).toHaveLength(1)

		set_live_preview(view, false)
		expect(chip_nodes(view)).toHaveLength(0)

		// Still no chips while caret moves in source mode
		set_caret(view, at(doc, 'Doe2020Widgets'))
		expect(chip_nodes(view)).toHaveLength(0)

		// Back to Live Preview with caret outside → chip returns
		set_caret(view, 0)
		set_live_preview(view, true)
		expect(chip_ids(view)).toEqual(['Doe2020Widgets'])
	})

	it('skips unknown citekeys (not in dict / id_index)', () => {
		const doc = 'See `{UnknownKey}` and `{Doe2020Widgets}`'
		const { view } = mount_editor(doc, make_plugin([doe]), 0)
		track(view)
		expect(chip_ids(view)).toEqual(['Doe2020Widgets'])
	})

	it('resolves citekeys case-insensitively via id_index', () => {
		const doc = 'See `{doe2020widgets}` here'
		const { view } = mount_editor(doc, make_plugin([doe]), 0)
		track(view)
		// Canonical id is painted on the widget
		expect(chip_ids(view)).toEqual(['Doe2020Widgets'])
	})

	it('marks expanded [id] form on the widget', () => {
		const doc = 'Open `[Doe2020Widgets]` now'
		const { view } = mount_editor(doc, make_plugin([doe]), 0)
		track(view)
		const el = chip_nodes(view)[0] as HTMLElement
		expect(el.dataset.expand).toBe('true')
		expect(el.dataset.citeId).toEqual('Doe2020Widgets')
	})

	it('rebuilds chips after a document edit that inserts a new cite', () => {
		const doc = 'Start '
		const { view } = mount_editor(doc, make_plugin([doe, roe]), 0)
		track(view)
		expect(chip_nodes(view)).toHaveLength(0)

		view.dispatch({
			changes: { from: doc.length, insert: '`{Doe2020Widgets}`' },
			selection: EditorSelection.cursor(doc.length + '`{Doe2020Widgets}`'.length),
		})
		// Caret at exclusive end of the new span → chip should show
		expect(chip_ids(view)).toEqual(['Doe2020Widgets'])
	})

	it('cite_span_key_at reports inside only for [from, to)', () => {
		const doc = 'x`{A}`y'
		// Key helper does not need the id in the library
		const { view } = mount_editor(doc, make_plugin(), 0)
		track(view)
		// offsets: 0=x, 1=`, 2={, 3=A, 4=}, 5=`, 6=y
		expect(cite_span_key_at(view, 0)).toBeNull()
		expect(cite_span_key_at(view, 1)).toBe('1:6')
		expect(cite_span_key_at(view, 5)).toBe('1:6')
		expect(cite_span_key_at(view, 6)).toBeNull()
		expect(cite_span_key_at(view, -1)).toBeNull()
		expect(cite_span_key_at(view, 999)).toBeNull()
	})
})
