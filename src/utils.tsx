import { App } from 'obsidian'

export interface TreeNode {
    content: string
    children: TreeNode[]
}

export function parseMdList(source: string): TreeNode {
    const root: TreeNode = { content: 'root', children: [] }
    const stack: TreeNode[] = [root]
    
    function countLeadingTabs(str: string) {
        const match = str.match(/^\t+/)
        return match ? match[0].length : 0
    }

    const rows = source.split('\n').filter((row) => row.length > 0)
    rows.forEach((row) => {
        const tab_num = countLeadingTabs(row)
        if (row.match(/^[\t]*- /) !== null) {
            // match new line started with '- ', create a new node
            const newNode: TreeNode = { content: row.replace(/^[\t]*- /, '').trim(), children: [] }

            while (stack.length > tab_num + 1) {
                stack.pop()
            }

            stack[stack.length - 1].children.push(newNode)
            stack.push(newNode)
        } else {
            // append the row to the current node
            stack[stack.length - 1].content += `\n${row.replace(/^\t+/, ' ')}`
        }
    })

    return root
}


export async function cachedReadFname(fname: string, app: App): Promise<string> {
	const f = app.metadataCache.getFirstLinkpathDest(fname, '')
	if (f) {
		return await app.vault.cachedRead(f)
	}
	return ''
}