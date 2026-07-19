import { App, Component, MarkdownRenderer, Notice, Modal, MarkdownRenderChild } from 'obsidian'
import { useEffect, useLayoutEffect, useRef, useState, StrictMode, type MouseEvent as ReactMouseEvent } from "react"
import { createPortal } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { WidgetType } from '@codemirror/view'

import { type BibtexElement, make_bibtex, mentions_search_query } from 'src/bibtex'
import { normalize_card_font_size } from 'src/cache-ops'
import { compute_card_placement, compute_card_position } from 'src/citation-card-layout'
import { citation_popup, create_citation_popup_id, OPEN_DEBOUNCE_MS } from 'src/citation-popup'
import type BibtexScholar from 'src/main'

/**
 * Place a fixed-position card near an anchor chip (prefer below; flip above
 * when there is more room; clamp to the viewport).
 *
 * `is-flipped` (see styles.css) only ever moves the scrollable field list
 * (title/abstract/etc, "the contents") to whichever end is farthest from the
 * chip — it never reorders header vs. action toolbar. Title → info tokens →
 * action buttons stays the reading order in both placements; only the
 * distance between that cluster and the chip changes.
 */
function position_floating_card(anchor: HTMLElement, card: HTMLElement) {
    const ar = anchor.getBoundingClientRect()
    const cr = card.getBoundingClientRect()
    const viewport = { width: window.innerWidth, height: window.innerHeight }

    const placement = compute_card_placement(ar, cr, viewport)
    const { top, left } = compute_card_position(ar, cr, viewport, placement)

    card.style.top = `${top}px`
    card.style.left = `${left}px`
    card.classList.toggle('is-flipped', placement === 'above')
}

/** Workspace chrome root for portaled citation cards (Phase 0 / 2). */
function citation_portal_root(app: App): HTMLElement {
    return app.workspace.containerEl
}

/**
 * Copy the given text to the clipboard.
 * @param text - The text to copy.
 */
export const copy_to_clipboard = (text: any) => {
    navigator.clipboard.writeText(text).then(() => {
        new Notice('Copied to clipboard')
    }).catch(err => {
        console.error('Failed to copy text: ', err)
    })
}

/**
 * Modal for uploading a PDF file.
 */
class UploadPdfModal extends Modal {
    folder: string
    fname: string

    /**
     * Constructor
     * @param {App} app - The Obsidian app instance
     * @param {string} folder - The folder to place the PDF file
     * @param {string} fname - The name of the PDF file
     */
    constructor(app: App, folder: string = 'paper/pdf', fname: string = 'paper.pdf') {
        super(app)
        this.folder = folder
        this.fname = fname
    }

    onOpen() {
        const { contentEl } = this
        contentEl.createEl('h4', { text: 'Upload PDF' })

        const file_input = contentEl.createEl('input', { type: 'file' })
        file_input.addEventListener('change', (event: Event) => {
            const target = event.target as HTMLInputElement
            if (target.files && target.files.length > 0) {
                const file = target.files[0]
                this.handle_file_upload(file)
            }
        })
    }

    handle_file_upload(file: File) {
        // read the file as an ArrayBuffer
        const reader = new FileReader()
        reader.onload = async (event) => {
            const { result } = event.target as FileReader
            const data = result as ArrayBuffer
            const file_path = `${this.folder}/${this.fname}`

            // ensure the folder exists
            if (!await this.app.vault.getFolderByPath(this.folder)) {
                await this.app.vault.createFolder(this.folder)
            }

            // save the file to the vault
            await this.app.vault.createBinary(file_path, data)
            await this.app.workspace.openLinkText(this.fname, this.fname, true)
        }
        reader.readAsArrayBuffer(file)

        this.close()
    }
}

