import { addIcon, ItemView, WorkspaceLeaf, Setting, setIcon, type IconName } from 'obsidian'
import type { BibtexDict, BibtexElement, Clash, ClashHit } from 'src/bibtex'
import { normalize_card_font_size, probe_missing_pdf_chunked } from 'src/cache-ops'
import { render_hover, unmount_hover_hosts } from 'src/hover'
import {
    CLASH_RESULT_CAP,
    list_clashes_for_panel,
    list_ids_for_panel,
    MISSING_PDF_OVERSCAN,
    MISSING_PDF_ROW_HEIGHT,
    PANEL_RESULT_CAP,
    visible_window,
    type LibraryListResult,
} from 'src/library-scale'
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
    /**
     * Last missing-PDF probe result (SPEED S7). Recheck / entry-count change invalidates.
     * Avoids re-probing 10k entries every time the toggle flips.
     */
    private missing_pdf_cache: { ids: string[]; entry_count: number } | null = null
    /** Bumped to cancel an in-flight missing-PDF probe. */
    private missing_pdf_probe_epoch = 0
    private missing_pdf_scroll_el: HTMLElement | null = null
    private missing_pdf_rows_el: HTMLElement | null = null
    private missing_pdf_ids_view: string[] = []

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
                this.show_papers(query)
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
        this.missing_pdf_probe_epoch++
        if (this.list_el) {
            this.clear_list()
        }
    }

    /** Unmount React hover hosts before wiping list DOM (avoids leaked roots). */
    clear_list() {
        unmount_hover_hosts(this.list_el)
        this.missing_pdf_scroll_el = null
        this.missing_pdf_rows_el = null
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
            // Hard reset so collision harvest re-reads every file (full hit list).
            const clashes = await this.plugin.rescan_vault({ hard: true })
            if (clashes == null) {
                // Cancelled (unload / newer rescan) — leave panel mode alone.
                return
            }
            this.clashes = clashes
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
        void this.show_missing_pdf(false)
    }

    /**
     * List papers with a hard mount cap. Empty query shows a short sorted preview
     * (not the whole library). Search results cap at {@link PANEL_RESULT_CAP}.
     */
    show_papers(query: string = '') {
        this.clear_list()
        const list = list_ids_for_panel(this.bibtex_dict, query)
        this.render_list_status(list)

        if (list.ids.length === 0) {
            const empty_msg = list.kind === 'search'
                ? 'No papers match this query.'
                : 'No papers in cache yet.'
            this.list_el.createEl('div', { cls: 'bibtex-panel-clash-empty', text: empty_msg })
            return
        }

        for (const id of list.ids) {
            const entry = this.bibtex_dict[id]
            if (!entry) continue
            const paper_bar = this.list_el.createEl('span')
            // Dense chip + shared popup; mount count is bounded by PANEL_* caps.
            render_hover(paper_bar, entry, this.plugin, this.app, /* expand */ false, /* dense */ true)
        }
        this.plugin.perf.panel_rows_mounted = list.ids.length
    }

    /** Status line under the search box explaining preview / truncation. */
    private render_list_status(list: LibraryListResult) {
        if (list.kind === 'empty_preview') {
            if (list.matched === 0) return
            const text = list.truncated
                ? `Showing first ${list.ids.length} of ${list.matched} papers — type to search (max ${PANEL_RESULT_CAP} shown).`
                : `${list.matched} paper${list.matched === 1 ? '' : 's'} in cache.`
            this.list_el.createEl('div', { cls: 'bibtex-panel-list-status', text })
            return
        }
        if (list.matched === 0) return
        const text = list.truncated
            ? `${list.matched} matches — showing first ${list.ids.length}. Narrow your query.`
            : `${list.matched} match${list.matched === 1 ? '' : 'es'}.`
        this.list_el.createEl('div', { cls: 'bibtex-panel-list-status', text })
    }

    /** List clashes with a hard mount cap, same policy as {@link show_papers}. */
    show_clashes() {
        this.clear_list()
        if (this.clashes.length === 0) {
            this.list_el.createEl('div', { cls: 'bibtex-panel-clash-empty', text: 'No clashes found.' })
            return
        }

        const list = list_clashes_for_panel(this.clashes)
        if (list.truncated) {
            this.list_el.createEl('div', {
                cls: 'bibtex-panel-list-status',
                text: `${list.matched} clashes — showing first ${list.clashes.length} (max ${CLASH_RESULT_CAP} shown).`,
            })
        }

        for (const clash of list.clashes) {
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

    /** Drop cached missing-PDF ids. */
    invalidate_missing_pdf_cache() {
        this.missing_pdf_cache = null
    }

    /**
     * Missing-PDF worklist (SPEED S7):
     * - chunked probes so 10k libraries don't freeze the UI
     * - optional cache (re-open toggle reuses last probe; Recheck forces new)
     * - virtualized rows via {@link visible_window} (only viewport DOM)
     */
    async show_missing_pdf(force_recheck = false) {
        this.clear_list()
        const font_px = normalize_card_font_size(this.plugin.cache.card_font_size)
        const entry_count = Object.keys(this.bibtex_dict).length
        const cache_ok =
            !force_recheck
            && this.missing_pdf_cache != null
            && this.missing_pdf_cache.entry_count === entry_count

        if (cache_ok && this.missing_pdf_cache) {
            this.render_missing_pdf_shell(this.missing_pdf_cache.ids, font_px, /* from_cache */ true)
            return
        }

        const status = this.list_el.createEl('div', {
            cls: 'bibtex-panel-list-status',
            text: 'Checking PDFs…',
        })
        const epoch = ++this.missing_pdf_probe_epoch
        const ids = Object.keys(this.bibtex_dict)
        const result = await probe_missing_pdf_chunked({
            ids,
            has_pdf: (id) => this.has_pdf(id),
            should_cancel: () => this.missing_pdf_probe_epoch !== epoch || this.mode !== 'missing-pdf',
            on_progress: (done, total) => {
                status.setText(`Checking PDFs… ${done}/${total}`)
            },
        })

        if (this.missing_pdf_probe_epoch !== epoch || this.mode !== 'missing-pdf') {
            return
        }

        if (result.cancelled) {
            status.setText('PDF check cancelled.')
            return
        }

        this.missing_pdf_cache = { ids: result.missing, entry_count }
        this.clear_list()
        this.render_missing_pdf_shell(result.missing, font_px, /* from_cache */ false)
    }

    private render_missing_pdf_shell(ids: string[], font_px: number, from_cache: boolean) {
        const toolbar = this.list_el.createEl('div', { cls: 'bibtex-panel-missing-pdf-toolbar' })
        const status_text = ids.length === 0
            ? 'No references are missing a PDF.'
            : `${ids.length} missing PDF${ids.length === 1 ? '' : 's'}${from_cache ? ' (cached)' : ''}.`
        toolbar.createEl('div', { cls: 'bibtex-panel-list-status', text: status_text })

        const recheck = toolbar.createEl('button', {
            cls: 'bibtex-panel-missing-pdf-recheck',
            text: 'Recheck',
            attr: { type: 'button', title: 'Probe the library again for missing PDFs' },
        })
        recheck.addEventListener('click', () => {
            this.invalidate_missing_pdf_cache()
            void this.show_missing_pdf(true)
        })

        if (ids.length === 0) {
            return
        }

        const scroll = this.list_el.createEl('div', { cls: 'bibtex-panel-missing-pdf-scroll' })
        scroll.style.fontSize = `${font_px}px`
        const spacer = scroll.createEl('div', { cls: 'bibtex-panel-missing-pdf-spacer' })
        spacer.style.height = `${ids.length * MISSING_PDF_ROW_HEIGHT}px`
        const rows = scroll.createEl('div', { cls: 'bibtex-panel-missing-pdf-rows' })

        this.missing_pdf_scroll_el = scroll
        this.missing_pdf_rows_el = rows
        this.missing_pdf_ids_view = ids

        const paint = () => this.paint_missing_pdf_window()
        scroll.addEventListener('scroll', paint)
        // First paint after layout so clientHeight is meaningful.
        requestAnimationFrame(paint)
    }

    private paint_missing_pdf_window() {
        const scroll = this.missing_pdf_scroll_el
        const rows_el = this.missing_pdf_rows_el
        const ids = this.missing_pdf_ids_view
        if (!scroll || !rows_el || this.mode !== 'missing-pdf') return

        const { start, end } = visible_window(
            scroll.scrollTop,
            scroll.clientHeight || 320,
            MISSING_PDF_ROW_HEIGHT,
            ids.length,
            MISSING_PDF_OVERSCAN,
        )

        rows_el.empty()
        rows_el.style.transform = `translateY(${start * MISSING_PDF_ROW_HEIGHT}px)`

        for (let i = start; i < end; i++) {
            const id = ids[i]
            const entry = this.bibtex_dict[id]
            if (!entry) continue
            this.add_missing_pdf_row(rows_el, entry, i + 1)
        }
    }

    add_missing_pdf_row(parent: HTMLElement, bibtex: BibtexElement, n: number) {
        const row = parent.createEl('div', { cls: 'bibtex-panel-clash-member bibtex-panel-missing-pdf-row' })
        row.style.height = `${MISSING_PDF_ROW_HEIGHT}px`
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

    /** @deprecated Prefer {@link list_ids_for_panel}; kept for any external callers. */
    get_papers(query: string): string[] {
        return list_ids_for_panel(this.bibtex_dict, query).ids
    }
}
