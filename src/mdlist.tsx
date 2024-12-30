import { MarkdownPostProcessorContext } from 'obsidian';
import { TreeNode, parseMdList } from './utils'

function drawNode(
    node: TreeNode,
    element: HTMLElement,
    drawContent: (content: string, element: HTMLElement) => void,
) {
    const ul = element.createEl('ul')
    node.children.forEach((child) => {
        const li = ul.createEl('li')
        drawContent(child.content, li)

        // recursively draw children
        if (child.children.length > 0) {
            drawNode(child, li, drawContent)
        }
    })
}

export const renderMdList = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    // parse markdown list as a tree
    const root = parseMdList(source)

    // recursive rendering
    drawNode(root, el, (content: string, element: HTMLElement) => {
        let span_str: string = ''
        let link_str: string = ''
        let link_flag: boolean = false

        for (let i = 0; i < content.length; i++) {
            if (content[i] === '\n') {
                // when encounter \n, render the previous span and break to new line
                element.createEl('span', {text: span_str})
                span_str = ''
                element.createEl('br')
            } else if (content[i] + content[i+1] === '[[') {
                // when encounter [[, start to link mode and render the previous span
                link_flag = true
                i++
                element.createEl('span', {text: span_str})
            } else if (content[i] + content[i+1] === ']]') {
                // when encounter ]], end the link mode and render the link
                link_flag = false
                i++

                // parse link string
                const link_split = link_str.split('|')
                const href = link_split[0]
                const name = link_split[1] || href
                element.createEl('a', {text: name, href: href, cls: "internal-link"})
                
            } else if (link_flag) {
                link_str += content[i]
            } else {
                span_str += content[i]
            }
        }

        // render the last span
        element.createEl('span', {text: span_str})
    })
}