/**
 * Renders a button that links to or creates a file within an Obsidian vault.
 * - If the file exists, hovering triggers a preview and clicking opens the file.
 * - If the file does not exist:
 *   - For PDFs, opens an upload modal.
 *   - For Markdown files, ensures the folder exists, creates a new file with a frontmatter template, and opens it.
 * @param label - The text to display on the button.
 * @param fname - The name of the file (without path).
 * @param folder - The folder where the file should be located or created.
 * @param app - The Obsidian App instance for interacting with the vault and workspace.
 */
const LinkedFileButton = ({ label, fname, folder, app, plugin }: { label: string, fname: string, folder: string, app: App, plugin: BibtexScholar }) => {
    const exist = app.metadataCache.getFirstLinkpathDest(fname, '')
    const cls = (exist) ? ('bibtex-file-exist') : ('bibtex-file-not-exist')

    return (
        <a
            className={cls}
            onMouseOver={(event) => {
                app.workspace.trigger("hover-link", {
                    event,
                    source: "preview",
                    hoverParent: { hoverPopover: null },
                    targetEl: event.currentTarget,
                    linktext: fname,
                    sourcePath: fname,
                })
            }}
            onClick={async (event) => {
                if (exist) {
                    app.workspace.openLinkText(fname, fname, true)
                } else {
                    if (fname.endsWith('.pdf')) {
                        new UploadPdfModal(app, folder, fname).open()
                    } else if (fname.endsWith('.md')) {
                        // ensure the folder exists
                        if (!await app.vault.getFolderByPath(folder)) {
                            await app.vault.createFolder(folder)
                        }

                        // load custom template if provided
                        let content = ''
                        const template_path = plugin.cache.template_path

                        if (template_path != '/' && await app.vault.adapter.exists(template_path)) {
                            // if template found, load it
                            try {
                                content = await app.vault.adapter.read(template_path)
                            } catch (e) {
                                console.error('Failed to read custom template:', e)
                                new Notice('Failed to load custom template, using default.')
                            }
                        } else {
                            // if no template found, use default
                            content = `---\naliases:\n  - \n---\n\`[${fname.replace('.md', '')}]\`\n\n---\n\n`
                        }

                        // create the file with the content
                        // if Templater plugin is enable, it will be trigged to automatically fill the template,
                        // supposed that the "Trigger Templater on new file creation" setting is enabled in the Templater plugin settings
                        await app.vault.create(`${folder}/${fname}`, content)
                        await app.workspace.openLinkText(fname, fname, true)
                    }
                }
            }}
        >
            <button>{label}</button>
        </a>
    )
}

/** Prefer common bibliographic fields first in the card body. */
const FIELD_ORDER = [
    'title', 'author', 'year', 'journal', 'booktitle', 'volume', 'number',
    'pages', 'publisher', 'doi', 'url', 'abstract', 'keywords',
]

function ordered_field_entries(fields: BibtexElement['fields']): [string, string][] {
    const keys = Object.keys(fields).filter((k) => k !== 'id' && k !== 'type')
    keys.sort((a, b) => {
        const ia = FIELD_ORDER.indexOf(a.toLowerCase())
        const ib = FIELD_ORDER.indexOf(b.toLowerCase())
        if (ia === -1 && ib === -1) return a.localeCompare(b)
        if (ia === -1) return 1
        if (ib === -1) return -1
        return ia - ib
    })
    return keys.map((k) => [k, String(fields[k])])
}

const CardBtn = ({
    label,
    title,
    onClick,
    danger,
}: {
    label: string
    title: string
    onClick: () => void
    danger?: boolean
}) => (
    <button
        type="button"
        className={danger ? 'bibtex-card-btn is-danger' : 'bibtex-card-btn'}
        title={title}
        aria-label={title}
        onClick={onClick}
    >
        {label}
    </button>
)

/**
 * One field value rendered through Obsidian's own MarkdownRenderer — reuses the
 * vault's math/link rendering instead of bundling a second markdown+katex pipeline.
 * `owner` is unloaded by the caller when the card closes, tearing down anything
 * MarkdownRenderer registered (internal link handlers, etc).
 */
