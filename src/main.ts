import { App, Notice, Plugin, Setting, PluginSettingTab, TFile, normalizePath, type MarkdownPostProcessorContext } from 'obsidian'
import { parse_bibtex, make_bibtex, check_duplicate_id, check_duplicate_doi, find_clashes, same_paper, replace_inline_citekey, INLINE_CITE_RE, FetchBibtexOnline, RenameCitekeyModal, type BibtexDict, type BibtexField, type Clash, type ClashHit, type CiteHit } from 'src/bibtex'
import { HoverRenderChild } from 'src/hover'
import { EditorPrompt, FolderSuggest, FileSuggest } from 'src/prompt'
import { PaperPanelView, PAPER_PANEL_VIEW_TYPE } from 'src/panel'
import { createHoverWidgetPlugin } from 'src/editor'

interface BibtexScholarCache {
	bibtex_dict: BibtexDict,
	note_folder: string,
	pdf_folder: string,
	template_path: string,
	fetch_mode: string,
}

const DEFAULT_SETTINGS: BibtexScholarCache = {
	bibtex_dict: {},
	note_folder: 'note',
	pdf_folder: 'pdf',
	template_path: '',
	fetch_mode: 'doi',
}

export default class BibtexScholar extends Plugin {
	cache: BibtexScholarCache
	renaming = false
	rename_timers = new Map<string, number>()

	async onload() {
		await this.load_cache()

		// setting tab
		this.addSettingTab(new BibtexScholarSetting(this.app, this))

		// bibtex code block processor
		this.registerMarkdownCodeBlockProcessor('bibtex', async (source, el, ctx) => await this.bibtex_codeblock_processor(source, el, ctx))

		// inline reference of paper
		// reading view
		this.registerMarkdownPostProcessor((el, ctx) => this.inline_ref_processor(el, ctx))
		// editing view (source + live preview modes)
		const hover_widget_editor_plugin = createHoverWidgetPlugin(this, this.app)
		this.registerEditorExtension(hover_widget_editor_plugin)

		// commands for copy all bibtex entries to the clipboard
		this.addRibbonIcon(
			'scroll-text',
			'Copy all BibTeX',
			(evt: MouseEvent) => this.cp_bibtex()
		)

		this.addCommand({
			id: 'copy-all-bibtex',
			name: 'Copy all BibTeX entries',
			callback: () => {
				this.cp_bibtex()
			},
		})

		// commands for copy file in standard markdown syntax
		this.addCommand({
			id: 'copy-std-md',
			name: 'Copy current file as standard markdown',
			checkCallback: (checking: boolean) => {
				const current_file = this.app.workspace.getActiveFile()
				if (checking) return Boolean(current_file) // return true if active file exists
				if (current_file) {
					this.cp_std_md()
				}
			},
		})

		// commands for copy file with `{}` replaced as \autocite{}
		this.addCommand({
			id: 'copy-autocite-md',
			name: 'Copy current file with ` {id}`  replaced as \\autocite{id}',
			checkCallback: (checking: boolean) => {
				const current_file = this.app.workspace.getActiveFile()
				if (checking) return Boolean(current_file) // return true if active file exists
				if (current_file) {
					this.cp_autocite_md()
				}
			},
		})

		// commands for uncache bibtex entries
		this.addCommand({
			id: 'uncache-all-bibtex',
			name: 'Uncache all BibTeX entries',
			callback: () => {
				if (window.confirm('Are you sure?')) {
					this.uncache_bibtex_all()
				}
			},
		})

		this.addCommand({
			id: 'uncache-file-bibtex',
			name: 'Uncache BibTeX entries from current file',
			checkCallback: (checking: boolean) => {
				const current_file = this.app.workspace.getActiveFile()
				if (checking) return Boolean(current_file) // return true if active file exists
				if (current_file) {
					if (window.confirm('Are you sure?')) {
						this.uncache_bibtex_from_path(current_file.path)
					}
				}
			},
		})

		// full vault recache from ```bibtex blocks (no confirm; reports clash count)
		this.addCommand({
			id: 'recache-vault-bibtex',
			name: 'Recache all BibTeX entries from vault',
			callback: () => {
				void this.recache_vault_command()
			},
		})

		// events for rename and delete file
		this.registerEvent(this.app.vault.on('rename', (file, old_path) => {
			this.update_bibtex_source_path(old_path, file.path)
		}))

		this.registerEvent(this.app.vault.on('delete', (file) => {
			this.uncache_bibtex_from_path(file.path)
		}))

		// citekey rename: only runs on file modify (debounced), not on idle
		this.registerEvent(this.app.vault.on('modify', (file) => {
			if (this.renaming) return
			if (!(file instanceof TFile) || file.extension !== 'md') return
			const prev = this.rename_timers.get(file.path)
			if (prev) window.clearTimeout(prev)
			const t = window.setTimeout(() => {
				this.rename_timers.delete(file.path)
				this.on_file_modified(file)
			}, 400)
			this.rename_timers.set(file.path, t)
		}))

		this.addCommand({
			id: 'propagate-key-change',
			name: 'Propagate citekey rename',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile()
				if (checking) return Boolean(file)
				if (file) this.on_file_modified(file, true)
			},
		})

