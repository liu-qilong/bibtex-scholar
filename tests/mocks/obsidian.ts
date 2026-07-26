/**
 * Minimal Obsidian stubs for pure unit tests (no Electron).
 *
 * `editorLivePreviewField` is a real CodeMirror StateField so editor decoration
 * tests can mount an EditorView and toggle Live Preview ↔ Source without
 * Obsidian's runtime.
 */
import { StateEffect, StateField } from '@codemirror/state'

/** Minimal contentEl with Obsidian-like createEl/empty for Modal subclasses in tests. */
function make_content_el(): HTMLElement & { createEl: Function; empty: Function } {
	const el = document.createElement('div') as HTMLElement & { createEl: Function; empty: Function }
	el.createEl = (tag: string, opts?: { text?: string; cls?: string }) => {
		const child = document.createElement(tag)
		if (opts?.text != null) child.textContent = opts.text
		if (opts?.cls) child.className = opts.cls
		el.appendChild(child)
		return child
	}
	el.empty = () => {
		el.replaceChildren()
	}
	return el
}

export class Modal {
	app: unknown
	contentEl: HTMLElement & { createEl: Function; empty: Function }

	constructor(app?: unknown) {
		this.app = app
		this.contentEl = make_content_el()
	}

	open() {
		this.onOpen()
	}

	close() {
		this.onClose()
	}

	onOpen() {}
	onClose() {}
}
export class Notice {
	constructor(_msg?: string, _timeout?: number) {}
}
export class Setting {
	constructor(_el?: unknown) {}
	setName() { return this }
	setDesc() { return this }
	addText() { return this }
	addButton(cb?: (btn: {
		setButtonText: (t: string) => unknown
		setCta: () => unknown
		setWarning: () => unknown
		onClick: (fn: () => unknown) => unknown
	}) => unknown) {
		if (cb) {
			const btn = {
				setButtonText() { return btn },
				setCta() { return btn },
				setWarning() { return btn },
				onClick() { return btn },
			}
			cb(btn)
		}
		return this
	}
	addDropdown() { return this }
	addTextArea() { return this }
	addSlider() { return this }
	addSearch() { return this }
}
export async function requestUrl(_opts?: unknown): Promise<{ text: string }> {
	return { text: '' }
}
export type App = unknown

/** Dispatch to flip Live Preview on/off in unit tests. */
export const setEditorLivePreview = StateEffect.define<boolean>()

/**
 * Stand-in for Obsidian's `editorLivePreviewField`.
 * Default `true` (Live Preview) — matches the mode where cite chips render.
 */
export const editorLivePreviewField = StateField.define<boolean>({
	create: () => true,
	update(value, tr) {
		for (const e of tr.effects) {
			if (e.is(setEditorLivePreview)) {
				return e.value
			}
		}
		return value
	},
})

/** Minimal Component: enough for load()/unload() lifecycle + child registration. */
export class Component {
	private loaded = false

	load() {
		if (this.loaded) return
		this.loaded = true
		this.onload()
	}
	onload() {}

	unload() {
		if (!this.loaded) return
		this.loaded = false
		this.onunload()
	}
	onunload() {}

	addChild<T>(component: T): T { return component }
	removeChild<T>(component: T): T { return component }
	register(_cb: () => unknown) {}
	registerEvent(_ref: unknown) {}
	registerDomEvent(..._args: unknown[]) {}
	registerInterval(id: number) { return id }
}

export class MarkdownRenderChild extends Component {
	containerEl: HTMLElement
	constructor(containerEl: HTMLElement) {
		super()
		this.containerEl = containerEl
	}
}

/** Stub: writes the raw markdown as text instead of rendering it (not under test here). */
export class MarkdownRenderer {
	static async render(
		_app: unknown,
		markdown: string,
		el: HTMLElement,
		_sourcePath: string,
		_component: unknown,
	): Promise<void> {
		el.textContent = markdown
	}
}