const MarkdownField = ({
    app,
    text,
    source_path,
    owner,
}: {
    app: App
    text: string
    source_path: string
    owner: Component
}) => {
    const el_ref = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        const el = el_ref.current
        if (!el) {
            return
        }
        el.replaceChildren()
        void MarkdownRenderer.render(app, text, el, source_path, owner)
    }, [app, text, source_path, owner])

    return <div ref={el_ref} />
}

/**
 * Body of the citation card: header, grouped actions, denser field list.
 */
const CitationCardBody = ({
    bibtex,
    plugin,
    app,
}: {
    bibtex: BibtexElement
    plugin: BibtexScholar
    app: App
}) => {
    // Owns the lifecycle of MarkdownRenderer.render() calls for this card instance.
    const owner_ref = useRef<Component | null>(null)
    if (owner_ref.current === null) {
        owner_ref.current = new Component()
    }

    useEffect(() => {
        const owner = owner_ref.current!
        owner.load()
        return () => owner.unload()
    }, [])
    const paper_id = bibtex.fields.id
    const title = bibtex.fields.title || paper_id
    const year = bibtex.fields.year

    const open_mentions = async () => {
        const query = mentions_search_query(paper_id)
        let search_leaf = app.workspace.getLeavesOfType('search')[0]
        if (!search_leaf) {
            const leaf = app.workspace.getLeftLeaf(false)
            if (leaf) {
                leaf.setViewState({ type: 'search', active: true })
                search_leaf = app.workspace.getLeavesOfType('search')[0]
            }
        }
        if (search_leaf) {
            function is_search_view(view: any): view is { setQuery: (query: string) => void } {
                return typeof view?.setQuery === 'function'
            }
            await app.workspace.revealLeaf(search_leaf)
            if (is_search_view(search_leaf.view)) {
                search_leaf.view.setQuery(query)
            }
            app.workspace.setActiveLeaf(search_leaf)
        }
    }

    return (
        <>
            <header className='bibtex-card-header'>
                <div className='bibtex-card-header-text'>
                    <div className='bibtex-card-title' title={title}>{title}</div>
                    <div className='bibtex-card-meta'>
                        <code className='bibtex-card-id'>{paper_id}</code>
                        {year ? <span className='bibtex-card-year'>{year}</span> : null}
                        {bibtex.fields.type ? (
                            <span className='bibtex-card-type'>{bibtex.fields.type}</span>
                        ) : null}
                    </div>
                </div>
                <button
                    type="button"
                    className='bibtex-card-close'
                    title='Dismiss (Esc)'
                    aria-label='Dismiss citation card'
                    onClick={() => citation_popup.dismiss()}
                >
                    ×
                </button>
            </header>

            <div className='bibtex-hover-button-bar' role='toolbar' aria-label='Citation actions'>
                <div className='bibtex-card-btn-group' role='group' aria-label='Copy'>
                    <CardBtn label='id' title='Copy citation key' onClick={() => copy_to_clipboard(paper_id)} />
                    <CardBtn label='bibtex' title='Copy BibTeX (no abstract)' onClick={() => copy_to_clipboard(make_bibtex(bibtex.fields, false))} />
                    <CardBtn label='{ }' title='Copy compact cite `{id}`' onClick={() => copy_to_clipboard(`\`{${paper_id}}\``)} />
                    <CardBtn label='[ ]' title='Copy expanded cite `[id]`' onClick={() => copy_to_clipboard(`\`[${paper_id}]\``)} />
                    <CardBtn label='cite' title='Copy LaTeX \\autocite{id}' onClick={() => copy_to_clipboard(`\\autocite{${paper_id}}`)} />
                </div>
                <div className='bibtex-card-btn-group' role='group' aria-label='Open'>
                    <LinkedFileButton label='note' fname={`${paper_id}.md`} folder={plugin.cache.note_folder} app={app} plugin={plugin} />
                    <LinkedFileButton label='pdf' fname={`${paper_id}.pdf`} folder={plugin.cache.pdf_folder} app={app} plugin={plugin} />
                    <CardBtn
                        label='source'
                        title={`Jump to BibTeX source (${bibtex.source_path})`}
                        onClick={() => {
                            void plugin.open_line(String(bibtex.source_path), 0)
                        }}
                    />
                    <CardBtn label='mentions' title='Search mentions of this paper' onClick={() => { void open_mentions() }} />
                </div>
                <div className='bibtex-card-btn-group' role='group' aria-label='Cache'>
                    <CardBtn
                        label='uncache'
                        title='Remove from plugin cache'
                        danger
                        onClick={() => {
                            if (window.confirm(`Uncache ${paper_id}?`)) {
                                void plugin.uncache_bibtex_with_id(paper_id)
                                citation_popup.dismiss()
                            }
                        }}
                    />
                </div>
            </div>

            <div className='bibtex-card-fields'>
                {ordered_field_entries(bibtex.fields).map(([key, value]) => {
                    let display = value
                    if (key.toLowerCase().includes('url') || key.toLowerCase() === 'doi') {
                        const href = key.toLowerCase() === 'doi' && !value.startsWith('http')
                            ? `https://doi.org/${value}`
                            : value
                        display = `[${value}](${href})`
                    }
                    const dense = key.toLowerCase() === 'abstract' ? ' is-abstract' : ''
                    return (
                        <div key={key} className={`bibtex-card-field${dense}`}>
                            <div className='bibtex-card-field-key'>{key}</div>
                            <div className='bibtex-markdown-rendered bibtex-card-field-val'>
                                <MarkdownField
                                    app={app}
                                    text={display}
                                    source_path={String(bibtex.source_path)}
                                    owner={owner_ref.current!}
                                />
                            </div>
                        </div>
                    )
                })}
            </div>
        </>
    )
}

