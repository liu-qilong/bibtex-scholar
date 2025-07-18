import { App, Editor, Notice, Plugin, Setting, PluginSettingTab, MarkdownRenderer, type MarkdownPostProcessorContext } from 'obsidian'
import { parse_bibtex, make_bibtex, check_duplicate_id, FetchBibtexOnline, type BibtexDict } from 'src/bibtex'
import { render_hover } from 'src/hover'
import { EditorPrompt } from 'src/prompt'
import { PaperPanelView, PAPER_PANEL_VIEW_TYPE } from 'src/panel'

interface BibtexScholarCache {
	bibtex_dict: BibtexDict,
	note_folder: string,
	pdf_folder: string,
	fetch_mode: string,
}

const DEFAULT_SETTINGS: BibtexScholarCache = {
	bibtex_dict: {},
	note_folder: 'note',
	pdf_folder: 'pdf',
	fetch_mode: 'doi',
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
			name: 'Copy current file as standard markdown',
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
			name: 'Uncache all BibTeX entries',
			checkCallback: (checking: boolean) => {
				if (!checking) {
					if (window.confirm('Are you sure?')) {
						this.uncache_bibtex_all()
					}
				}
				return true
			},
		})

		this.addCommand({
			id: 'uncache-file-bibtex',
			name: 'Uncache BibTeX entries from current file',
			checkCallback: (checking: boolean) => {				
				if (!checking) {
					const current_file = this.app.workspace.getActiveFile()
					if (current_file) {
						if (window.confirm('Are you sure?')) {
							this.uncache_bibtex_from_path(current_file.path)
						}
					}
				}
				return true
			},
		})
		
		// events for rename and delete file
		this.registerEvent(this.app.vault.on('rename', (file, old_path) => {
			this.update_bibtex_source_path(old_path, file.path)
		}))

		this.registerEvent(this.app.vault.on('delete', (file) => {
			this.uncache_bibtex_from_path(file.path)
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

	/**
	 * Loads the plugin cache from storage.
	 * P.S. The BibTeX entries is also loaded from the cache: this.cache.bibtex_dict
	 */
	async load_cache() {
		this.cache = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
	}

	/**
	 * Saves the plugin cache to storage.
	 * P.S. The BibTeX entries are also saved to the cache: this.cache.bibtex_dict
	 */
	async save_cache() {
		// console.log('export bibtex cache')
		await this.saveData(this.cache)
	}

	/**
	 * Processes a BibTeX code block.
	 * It adds the BibTeX entry to the cache if no duplication is found.
	 * @param {string} source - The source text of the code block.
	 * @param {HTMLElement} el - The HTML element representing the code block.
	 * @param {MarkdownPostProcessorContext} ctx - The Markdown post-processing context.
	 */
	async bibtex_codeblock_processor(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		// parse bibtex
		const fields_ls = await parse_bibtex(source)
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
	
			// render paper element
			const paper_bar = el.createEl('span', {
				cls: (duplicate)?('bibtex-hover-duplicate-id'):('bibtex-entry'),
			})
			render_hover(paper_bar, this.cache.bibtex_dict[id], this, this.app)
			el.createEl('code').setText('source')
		})
	}

	/**
	 * Processes an inline reference in the formats:
	 * * `{<id>}`: Show the collapsed paper element (hover to expand)
	 * * `[<id>]`: Show the expanded paper element
	 * @param el - The HTML element representing the inline reference.
	 * @param ctx - The Markdown post-processing context.
	 */
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

	/**
	 * Copy all BibTeX entries to clipboard
	 * P.S. The abstract will be omitted to ensure that LaTeX compiles correctly
	 */
	cp_bibtex() {
		let bibtex = ''
		const current_file = this.app.workspace.getActiveFile()
		
		for (const id in this.cache.bibtex_dict) {
			bibtex += make_bibtex(this.cache.bibtex_dict[id].fields, false) + '\n'
		}
		
		navigator.clipboard.writeText(bibtex)
		new Notice('Copied BibTeX entries to clipboard')
	}

	/**
	 * Copy the current file's content as standard markdown, i.e. replacing inline references with url links
	 */
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

	/**
	 * Uncache a single BibTeX entry
	 * @param paper_id - The ID of the paper to uncache
	 */
	async uncache_bibtex_with_id(paper_id: string) {
		// uncache single bibtex
		delete this.cache.bibtex_dict[paper_id]
		await this.save_cache()
		new Notice(`Uncached ${paper_id}`)
	}
	
	/**
	 * Uncache all BibTeX entry from a path
	 * @param path - The path to uncache papers from
	 */
	async uncache_bibtex_from_path(path: string) {
		// batch uncache
		let update = false

		for (const id in this.cache.bibtex_dict) {
			if (this.cache.bibtex_dict[id].source_path == path) {
				delete this.cache.bibtex_dict[id]
				update = true
			}
		}

		if (update) {
			await this.save_cache()
			new Notice(`Uncached BibTeX entries from ${path}`)
		}
	}

	/**
	 * Uncache all BibTeX entry
	 */
	async uncache_bibtex_all() {
		// batch uncache
		for (const id in this.cache.bibtex_dict) {
			delete this.cache.bibtex_dict[id]
		}

		await this.save_cache()
		new Notice('Uncached all BibTeX entries')
	}

	/**
	 * Update the source path of a BibTeX entry
	 * P.S. Usually called when a file is renamed
	 * @param old_path - The old source path
	 * @param new_path - The new source path
	 */
	async update_bibtex_source_path(old_path: string, new_path: string) {
		let update = false

		// update bibtex entries
		for (const id in this.cache.bibtex_dict) {
			if (this.cache.bibtex_dict[id].source_path == old_path) {
				// if source_path is not empty, update bibtex entries from the current file
				this.cache.bibtex_dict[id].source_path = new_path
				update = true
			}
		}

		if (update) {
			await this.save_cache()
			new Notice('Updated BibTeX entry paths')
		}
	}

	/**
	 * Add paper panel to the right sidebar
	 */
	add_paper_panel() {
		const { workspace } = this.app
		let leaf = workspace.getRightLeaf(false)

		if (leaf) {
			leaf.setViewState({ type: PAPER_PANEL_VIEW_TYPE, active: true })
		}
	}
}

/**
 * BibTeX Scholar's setting
 */
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

		new Setting(containerEl)
			.setName('Default mode for fetching BibTeX online')
			.setDesc('Choose the default mode for fetching BibTeX entries online')
			.addDropdown(dropdown => dropdown
				.addOption('doi', 'DOI')
				.addOption('manual', 'Manual')
				.setValue(this.plugin.cache.fetch_mode)
				.onChange(async (value) => {
					this.plugin.cache.fetch_mode = value
					await this.plugin.save_cache()
				}))
	}
}
