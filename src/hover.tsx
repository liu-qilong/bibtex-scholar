/**
 * Citation chips + floating cards.
 *
 * Architecture (see docs/one-root-per-chip.md):
 * - Chips are plain DOM (`mount_chip`), not React.
 * - One shared React root (`CardManager`) portals:
 *     • 0–1 {@link PreviewCard} — hover/click, anchored (`citation_popup` + `chip_registry`)
 *     • 0–N {@link PinnedCard} — user-pinned, draggable (`pin_registry`)
 * - Live Preview: {@link HoverWidget} (CodeMirror replace decoration).
 * - Reading view / panel: {@link render_hover} / {@link HoverRenderChild}.
 */
import { App, Component, MarkdownRenderer, Notice, Modal, MarkdownRenderChild } from 'obsidian'
import { useEffect, useLayoutEffect, useRef, useState, StrictMode, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { EditorSelection } from '@codemirror/state'
import { type EditorView, WidgetType } from '@codemirror/view'

import { type BibtexElement, make_bibtex, mentions_search_query } from 'src/bibtex'
import { normalize_card_font_size } from 'src/cache-ops'
import { clamp_card_position, compute_card_placement, compute_card_position } from 'src/citation-card-layout'
import { citation_popup, create_citation_popup_id, OPEN_DEBOUNCE_MS } from 'src/citation-popup'
import { find_cite_spans_in_line } from 'src/cite-span'
import type BibtexScholar from 'src/main'
import { PinRegistry, type PinPosition } from 'src/pin-registry'
import { card_affordance_copy } from 'src/ux-copy'

/** Long-press duration (ms) on a Live Preview chip to drop into raw-text edit mode. */
export const CHIP_LONG_PRESS_MS = 500

/** Minimum pointer travel (px) before a header-down starts moving a pinned card — absorbs tap jitter (touch). */
export const PIN_DRAG_THRESHOLD_PX = 5

/** True when two field maps have the same keys and string values (widget eq / A5). */
export function fields_shallow_equal(
	a: Record<string, unknown>,
	b: Record<string, unknown>,
): boolean {
	const keys_a = Object.keys(a)
	const keys_b = Object.keys(b)
	if (keys_a.length !== keys_b.length) {
		return false
	}
	for (const k of keys_a) {
		if (a[k] !== b[k]) {
			return false
		}
	}
	return true
}

/** Snapshot carried by a pinned card (independent of the chip that opened it). */
type PinPayload = { bibtex: BibtexElement, plugin: BibtexScholar, app: App }

/** Process-wide pins — survive note switches; cleared on plugin unload. */
export const pin_registry = new PinRegistry<PinPayload>()

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
/**
 * `window.innerWidth/innerHeight` do not shrink for the on-screen keyboard on
 * iOS/most Android WebViews — only `visualViewport` does. Fall back for
 * environments without it (older WebViews).
 */
function get_viewport(): { width: number, height: number } {
    const vv = window.visualViewport
    if (vv) {
        return { width: vv.width, height: vv.height }
    }
    return { width: window.innerWidth, height: window.innerHeight }
}

function position_floating_card(anchor: HTMLElement, card: HTMLElement) {
    const ar = anchor.getBoundingClientRect()
    const cr = card.getBoundingClientRect()
    const viewport = get_viewport()

    const placement = compute_card_placement(ar, cr, viewport)
    const { top, left } = compute_card_position(ar, cr, viewport, placement)

    card.style.top = `${top}px`
    card.style.left = `${left}px`
    card.classList.toggle('is-flipped', placement === 'above')
}

/** Workspace chrome root — floating cards portal here so they do not shift note layout. */
function citation_portal_root(app: App): HTMLElement {
    return app.workspace.containerEl
}

/** Copy text and show a short Notice (errors go to the console). */
export const copy_to_clipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
        new Notice('Copied to clipboard')
    }).catch((err) => {
        console.error('Failed to copy text:', err)
    })
}