/**
 * HoverPopup: cite chip in text flow + floating card (portaled).
 *
 * Phases 1–4: {@link citation_popup} open/close; portal under workspace container;
 * click-outside close; chip click/keyboard toggle; a11y attrs without focus steal.
 *
 * @param expand - If true (`[id]`), open on mount with no debounce.
 * @param dense - If true (paper panel's chip list), and the "Double hover
 * debounce in paper panel" setting is on, wait 2x the open debounce.
 */
const HoverPopup = ({ bibtex, plugin, app, expand = false, dense = false }: { bibtex: BibtexElement, plugin: BibtexScholar, app: App, expand: boolean, dense?: boolean }) => {
    const paper_id = bibtex.fields.id

    const instance_id_ref = useRef<string | null>(null)
    if (instance_id_ref.current === null) {
        instance_id_ref.current = create_citation_popup_id()
    }
    const instance_id = instance_id_ref.current
    const card_dom_id = `bibtex-cite-card-${instance_id}`
    const open_debounce_ms = dense && plugin.cache.panel_double_debounce_enabled
        ? OPEN_DEBOUNCE_MS * 2
        : OPEN_DEBOUNCE_MS

    const chip_ref = useRef<HTMLSpanElement | null>(null)
    const card_ref = useRef<HTMLDivElement | null>(null)

    const [is_open, set_is_open] = useState(false)

    useEffect(() => {
        return citation_popup.register(instance_id, set_is_open)
    }, [instance_id])

    // `[id]`: open immediately on mount (no debounce). Compact `{id}` waits for hover.
    useEffect(() => {
        if (expand) {
            citation_popup.open_for_expand(instance_id)
        }
    }, [expand, instance_id])

    // Phase 4: pointer down outside chip+card closes (no hover-suppress).
    // Deferred one tick so the same gesture that opened via click does not immediately close.
    useEffect(() => {
        if (!is_open) {
            return
        }

        const on_pointer_down = (e: PointerEvent) => {
            const t = e.target
            if (!(t instanceof Node)) {
                return
            }
            if (chip_ref.current?.contains(t)) {
                return
            }
            if (card_ref.current?.contains(t)) {
                return
            }
            citation_popup.close_outside()
        }

        const bind_timer = window.setTimeout(() => {
            document.addEventListener('pointerdown', on_pointer_down, true)
        }, 0)

        return () => {
            window.clearTimeout(bind_timer)
            document.removeEventListener('pointerdown', on_pointer_down, true)
        }
    }, [is_open])

    // Position floating card near chip; keep it attached on scroll/resize/content size.
    useLayoutEffect(() => {
        if (!is_open) {
            return
        }

        const update = () => {
            const anchor = chip_ref.current
            const card = card_ref.current
            if (!anchor || !card) {
                return
            }
            position_floating_card(anchor, card)
            card.classList.add('is-positioned')
        }

        update()
        const raf = window.requestAnimationFrame(update)

        window.addEventListener('resize', update)
        window.addEventListener('scroll', update, true)

        const card_el = card_ref.current
        let ro: ResizeObserver | null = null
        if (card_el && typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(() => update())
            ro.observe(card_el)
        }

        return () => {
            window.cancelAnimationFrame(raf)
            window.removeEventListener('resize', update)
            window.removeEventListener('scroll', update, true)
            ro?.disconnect()
        }
    }, [is_open, paper_id])

    const on_chip_click = (e: ReactMouseEvent) => {
        // Intentional activate: open immediately / toggle closed (touch + keyboard).
        e.preventDefault()
        e.stopPropagation()
        citation_popup.toggle_trigger(instance_id)
    }

    const card_font_px = normalize_card_font_size(plugin.cache.card_font_size)
    const card_wide = Boolean(plugin.cache.card_wide)

    const card = is_open ? createPortal(
        <div
            ref={card_ref}
            id={card_dom_id}
            className={card_wide ? 'bibtex-hover-card is-floating is-wide' : 'bibtex-hover-card is-floating'}
            role='dialog'
            aria-label={`Citation ${paper_id}`}
            aria-modal={false}
            tabIndex={-1}
            style={{
                // Drives em-based type inside the card (see styles.css).
                ['--bibtex-card-font-size' as string]: `${card_font_px}px`,
                fontSize: `${card_font_px}px`,
            }}
            // Not autoFocused — keep editor focus for typing; user can Tab into controls.
            onMouseEnter={() => citation_popup.enter_card(instance_id)}
            onMouseLeave={() => citation_popup.leave_card(instance_id)}
            onKeyDown={(e) => {
                if (e.key === 'Escape') {
                    e.stopPropagation()
                    citation_popup.dismiss()
                }
            }}
        >
            <CitationCardBody bibtex={bibtex} plugin={plugin} app={app} />
        </div>,
        citation_portal_root(app),
    ) : null

    return (
        <span className='bibtex-hover'>
            <span
                ref={chip_ref}
                className='bibtex-hover-chip'
                onMouseEnter={() => citation_popup.enter_trigger(instance_id, open_debounce_ms)}
                onMouseLeave={() => citation_popup.leave_trigger(instance_id)}
            >
                <button
                    type="button"
                    aria-expanded={is_open}
                    aria-haspopup="dialog"
                    aria-controls={is_open ? card_dom_id : undefined}
                    aria-label={`Citation ${paper_id}`}
                    title={`Citation ${paper_id} — hover or click for details, Esc to dismiss`}
                    onClick={on_chip_click}
                >
                    {paper_id}
                </button>
            </span>
            {card}
        </span>
    )
}


