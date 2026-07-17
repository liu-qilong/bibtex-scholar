import { ItemView, WorkspaceLeaf, Setting, setIcon, type IconName } from 'obsidian'
import { match_query, type BibtexDict, type BibtexElement, type Clash, type ClashHit } from 'src/bibtex'
import { render_hover } from 'src/hover'
import BibtexScholar from 'src/main'

export const PAPER_PANEL_VIEW_TYPE = 'paper-panel-view'

/**
 * Represents the paper panel view in the Obsidian app.
 */
export class PaperPanelView extends ItemView {
    bibtex_dict: BibtexDict
    plugin: BibtexScholar
    clash_mode = false
    clashes: Clash[] = []
    list_el: HTMLElement
    clash_btn: HTMLElement

    constructor(leaf: WorkspaceLeaf, bibtex_dict: BibtexDict, plugin: BibtexScholar) {
        super(leaf)
        this.bibtex_dict = bibtex_dict
        this.plugin = plugin
    }

    getViewType() {
        return PAPER_PANEL_VIEW_TYPE
    }

    getDisplayText() {
        return 'Paper panel'
    }

    getIcon(): IconName {
        return 'scan-search'
    }

    async onOpen() {
        const container = this.containerEl.children[1]
        container.empty()

        const query_div = container.createEl('div', { cls: 'bibtex-panel-query' })
        const query_row = query_div.createEl('div', { cls: 'bibtex-panel-query-row' })

        const search_wrap = query_row.createEl('div', { cls: 'bibtex-panel-search' })
        new Setting(search_wrap)
            .addSearch((text) => text.onChange((query) => {
                if (this.clash_mode) return
                this.list_el.empty()
                this.get_papers(query).forEach((id) => {
                    const paper_bar = this.list_el.createEl('span')
                    render_hover(paper_bar, this.bibtex_dict[id], this.plugin, this.app)
                })
            }))

        this.clash_btn = query_row.createEl('button', {
            cls: 'bibtex-panel-clash-btn',
            attr: {
                'aria-label': 'Recache and collect collisions',
                title: 'Recache and collect collisions',
            },
        })
        setIcon(this.clash_btn, 'git-compare')
        this.clash_btn.addEventListener('click', () => this.on_clash_click())

        this.list_el = container.createEl('div')
        this.show_papers()
    }

    async onClose() {

    }

    async on_clash_click() {
        if (this.clash_mode) {
            this.clash_mode = false
            this.clash_btn.classList.remove('is-active')
            this.show_papers()
            return
        }

        if (!window.confirm('Are you sure you want to recreate the BibTeX cache from the vault?')) {
            return
        }

        this.clash_btn.setAttr('disabled', 'true')
        try {
            this.clashes = await this.plugin.rescan_vault()
            this.bibtex_dict = this.plugin.cache.bibtex_dict
            this.clash_mode = true
            this.clash_btn.classList.add('is-active')
            this.show_clashes()
        } finally {
            this.clash_btn.removeAttribute('disabled')
        }
    }

    show_papers() {
        this.list_el.empty()
        for (const id in this.bibtex_dict) {
            const paper_bar = this.list_el.createEl('span')
            render_hover(paper_bar, this.bibtex_dict[id], this.plugin, this.app)
        }
    }

    show_clashes() {
        this.list_el.empty()
        if (this.clashes.length === 0) {
            this.list_el.createEl('div', { cls: 'bibtex-panel-clash-empty', text: 'No clashes found.' })
            return
        }

        for (const clash of this.clashes) {
            const card = this.list_el.createEl('div', { cls: 'bibtex-panel-clash-card' })
            card.createEl('div', {
                cls: 'bibtex-panel-clash-reason',
                text: clash.reasons.join(' · '),
            })
            clash.members.forEach((hit, i) => this.add_member_row(card, hit, i + 1))
        }
    }

    add_member_row(parent: HTMLElement, hit: ClashHit, n: number) {
        const row = parent.createEl('div', { cls: 'bibtex-panel-clash-member' })
        row.createEl('span', { cls: 'bibtex-panel-clash-num', text: `[${n}] ` })

        const key = row.createEl('span', { cls: 'bibtex-panel-clash-link', text: `'${hit.id}'` })
        key.addEventListener('click', () => this.plugin.open_line(hit.path, hit.line))

        row.createEl('span', { text: ' ' })

        const path = row.createEl('span', { cls: 'bibtex-panel-clash-link is-path', text: `[${hit.path}]` })
        path.addEventListener('click', () => this.plugin.open_line(hit.path, hit.line))
    }

    get_papers(query: string): string[] {
        return Object.values(this.bibtex_dict)
            .filter((bibtex) => match_query(bibtex, query))
            .map((bibtex: BibtexElement) => String(bibtex.fields.id))
    }
}
