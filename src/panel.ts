import { addIcon, ItemView, WorkspaceLeaf, Setting, setIcon, type IconName } from 'obsidian'
import { match_query, type BibtexDict, type BibtexElement, type Clash, type ClashHit } from 'src/bibtex'
import { missing_pdf_ids, normalize_card_font_size } from 'src/cache-ops'
import { render_hover, unmount_hover_hosts } from 'src/hover'
import type BibtexScholar from 'src/main'

export const PAPER_PANEL_VIEW_TYPE = 'paper-panel-view'

/** Custom "crossed-out document" icon for the missing-PDF panel toggle (Obsidian icons use a 100x100 grid). */
const MISSING_PDF_ICON_ID = 'bibtex-missing-pdf'
addIcon(
	MISSING_PDF_ICON_ID,
	`<path d="M30 8 L62 8 L84 30 L84 92 L30 92 Z" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
	<path d="M62 8 L62 30 L84 30" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
	<path d="M16 84 L96 16" stroke="currentColor" stroke-width="9" stroke-linecap="round"/>`,
)

/** A view mode swaps what the panel's list shows; only one is active at a time. */
type PanelMode = 'papers' | 'clash' | 'missing-pdf'

/**
 * Represents the paper panel view in the Obsidian app.
 */
export class PaperPanelView extends ItemView {
    plugin: BibtexScholar
    mode: PanelMode = 'papers'
    clashes: Clash[] = []
    list_el: HTMLElement
    clash_btn: HTMLElement
    /** Only created when Settings → "Missing PDF panel" is enabled. */
    missing_pdf_btn: HTMLElement | null = null

    constructor(leaf: WorkspaceLeaf, plugin: BibtexScholar) {
        super(leaf)
        this.plugin = plugin
    }

    /** Always read the live plugin dict (rescan/uncache must be visible). */
    private get bibtex_dict(): BibtexDict {
        return this.plugin.cache.bibtex_dict
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
                if (this.mode !== 'papers') return
                this.clear_list()
                this.get_papers(query).forEach((id) => {
                    const paper_bar = this.list_el.createEl('span')
                    render_hover(paper_bar, this.bibtex_dict[id], this.plugin, this.app, /* expand */ false, /* dense */ true)
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

        if (this.plugin.cache.missing_pdf_enabled) {
            this.missing_pdf_btn = query_row.createEl('button', {
                cls: 'bibtex-panel-missing-pdf-btn',
                attr: {
                    'aria-label': 'Show references missing a PDF',
                    title: 'Show references missing a PDF',
                },
            })
            setIcon(this.missing_pdf_btn, MISSING_PDF_ICON_ID)
            this.missing_pdf_btn.addEventListener('click', () => this.on_missing_pdf_click())
        }

        this.list_el = container.createEl('div')
        this.show_papers()
    }

    async onClose() {
        if (this.list_el) {
            this.clear_list()
        }
    }

    /** Unmount React hover hosts before wiping list DOM (avoids leaked roots). */
    clear_list() {
        unmount_hover_hosts(this.list_el)
        this.list_el.empty()
    }

    /** Switch active mode and keep both toggle buttons' active state in sync. */
    private set_mode(mode: PanelMode) {
        this.mode = mode
        this.clash_btn.classList.toggle('is-active', mode === 'clash')
        this.missing_pdf_btn?.classList.toggle('is-active', mode === 'missing-pdf')
    }

    async on_clash_click() {
        if (this.mode === 'clash') {
            this.set_mode('papers')
            this.show_papers()
            return
        }

        if (!window.confirm('Are you sure you want to recreate the BibTeX cache from the vault?')) {
            return
        }

        this.clash_btn.setAttr('disabled', 'true')
        try {
            this.clashes = await this.plugin.rescan_vault()
            this.set_mode('clash')
            this.show_clashes()
        } finally {
            this.clash_btn.removeAttribute('disabled')
        }
    }

    on_missing_pdf_click() {
        if (this.mode === 'missing-pdf') {
            this.set_mode('papers')
            this.show_papers()
            return
        }
        this.set_mode('missing-pdf')
        this.show_missing_pdf()
    }

    show_papers() {
        this.clear_list()
        for (const id in this.bibtex_dict) {
            const paper_bar = this.list_el.createEl('span')
            render_hover(paper_bar, this.bibtex_dict[id], this.plugin, this.app, /* expand */ false, /* dense */ true)
        }
    }

    show_clashes() {
        this.clear_list()
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

    /** Same "have a PDF?" check as {@link LinkedFileButton} in src/hover.tsx. */
    private has_pdf(id: string): boolean {
        const fname = `${id}.pdf`
        return Boolean(this.app.metadataCache.getFirstLinkpathDest(fname, ''))
    }

    /**
     * Missing-PDF worklist — mirrors the clash list's row layout (num, clickable
     * id/title jumping to source), but as a flat list rather than clash groups.
     * Font size follows the citation-card font-size setting, per the panel's
     * own toggle for this feature.
     */
    show_missing_pdf() {
        this.clear_list()
        const wrap = this.list_el.createEl('div', { cls: 'bibtex-panel-missing-pdf-list' })
        wrap.style.fontSize = `${normalize_card_font_size(this.plugin.cache.card_font_size)}px`

        const ids = missing_pdf_ids(this.bibtex_dict, (id) => this.has_pdf(id))
        if (ids.length === 0) {
            wrap.createEl('div', { cls: 'bibtex-panel-clash-empty', text: 'No references are missing a PDF.' })
            return
        }

        ids.forEach((id, i) => this.add_missing_pdf_row(wrap, this.bibtex_dict[id], i + 1))
    }

    add_missing_pdf_row(parent: HTMLElement, bibtex: BibtexElement, n: number) {
        const row = parent.createEl('div', { cls: 'bibtex-panel-clash-member' })
        row.createEl('span', { cls: 'bibtex-panel-clash-num', text: `[${n}] ` })

        const key = row.createEl('span', { cls: 'bibtex-panel-clash-link', text: `'${bibtex.fields.id}'` })
        key.addEventListener('click', () => this.plugin.open_line(String(bibtex.source_path), 0))

        row.createEl('span', { text: ' ' })

        const title = row.createEl('span', {
            cls: 'bibtex-panel-clash-link is-path',
            text: `[${bibtex.fields.title || bibtex.source_path}]`,
            attr: { title: String(bibtex.source_path) },
        })
        title.addEventListener('click', () => this.plugin.open_line(String(bibtex.source_path), 0))
    }

    get_papers(query: string): string[] {
        return Object.values(this.bibtex_dict)
            .filter((bibtex) => match_query(bibtex, query))
            .map((bibtex: BibtexElement) => String(bibtex.fields.id))
    }
}
