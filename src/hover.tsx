import { useState, StrictMode } from "react"
import { createRoot } from 'react-dom/client'
import { BibtexDict } from 'src/bibtex'

const HoverPopup = ({ bibtex_dict }: { bibtex_dict: BibtexDict }) => {
    const paper_id = bibtex_dict?.fields?.id || 'null'
    const paper_title = bibtex_dict?.fields?.title || 'null'
    const paper_author = bibtex_dict?.fields?.author || 'null'
    const paper_abstract = bibtex_dict?.fields?.abstract || 'null'

    // Handlers for mouse enter and leave
    const [isHovered, setIsHovered] = useState(false)

    const handleMouseEnter = () => {
        setIsHovered(true)
    }

    const handleMouseLeave = () => {
        setIsHovered(false)
    }

    return (
        <div
            style={{ position: "relative", display: "inline-block" }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {/* This is the element to hover */}
            <button>{paper_id}</button>

            {/* This is the popup that appears on hover */}
            {isHovered && (
            <div
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                style={{
                position: "absolute",
                top: "-100%",
                left: "100%",
                // transform: "translateX(-50%)",
                background: "white",
                border: "1px solid #ccc",
                boxShadow: "0 4px 8px rgba(0, 0, 0, 0.2)",
                borderRadius: "4px",
                padding: "10px",
                fontSize: "10px",
                zIndex: 1000,
                width: "300%", // Adjust the width as needed
                }}
            >
                <p style={{ margin: 0 }}>Title: {paper_title}</p>
                <p style={{ margin: 0 }}>Author: {paper_author}</p>
                <p style={{ margin: 0 }}>Abstract: {paper_abstract}</p>
            </div>
            )}
        </div>
    )
}

export const render_hover = async ( el: HTMLElement, bibtex_dict: BibtexDict ) => {
    createRoot(el).render(
        <StrictMode>
            <HoverPopup bibtex_dict={bibtex_dict} />
        </StrictMode>
    )
}