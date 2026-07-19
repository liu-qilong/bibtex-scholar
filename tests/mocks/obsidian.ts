/** Minimal Obsidian stubs for pure unit tests (no Electron). */
export class Modal {
	constructor(_app?: unknown) {}
	open() {}
	close() {}
}
export class Notice {
	constructor(_msg?: string, _timeout?: number) {}
}
export class Setting {
	constructor(_el?: unknown) {}
	setName() { return this }
	setDesc() { return this }
	addText() { return this }
	addButton() { return this }
	addDropdown() { return this }
	addTextArea() { return this }
	addSlider() { return this }
	addSearch() { return this }
}
export async function requestUrl(_opts?: unknown): Promise<{ text: string }> {
	return { text: '' }
}
export type App = unknown

/** CodeMirror StateField stand-in — real value comes from EditorView.state.field. */
export const editorLivePreviewField = Symbol('editorLivePreviewField')

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
