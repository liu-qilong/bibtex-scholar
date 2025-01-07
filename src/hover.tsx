import { Notice } from 'obsidian'
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
            {is_hovered && (
            <span
                onMouseEnter={handle_mouse_enter}
                onMouseLeave={handle_mouse_leave}
                >
                <div className='bibtex-hover-button-bar'>
                    <button onClick={() => copy_to_clipboard(paper_id)}>
                        ID
                    </button>
                    <button onClick={() => copy_to_clipboard(bibtex.source)}>
                        BibTeX
                    </button>
                    <a href={`${paper_id}.md`} className="internal-link">
                        <button>Note</button>
                    </a>
                    <a href={`${paper_id}.pdf`} className="internal-link">
                        <button>PDF</button>
                    </a>
                    <a href={String(bibtex.source_path)} className="internal-link">
                        <button>Source</button>
                    </a>
                    <button onClick={() => {
                        delete plugin.cache.bibtex_dict[paper_id]
                        plugin.save_cache()
                        new Notice(`Uncached ${paper_id}`)
                    }}>
                        Uncache
                    </button>
                </div>
                {Object.entries(bibtex.fields).map(([key, value]) => {
                    if (key == 'id') {
                        return
                    }
                    if (key.includes('url')) {
                        value = `[${value}](${value})`
                    }
                    return (<div key={key}>
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