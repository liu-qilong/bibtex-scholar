import { addIcon, ItemView, Notice, WorkspaceLeaf, SearchComponent, setIcon, type IconName } from 'obsidian'
import type { BibtexDict, BibtexElement, Clash } from 'src/bibtex'
import { normalize_card_font_size, normalize_list_font_size, normalize_panel_chip_font_size, probe_missing_pdf_chunked, type ScanHit } from 'src/cache-ops'
import { CacheOpsModal, CopyExportModal } from 'src/command-modals'
import { render_hover, unmount_hover_hosts } from 'src/hover'
import {
    CLASH_RESULT_CAP,
    compare_by_mention_count,
    DISCOVER_RESULT_CAP,
    filtered_ids,
    list_clashes_for_panel,
    list_ids_for_panel,
    LIST_OVERSCAN,
    list_row_height_px,
    MISSING_PDF_OVERSCAN,
    MISSING_PDF_ROW_HEIGHT,
    PANEL_RESULT_CAP,
    random_sample_ids,
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
    clashes: Clash<ScanHit>[] = []
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

    /** Switches the papers list between discover (random/capped chips) and list (virtualized rows). */
    view_toggle_btn: HTMLElement
    /** The sliding knob inside {@link view_toggle_btn}; carries the current-mode icon. */
    private view_toggle_knob_el: HTMLElement
    /** List-mode sort — session-only, not persisted (unlike the discover/list choice itself). */
    private papers_sort: 'alpha' | 'mentions' = 'alpha'
    /** True once `plugin.ensure_cite_index()` has completed at least once for this panel session. */
    private mentions_index_warm = false
    /** Bumped to cancel an in-flight citation-count index build. */
    private cite_index_build_epoch = 0
    private list_scroll_el: HTMLElement | null = null
    private list_rows_el: HTMLElement | null = null
    private list_ids_view: string[] = []
    /** Live virtual row height (px) — scales with list font so title descenders are not clipped. */
    private list_row_px = list_row_height_px()
    /** Discover mode's scrolling content region — status + chips scroll here; the footer stays pinned below it. */
    private discover_scroll_el: HTMLElement | null = null

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
        container.addClass('bibtex-panel-root')

        const query_div = container.createEl('div', { cls: 'bibtex-panel-query' })
        const query_row = query_div.createEl('div', { cls: 'bibtex-panel-query-row' })

        // Toggle comes first — it's the primary "what am I looking at" choice,
        // search is secondary to it.
        this.view_toggle_btn = query_row.createEl('button', {
            cls: 'bibtex-panel-view-toggle',
            attr: { role: 'switch' },
        })
        this.view_toggle_knob_el = this.view_toggle_btn.createEl('span', {
            cls: 'bibtex-panel-view-toggle-knob',
        })
        this.update_view_toggle_button()
        this.view_toggle_btn.addEventListener('click', () => this.on_view_toggle_click())

        const search_wrap = query_row.createEl('div', { cls: 'bibtex-panel-search' })
        new SearchComponent(search_wrap).onChange((query) => {
            if (this.mode !== 'papers') return
            this.show_papers(query)
        })

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

        this.list_el = container.createEl('div', { cls: 'bibtex-panel-list' })

        // Corner actions pull the command-palette-only cache/export commands into
        // the panel itself — floats over the list so it's reachable in any view mode.
        const corner_actions = container.createEl('div', { cls: 'bibtex-panel-corner-actions' })

        const cache_ops_btn = corner_actions.createEl('button', {
            cls: 'bibtex-panel-corner-btn',
            attr: { 'aria-label': 'Manage BibTeX cache', title: 'Manage BibTeX cache' },
        })
        setIcon(cache_ops_btn, 'save')
        cache_ops_btn.addEventListener('click', () => new CacheOpsModal(this.app, this.plugin).open())

        const copy_export_btn = corner_actions.createEl('button', {
            cls: 'bibtex-panel-corner-btn',
            attr: { 'aria-label': 'Copy / export BibTeX', title: 'Copy / export BibTeX' },
        })
        setIcon(copy_export_btn, 'external-link')
        copy_export_btn.addEventListener('click', () => new CopyExportModal(this.app, this.plugin).open())

        this.show_papers()
    }

    async onClose() {
        this.missing_pdf_probe_epoch++
        this.cite_index_build_epoch++
        if (this.list_el) {
            this.clear_list()
        }
    }

    /** Unmount hover chips before wiping list DOM (avoids leaked chip/registry entries). */
    clear_list() {
        unmount_hover_hosts(this.list_el)
        this.missing_pdf_scroll_el = null
        this.missing_pdf_rows_el = null
        this.list_scroll_el = null
        this.list_rows_el = null
        this.discover_scroll_el = null
        this.list_el.empty()
        // list_el itself becomes a flex pass-through so an inner scroll div can fill
        // remaining panel height while status/footer chrome stays pinned outside it —
        // used by list/missing-pdf mode (virtualized rows) and discover mode (status +
        // chips scroll, the "randomize again" footer stays put); clash content stays
        // normal block flow.
        this.list_el.classList.remove('is-virtual')
    }

    /** Switch active mode and keep both toggle buttons' active state in sync. */
    private set_mode(mode: PanelMode) {
        this.mode = mode
        this.clash_btn.classList.toggle('is-active', mode === 'clash')
        this.missing_pdf_btn?.classList.toggle('is-active', mode === 'missing-pdf')
    }

    private on_view_toggle_click() {
        this.plugin.cache.papers_view = this.plugin.cache.papers_view === 'list' ? 'discover' : 'list'
        void this.plugin.save_cache()
        this.update_view_toggle_button()
        if (this.mode !== 'papers') {
            this.set_mode('papers')
        }
        this.show_papers()
    }

    /**
     * The knob slides along the track and carries the current-mode icon — no
     * accent-color highlight (unlike clash/missing-pdf, discover/list aren't an
     * alert/audit state, just two equally-valid ways to browse the same papers).
     */
    private update_view_toggle_button() {
        const is_list = this.plugin.cache.papers_view === 'list'
        setIcon(this.view_toggle_knob_el, is_list ? 'list' : 'layers')
        const label = is_list ? 'Switch to discover view' : 'Switch to list view'
        this.view_toggle_btn.setAttr('aria-label', label)
        this.view_toggle_btn.setAttr('title', label)
        this.view_toggle_btn.setAttr('aria-checked', String(is_list))
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

    /** Dispatches to whichever papers-list view is active (persisted in plugin cache). */
    show_papers(query: string = '') {
        // Any fresh dispatch (typing, view toggle, back-from-clash/missing-pdf) supersedes
        // an in-flight "Most cited" index build — see on_sort_change's epoch check.
        this.cite_index_build_epoch++
        if (this.plugin.cache.papers_view === 'list') {
            this.show_list(query)
        } else {
            this.show_discover(query)
        }
    }

    /**
     * Discover view: browse, not search. Empty query shows a random capped
     * sample (re-rollable) with clash/missing-PDF coloring; a non-empty
     * query falls back to the same sorted/capped search every other panel
     * list uses — randomness only applies to the browse state.
     */
    show_discover(query: string = '') {
        this.clear_list()
        this.list_el.classList.add('is-virtual')
        const chip_font_px = normalize_panel_chip_font_size(this.plugin.cache.panel_chip_font_size)
        this.list_el.style.setProperty('--bibtex-panel-chip-font-size', `${chip_font_px}px`)
        // Status + chips scroll in here; a re-rollable footer (empty query only)
        // stays pinned below it, outside the scrolling region — same "chrome stays
        // put, content scrolls" treatment list mode's sort footer already uses.
        this.discover_scroll_el = this.list_el.createEl('div', { cls: 'bibtex-panel-discover-scroll' })
        if (query.trim().length === 0) {
            this.render_discover_preview()
            return
        }

        const list = list_ids_for_panel(this.bibtex_dict, query)
        this.render_list_status(list)
        if (list.ids.length === 0) {
            this.discover_scroll_el.createEl('div', { cls: 'bibtex-panel-clash-empty', text: 'No papers match this query.' })
            return
        }
        for (const id of list.ids) {
            const entry = this.bibtex_dict[id]
            if (!entry) continue
            this.render_discover_chip(id, entry)
        }
        this.plugin.perf.panel_rows_mounted = list.ids.length
    }

    /** Random, re-rollable sample of up to {@link DISCOVER_RESULT_CAP} chips — the browse/discover state. */
    private render_discover_preview() {
        const scroll = this.discover_scroll_el!
        const all_ids = Object.keys(this.bibtex_dict)
        if (all_ids.length === 0) {
            scroll.createEl('div', { cls: 'bibtex-panel-clash-empty', text: 'No papers in cache yet.' })
            return
        }

        const sample = random_sample_ids(all_ids, DISCOVER_RESULT_CAP)
        const truncated = all_ids.length > sample.length
        const status_text = truncated
            ? `${all_ids.length} papers — showing a random ${sample.length}.`
            : `${all_ids.length} paper${all_ids.length === 1 ? '' : 's'} in cache.`
        scroll.createEl('div', { cls: 'bibtex-panel-list-status', text: status_text })

        for (const id of sample) {
            const entry = this.bibtex_dict[id]
            if (!entry) continue
            this.render_discover_chip(id, entry)
        }
        this.plugin.perf.panel_rows_mounted = sample.length

        const footer = this.list_el.createEl('div', { cls: 'bibtex-panel-discover-footer' })
        footer.createEl('span', { text: 'Type to search for more, or ' })
        const randomize = footer.createEl('span', {
            cls: 'bibtex-panel-clash-link',
            text: 'randomize again',
        })
        randomize.addEventListener('click', () => this.show_discover(''))
        footer.createEl('span', { text: '.' })
    }

    /** Dense chip, flagged with clash/missing-PDF coloring for discover-mode's "notice things" purpose. */
    private render_discover_chip(id: string, entry: BibtexElement) {
        const paper_bar = this.discover_scroll_el!.createEl('span', { cls: 'bibtex-panel-discover-chip' })
        if (this.plugin.clash_reasons.has(id)) {
            paper_bar.classList.add('is-clashing-chip')
        }
        if (!this.has_pdf(id)) {
            paper_bar.classList.add('is-missing-pdf-chip')
        }
        // Dense chip + shared popup; mount count is bounded by DISCOVER/PANEL_* caps.
        render_hover(paper_bar, entry, this.plugin, this.app, /* expand */ false, /* dense */ true)
    }

    /** Status line under the search box explaining preview / truncation (discover-mode search only). */
    private render_list_status(list: LibraryListResult) {
        const scroll = this.discover_scroll_el!
        if (list.kind === 'empty_preview') {
            if (list.matched === 0) return
            const text = list.truncated
                ? `Showing first ${list.ids.length} of ${list.matched} papers — type to search (max ${PANEL_RESULT_CAP} shown).`
                : `${list.matched} paper${list.matched === 1 ? '' : 's'} in cache.`
            scroll.createEl('div', { cls: 'bibtex-panel-list-status', text })
            return
        }
        if (list.matched === 0) return
        const text = list.truncated
            ? `${list.matched} matches — showing first ${list.ids.length}. Narrow your query.`
            : `${list.matched} match${list.matched === 1 ? '' : 'es'}.`
        scroll.createEl('div', { cls: 'bibtex-panel-list-status', text })
    }

    /**
     * List view: unbounded, virtualized rows (title/id/year/source path,
     * optionally mention count), sortable A–Z or by mention count.
     * Virtualized via {@link visible_window}, same technique as the
     * missing-PDF list — never needs a hard mount cap.
     */
    show_list(query: string = '') {
        this.clear_list()
        this.list_el.classList.add('is-virtual')
        const compare = this.papers_sort === 'mentions' && this.mentions_index_warm
            ? compare_by_mention_count(this.mention_counts())
            : undefined
        const ids = filtered_ids(this.bibtex_dict, query, compare)
        this.render_list_top_status(ids.length, query)

        if (ids.length === 0) {
            const msg = query.trim().length > 0 ? 'No papers match this query.' : 'No papers in cache yet.'
            this.list_el.createEl('div', { cls: 'bibtex-panel-clash-empty', text: msg })
            return
        }

        const font_px = normalize_list_font_size(this.plugin.cache.list_font_size)
        this.list_row_px = list_row_height_px(font_px)
        const scroll = this.list_el.createEl('div', { cls: 'bibtex-panel-list-scroll' })
        scroll.style.fontSize = `${font_px}px`
        const spacer = scroll.createEl('div', { cls: 'bibtex-panel-list-spacer' })
        spacer.style.height = `${ids.length * this.list_row_px}px`
        const rows = scroll.createEl('div', { cls: 'bibtex-panel-list-rows' })

        this.list_scroll_el = scroll
        this.list_rows_el = rows
        this.list_ids_view = ids

        const paint = () => this.paint_list_window()
        scroll.addEventListener('scroll', paint)
        // First paint after layout so clientHeight is meaningful — the window now
        // fills whatever height the panel actually has (see .bibtex-panel-list-scroll),
        // so a taller panel renders (and virtualizes) a taller visible slice.
        requestAnimationFrame(paint)

        // Sort control lives at the bottom, like discover mode's footer — always
        // reachable without scrolling up, and reads as "interactive control" vs.
        // the plain count line at top.
        this.render_list_sort_footer(query)
    }

    /** id -> mention count snapshot for the current dict (cheap: cite_index lookups are O(1) once warm). */
    private mention_counts(): Map<string, number> {
        return new Map(Object.keys(this.bibtex_dict).map((id) => [id, this.plugin.mention_count(id)]))
    }

    private render_list_top_status(count: number, query: string) {
        const status_text = query.trim().length > 0
            ? `${count} match${count === 1 ? '' : 'es'}.`
            : `${count} paper${count === 1 ? '' : 's'} in cache.`
        this.list_el.createEl('div', { cls: 'bibtex-panel-list-status', text: status_text })
    }

    private render_list_sort_footer(query: string) {
        const footer = this.list_el.createEl('div', { cls: 'bibtex-panel-list-sort-footer' })
        footer.createEl('span', { text: 'Sort ' })
        const select = footer.createEl('select')
        select.createEl('option', { value: 'alpha', text: 'A–Z' })
        select.createEl('option', { value: 'mentions', text: 'Most cited' })
        select.value = this.papers_sort
        select.addEventListener('change', () => {
            void this.on_sort_change(select.value === 'mentions' ? 'mentions' : 'alpha', query)
        })
    }

    /**
     * "Most cited" needs `cite_index` warm — build it once (chunked, progress
     * notice) via {@link BibtexScholar.ensure_cite_index}; a no-op if already
     * warm (index self-maintains incrementally after that — see main.ts
     * `on_file_modified`). "A–Z" never needs it.
     */
    private async on_sort_change(sort: 'alpha' | 'mentions', query: string) {
        this.papers_sort = sort
        if (sort === 'alpha' || this.mentions_index_warm) {
            this.show_list(query)
            return
        }

        const epoch = ++this.cite_index_build_epoch
        const status = this.list_el.createEl('div', {
            cls: 'bibtex-panel-list-status',
            text: 'Preparing citation counts…',
        })
        const ok = await this.plugin.ensure_cite_index(
            (done, total) => status.setText(`Preparing citation counts… ${done}/${total}`),
            // Cancel only on leaving papers mode / closing the panel — NOT on the
            // epoch bump `show_papers()` does for every keystroke. Typing further
            // while this one-time build runs should still let it finish in the
            // background (see the epoch check below), not restart it from scratch
            // on the next "Most cited" click.
            () => this.mode !== 'papers',
        )

        if (this.cite_index_build_epoch !== epoch || this.mode !== 'papers') {
            // Superseded by a later action (typed further, closed panel, …) — leave
            // whatever it rendered alone, but still record success on the plugin
            // side so a *future* switch to "Most cited" doesn't redo the scan.
            if (ok) this.mentions_index_warm = true
            return
        }
        if (!ok) {
            new Notice('Citation count scan cancelled.')
            this.papers_sort = 'alpha'
            this.show_list(query)
            return
        }
        this.mentions_index_warm = true
        this.show_list(query)
    }

    private paint_list_window() {
        const scroll = this.list_scroll_el
        const rows_el = this.list_rows_el
        const ids = this.list_ids_view
        if (!scroll || !rows_el || this.mode !== 'papers' || this.plugin.cache.papers_view !== 'list') return

        const row_h = this.list_row_px
        const { start, end } = visible_window(
            scroll.scrollTop,
            scroll.clientHeight || 320,
            row_h,
            ids.length,
            LIST_OVERSCAN,
        )

        // Rows carry a live citekey chip (hover card) — unmount before wiping so a
        // fast scroll doesn't leak chip_registry / citation_popup registrations
        // (list mode repaints its visible window on every scroll tick).
        unmount_hover_hosts(rows_el)
        rows_el.empty()
        rows_el.style.transform = `translateY(${start * row_h}px)`

        for (let i = start; i < end; i++) {
            const id = ids[i]
            const entry = this.bibtex_dict[id]
            if (!entry) continue
            this.add_list_row(rows_el, id, entry, row_h)
        }
        this.plugin.perf.panel_rows_mounted = end - start
    }

    /**
     * Modern-card-style row: title + a real citekey chip (hover for the same
     * card every other citekey in the plugin shows) + year/path/mentions.
     * Click anywhere else in the row opens source — the chip's own click
     * toggles the card instead (stopPropagation, same as any other chip).
     */
    private add_list_row(parent: HTMLElement, id: string, entry: BibtexElement, row_h: number = this.list_row_px) {
        const row = parent.createEl('div', { cls: 'bibtex-panel-list-row' })
        row.style.height = `${row_h}px`
        row.addEventListener('click', () => this.plugin.open_line(String(entry.source_path), entry.source_line ?? 0))

        row.createEl('div', { cls: 'bibtex-panel-list-title', text: entry.fields.title || id })

        const meta = row.createEl('div', { cls: 'bibtex-panel-list-meta' })
        const chip_host = meta.createEl('span', { cls: 'bibtex-panel-list-chip' })
        // dense=true: same scroll-dismiss-not-chase + double-debounce policy as
        // every other chip living in this scrollable panel list.
        render_hover(chip_host, entry, this.plugin, this.app, /* expand */ false, /* dense */ true)

        const rest_parts = [entry.fields.year, String(entry.source_path)].filter((p): p is string => Boolean(p))
        if (this.papers_sort === 'mentions' && this.mentions_index_warm) {
            const n = this.plugin.mention_count(id)
            rest_parts.push(`${n} cite${n === 1 ? '' : 's'}`)
        }
        if (rest_parts.length > 0) {
            // No leading " · " — flex gap on .bibtex-panel-list-meta separates chip from meta.
            meta.createEl('span', { cls: 'bibtex-panel-list-meta-rest', text: rest_parts.join(' · ') })
        }
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

    /**
     * `hit` carries its own parsed `fields` from the scan that found it
     * (`ScanHit`, not the slim `ClashHit`) — so the chip/card built from it
     * shows this occurrence's own independent content, not whichever entry
     * happened to win the citekey in `plugin.cache.bibtex_dict`. No extra
     * read or parse on hover: the fields were already captured mid-scan.
     */
    add_member_row(parent: HTMLElement, hit: ScanHit, n: number) {
        const row = parent.createEl('div', { cls: 'bibtex-panel-clash-member' })
        row.createEl('span', { cls: 'bibtex-panel-clash-num', text: `[${n}] ` })

        const key_host = row.createEl('span')
        const entry: BibtexElement = {
            fields: hit.fields,
            source_path: hit.path,
            source_line: hit.line,
        }
        // dense=true: this chip lives in the same scrollable panel list as
        // discover mode's chips, so it gets the same scroll-dismiss-not-chase
        // card behavior (see ChipRecord.dense in src/hover.tsx).
        render_hover(key_host, entry, this.plugin, this.app, /* expand */ false, /* dense */ true)

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
        this.list_el.classList.add('is-virtual')
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