/** Host attribute so callers can find and unmount hover roots before emptying DOM. */
export const HOVER_HOST_ATTR = 'data-bibtex-hover-host'

const hover_roots = new WeakMap<HTMLElement, Root>()

function mount_hover_tree(
    el: HTMLElement,
    bibtex: BibtexElement,
    plugin: BibtexScholar,
    app: App,
    expand: boolean,
    dense: boolean = false,
): Root {
    el.setAttribute(HOVER_HOST_ATTR, '')
    let root = hover_roots.get(el)
    if (!root) {
        root = createRoot(el)
        hover_roots.set(el, root)
    }
    root.render(
        <StrictMode>
            <HoverPopup bibtex={bibtex} plugin={plugin} app={app} expand={expand} dense={dense} />
        </StrictMode>
    )
    return root
}

/**
 * Unmount React for a hover host (and unregister citation_popup instance).
 * Safe to call if nothing was mounted.
 */
export function unmount_hover(el: HTMLElement) {
    const root = hover_roots.get(el)
    if (!root) {
        return
    }
    hover_roots.delete(el)
    el.removeAttribute(HOVER_HOST_ATTR)
    queueMicrotask(() => {
        try {
            root.unmount()
        } catch {
            // already unmounted
        }
    })
}

/**
 * Unmount every hover host under `root` (e.g. before `list_el.empty()`).
 */
