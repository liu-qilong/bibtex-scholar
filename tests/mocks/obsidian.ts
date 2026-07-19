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
