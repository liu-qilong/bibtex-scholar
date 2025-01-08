import { App, Notice } from 'obsidian'
import { useState, StrictMode } from "react"
import { createRoot } from 'react-dom/client'
import Markdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { UploadPdfModal } from 'src/upload'

import { type BibtexDict } from 'src/bibtex'
import BibtexScholar from 'src/main'

const copy_to_clipboard = (text: any) => {
    navigator.clipboard.writeText(text).then(() => {
        new Notice('Copied to clipboard')
    }).catch(err => {
        console.error('Failed to copy text: ', err)
    })
}

const LinkedFileButton = ({label, path, app}: {label: string, path: string, app: App}) => {
    const exist = app.metadataCache.getFirstLinkpathDest(path, '')
    const cls = (exist)?('bibtex-file-exist'):('bibtex-file-not-exist')

    return (
    <a 
        href={path}
        className={cls}
        onMouseOver={ (event) => {
            app.workspace.trigger("hover-link", {
                event,
                source: "preview",
                hoverParent: { hoverPopover: null },
                targetEl: event.currentTarget,
                linktext: path,
                sourcePath: path,
            })
        }}
        onClick={ (event) => {
            if (exist) {
                app.workspace.openLinkText(path, path, true)
            } else {
                if (path.endsWith('.pdf')) {
                    new UploadPdfModal(app, 'paper/pdf', path).open()
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
                    <LinkedFileButton label='note' path={`${paper_id}.md`} app={app}/>
                    {/* linked pdf */}
                    <LinkedFileButton label='pdf' path={`${paper_id}.pdf`} app={app}/>
                    {/* linked bibtex source */}
                    <LinkedFileButton label='soure' path={String(bibtex.source_path)} app={app}/>
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