export function unmount_hover_hosts(root: HTMLElement) {
    root.querySelectorAll(`[${HOVER_HOST_ATTR}]`).forEach((node) => {
        unmount_hover(node as HTMLElement)
    })
}

/**
 * Mount a citation chip + floating card into `el`.
 * Reuses an existing React root on the same element when re-rendered.
 * Prefer {@link HoverRenderChild} in markdown post-processors so unload unmounts cleanly.
 * @param dense - Pass true for dense chip lists (paper panel) to opt into the
 * "Double hover debounce in paper panel" setting.
 */
export function render_hover(
    el: HTMLElement,
    bibtex: BibtexElement,
    plugin: BibtexScholar,
    app: App,
    expand: boolean = false,
    dense: boolean = false,
) {
    mount_hover_tree(el, bibtex, plugin, app, expand, dense)
}

/**
 * Markdown section lifecycle wrapper: unmounts React when Obsidian discards the section.
 */
export class HoverRenderChild extends MarkdownRenderChild {
    constructor(
        el: HTMLElement,
        private readonly bibtex: BibtexElement,
        private readonly plugin: BibtexScholar,
        private readonly app: App,
        private readonly expand: boolean = false,
        private readonly dense: boolean = false,
    ) {
        super(el)
    }

    onload() {
        render_hover(this.containerEl, this.bibtex, this.plugin, this.app, this.expand, this.dense)
    }

    onunload() {
        unmount_hover(this.containerEl)
    }
}

/**
 * CodeMirror replace-widget for a citation chip (card is portaled separately).
 *
 * {@link eq} reuses DOM across decoration rebuilds; {@link destroy} unmounts React.
 */
export class HoverWidget extends WidgetType {
    bibtex: BibtexElement
    plugin: BibtexScholar
    app: App
    expand: boolean
    private host: HTMLElement | null = null

    constructor(bibtex: BibtexElement, plugin: BibtexScholar, app: App, expand: boolean = false) {
        super()
        this.bibtex = bibtex
        this.plugin = plugin
        this.app = app
        this.expand = expand
    }

    toDOM() {
        const span = document.createElement('span')
        span.className = 'bibtex-cm-widget'
        this.host = span
        mount_hover_tree(span, this.bibtex, this.plugin, this.app, this.expand)
        return span
    }

    eq(other: HoverWidget) {
        return (
            other instanceof HoverWidget
            && this.bibtex.fields.id === other.bibtex.fields.id
            && this.expand === other.expand
        )
    }

    /**
     * When CM reuses this widget via {@link eq}, destroy is not called.
     * When the decoration is removed, unmount React.
     */
    destroy() {
        if (this.host) {
            unmount_hover(this.host)
            this.host = null
        }
    }

    ignoreEvent() {
        // Let React handle pointer events on the chip; CM should not steal them.
        return true
    }
}