import { StrictMode } from 'react'
import { type App, MarkdownPostProcessorContext } from 'obsidian'
import { Root, createRoot } from 'react-dom/client'
import { LayoutFlowProps, FlowView } from './reactflow'
import { type TreeNode, parseMdList, cachedReadFname } from './utils'

// construct nodes & edges recursively
function parsePattern(str: string) {
	const pattern = /\[\[([^|\]]+)(?:\|([^|\]]+))?\]\](?::(.+))?/
	const match = str.match(pattern)

	if (match) {
		const fname = match[1]
		const label = match[2] || null
		const desc = match[3] || null
		return { fname, label, desc }
	  } else {
		return null
	  }
}

async function drawNode(
    node: TreeNode,
	node_id: string | null,
	props: LayoutFlowProps,
    app: App,
) {
	let child_content

	for (let idx = 0; idx < node.children.length; idx++) {
		let child = node.children[idx]

		// parse pattern
		const pattern = parsePattern(child.content)
		if (!pattern) {
			child_content = child.content
		} else {
			child_content = await cachedReadFname(pattern.fname, app)
			let parts = child_content.split('---')
			child_content = parts.length > 2 ? parts[2].trim() : ''
		}

		console.log(child_content)

		// add child node
		const child_id = `node-${props.nodes.length}`
		props.nodes.push({
			id: child_id,
			type: 'note',
			position: {x: 0, y: 0},
			// data: { source: child.content },
			data: { source: child_content },
		})

		if (node_id) {
			props.edges.push({
				id: `edge-${props.edges.length}`,
				source: node_id,
				target: child_id,
				animated: true,
			})
		}

		// recursively draw children
        if (child.children.length > 0) {
            drawNode(child, child_id, props, app)
        }
    }
}

export const renderThread = async (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext, app: App) => {
	// parse markdown list as a tree
    const root = parseMdList(source)

	// add nodes & edges to props
	let props = { nodes: [], edges: [] }
	await drawNode(root, null, props, app)

	// render thread
	createRoot(el).render(
		<StrictMode>
			<FlowView {...props}/>
		</StrictMode>,
	);
}