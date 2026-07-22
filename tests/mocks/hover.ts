/**
 * Break bibtex ↔ hover (React) cycle in pure unit tests.
 *
 * Also supplies a lightweight CodeMirror WidgetType so `createHoverWidgetPlugin`
 * can paint decorations in EditorView integration tests without mounting React.
 * Real chip/card/focus behaviour is covered by `tests/hover-popup.test.tsx`
 * (relative import of `src/hover`).
 */
import { WidgetType } from '@codemirror/view'

/** Break bibtex ↔ hover cycle in unit tests. */
export const copy_to_clipboard = (_text?: unknown) => {}

export function unmount_card_manager() {}
export function render_hover() {}
export function unmount_hover() {}
export function unmount_hover_hosts() {}
export const HOVER_HOST_ATTR = 'data-bibtex-hover-host'

export class HoverRenderChild {
	constructor(..._args: unknown[]) {}
	onload() {}
	onunload() {}
}

/**
 * CM replace-widget stub: same DOM contracts the real HoverWidget paints
 * (contenteditable=false, css class, cite id data attr) without React.
 */
export class HoverWidget extends WidgetType {
	bibtex: { fields: { id: string } }
	expand: boolean

	constructor(bibtex: { fields: { id: string } }, _plugin?: unknown, _app?: unknown, expand: boolean = false) {
		super()
		this.bibtex = bibtex
		this.expand = expand
	}

	toDOM() {
		const span = document.createElement('span')
		span.className = 'bibtex-cm-widget'
		span.setAttribute('contenteditable', 'false')
		span.dataset.citeId = this.bibtex.fields.id
		span.dataset.expand = String(this.expand)
		span.textContent = this.bibtex.fields.id
		return span
	}

	eq(other: HoverWidget) {
		return (
			other instanceof HoverWidget
			&& this.bibtex.fields.id === other.bibtex.fields.id
			&& this.expand === other.expand
		)
	}

	destroy(_dom: HTMLElement) {}

	ignoreEvent() {
		return true
	}
}
