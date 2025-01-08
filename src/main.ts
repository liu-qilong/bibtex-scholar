import { App, Editor, Notice, Plugin, Setting, PluginSettingTab, MarkdownRenderer, type MarkdownPostProcessorContext } from 'obsidian'
import { parse_bitex, make_bibtex, check_duplicate_id, type BibtexDict } from 'src/bibtex'
import { render_hover } from 'src/hover'
import { ModalPrompt, EditorPrompt } from 'src/prompt'
import { PaperPanelView, PAPER_PANEL_VIEW_TYPE } from 'src/panel'

interface BibtexScholarCache {
	bibtex_dict: BibtexDict,
	note_folder: string,
	pdf_folder: string,
}

const DEFAULT_SETTINGS: BibtexScholarCache = {
	bibtex_dict: {},
	note_folder: 'note',
	pdf_folder: 'pdf',
}

export default class BibtexScholar extends Plugin {
	cache: BibtexScholarCache

	async onload() {
		await this.load_cache()

		// setting tab
		this.addSettingTab(new BibtexScholarSetting(this.app, this))

		// bibtex code block processor
		this.registerMarkdownCodeBlockProcessor('bibtex', async (source, el, ctx) => await this.bibtex_codeblock_processor(source, el, ctx))

		// inline reference of paper
		this.registerMarkdownPostProcessor((el, ctx) => this.inline_ref_processor(el, ctx))

		// commands for copy all bibtex entries to the clipboard
		this.addRibbonIcon('scroll-text', 'Copy All BibTeX', (evt: MouseEvent) => this.cp_bibtex(true))

		this.addCommand({
			id: 'copy-file-bibtex',
			name: 'Copy BibTeX Entries from Current File',
			checkCallback: (checking: boolean) => {
				if (!checking) {
					this.cp_bibtex(false)
				}
				return true
			},
		})

		// commands for uncache bibtex entries
		this.addCommand({
			id: 'uncache-all-bibtex',
			name: 'Uncache All BibTeX Entries',
			checkCallback: (checking: boolean) => {
				if (!checking) {
					this.uncache_bibtex(true)
				}
				return true
			},
		})

		this.addCommand({
			id: 'uncache-file-bibtex',
			name: 'Uncache BibTeX Entries from Current File',
			checkCallback: (checking: boolean) => {				
				if (!checking) {
					this.uncache_bibtex(false)
				}
				return true
			},
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

	async bibtex_codeblock_processor(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		// parse bibtex
		const fields_ls = await parse_bitex(source)
		fields_ls.forEach( async (fields) => {
			const id = fields.id
			const bibtex_source = make_bibtex(fields)
			const duplicate = check_duplicate_id(
				this.cache.bibtex_dict, id,
				ctx.sourcePath,
				String(ctx.getSectionInfo(el)?.text)
			)
	
			if (duplicate) {
				// if duplicated, prompt warning
				const fragment = new DocumentFragment()
				const p = document.createElement("p")
				MarkdownRenderer.render(this.app, `Warning: BibTeX ID has been used\n\`${id}\`\nRevise for successful import`, p, '', this)
				fragment.append(p)
				new Notice(fragment, 5e3)
			} else {
				// if not duplicated, check if the id exists
				// if exists, only cache bibtex code that is updated
				// if not exists, cache the bibtex entry
				if (!this.cache.bibtex_dict[id] || this.cache.bibtex_dict[id].source != bibtex_source) {
					this.cache.bibtex_dict[id] = {
						fields: fields,
						source: bibtex_source,
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
		})
	}

	inline_ref_processor(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
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
	}

	cp_bibtex(all: boolean = false) {
		let bibtex = ''
		const current_file = this.app.workspace.getActiveFile()
		
		for (const id in this.cache.bibtex_dict) {
			if (!all) {
				// if not all, only copy bibtex from the current file
				if (!current_file || (current_file && this.cache.bibtex_dict[id].source_path != current_file.path)) {
					continue
				}
			}
			bibtex += this.cache.bibtex_dict[id].source + '\n\n'
		}
		
		navigator.clipboard.writeText(bibtex)
		new Notice('Copied BibTeX entries to clipboard')
	}

	async uncache_bibtex(all: boolean = false) {
		// prompt confirm
		const confirmed = window.confirm('Are you sure you want to uncache BibTeX entries?')
		const current_file = this.app.workspace.getActiveFile()
					
		if (!confirmed) {
			return false
		}

		// uncache bibtex entries
		for (const id in this.cache.bibtex_dict) {
			if (!all) {
				// if not all, only uncache bibtex from the current file
				if (!current_file || (current_file && this.cache.bibtex_dict[id].source_path != current_file.path)) {
					continue
				}
			}
			delete this.cache.bibtex_dict[id]
		}
		this.save_cache()
		new Notice('Uncached all BibTeX entries')
	}

	add_paper_panel() {
		const { workspace } = this.app
		let leaf = workspace.getRightLeaf(false)

		if (leaf) {
			leaf.setViewState({ type: PAPER_PANEL_VIEW_TYPE, active: true })
		}
	}
}

class BibtexScholarSetting extends PluginSettingTab {
	plugin: BibtexScholar

	constructor(app: App, plugin: BibtexScholar) {
		super(app, plugin)
		this.plugin = plugin
	}

	display(): void {
		const {containerEl} = this

		containerEl.empty()

		new Setting(containerEl)
			.setName('Default paper note folder')
			.setDesc('When click on the note button, it will create a note in this folder. Without / at the end')
			.addText(text => text
				.setValue(this.plugin.cache.note_folder)
				.onChange(async (value) => {
					this.plugin.cache.note_folder = value
					await this.plugin.save_cache()
				}))

		new Setting(containerEl)
			.setName('Default PDF folder')
			.setDesc('When click on the pdf button, it will upload a PDF file to this folder. Without / at the end')
			.addText(text => text
				.setValue(this.plugin.cache.pdf_folder)
				.onChange(async (value) => {
					this.plugin.cache.pdf_folder = value
					await this.plugin.save_cache()
				}))
	}
}
