import { App, Notice, Modal } from 'obsidian'
import { useState, StrictMode } from "react"
import { createRoot } from 'react-dom/client'
import Markdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { WidgetType } from '@codemirror/view'

import { type BibtexElement, make_bibtex, mentions_search_query } from 'src/bibtex'
import BibtexScholar from 'src/main'

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

/**
 * HoverPopup component displays a hoverable popup for a given BibTeX entry.
 * @param bibtex - The BibtexElement object containing the entry's fields and metadata.
 * @param plugin - The BibtexScholar plugin instance, used for accessing cache and plugin methods.
 * @param app - The Obsidian App instance, used for workspace and UI interactions.
 * @param expand - If true, the popup is expanded by default; otherwise, it appears on hover.
 * The popup provides quick actions such as copying the entry's ID, BibTeX, markdown/LaTeX citations, and links to associated note, PDF, and BibTeX source files. It also allows searching for mentions of the entry and uncaching the entry from the plugin's cache. Entry fields are rendered with markdown and math support.
 */
const HoverPopup = ({ bibtex, plugin, app, expand = false }: { bibtex: BibtexElement, plugin: BibtexScholar, app: App, expand: boolean }) => {
    const paper_id = bibtex.fields.id

    // handlers for mouse enter and leave
    const [is_hovered, set_is_hovered] = useState(expand)

    const handle_mouse_enter = () => {
        set_is_hovered(true)
    }

    const handle_mouse_leave = () => {
        set_is_hovered(expand)
    }

    return (
        <span className='bibtex-hover'>
            {/* This is the element to hover */}
            <span
                onMouseEnter={handle_mouse_enter}
                onMouseLeave={handle_mouse_leave}
            >
                <button>{paper_id}</button>
            </span>
            {/* This is the popup that appears on hover */}
            {/* {( */}
            {is_hovered && (
                <span
                    onMouseEnter={handle_mouse_enter}
                    onMouseLeave={handle_mouse_leave}
                >
                    <div className='bibtex-hover-button-bar'>
                        {/* copy id */}
                        <button onClick={() => copy_to_clipboard(paper_id)}>
                            <code>id</code>
                        </button>
                        {/* copy bibtex */}
                        <button onClick={() => copy_to_clipboard(make_bibtex(bibtex.fields, false))}>
                            {/* <button onClick={() => copy_to_clipboard(bibtex.source)}> */}
                            <code>bibtex</code>
                        </button>
                        {/* md cite */}
                        <button onClick={() => copy_to_clipboard(`\`{${paper_id}}\``)}>
                            <code>{'`{}`'}</code>
                        </button>
                        <button onClick={() => copy_to_clipboard(`\`[${paper_id}]\``)}>
                            <code>{'`[]`'}</code>
                        </button>
                        {/* latex cite */}
                        <button onClick={() => copy_to_clipboard(`\\autocite{${paper_id}}`)}>
                            <code>{'\\autocite{}'}</code>
                        </button>
                        <code>{'+'}</code>
                        {/* linked note */}
                        {/* <LinkedFileButton label='note' fname={`${paper_id}.md`} folder={plugin.cache.note_folder} app={app} /> */}
                        {/* linked pdf */}
                        {/* <LinkedFileButton label='pdf' fname={`${paper_id}.pdf`} folder={plugin.cache.pdf_folder} app={app} /> */}
                        {/* linked bibtex source */}
                        {/* <LinkedFileButton label='source' fname={String(bibtex.source_path)} folder={''} app={app} /> */}

                        <LinkedFileButton label='note' fname={`${paper_id}.md`} folder={plugin.cache.note_folder} app={app} plugin={plugin} />
                        <LinkedFileButton label='pdf' fname={`${paper_id}.pdf`} folder={plugin.cache.pdf_folder} app={app} plugin={plugin} />
                        <LinkedFileButton label='source' fname={String(bibtex.source_path)} folder={''} app={app} plugin={plugin} />


                        {/* mentions query */}
                        <button
                            onClick={async () => {
                                const query = mentions_search_query(paper_id)

                                // check if a search leaf exists
                                // if no search leaf exists, create one
                                let search_leaf = app.workspace.getLeavesOfType('search')[0]

                                if (!search_leaf) {
                                    const leaf = app.workspace.getLeftLeaf(false)
                                    if (leaf) {
                                        leaf.setViewState({ type: 'search', active: true })
                                        search_leaf = app.workspace.getLeavesOfType('search')[0]
                                    }
                                }

                                // set the query in the search panel
                                if (search_leaf) {
                                    function is_search_view(view: any): view is { setQuery: (query: string) => void } {
                                        return typeof view?.setQuery === 'function';
                                    }

                                    await app.workspace.revealLeaf(search_leaf);
                                    if (is_search_view(search_leaf.view)) {
                                        search_leaf.view.setQuery(query)
                                    }
                                    app.workspace.setActiveLeaf(search_leaf)
                                }
                            }}
                        >
                            mentions
                        </button>
                        <code>{'+'}</code>
                        {/* tool */}
                        <button onClick={() => {
                            delete plugin.cache.bibtex_dict[paper_id]
                            plugin.save_cache()
                            new Notice(`Uncached ${paper_id}`)
                            if (window.confirm('Are you sure?')) {
                                plugin.uncache_bibtex_with_id(paper_id)
                            }
                        }}>
                            uncache
                        </button>
                    </div>
                    {Object.entries(bibtex.fields).map(([key, value]) => {
                        if (key == 'id') {
                            return
                        }
                        if (key.includes('url')) {
                            value = `[${value}](${value})`
                        }
                        return (<div key={key} className='bibtex-markdown-rendered'>
                            <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{`**\`${key}\`** ${value}`}</Markdown>
                        </div>)
                    })}
                </span>
            )}
        </span>
    )
}


/**
 * Functions to render a paper element with hover pop up
 * @param el The HTML element to render the pop up in
 * @param bibtex The BibtexElement to render
 * @param plugin The BibtexScholar plugin instance
 * @param app The Obsidian app instance
 * @param expand Whether to expand the hover pop up
 */
export const render_hover = async (el: HTMLElement, bibtex: BibtexElement, plugin: BibtexScholar, app: App, expand: boolean = false) => {
    createRoot(el).render(
        <StrictMode>
            <HoverPopup bibtex={bibtex} plugin={plugin} app={app} expand={expand} />
        </StrictMode>
    )
}


/**
 * HoverWidget class for displaying BibTeX entry hover popups in the editor.
 * Extends the WidgetType from CodeMirror to create a custom widget.
 * 
 * @param bibtex - The BibtexElement object containing the entry's fields and metadata.
 * @param plugin - The BibtexScholar plugin instance, used for accessing cache and plugin methods.
 * @param app - The Obsidian App instance, used for workspace and UI interactions.
 * @param expand - If true, the popup is expanded by default; otherwise, it appears on hover.
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

    toDOM() {
        const span = document.createElement("span")
        createRoot(span).render(
            <StrictMode>
                <HoverPopup bibtex={this.bibtex} plugin={this.plugin} app={this.app} expand={this.expand} />
                {/* <button>test</button> */}
            </StrictMode>
        )
        return span
    }

    eq(other: HoverWidget) {
        return this.bibtex.fields.id === other.bibtex.fields.id
    }

    ignoreEvent() {
        return true
    }
}