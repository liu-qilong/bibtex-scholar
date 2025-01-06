import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, MarkdownRenderer, setTooltip } from 'obsidian'
import { parse_bitex, BibtexField, BibtexDict } from 'src/bibtex'
import { render_hover } from 'src/hover'


interface BibtexScholarCache {
	bibtex_dict: BibtexDict
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
				let duplicate

				if (this.cache.bibtex_dict[id] && (this.cache.bibtex_dict[id].source_path != ctx.sourcePath)) {
					// if the same id existed in different files, prompt warning
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
						source_path: ctx.sourcePath,
					}
					await this.save_cache()
				}

				// render paper entry
				const paper_bar = el.createEl('span', {
					cls: (duplicate)?('bibtex-entry-duplicate-id'):('bibtex-entry'),
				})
				render_hover(paper_bar, this.cache.bibtex_dict[id])
			}
		})

		// inline reference of paper
		this.registerMarkdownPostProcessor((el, ctx) => {
			const codeblocks = el.findAll('code')

			for (let codeblock of codeblocks) {
				const text = codeblock.innerText.trim()
				if (text[0] === '{' && text[text.length - 1] === '}') {
					const paper_id = text.slice(1, -1)
					const paper_bar = codeblock.createSpan()
					render_hover(paper_bar, this.cache.bibtex_dict[paper_id])
					codeblock.replaceWith(paper_bar)
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