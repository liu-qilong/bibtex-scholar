import { App, Editor, AbstractInputSuggest, SuggestModal, EditorSuggest, TFile, type EditorPosition, type EditorSuggestContext, type EditorSuggestTriggerInfo } from 'obsidian'
import { BibtexElement, match_query, type BibtexDict } from 'src/bibtex'

/**
 * An editor prompt to suggest BibTeX entries. Triggered by:
 * * Type ` and { for collapsed paper element
 * * Type ` and [ for expanded paper element
 * P.S. Since Obsidian auto-completes ``, we are actually matching `{<cursor>` or `[<cursor>`
 */
export class EditorPrompt extends EditorSuggest<string> {
    bibtex_dict: BibtexDict
    editor: Editor
    bracket_start: string
    bracket_end: string
    code_end: string
    trigger_info: EditorSuggestTriggerInfo

    constructor(app: App, bibtex_dict: BibtexDict) {
        super(app)
        this.bibtex_dict = bibtex_dict
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
        // determine if this EditorSuggest should be triggered
        this.editor = editor
        const line = editor.getLine(cursor.line)
        const regex = /(`)([{\[])([^}\]`\ ]*)([}\]]?)(`?)/g
        let match
        
        while ((match = regex.exec(line)) !== null) {
            // example: match = ('`{test}`', '`', '{', 'test', '}', '`')
            // console.log(match)
            const query = match[3]
            const content_start = match.index + 2 // position after `{` or `[`
            const content_end = content_start + query.length
            
            // Check if cursor is within the content area
            // if (cursor.ch >= content_start && cursor.ch == content_end) {
            if (cursor.ch == content_end) {
                this.bracket_start = match[2]
                this.bracket_end = match[4]
                this.code_end = match[5]

                if (this.bracket_end && !this.code_end) {
                    // rule out the case like `{test}, where proper insertion is not achievable
                    continue
                }

                this.trigger_info = {
                    start: { line: cursor.line, ch: content_start },
                    end: { line: cursor.line, ch: content_end },
                    query: query,
                }
                return this.trigger_info
            }
        }

        return null
    }

    getSuggestions(context: EditorSuggestContext): string[] {
        // generate suggestion items based on the context
        const query = context.query
        return Object.values(this.bibtex_dict)
            .filter((bibtex) => match_query(bibtex, query))
            .map((bibtex: BibtexElement) => String(bibtex.fields.id))
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
            str += (this.bracket_start === '{')?('}'):(']')
        }
        if (this.code_end === '') {
            str += '`'
        }

        this.editor.replaceRange(
            str,
            this.trigger_info.start,
            this.trigger_info.end,
        )
        this.editor.setCursor(
            this.trigger_info.start.line,
            this.trigger_info.start.ch + bibtex.fields.id.length + 2,
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