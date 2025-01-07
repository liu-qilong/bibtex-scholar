import { App, Editor, SuggestModal,  } from 'obsidian'
import { BibtexDict } from 'src/bibtex'

export class SelectPaper extends SuggestModal<BibtexDict> {
    all_bibtex: BibtexDict[]
    editor: Editor

    constructor(app: App, editor: Editor, bibtex_dict: BibtexDict) {
        super(app)
        this.editor = editor
        this.all_bibtex = Object.values(bibtex_dict)
    }

    // returns all available suggestions
    getSuggestions(query: string): BibtexDict[] {
        return this.all_bibtex.filter((bibtex) =>
            bibtex.fields.id.toLowerCase().includes(query.toLowerCase()) ||
            bibtex.fields.title.toLowerCase().includes(query.toLowerCase()) ||
            bibtex.fields.author.toLowerCase().includes(query.toLowerCase()) ||
            bibtex.fields.tags.toLowerCase().includes(query.toLowerCase())
        )
    }

    // renders each suggestion item
    renderSuggestion(bibtex: BibtexDict, el: HTMLElement) {
        el.createEl('code', { text: bibtex.fields.id, cls: 'bibtex-prompt-id' })
        el.createEl('div', { text: bibtex.fields.title })
        el.createEl('small', { text: bibtex.fields.author })
    }

    // perform action on the selected suggestion
    onChooseSuggestion(bibtex: BibtexDict, evt: MouseEvent | KeyboardEvent) {
        // new Notice(`Selected ${bibtex.fields.id}`)
        this.editor.replaceRange(
            `\`{${bibtex.fields.id}}\``,
            this.editor.getCursor()
        )
    }
}