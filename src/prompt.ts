import { App, Editor, SuggestModal, EditorSuggest, TFile, type EditorPosition, type EditorSuggestContext, type EditorSuggestTriggerInfo } from 'obsidian'
import { match_query, type BibtexDict } from 'src/bibtex'

export class ModalPrompt extends SuggestModal<BibtexDict> {
    all_bibtex: BibtexDict[]
    editor: Editor

    constructor(app: App, editor: Editor, bibtex_dict: BibtexDict) {
        super(app)
        this.editor = editor
        this.all_bibtex = Object.values(bibtex_dict)
    }

    // returns all available suggestions
    getSuggestions(query: string): BibtexDict[] {
        return this.all_bibtex.filter((bibtex) => match_query(bibtex, query))
    }

    // renders each suggestion item
    renderSuggestion(bibtex: BibtexDict, el: HTMLElement) {
        el.createEl('code', { text: bibtex.fields.id, cls: 'bibtex-prompt-id' })
        el.createEl('div', { text: bibtex.fields.title, cls: 'bibtex-prompt-title' })
        el.createEl('small', { text: bibtex.fields.author, cls: 'bibtex-prompt-author' })
    }

    // perform action on the selected suggestion
    onChooseSuggestion(bibtex: BibtexDict, evt: MouseEvent | KeyboardEvent) {
        this.editor.replaceRange(
            `\`{${bibtex.fields.id}}\``,
            this.editor.getCursor()
        )
    }
}

export class EditorPrompt extends EditorSuggest<string> {
    bibtex_dict: BibtexDict
    editor: Editor
    match_start: string
    trigger_info: EditorSuggestTriggerInfo

    constructor(app: App, bibtex_dict: BibtexDict) {
        super(app)
        this.bibtex_dict = bibtex_dict
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
        // determine if this EditorSuggest should be triggered
        this.editor = editor
        const line = editor.getLine(cursor.line)
        const match = line.match(/`[{\[]([^}]*)`/)

        if (match) {
            const query = match[1]
            this.match_start = match[0][1]
            this.trigger_info = {
                start: { line: cursor.line, ch: cursor.ch - query.length },
                end: cursor,
                query: query,
            }
            return this.trigger_info
        }

        return null
    }

    getSuggestions(context: EditorSuggestContext): string[] {
        // generate suggestion items based on the context
        const query = context.query
        return Object.values(this.bibtex_dict)
            .filter((bibtex) => match_query(bibtex, query))
            .map((bibtex: BibtexDict) => String(bibtex.fields.id))
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
        this.editor.replaceRange(
            `${bibtex.fields.id}${(this.match_start === '{')?('}'):(']')}`,
            this.trigger_info.start,
            this.trigger_info.end,
        )
        this.editor.setCursor(
            this.trigger_info.start.line,
            this.trigger_info.start.ch + bibtex.fields.id.length + 2,
        )
    }
}