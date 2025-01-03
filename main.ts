import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, MarkdownRenderer } from 'obsidian'
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
		console.log(this.cache)

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
					MarkdownRenderer.render(this.app, `Warning: BibTeX ID has been used\n\`${id}\``, p, '', this)
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