		// commands for fetch bibtex online
		this.addRibbonIcon(
			'antenna',
			'Fetch BibTeX online',
			(evt: MouseEvent) => new FetchBibtexOnline(this.app, this).open()
		)

		this.addCommand({
			id: 'fetch-bibtex-online',
			name: 'Fetch BibTeX online',
			callback: () => {
				new FetchBibtexOnline(this.app, this).open()
			},
		})

		// cite paper editor prompt
		this.registerEditorSuggest(new EditorPrompt(this.app, this.cache.bibtex_dict))

		// paper panel
		this.registerView(
			PAPER_PANEL_VIEW_TYPE,
			(leaf) => new PaperPanelView(leaf, this.cache.bibtex_dict, this)
		)

		this.addRibbonIcon('scan-search', 'Paper panel', () => {
			this.add_paper_panel()
		})

		this.addCommand({
			id: 'open-paper-panel',
			name: 'Open paper panel',
			callback: () => {
				this.add_paper_panel()
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
		fields_ls.forEach(async (fields) => {
			const id = fields.id
			const bibtex_source = make_bibtex(fields)
			const id_duplicate = check_duplicate_id(
				this.cache.bibtex_dict, id,
				ctx.sourcePath,
				String(ctx.getSectionInfo(el)?.text)
			)
			const doi_duplicate = check_duplicate_doi(
				this.cache.bibtex_dict, fields.doi, id, ctx.sourcePath
			)
			const duplicate = id_duplicate || doi_duplicate

			if (duplicate) {
				// if duplicated, prompt warning
				if (id_duplicate) {
					new Notice(`Warning: BibTeX ID has been used\n${id}`, 10e3)
				}
				if (doi_duplicate) {
					new Notice(`Warning: BibTeX DOI has been used\n${fields.doi}`, 10e3)
				}
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

			// render paper element (HoverRenderChild unmounts React when the section is discarded)
			// if doi-clash rejected a new id, fall back to the local fields so it still paints
			const paper_bar = el.createEl('span', {
				cls: (duplicate) ? ('bibtex-hover-duplicate-id') : ('bibtex-entry'),
			})
			const entry = this.cache.bibtex_dict[id] ?? {
				fields: fields,
				source: bibtex_source,
				source_path: ctx.sourcePath,
			}
			ctx.addChild(new HoverRenderChild(paper_bar, entry, this, this.app, false))
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
					codeblock.replaceWith(paper_bar)
					ctx.addChild(new HoverRenderChild(
						paper_bar,
						this.cache.bibtex_dict[paper_id],
						this,
						this.app,
						text[0] === '[',
					))
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
				} else if (fields.doi) {
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
	 * Copy the current file's content with `{id}` replaced as \autocite{id}
	 */
	async cp_autocite_md() {
		const current_file = this.app.workspace.getActiveFile()
		// read file content
		if (current_file) {
			let content = await this.app.vault.read(current_file)
			content = content.replace(/```bibtex[\s\S]*?```/g, '')
			content = content.replace(/\`(\{|\[)([^\}\]]+)(\}|\])\`/g, (match, p1, id, p3) => {
				const fields = this.cache.bibtex_dict[id]?.fields
				return `\\autocite{${id}}`
			})
			navigator.clipboard.writeText(content)
			new Notice('Copied with \\autocite{} to clipboard')
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
	 * Command-palette entry: silent vault rescan, then notice with clash count.
	 * If clashes exist, points the user at the paper panel collision view.
	 */
	async recache_vault_command() {
		new Notice('Recaching BibTeX from vault…')
		const clashes = await this.rescan_vault()
		const n = Object.keys(this.cache.bibtex_dict).length
		if (clashes.length > 0) {
			new Notice(
				`Recached ${n} BibTeX entr${n === 1 ? 'y' : 'ies'}: ${clashes.length} collision group${clashes.length === 1 ? '' : 's'} found. Open the Paper panel and use Recache and collect collisions to review them.`,
				10e3
			)
		} else {
			new Notice(`Recached ${n} BibTeX entr${n === 1 ? 'y' : 'ies'}: no collisions found.`)
		}
	}

	/** Scan ```bibtex blocks, rebuild cache (first id + DOI wins), return undirected clashes. */
	async rescan_vault(): Promise<Clash[]> {
		type ScanHit = ClashHit & { fields: BibtexField }
		const hits: ScanHit[] = []
		const files = this.app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path))

		for (const file of files) {
			const text = await this.app.vault.read(file)
			const block_re = /```bibtex[^\n]*\n([\s\S]*?)```/g
			let match: RegExpExecArray | null

			while ((match = block_re.exec(text)) !== null) {
				const line = text.slice(0, match.index).split('\n').length - 1
				for (const fields of await parse_bibtex(match[1])) {
					hits.push({
						id: fields.id,
						doi: fields.doi,
						path: file.path,
						line,
						fields,
					})
				}
			}
		}

		hits.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)

		for (const id in this.cache.bibtex_dict) {
			delete this.cache.bibtex_dict[id]
		}

		const used_dois = new Set<string>()
		for (const h of hits) {
			if (h.id in this.cache.bibtex_dict) continue
			if (h.doi && used_dois.has(h.doi)) continue
			this.cache.bibtex_dict[h.id] = {
				fields: h.fields,
				source: make_bibtex(h.fields),
				source_path: h.path,
			}
			if (h.doi) used_dois.add(h.doi)
		}

		await this.save_cache()
		return find_clashes(hits)
	}

	async open_line(path: string, line: number) {
		const file = this.app.vault.getAbstractFileByPath(path)
		if (!(file instanceof TFile)) {
			new Notice(`File not found: ${path}`)
			return
		}
		// Open in the main split only. getLeaf(false) after a panel click can
		// target the side panel and replace the paper panel itself.
		const leaf =
			this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit)
			?? this.app.workspace.getLeaf(true)
		await leaf.openFile(file, { eState: { line } })
	}

	async on_file_modified(file: TFile, from_command = false) {
		const renames = await this.detect_citekey_renames(file)
		if (renames.length === 0) {
			if (from_command) new Notice('No citekey rename detected in this file')
			return
		}
		// one at a time
		const { old_id, new_id } = renames[0]
		await this.offer_rename(old_id, new_id)
	}

	async detect_citekey_renames(file: TFile): Promise<{ old_id: string, new_id: string }[]> {
		const text = await this.app.vault.read(file)
		const current: BibtexField[] = []
		const block_re = /```bibtex[^\n]*\n([\s\S]*?)```/g
		let match: RegExpExecArray | null
		while ((match = block_re.exec(text)) !== null) {
			current.push(...await parse_bibtex(match[1]))
		}

		const current_ids = new Set(current.map((f) => f.id))
		const cached = Object.entries(this.cache.bibtex_dict)
			.filter(([, e]) => e.source_path === file.path)

		const used_new = new Set<string>()
		const out: { old_id: string, new_id: string }[] = []

		for (const [old_id, entry] of cached) {
			if (current_ids.has(old_id)) continue
			for (const fields of current) {
				if (fields.id === old_id || used_new.has(fields.id)) continue
				if (!same_paper(entry.fields, fields)) continue
				const other = this.cache.bibtex_dict[fields.id]
				if (other && other.source_path !== file.path) continue
				out.push({ old_id, new_id: fields.id })
				used_new.add(fields.id)
				break
			}
		}
		return out
	}

	async scan_inline_cites(old_id: string): Promise<CiteHit[]> {
		const hits: CiteHit[] = []
		for (const file of this.app.vault.getMarkdownFiles()) {
			const text = await this.app.vault.read(file)
			const body = text.replace(/```bibtex[\s\S]*?```/g, '')
			let count = 0
			INLINE_CITE_RE.lastIndex = 0
			let m: RegExpExecArray | null
			const re = new RegExp(INLINE_CITE_RE.source, 'g')
			while ((m = re.exec(body)) !== null) {
				if (m[2] === old_id) count++
			}
			if (count > 0) hits.push({ path: file.path, count })
		}
		return hits
	}

	async offer_rename(old_id: string, new_id: string) {
		const old = this.cache.bibtex_dict[old_id]
		if (!old) return

		const existing = this.cache.bibtex_dict[new_id]
		if (existing && existing.source_path !== old.source_path) {
			new Notice(`Citekey already used: ${new_id}`)
			return
		}

		const hits = await this.scan_inline_cites(old_id)
		new RenameCitekeyModal(this.app, old_id, new_id, hits, async () => {
			await this.rename_citekey(old_id, new_id)
		}).open()
	}

	async rename_citekey(old_id: string, new_id: string) {
		const old = this.cache.bibtex_dict[old_id]
		if (!old) {
			new Notice(`Unknown citekey: ${old_id}`)
			return
		}
		const existing = this.cache.bibtex_dict[new_id]
		if (existing && existing.source_path !== old.source_path) {
			new Notice(`Citekey already used: ${new_id}`)
			return
		}

		this.renaming = true
		try {
			const hits = await this.scan_inline_cites(old_id)
			let files_changed = 0
			for (const { path } of hits) {
				const file = this.app.vault.getAbstractFileByPath(path)
				if (!(file instanceof TFile)) continue
				const text = await this.app.vault.read(file)
				const next = replace_inline_citekey(text, old_id, new_id)
				if (next !== text) {
					await this.app.vault.modify(file, next)
					files_changed++
				}
			}

			const fields = { ...old.fields, id: new_id }
			this.cache.bibtex_dict[new_id] = {
				fields,
				source: make_bibtex(fields),
				source_path: old.source_path,
			}
			delete this.cache.bibtex_dict[old_id]
			await this.save_cache()

			const total = hits.reduce((s, h) => s + h.count, 0)
			new Notice(`Renamed ${old_id} → ${new_id} (${total} cite(s) in ${files_changed} file(s))`)
		} finally {
			this.renaming = false
		}
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
		const { containerEl } = this

		containerEl.empty()

		new Setting(containerEl)
			.setName('Default paper note folder')
			.setDesc('When click on the note button, it will create a note in this folder. Without / at the end')
			.addSearch(search => {
				search
					.setValue(this.plugin.cache.note_folder)
					.onChange(async (value) => {
						this.plugin.cache.note_folder = normalizePath(value);
						await this.plugin.save_cache();
					});
				// attach folder suggestion prompt
				new FolderSuggest(this.app, search.inputEl);
			});

		new Setting(containerEl)
			.setName('Default PDF folder')
			.setDesc('When click on the pdf button, it will upload a PDF file to this folder. Without / at the end')
			.addSearch(search => {
				search
					.setValue(this.plugin.cache.pdf_folder)
					.onChange(async (value) => {
						this.plugin.cache.pdf_folder = normalizePath(value);
						await this.plugin.save_cache();
					});
				// attach folder suggestion prompt
				new FolderSuggest(this.app, search.inputEl);
			});

		new Setting(containerEl)
			.setName('Custom paper note template path')
			.setDesc('Path to a template file used when creating associated paper notes from BibTeX entries. Leave empty to use the default.')
			.addSearch(search => {
				search
					.setPlaceholder('templates/bibtex-note.md')
					.setValue(this.plugin.cache.template_path || '')
					.onChange(async (value) => {
						this.plugin.cache.template_path = normalizePath(value);
						await this.plugin.save_cache();
					});
				// attach file suggestion prompt
				new FileSuggest(this.app, search.inputEl);
			});

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
