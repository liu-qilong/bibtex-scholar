import { App, Notice, Modal } from 'obsidian'
import { useState, StrictMode } from "react"
import { createRoot } from 'react-dom/client'
import Markdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

import { type BibtexDict } from 'src/bibtex'
import BibtexScholar from 'src/main'

const copy_to_clipboard = (text: any) => {
    navigator.clipboard.writeText(text).then(() => {
        new Notice('Copied to clipboard')
    }).catch(err => {
        console.error('Failed to copy text: ', err)
    })
}

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
            if (!await this.app.vault.adapter.exists(this.folder)) {
                await this.app.vault.createFolder(this.folder)
            }

            // save the file to the vault
            await this.app.vault.createBinary(file_path, data)
            await this.app.workspace.openLinkText(this.fname, this.fname, true)
        }
        reader.readAsArrayBuffer(file)

        this.close()
    }

    // onClose() {
    //     const { contentEl } = this
    //     contentEl.empty()
    // }
}

const LinkedFileButton = ({label, fname, folder, app}: {label: string, fname: string, folder: string, app: App}) => {
    /** fname only contains the file name
    created/uploaded file will be put to folder  */
    const exist = app.metadataCache.getFirstLinkpathDest(fname, '')
    const cls = (exist)?('bibtex-file-exist'):('bibtex-file-not-exist')

    return (
    <a 
        href={fname}
        className={cls}
        onMouseOver={ (event) => {
            app.workspace.trigger("hover-link", {
                event,
                source: "preview",
                hoverParent: { hoverPopover: null },
                targetEl: event.currentTarget,
                linktext: fname,
                sourcePath: fname,
            })
        }}
        onClick={ async (event) => {
            if (exist) {
                app.workspace.openLinkText(fname, fname, true)
            } else {
                if (fname.endsWith('.pdf')) {
                    new UploadPdfModal(app, folder, fname).open()
                } else if (fname.endsWith('.md')) {
                    // ensure the folder exists
                    if (!await app.vault.adapter.exists(folder)) {
                        await app.vault.createFolder(folder)
                    }

                    // create the file
                    await app.vault.create(`${folder}/${fname}`, `\`[${fname.replace('.md', '')}]\``)
                    await app.workspace.openLinkText(fname, fname, true)
                }
            }
            
        }}
    >
        <button>{label}</button>
    </a>
    )
}

const HoverPopup = ({ bibtex, plugin, app, expand=false }: { bibtex: BibtexDict, plugin: BibtexScholar, app: App, expand: boolean }) => {
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
        <>
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
                    <button onClick={() => copy_to_clipboard(bibtex.source)}>
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
                    <LinkedFileButton label='note' fname={`${paper_id}.md`} folder={plugin.cache.note_folder} app={app}/>
                    {/* linked pdf */}
                    <LinkedFileButton label='pdf' fname={`${paper_id}.pdf`} folder={plugin.cache.pdf_folder} app={app}/>
                    {/* linked bibtex source */}
                    <LinkedFileButton label='soure' fname={String(bibtex.source_path)} folder={''} app={app}/>
                    <code>{'+'}</code>
                    {/* tool */}
                    <button onClick={() => {
                        delete plugin.cache.bibtex_dict[paper_id]
                        plugin.save_cache()
                        new Notice(`Uncached ${paper_id}`)
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
        </>
    )
}

export const render_hover = async ( el: HTMLElement, bibtex: BibtexDict, plugin: BibtexScholar, app: App, expand: boolean = false ) => {
    createRoot(el).render(
        <StrictMode>
            <HoverPopup bibtex={bibtex} plugin={plugin} app={app} expand={expand}/>
        </StrictMode>
    )
}