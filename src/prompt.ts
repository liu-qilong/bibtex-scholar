import {
	App,
	Editor,
	AbstractInputSuggest,
	EditorSuggest,
	TFile,
	type EditorPosition,
	type EditorSuggestContext,
	type EditorSuggestTriggerInfo,
} from 'obsidian'
import { type BibtexDict } from 'src/bibtex'
import { list_ids_for_suggest } from 'src/library-scale'
import { find_prompt_trigger } from 'src/prompt-trigger'

/**
 * Inline cite autocomplete.
 *
 * Triggers while typing `` `{…` `` (compact chip) or `` `[…` `` (expanded card).
 * Obsidian auto-closes backticks, so the live match is often `{<cursor>` / `[<cursor>`.
 */
export type SuggestStatsSink = (stats: { returned: number, matched: number }) => void

export class EditorPrompt extends EditorSuggest<string> {
	/** Live getter — never snapshot the dict at construct time (rescan would stale). */
	private get_dict: () => BibtexDict
	private on_stats: SuggestStatsSink | undefined
	editor: Editor
	bracket_start: string
	bracket_end: string
	code_end: string
	trigger_info: EditorSuggestTriggerInfo

	constructor(app: App, get_dict: () => BibtexDict, on_stats?: SuggestStatsSink) {
		super(app)
		this.get_dict = get_dict
		this.on_stats = on_stats
	}

	private get bibtex_dict(): BibtexDict {
		return this.get_dict()
	}

	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile): EditorSuggestTriggerInfo | null {
		this.editor = editor
		const line = editor.getLine(cursor.line)
		const found = find_prompt_trigger(
			line,
			cursor.ch,
			(query) => list_ids_for_suggest(this.bibtex_dict, query).ids.length > 0,
		)
		if (!found) {
			return null
		}

		this.bracket_start = found.bracket_start
		this.bracket_end = found.bracket_end
		this.code_end = found.code_end
		this.trigger_info = {
			start: { line: cursor.line, ch: found.content_start },
			end: { line: cursor.line, ch: found.content_end },
			query: found.query,
		}
		return this.trigger_info
	}

	getSuggestions(context: EditorSuggestContext): string[] {
		// Capped list — never dump the whole library into the suggest UI.
		const list = list_ids_for_suggest(this.bibtex_dict, context.query)
		this.on_stats?.({ returned: list.ids.length, matched: list.matched })
		return list.ids
	}

	renderSuggestion(id: string, el: HTMLElement): void {
		const bibtex = this.bibtex_dict[id]
		el.createEl('code', { text: bibtex.fields.id, cls: 'bibtex-prompt-id' })
		el.createEl('div', { text: bibtex.fields.title, cls: 'bibtex-prompt-title' })
		el.createEl('small', { text: bibtex.fields.author, cls: 'bibtex-prompt-author' })
	}

	selectSuggestion(id: string, _evt: MouseEvent | KeyboardEvent): void {
		const bibtex = this.bibtex_dict[id]
		let insert = bibtex.fields.id
		if (this.bracket_end === '') {
			insert += this.bracket_start === '{' ? '}' : ']'
		}
		if (this.code_end === '') {
			insert += '`'
		}

		this.editor.replaceRange(
			insert,
			this.trigger_info.start,
			this.trigger_info.end,
		)
		// Caret after the text we inserted (id only, or id + closers).
		this.editor.setCursor(
			this.trigger_info.start.line,
			this.trigger_info.start.ch + insert.length,
		)
	}
}

/** Settings helper: pick a vault folder path. */
export class FolderSuggest extends AbstractInputSuggest<string> {
	private folders: string[]

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl)
		this.folders = ['/'].concat(this.app.vault.getAllFolders().map((folder) => folder.path))
	}

	getSuggestions(inputStr: string): string[] {
		const q = inputStr.toLowerCase()
		return this.folders.filter((folder) => folder.toLowerCase().includes(q))
	}

	renderSuggestion(folder: string, el: HTMLElement): void {
		el.createEl('div', { text: folder })
	}

	selectSuggestion(folder: string): void {
		apply_suggest_value(this, folder)
	}
}

/** Settings helper: pick a markdown file path. */
export class FileSuggest extends AbstractInputSuggest<string> {
	private files: string[]

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl)
		this.files = this.app.vault.getFiles()
			.filter((f) => f.extension === 'md')
			.map((f) => f.path)
	}

	getSuggestions(inputStr: string): string[] {
		const q = inputStr.toLowerCase()
		return this.files.filter((file) => file.toLowerCase().includes(q))
	}

	renderSuggestion(file: string, el: HTMLElement): void {
		el.createEl('div', { text: file })
	}

	selectSuggestion(file: string): void {
		apply_suggest_value(this, file)
	}
}

/**
 * Write the chosen path into the bound input and notify Setting.onChange.
 * `setValue` alone does not fire `input`, which is what addSearch wires to.
 */
function apply_suggest_value(suggest: AbstractInputSuggest<string>, value: string): void {
	suggest.setValue(value)
	const input = (suggest as unknown as { textInputEl?: HTMLInputElement | HTMLDivElement }).textInputEl
	input?.dispatchEvent(new Event('input'))
	suggest.close()
}
