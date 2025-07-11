import { ItemView, WorkspaceLeaf, Setting, type IconName } from 'obsidian'
import { match_query, type BibtexDict, type BibtexElement } from 'src/bibtex'
import { render_hover } from 'src/hover'
import BibtexScholar from 'src/main'

export const PAPER_PANEL_VIEW_TYPE = 'paper-panel-view'

/**
 * Represents the paper panel view in the Obsidian app.
 */
export class PaperPanelView extends ItemView {
    bibtex_dict: BibtexDict
    plugin: BibtexScholar

    constructor(leaf: WorkspaceLeaf, bibtex_dict: BibtexDict, plugin: BibtexScholar) {
        super(leaf)
        this.bibtex_dict = bibtex_dict
        this.plugin = plugin
    }

    getViewType() {
        return PAPER_PANEL_VIEW_TYPE
    }

    getDisplayText() {
        return 'Paper Panel'
    }

    getIcon(): IconName {
        return 'scan-search'
    }

    async onOpen() {
        const container = this.containerEl.children[1]
        container.empty()

        // query
        const query_div = container.createEl('div', { cls: 'bibtex-panel-query' })
        new Setting(query_div)
            .addSearch((text) => text.onChange(
                (query) => {
                    papers.empty()
                    this.get_papers(query).forEach((id) => {
                        const paper_bar = papers.createEl('span')
                        render_hover(paper_bar, this.bibtex_dict[id], this.plugin, this.app)
                    })
                }
            ))

        // papers
        let papers = container.createEl('div')

        for (const id in this.bibtex_dict) {
            const paper_bar = papers.createEl('span')
            render_hover(paper_bar, this.bibtex_dict[id], this.plugin, this.app)
        }
    }

    async onClose() {

    }

    get_papers(query: string): string[] {
        return Object.values(this.bibtex_dict)
            .filter((bibtex) => match_query(bibtex, query))
            .map((bibtex: BibtexElement) => String(bibtex.fields.id))
    }
}