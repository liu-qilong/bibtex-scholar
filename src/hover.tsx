import { useState, StrictMode } from "react"
import { createRoot } from 'react-dom/client'
import { BibtexDict } from 'src/bibtex'

const HoverPopup = ({ bibtex_dict }: { bibtex_dict: BibtexDict }) => {
    const paper_id = bibtex_dict?.fields?.id || 'null'
    const paper_title = bibtex_dict?.fields?.title || 'null'
    const paper_author = bibtex_dict?.fields?.author || 'null'
    const paper_abstract = bibtex_dict?.fields?.abstract || 'null'

    // Handlers for mouse enter and leave
    const [is_hovered, set_is_hovered] = useState(false)

    const handle_mouse_enter = () => {
        console.log(`enter ${paper_id}`)
        set_is_hovered(true)
    }

    const handle_mouse_leave = () => {
        console.log(`leave ${paper_id}`)
        set_is_hovered(false)
    }

    return (
        <>
            {/* This is the element to hover */}
            <div
                style={{ position: "relative", display: "inline-block" }}
                onMouseEnter={handle_mouse_enter}
                onMouseLeave={handle_mouse_leave}
            >
                <button>{paper_id}</button>
            </div>
            {/* This is the popup that appears on hover */}
            {is_hovered && (
            <div
                onMouseEnter={handle_mouse_enter}
                onMouseLeave={handle_mouse_leave}
                style={{
                    padding: "10px",
                    fontSize: "12px",
                    position: "relative",
                    display: "inline-block",
                }}
                >
                <div style={{ margin: 0 }}><strong>Title</strong> {paper_title}</div>
                <div style={{ margin: 0 }}><strong>Author</strong> {paper_author}</div>
                <div style={{ margin: 0 }}><strong>Abstract</strong> {paper_abstract}</div>
            </div>
            )}
        </>
    )
}

export const render_hover = async ( el: HTMLElement, bibtex_dict: BibtexDict ) => {
    createRoot(el).render(
        <StrictMode>
            <HoverPopup bibtex_dict={bibtex_dict} />
        </StrictMode>
    )
}