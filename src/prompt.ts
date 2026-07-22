import { App, Editor, AbstractInputSuggest, SuggestModal, EditorSuggest, TFile, type EditorPosition, type EditorSuggestContext, type EditorSuggestTriggerInfo } from 'obsidian'
import { BibtexElement, type BibtexDict } from 'src/bibtex'
import { list_ids_for_suggest } from 'src/library-scale'
import { find_prompt_trigger } from 'src/prompt-trigger'

/**
 * An editor prompt to suggest BibTeX entries. Triggered by:
 * * Type ` and { for collapsed paper element
 * * Type ` and [ for expanded paper element
 * P.S. Since Obsidian auto-completes ``, we are actually matching `{<cursor>` or `[<cursor>`
 */
export type SuggestStatsSink = (stats: { returned: number, matched: number }) => void

export class EditorPrompt extends EditorSuggest<string> {
    /** Live getter — never snapshot the dict at construct time (rescan/uncache would stale). */
    private get_dict: () => BibtexDict
    /** Optional scale counter hook (plugin.perf). */
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

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
        // determine if this EditorSuggest should be triggered
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
        // Capped + slim match_query — never dump the whole library into the suggest UI.
        const list = list_ids_for_suggest(this.bibtex_dict, context.query)
        this.on_stats?.({ returned: list.ids.length, matched: list.matched })
        return list.ids
    }

    renderSuggestion(id: string, el: HTMLElement): void {
        // render each suggestion item
        const bibtex = this.bibtex_dict[id]
        el.createEl('code', { text: bibtex.fields.id, cls: 'bibtex-prompt-id' })
        el.createEl('div', { text: bibtex.fields.title, cls: 'bibtex-prompt-title' })
        el.createEl('small', { text: bibtex.fields.author, cls: 'bibtex-prompt-author' })
    }

    selectSuggestion(id: string, evt: MouseEvent | KeyboardEvent): void {
        // handle the selection of a suggestion
        const bibtex = this.bibtex_dict[id]
        let str = bibtex.fields.id
        if (this.bracket_end === '') {
            str += (this.bracket_start === '{') ? ('}') : (']')
        }
        if (this.code_end === '') {
            str += '`'
        }

        this.editor.replaceRange(
            str,
            this.trigger_info.start,
            this.trigger_info.end,
        )
        // Caret after whatever we actually inserted (id only, or id + closers).
        this.editor.setCursor(
            this.trigger_info.start.line,
            this.trigger_info.start.ch + str.length,
        )
    }
}

export class FolderSuggest extends AbstractInputSuggest<string> {
    private folders: string[];

    constructor(app: App, inputEl: HTMLInputElement) {
        super(app, inputEl);
        // Get all folders and include root folder
        this.folders = ["/"].concat(this.app.vault.getAllFolders().map(folder => folder.path));
    }

    getSuggestions(inputStr: string): string[] {
        const inputLower = inputStr.toLowerCase();
        return this.folders.filter(folder =>
            folder.toLowerCase().includes(inputLower)
        );
    }

    renderSuggestion(folder: string, el: HTMLElement): void {
        el.createEl("div", { text: folder });
    }

    selectSuggestion(folder: string): void {
        // @ts-ignore
        this.textInputEl.value = folder;
        const event = new Event('input');
        // @ts-ignore
        this.textInputEl.dispatchEvent(event);
        this.close();
    }
}

export class FileSuggest extends AbstractInputSuggest<string> {
    private files: string[];

    constructor(app: App, inputEl: HTMLInputElement) {
        super(app, inputEl);
        // collect all files
        this.files = this.app.vault.getFiles().filter(f => f.extension === 'md').map(f => f.path);
    }

    getSuggestions(inputStr: string): string[] {
        const inputLower = inputStr.toLowerCase();
        return this.files.filter(file =>
            file.toLowerCase().includes(inputLower)
        );
    }

    renderSuggestion(file: string, el: HTMLElement): void {
        el.createEl("div", { text: file });
    }

    selectSuggestion(file: string): void {
        // @ts-ignore
        this.textInputEl.value = file;
        const event = new Event('input');
        // @ts-ignore
        this.textInputEl.dispatchEvent(event);
        this.close();
    }
}
