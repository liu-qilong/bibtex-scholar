import { App, Editor, Notice, Plugin, Setting, PluginSettingTab, MarkdownRenderer, type MarkdownPostProcessorContext } from 'obsidian'
import { parse_bitex, make_bibtex, check_duplicate_id, FetchBibtexOnline, type BibtexDict } from 'src/bibtex'
import { render_hover } from 'src/hover'
import { EditorPrompt } from 'src/prompt'
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
		this.addRibbonIcon(
			'scroll-text',
			'Copy All BibTeX',
			(evt: MouseEvent) => this.cp_bibtex()
		)

		this.addCommand({
			id: 'copy-all-bibtex',
			name: 'Copy All BibTeX Entries',
			checkCallback: (checking: boolean) => {
				if (!checking) {
					this.cp_bibtex()
				}
				return true
			},
		})

		// commands for copy file in standard markdown syntax
		this.addCommand({
			id: 'copy-std-md',
			name: 'Copy Current File as Standard Markdown',
			checkCallback: (checking: boolean) => {
				if (!checking) {
					this.cp_std_md()
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
					this.uncache_bibtex()
				}
				return true
			},
		})

		this.addCommand({
			id: 'uncache-file-bibtex',
			name: 'Uncache BibTeX Entries from Current File',
			checkCallback: (checking: boolean) => {				
				if (!checking) {
					const current_file = this.app.workspace.getActiveFile()
					if (current_file) {
						this.uncache_bibtex(current_file.path)
					}
				}
				return true
			},
		})
		
		// events for rename and delete file
		this.registerEvent(this.app.vault.on('rename', (file, old_path) => {
			this.update_bibtex_source(old_path, file.path)
		}))

		this.registerEvent(this.app.vault.on('delete', (file) => {
			this.uncache_bibtex(file.path)
		}))

		// commands for fetch bibtex online
		this.addRibbonIcon(
			'antenna',
			'Fetch BibTeX Online',
			(evt: MouseEvent) => new FetchBibtexOnline(this.app, this).open()
		)

		this.addCommand({
			id: 'fetch-bibtex-online',
			name: 'Fetch BibTeX Online',
			checkCallback: (checking: boolean) => {
				if (!checking) {
					new FetchBibtexOnline(this.app, this).open()
				}
				return true
			},
		})

		// cite paper editor prompt
		this.registerEditorSuggest(new EditorPrompt(this.app, this.cache.bibtex_dict))

		// paper panel
		this.registerView(
			PAPER_PANEL_VIEW_TYPE,
			(leaf) => new PaperPanelView(leaf, this.cache.bibtex_dict, this)
		)

		this.addRibbonIcon('scan-search', 'Paper Panel', () => {
			this.add_paper_panel()
		})

		this.addCommand({
			id: 'open-paper-panel',
			name: 'Open Paper Panel',
			checkCallback: (checking: boolean) => {
				if (!checking) {
					this.add_paper_panel()
				}
				return true
			},
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

	cp_bibtex() {
		let bibtex = ''
		const current_file = this.app.workspace.getActiveFile()
		
		for (const id in this.cache.bibtex_dict) {
			bibtex += make_bibtex(this.cache.bibtex_dict[id].fields, false) + '\n'
		}
		
		navigator.clipboard.writeText(bibtex)
		new Notice('Copied BibTeX entries to clipboard')
	}

	async cp_std_md() {
		const current_file = this.app.workspace.getActiveFile()
		// read file content
		if (current_file) {
			let content = await this.app.vault.read(current_file)
			content = content.replace(/```bibtex[\s\S]*?```/g, '')
			content = content.replace(/\`(\{|\[)([^\}\]]+)(\}|\])\`/g, (match, p1, id, p3) => {
				const fields = this.cache.bibtex_dict[id]?.fields
				if (fields.url) {
					return `[${id}](${fields.url})`
				} else if  (fields.doi){
					return `[${id}](http://dx.doi.org/${fields.doi})`
				} else {
					return `[${id}](data:text/plain,${encodeURIComponent(this.cache.bibtex_dict[id].source)})`
				}

				// encode entire bibtex in the link (abandoned)
				// return `[${id}](data:text/plain,${encodeURIComponent(this.cache.bibtex_dict[id].source)})`
			})
			navigator.clipboard.writeText(content)
			new Notice('Copied standard markdown to clipboard')
		} else {
			new Notice('No active file to copy')
		}
	}

	async uncache_bibtex(source_path: string = '') {
		let update = false

		// uncache bibtex entries
		for (const id in this.cache.bibtex_dict) {
			if (source_path == '') {
				// if source_path is empty, prompt confirmation and then uncache all bibtex entries
				if (window.confirm('Are you sure you want to uncache BibTeX entries?')) {
					delete this.cache.bibtex_dict[id]
					update = true
				}
			} else if (this.cache.bibtex_dict[id].source_path == source_path) {
				// if source_path is not empty, uncache bibtex entries from the current file
				delete this.cache.bibtex_dict[id]
				update = true
			}
		}

		if (update) {
			await this.save_cache()
			new Notice('Uncached BibTeX entries')
		}
	}

	async update_bibtex_source(old_path: string, new_path: string) {
		let update = false

		// uncache bibtex entries
		for (const id in this.cache.bibtex_dict) {
			if (this.cache.bibtex_dict[id].source_path == old_path) {
				// if source_path is not empty, uncache bibtex entries from the current file
				this.cache.bibtex_dict[id].source_path = new_path
				update = true
			}
		}

		if (update) {
			await this.save_cache()
			new Notice('Updated BibTeX entry paths')
		}
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
