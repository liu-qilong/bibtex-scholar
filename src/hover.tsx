import { useState, StrictMode } from "react"
import { createRoot } from 'react-dom/client'
import { BibtexDict } from 'src/bibtex'

const HoverPopup = ({ bibtex_dict }: { bibtex_dict: BibtexDict }) => {
    const paper_id = bibtex_dict.fields.id

    // Handlers for mouse enter and leave
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
                style={{
                    padding: "10px",
                    fontSize: "12px",
                }}
                >
                {Object.entries(bibtex_dict.fields).map(([key, value]) => {
                    return (<p key={key} style={{ margin: 0 }}><strong>{key}</strong> {value}</p>)
                })}
            </span>
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