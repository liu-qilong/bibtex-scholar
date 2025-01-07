import { Notice, Keymap } from 'obsidian'
import { useState, StrictMode } from "react"
import { createRoot } from 'react-dom/client'
import Markdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

import { BibtexDict } from 'src/bibtex'
import BibtexScholar from 'src/main'

const copy_to_clipboard = (text: any) => {
    navigator.clipboard.writeText(text).then(() => {
        new Notice('Copied to clipboard')
    }).catch(err => {
        console.error('Failed to copy text: ', err)
    })
}

const HoverPopup = ({ bibtex, plugin }: { bibtex: BibtexDict, plugin: BibtexScholar }) => {
    const paper_id = bibtex.fields.id

    // handlers for mouse enter and leave
    const [is_hovered, set_is_hovered] = useState(false)

    const handle_mouse_enter = () => {
        set_is_hovered(true)
    }

    const handle_mouse_leave = () => {
        set_is_hovered(false)
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
                        id
                    </button>
                    {/* md cite */}
                    <button onClick={() => copy_to_clipboard(`\`{${paper_id}}\``)}>
                        md cite
                    </button>
                    {/* latex cite */}
                    <button onClick={() => copy_to_clipboard(`\\autocite{${paper_id}}`)}>
                        latex cite
                    </button>
                    {/* copy bibtex */}
                    <button onClick={() => copy_to_clipboard(bibtex.source)}>
                        bibtex
                    </button>
                    <code>{'+'}</code>
                    {/* linked note */}
                    <a href={`${paper_id}.md`}
                        onMouseOver={ (event) => {
                            plugin.app.workspace.trigger("hover-link", {
                                event,
                                source: "preview",
                                hoverParent: { hoverPopover: null },
                                targetEl: event.currentTarget,
                                linktext: `${paper_id}.md`,
                                sourcePath: `${paper_id}.md`,
                            })
                        }}
                        onClick={ (event) => {
                            plugin.app.workspace.openLinkText(
                                `${paper_id}.md`,
                                `${paper_id}.md`,
                            )
                        }}
                    >
                        <button>note</button>
                    </a>
                    {/* linked pdf */}
                    <a href={`${paper_id}.pdf`}
                        onMouseOver={ (event) => {
                            plugin.app.workspace.trigger("hover-link", {
                                event,
                                source: "preview",
                                hoverParent: { hoverPopover: null },
                                targetEl: event.currentTarget,
                                linktext: `${paper_id}.pdf`,
                                sourcePath: `${paper_id}.pdf`,
                            })
                        }}
                        onClick={ (event) => {
                            plugin.app.workspace.openLinkText(
                                `${paper_id}.pdf`,
                                `${paper_id}.pdf`,
                            )
                        }}
                    >
                        <button>pdf</button>
                    </a>
                    {/* linked bibtex source */}
                    <a href={String(bibtex.source_path)}
                        onMouseOver={ (event) => {
                            plugin.app.workspace.trigger("hover-link", {
                                event,
                                source: "preview",
                                hoverParent: { hoverPopover: null },
                                targetEl: event.currentTarget,
                                linktext: String(bibtex.source_path),
                                sourcePath: String(bibtex.source_path),
                            })
                        }}
                        onClick={ (event) => {
                            plugin.app.workspace.openLinkText(
                                String(bibtex.source_path),
                                String(bibtex.source_path),
                            )
                        }}
                    >
                        <button>source</button>
                    </a>
                    <code>{'+'}</code>
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

export const render_hover = async ( el: HTMLElement, bibtex: BibtexDict, plugin: BibtexScholar ) => {
    createRoot(el).render(
        <StrictMode>
            <HoverPopup bibtex={bibtex} plugin={plugin} />
        </StrictMode>
    )
}