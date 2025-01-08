import { Editor, Notice, Plugin, MarkdownRenderer, WorkspaceLeaf } from 'obsidian'
import { parse_bitex, make_bibtex, BibtexDict } from 'src/bibtex'
import { render_hover } from 'src/hover'
import { ModalPrompt, EditorPrompt } from 'src/prompt'
import { PaperPanelView, PAPER_PANEL_VIEW_TYPE } from 'src/panel'

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
			parse_bitex(source)?.forEach( async (fields) => {
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
						if (!this.cache.bibtex_dict[id] || (this.cache.bibtex_dict[id] && source != this.cache.bibtex_dict[id].source)) {
							// if the id doesn't existed
							// or its source is changed
							// add paper entry to cache and export
							this.cache.bibtex_dict[id] = {
								fields: fields,
								source: make_bibtex(fields),
								source_path: ctx.sourcePath,
							}
							await this.save_cache()
						}
					}
	
					// render paper entry
					const paper_bar = el.createEl('span', {
						cls: (duplicate)?('bibtex-entry-duplicate-id'):('bibtex-entry'),
					})
					render_hover(paper_bar, this.cache.bibtex_dict[id], this, this.app)
					el.createEl('code').setText('source')
				}
			})
		})

		// inline reference of paper
		this.registerMarkdownPostProcessor((el, ctx) => {
			const codeblocks = el.findAll('code')

			for (let codeblock of codeblocks) {
				const text = codeblock.innerText.trim()
				
				if ((text[0] === '{' || text[0] === '[') && (text[text.length - 1] === '}' || text[text.length - 1] === ']')) {
					// `{<id>}` -> collapsed inline reference
					// `[<id>]` -> collapsed inline reference
					const paper_id = text.slice(1, -1)

					if (!this.cache.bibtex_dict[paper_id]) {
						new Notice(`Paper ID not found in BibTeX cache: ${paper_id}`)
						continue
					} else {
						const paper_bar = codeblock.createSpan()
						render_hover(paper_bar, this.cache.bibtex_dict[paper_id], this, this.app, text[0] === '[')
						codeblock.replaceWith(paper_bar)
					}
				}
			}
		})

		// copy all bibtex entries to the clipboard
		this.addRibbonIcon('scroll-text', 'Copy All BibTeX', (evt: MouseEvent) => {
			let bibtex = ''
			for (const id in this.cache.bibtex_dict) {
				bibtex += this.cache.bibtex_dict[id].source + '\n\n'
			}
			navigator.clipboard.writeText(bibtex)
			new Notice('Copied all BibTeX to clipboard')
		})

		// cite paper command & editor prompt
		this.addCommand({
			id: 'cite-paper',
			name: 'Cite Paper',
			editorCallback: (editor: Editor) => {
			  	new ModalPrompt(this.app, editor, this.cache.bibtex_dict).open()
			},
		})

		this.registerEditorSuggest(new EditorPrompt(this.app, this.cache.bibtex_dict))

		// paper panel
		this.registerView(
			PAPER_PANEL_VIEW_TYPE,
			(leaf) => new PaperPanelView(leaf, this.cache.bibtex_dict, this)
		)
		this.addRibbonIcon('scan-search', 'Paper Panel', () => {
			this.add_paper_panel()
		})
	}

	async onunload() {

	}

	async load_cache() {
		this.cache = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
	}

	async save_cache() {
		console.log('export bibtex cache')
		await this.saveData(this.cache)
	}

	async add_paper_panel() {
		const { workspace } = this.app
		let leaf = workspace.getRightLeaf(false)

		if (leaf) {
			leaf.setViewState({ type: PAPER_PANEL_VIEW_TYPE, active: true })
		}
	}
}