import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, MarkdownRenderer, setTooltip } from 'obsidian'
import tippy from "tippy.js"
import { parse_bitex, BibtexField } from 'src/parse'


interface BibtexScholarCache {
	bibtex_dict: {
		[key: string]: {  // paper id
			fields: BibtexField,  // bibtex fields
			[key: string]: any,  // other data associated to the paper
		}
	}
}

const DEFAULT_SETTINGS: BibtexScholarCache = {
	bibtex_dict: {}
}

export default class BibtexScholar extends Plugin {
	cache: BibtexScholarCache

	async onload() {
		await this.load_cache()

		// bibtex code block processor
		this.registerMarkdownCodeBlockProcessor('bibtex', async (source, el, ctx) => {
			// parse bibtex
			const fields = parse_bitex(source)

			if (fields != null) {
				const id = fields.id
				let duplicate = false

				if (this.cache.bibtex_dict[id] && this.cache.bibtex_dict[id].source_path != ctx.sourcePath) {
					// if id existed, prompt warning
					duplicate = true
					const fragment = new DocumentFragment()
					const p = document.createElement("p")
					MarkdownRenderer.render(this.app, `Warning: BibTeX ID has been used\n\`${id}\`\nRevise for successful import`, p, '', this)
					fragment.append(p)
					new Notice(fragment, 0)
				} else {
					// otherwise, add paper entry to cache and export
					this.cache.bibtex_dict[id] = {
						fields: fields,
						source: source,
						source_path: ctx.sourcePath
					}
					await this.save_cache()
				}

				// render paper entry
				el.createEl('hr')
				let table
				
				if (duplicate) {
					table = el.createEl('table', { cls: 'bibtex-entry-duplicate-id' })  // mark duplication in the class
				} else {
					table = el.createEl('table', { cls: 'bibtex-entry' })
				}
				
				const body = table.createEl('tbody')
				
				for (const key in fields) {
					const tr = body.createEl('tr')
					const td1 = tr.createEl('td')
					td1.innerText = key
					const td2 = tr.createEl('td')
					MarkdownRenderer.render(this.app, fields[key], td2, '', this)
				}
			}
		})

		// inline reference of paper
		this.registerMarkdownPostProcessor((el, ctx) => {
			const codeblocks = el.findAll('code')

			for (let codeblock of codeblocks) {
				const text = codeblock.innerText.trim()
				if (text[0] === ':' && text[text.length - 1] === ':') {
					const paper_id = text.slice(1, -1)
					const paper_bibtex = this.cache.bibtex_dict[paper_id]?.source || 'null'
					
					const paper_el = codeblock.createEl('a', { text: paper_id })
					setTooltip(paper_el, paper_bibtex)
					codeblock.replaceWith(paper_el)
				}
			}
		})

		// copy all bibtex entries to the clipboard
		const cp_all_btn = this.addRibbonIcon('package', 'Copy All BibTeX', (evt: MouseEvent) => {
			let bibtex = ''
			for (const id in this.cache.bibtex_dict) {
				bibtex += this.cache.bibtex_dict[id].source + '\n\n'
			}
			navigator.clipboard.writeText(bibtex)
		})
		cp_all_btn.addClass('my-plugin-ribbon-class')
	}

	onunload() {

	}

	async load_cache() {
		this.cache = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
	}

	async save_cache() {
		await this.saveData(this.cache)
	}
}