/** Modal: pick a PDF and write it into the vault under `folder/fname`. */
class UploadPdfModal extends Modal {
    folder: string
    fname: string

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
                this.handle_file_upload(target.files[0])
            }
        })
    }

    handle_file_upload(file: File) {
        const reader = new FileReader()
        reader.onload = async (event) => {
            const { result } = event.target as FileReader
            const data = result as ArrayBuffer
            const file_path = `${this.folder}/${this.fname}`

            if (!await this.app.vault.getFolderByPath(this.folder)) {
                await this.app.vault.createFolder(this.folder)
            }

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

/** Tilted thumbtack glyph for the pin button — outline head when unpinned, fills via CSS (`.is-active`) when pinned. */
const PinIcon = () => (
    <svg
        className='bibtex-card-pin-icon'
        viewBox="0 0 24 24"
        width="14"
        height="14"
        aria-hidden="true"
        focusable="false"
    >
        <g transform="rotate(45 12 12)">
            <rect className='bibtex-card-pin-head' x="9" y="3" width="6" height="8" rx="3" />
            <line x1="12" y1="11" x2="12" y2="20" />
        </g>
    </svg>
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
    pinned,
    on_pin_toggle,
    on_close,
    on_header_pointer_down,
}: {
    bibtex: BibtexElement
    plugin: BibtexScholar
    app: App
    pinned: boolean
    on_pin_toggle: () => void
    on_close: () => void
    on_header_pointer_down?: (e: ReactPointerEvent<HTMLElement>) => void
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
            <header className='bibtex-card-header' onPointerDown={on_header_pointer_down}>
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
                    className={pinned ? 'bibtex-card-pin is-active' : 'bibtex-card-pin'}
                    title={pinned ? 'Unpin card' : 'Pin card — stays open, can be dragged'}
                    aria-label={pinned ? 'Unpin citation card' : 'Pin citation card'}
                    aria-pressed={pinned}
                    onClick={on_pin_toggle}
                >
                    <PinIcon />
                </button>
                <button
                    type="button"
                    className='bibtex-card-close'
                    title='Dismiss (Esc)'
                    aria-label='Dismiss citation card'
                    onClick={on_close}
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
                                on_close()
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

            {/* Always-visible footer: same chrome for preview + pin; copy differs by mode. */}
            <CardAffordance pinned={pinned} />
        </>
    )
}

/** Shared dismiss/status strip at the far edge of the fields cluster. */
const CardAffordance = ({ pinned }: { pinned: boolean }) => {
    const { line, detail } = card_affordance_copy(pinned)
    return (
        <div
            className={pinned ? 'bibtex-card-affordance is-pinned' : 'bibtex-card-affordance'}
            title={detail}
        >
            {line}
        </div>
    )
}

/**
 * Live chip → data the shared card manager needs for its floating preview.
 * Chips are plain DOM; only the open card(s) are React (see docs/one-root-per-chip.md).
 */
type ChipRecord = {
    anchor: HTMLElement
    bibtex: BibtexElement
    plugin: BibtexScholar
    app: App
    /**
     * Panel discover chips sit in a dense scrolling list. Preview cards there
     * dismiss on scroll instead of chasing the anchor (inline notes re-tether).
     */
    dense: boolean
}

/** instance_id → chip record. Filled on mount, cleared on unmount. */
const chip_registry = new Map<string, ChipRecord>()

/** Bumped when an existing chip's bibtex snapshot changes so open cards re-read. */
const chip_content_listeners = new Set<() => void>()

function notify_chip_content_changed(): void {
	for (const listener of chip_content_listeners) {
		listener()
	}
}

/** Subscribe to chip bibtex/payload refreshes (CardManager). */
function subscribe_chip_content(listener: () => void): () => void {
	chip_content_listeners.add(listener)
	return () => {
		chip_content_listeners.delete(listener)
	}
}

/**
 * Place the caret inside a cite span near `pos` so the replace decoration drops
 * and the user can edit the raw `` `{id}` `` text (Live Preview only).
 */
function enter_cite_edit_mode(view: EditorView, near_pos: number): boolean {
	const doc = view.state.doc
	const clamped = Math.max(0, Math.min(near_pos, doc.length))
	const line = doc.lineAt(clamped)
	const spans = find_cite_spans_in_line(line.text, line.from)
	const span = spans.find((s) => near_pos >= s.from && near_pos <= s.to)
		?? spans.find((s) => Math.abs(near_pos - s.from) <= 1 || Math.abs(near_pos - s.to) <= 1)
	if (!span) {
		return false
	}
	// Inside half-open [from, to) → chip derenders to raw text.
	const caret = Math.min(span.from + 1, span.to - 1)
	view.dispatch({ selection: EditorSelection.cursor(Math.max(span.from, caret)) })
	view.focus()
	return true
}

/** Shared dialog chrome: classes + font CSS vars for both preview and pinned cards. */
function card_surface_props(
    plugin: BibtexScholar,
    paper_id: string,
    opts: { positioned?: boolean, pinned?: boolean, pos?: PinPosition, z?: number },
): { className: string, style: { [key: string]: string | number }, 'aria-label': string } {
    const font_px = normalize_card_font_size(plugin.cache.card_font_size)
    const classes = ['bibtex-hover-card', 'is-floating']
    if (plugin.cache.card_wide) {
        classes.push('is-wide')
    }
    if (opts.positioned || opts.pinned) {
        classes.push('is-positioned')
    }
    if (opts.pinned) {
        classes.push('is-pinned')
    }
    const style: { [key: string]: string | number } = {
        // Drives em-based type inside the card (see styles.css).
        ['--bibtex-card-font-size']: `${font_px}px`,
        fontSize: `${font_px}px`,
    }
    if (opts.pos) {
        style.top = opts.pos.top
        style.left = opts.pos.left
    }
    if (opts.z != null) {
        // Base matches styles.css `--layer-popover` fallback (30); pin z stacks above it.
        style.zIndex = 30 + opts.z
    }
    return {
        className: classes.join(' '),
        style,
        'aria-label': `Citation ${paper_id}`,
    }
}

/**
 * Transient hover/click card (0-or-1). Anchored to a chip; closes on outside
 * click, leave-grace, dense-list scroll, or Esc (via citation_popup).
 */
const PreviewCard = ({
    instance_id,
    record,
}: {
    instance_id: string
    record: ChipRecord
}) => {
    const { anchor, bibtex, plugin, app, dense } = record
    const paper_id = bibtex.fields.id
    const card_ref = useRef<HTMLDivElement | null>(null)

    // Outside click closes. Bind next tick so the opening click does not close it.
    useEffect(() => {
        const on_pointer_down = (e: PointerEvent) => {
            const t = e.target
            if (!(t instanceof Node)) {
                return
            }
            if (anchor.contains(t) || card_ref.current?.contains(t)) {
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
    }, [anchor])

    // Tether to chip on resize/scroll. Dense (panel) lists dismiss on scroll instead.
    useLayoutEffect(() => {
        const update = () => {
            const card = card_ref.current
            if (!card) {
                return
            }
            position_floating_card(anchor, card)
            card.classList.add('is-positioned')
        }
        // Capture-phase `scroll` on window sees every scrollable element in the
        // document, including the card's own internal scroll regions (long
        // abstract, scrollable field list). Scrolling those is reading the card,
        // not scrolling past it — only dismiss when the scroll happened outside it.
        const on_scroll = dense
            ? (e: Event) => {
                const target = e.target
                if (target instanceof Node && card_ref.current?.contains(target)) {
                    return
                }
                citation_popup.close_outside()
            }
            : update

        update()
        const raf = window.requestAnimationFrame(update)
        window.addEventListener('resize', update)
        window.addEventListener('scroll', on_scroll, true)
        // innerHeight doesn't shrink for the on-screen keyboard — visualViewport
        // does, and is the only thing that fires a resize when it opens/closes.
        window.visualViewport?.addEventListener('resize', update)

        const card_el = card_ref.current
        let ro: ResizeObserver | null = null
        if (card_el && typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(() => update())
            ro.observe(card_el)
        }

        return () => {
            window.cancelAnimationFrame(raf)
            window.removeEventListener('resize', update)
            window.removeEventListener('scroll', on_scroll, true)
            window.visualViewport?.removeEventListener('resize', update)
            ro?.disconnect()
        }
    }, [anchor, paper_id, dense])

    const pin_from_preview = () => {
        // Snapshot on-screen position, pin first, then drop the transient card
        // so there is no frame where the card is neither pinned nor previewed.
        const card = card_ref.current
        if (!card) {
            return
        }
        const rect = card.getBoundingClientRect()
        pin_registry.pin(paper_id, { bibtex, plugin, app }, { top: rect.top, left: rect.left })
        citation_popup.close_outside()
    }

    const surface = card_surface_props(plugin, paper_id, {})

    return (
        <div
            ref={card_ref}
            id={`bibtex-cite-card-${instance_id}`}
            className={surface.className}
            role='dialog'
            aria-label={surface['aria-label']}
            aria-modal={false}
            tabIndex={-1}
            style={surface.style}
            // Not autoFocused — keep editor focus for typing.
            onMouseEnter={() => citation_popup.enter_card(instance_id)}
            onMouseLeave={() => citation_popup.leave_card(instance_id)}
            onKeyDown={(e) => {
                if (e.key === 'Escape') {
                    e.stopPropagation()
                    citation_popup.dismiss()
                }
            }}
        >
            <CitationCardBody
                bibtex={bibtex}
                plugin={plugin}
                app={app}
                pinned={false}
                on_pin_toggle={pin_from_preview}
                on_close={() => citation_popup.dismiss()}
            />
        </div>
    )
}

/**
 * User-pinned card (0-or-N). Owns its position; drag from header; closes only
 * via unpin (button or Esc on the front-most pin, handled in CardManager).
 */
const PinnedCard = ({
    paper_id,
    payload,
    pos,
    z,
}: {
    paper_id: string
    payload: PinPayload
    pos: PinPosition
    z: number
}) => {
    const { bibtex, plugin, app } = payload
    const card_ref = useRef<HTMLDivElement | null>(null)
    // During drag we move the DOM node only; registry commits on pointerup (B3).
    const drag_pos_ref = useRef(pos)

    useEffect(() => {
        drag_pos_ref.current = pos
        const card = card_ref.current
        if (card && !card.dataset.dragging) {
            card.style.top = `${pos.top}px`
            card.style.left = `${pos.left}px`
        }
    }, [pos.top, pos.left])

    const on_header_pointer_down = (e: ReactPointerEvent<HTMLElement>) => {
        // Ignore pin/close buttons — they need their own clicks.
        if (e.target instanceof HTMLElement && e.target.closest('button')) {
            return
        }
        const card = card_ref.current
        if (!card) {
            return
        }
        const header_el = e.currentTarget
        const pointer_id = e.pointerId
        header_el.setPointerCapture(pointer_id)
        card.dataset.dragging = '1'

        const start_x = e.clientX
        const start_y = e.clientY
        const start_pos = { ...drag_pos_ref.current }
        const size = { width: card.offsetWidth, height: card.offsetHeight }
        let moved = false

        const on_move = (ev: PointerEvent) => {
            const dx = ev.clientX - start_x
            const dy = ev.clientY - start_y
            // Below threshold: don't move yet — absorbs tap jitter near the
            // header (e.g. reaching for a nearby button) so it doesn't drag.
            if (!moved && Math.hypot(dx, dy) < PIN_DRAG_THRESHOLD_PX) {
                return
            }
            moved = true
            const viewport = get_viewport()
            const next = clamp_card_position(
                {
                    top: start_pos.top + dy,
                    left: start_pos.left + dx,
                },
                size,
                viewport,
            )
            drag_pos_ref.current = next
            card.style.top = `${next.top}px`
            card.style.left = `${next.left}px`
        }
        const on_up = () => {
            header_el.removeEventListener('pointermove', on_move)
            header_el.removeEventListener('pointerup', on_up)
            delete card.dataset.dragging
            try {
                header_el.releasePointerCapture(pointer_id)
            } catch {
                // already released
            }
            // Single registry write — avoids re-rendering the card body every move.
            // Skip entirely if the drag never crossed the threshold (a tap, not a drag).
            if (moved) {
                pin_registry.move(paper_id, drag_pos_ref.current)
            }
        }
        header_el.addEventListener('pointermove', on_move)
        header_el.addEventListener('pointerup', on_up)
    }

    const surface = card_surface_props(plugin, paper_id, {
        positioned: true,
        pinned: true,
        pos,
        z,
    })

    return (
        <div
            ref={card_ref}
            id={`bibtex-cite-card-${paper_id}`}
            className={surface.className}
            role='dialog'
            aria-label={surface['aria-label']}
            aria-modal={false}
            tabIndex={-1}
            style={surface.style}
            onPointerDown={() => pin_registry.bring_to_front(paper_id)}
        >
            <CitationCardBody
                bibtex={bibtex}
                plugin={plugin}
                app={app}
                pinned={true}
                on_pin_toggle={() => pin_registry.unpin(paper_id)}
                on_close={() => pin_registry.unpin(paper_id)}
                on_header_pointer_down={on_header_pointer_down}
            />
        </div>
    )
}

/**
 * Single React root: 0–1 {@link PreviewCard} + 0–N {@link PinnedCard}s,
 * portaled under the workspace container.
 */
const CardManager = ({ app }: { app: App }) => {
    const [active_id, set_active_id] = useState<string | null>(() => citation_popup.get_active_id())
    const [, force_pins_update] = useState(0)
    const [, force_chip_content] = useState(0)

    useEffect(() => citation_popup.subscribe_active(set_active_id), [])
    useEffect(() => pin_registry.subscribe(() => force_pins_update((n) => n + 1)), [])
    // Re-read chip_registry when an existing host gets new bibtex (A5).
    useEffect(() => subscribe_chip_content(() => force_chip_content((n) => n + 1)), [])

    // Esc: preview first (citation_popup + stopImmediatePropagation), then front pin only.
    useEffect(() => {
        const on_keydown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' && e.key !== 'Esc') {
                return
            }
            if (citation_popup.get_active_id() != null) {
                return
            }
            const front = pin_registry.front_id()
            if (!front) {
                return
            }
            e.preventDefault()
            e.stopPropagation()
            e.stopImmediatePropagation()
            pin_registry.unpin(front)
        }
        document.addEventListener('keydown', on_keydown, true)
        return () => document.removeEventListener('keydown', on_keydown, true)
    }, [])

    const cards: ReactElement[] = []

    if (active_id) {
        const record = chip_registry.get(active_id)
        // Avoid double-rendering a paper that was just pinned from its preview.
        if (record && !pin_registry.is_pinned(record.bibtex.fields.id)) {
            cards.push(
                <PreviewCard key={active_id} instance_id={active_id} record={record} />,
            )
        }
    }

    for (const [paper_id, entry] of pin_registry.entries()) {
        cards.push(
            <PinnedCard
                key={paper_id}
                paper_id={paper_id}
                payload={entry.payload}
                pos={entry.pos}
                z={entry.z}
            />,
        )
    }

    if (cards.length === 0) {
        return null
    }

    return createPortal(<>{cards}</>, citation_portal_root(app))
}

let manager_root: Root | null = null
let manager_host: HTMLElement | null = null

/** Lazily create the single shared root that renders {@link CardManager} (idempotent). */
function ensure_card_manager(app: App): void {
    if (manager_root) {
        return
    }
    manager_host = document.createElement('div')
    manager_host.style.display = 'none'
    citation_portal_root(app).appendChild(manager_host)
    manager_root = createRoot(manager_host)
    manager_root.render(
        <StrictMode>
            <CardManager app={app} />
        </StrictMode>
    )
}

/** Unmount the single shared card-manager root (plugin unload / test teardown). */
export function unmount_card_manager(): void {
    if (manager_root) {
        const root = manager_root
        manager_root = null
        queueMicrotask(() => {
            try {
                root.unmount()
            } catch {
                // already unmounted
            }
        })
    }
    manager_host?.remove()
    manager_host = null
    // Pins are in-memory-only by design (survive note switches, not plugin
    // reload/restart) — tearing down the card manager also clears them.
    pin_registry.unpin_all()
}

/** Host attribute so callers can find and unmount hover chips before emptying DOM. */
export const HOVER_HOST_ATTR = 'data-bibtex-hover-host'

type ChipHost = {
    instance_id: string
    button: HTMLButtonElement
    unregister: () => void
}

/** Host element -> its chip's identity, so re-render on the same element reuses one instance. */
const chip_hosts = new WeakMap<HTMLElement, ChipHost>()

/** Plain-DOM chip (no React). `contenteditable=false` keeps CM's caret out of the label. */
function build_chip_dom(paper_id: string): { wrapper: HTMLSpanElement, chip: HTMLSpanElement, button: HTMLButtonElement } {
    const wrapper = document.createElement('span')
    wrapper.className = 'bibtex-hover'
    // Required inside CM Live Preview: without this the browser can park the caret
    // inside the chip text at an offset that is not a real document position.
    wrapper.setAttribute('contenteditable', 'false')
    const chip = document.createElement('span')
    chip.className = 'bibtex-hover-chip'
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = paper_id
    button.setAttribute('aria-haspopup', 'dialog')
    button.setAttribute('aria-expanded', 'false')
    button.setAttribute('aria-label', `Citation ${paper_id}`)
    // No native `title` — it duplicated the label and fought the card's own hint.
    chip.appendChild(button)
    wrapper.appendChild(chip)
    return { wrapper, chip, button }
}

type MountChipOptions = {
	/** Paper panel dense list — optional 2× open debounce. */
	dense?: boolean
	/**
	 * Live Preview editor: long-press places the caret inside the cite span
	 * so the chip derenders for editing (B1).
	 */
	editor_view?: EditorView
}

/**
 * Mount (or reuse) a plain-DOM citation chip in `el`.
 */
function mount_chip(
	el: HTMLElement,
	bibtex: BibtexElement,
	plugin: BibtexScholar,
	app: App,
	expand: boolean,
	opts: MountChipOptions = {},
): void {
	const dense = opts.dense === true
	const editor_view = opts.editor_view
	el.setAttribute(HOVER_HOST_ATTR, '')
	ensure_card_manager(app)

	const existing = chip_hosts.get(el)
	if (existing) {
		const prev = chip_registry.get(existing.instance_id)
		chip_registry.set(existing.instance_id, {
			anchor: prev?.anchor ?? el,
			bibtex,
			plugin,
			app,
			dense,
		})
		const paper_id = bibtex.fields.id
		existing.button.textContent = paper_id
		existing.button.setAttribute('aria-label', `Citation ${paper_id}`)
		// Keep open preview / pin in sync with new fields (A5).
		notify_chip_content_changed()
		if (pin_registry.is_pinned(paper_id)) {
			pin_registry.update_payload(paper_id, { bibtex, plugin, app })
		}
		if (expand) {
			citation_popup.open_for_expand(existing.instance_id)
		}
		return
	}

	const instance_id = create_citation_popup_id()
	const card_dom_id = `bibtex-cite-card-${instance_id}`
	const { wrapper, chip, button } = build_chip_dom(bibtex.fields.id)

	chip_registry.set(instance_id, { anchor: chip, bibtex, plugin, app, dense })

	chip.addEventListener('mouseenter', () => {
		const open_debounce_ms = dense && plugin.cache.panel_double_debounce_enabled
			? OPEN_DEBOUNCE_MS * 2
			: OPEN_DEBOUNCE_MS
		citation_popup.enter_trigger(instance_id, open_debounce_ms)
	}, true)
	chip.addEventListener('mouseleave', () => citation_popup.leave_trigger(instance_id), true)

	// Long-press (Live Preview) → edit raw cite; short click → toggle card.
	let long_press_timer: number | null = null
	let long_press_fired = false
	const clear_long_press = () => {
		if (long_press_timer != null) {
			window.clearTimeout(long_press_timer)
			long_press_timer = null
		}
	}
	button.addEventListener('pointerdown', (e) => {
		// Keep the CM editor focused: a real <button> steals focus on mousedown otherwise.
		e.preventDefault()
		long_press_fired = false
		if (!editor_view) {
			return
		}
		clear_long_press()
		long_press_timer = window.setTimeout(() => {
			long_press_timer = null
			long_press_fired = true
			citation_popup.close_outside()
			try {
				const near = editor_view.posAtDOM(wrapper)
				enter_cite_edit_mode(editor_view, near)
			} catch {
				// DOM not in view — ignore
			}
		}, CHIP_LONG_PRESS_MS)
	})
	button.addEventListener('pointerup', () => clear_long_press())
	button.addEventListener('pointerleave', () => clear_long_press())
	button.addEventListener('pointercancel', () => clear_long_press())
	button.addEventListener('click', (e) => {
		e.preventDefault()
		e.stopPropagation()
		if (long_press_fired) {
			long_press_fired = false
			return
		}
		citation_popup.toggle_trigger(instance_id)
	})

	const unregister = citation_popup.register(instance_id, (open) => {
		button.setAttribute('aria-expanded', String(open))
		if (open) {
			button.setAttribute('aria-controls', card_dom_id)
		} else {
			button.removeAttribute('aria-controls')
		}
	})
	chip_hosts.set(el, { instance_id, button, unregister })

	el.appendChild(wrapper)

	if (expand) {
		citation_popup.open_for_expand(instance_id)
	}
}

/**
 * Unmount a hover host: unregisters its chip from the popup controller and
 * chip registry, and removes its DOM. Safe to call if nothing was mounted.
 */
export function unmount_hover(el: HTMLElement) {
    const host = chip_hosts.get(el)
    if (!host) {
        return
    }
    chip_hosts.delete(el)
    // Unregister first so close_now can notify while the registry entry still
    // exists (CardManager's last paint for this id can still resolve the record).
    host.unregister()
    chip_registry.delete(host.instance_id)
    el.removeAttribute(HOVER_HOST_ATTR)
    el.replaceChildren()
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
 * Mount a citation chip + floating card into `el`. The chip itself is plain
 * DOM; the card renders through the single shared card-manager root, not a
 * root of its own — see docs/one-root-per-chip.md. Reuses the same chip
 * identity across re-renders of the same host element.
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
	mount_chip(el, bibtex, plugin, app, expand, { dense })
}

/**
 * Markdown section lifecycle wrapper: unmounts the chip when Obsidian discards the section.
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
 * CodeMirror replace widget for one cite chip (card is portaled via CardManager).
 *
 * Important: {@link destroy} must use the `dom` argument CM passes in.
 * After {@link eq} returns true, CM reuses the DOM but installs a *new* widget
 * instance — instance fields set in {@link toDOM} are not on that new object.
 */
export class HoverWidget extends WidgetType {
	bibtex: BibtexElement
	plugin: BibtexScholar
	app: App
	expand: boolean

	constructor(bibtex: BibtexElement, plugin: BibtexScholar, app: App, expand: boolean = false) {
		super()
		this.bibtex = bibtex
		this.plugin = plugin
		this.app = app
		this.expand = expand
	}

	toDOM(view: EditorView) {
		const span = document.createElement('span')
		span.className = 'bibtex-cm-widget'
		span.setAttribute('contenteditable', 'false')
		// Long-press uses `view` to place the caret inside the cite span (B1).
		mount_chip(span, this.bibtex, this.plugin, this.app, this.expand, { editor_view: view })
		return span
	}

	eq(other: HoverWidget) {
		return (
			other instanceof HoverWidget
			&& this.expand === other.expand
			&& this.bibtex.source_path === other.bibtex.source_path
			&& fields_shallow_equal(this.bibtex.fields, other.bibtex.fields)
		)
	}

	destroy(dom: HTMLElement) {
		unmount_hover(dom)
	}

	/** Let chip listeners handle pointer events; CM should not claim them. */
	ignoreEvent() {
		return true
	}
}