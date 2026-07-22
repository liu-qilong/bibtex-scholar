import { App, Notice, Plugin, TFile, TFolder, normalizePath, type MarkdownPostProcessorContext } from 'obsidian'
import { parse_bibtex, make_bibtex, entry_source, build_clash_reasons_by_id, check_duplicate_id, check_duplicate_doi, find_clashes, same_paper, replace_inline_citekey, source_tag_state, FetchBibtexOnline, RenameCitekeyModal, type BibtexDict, type BibtexField, type Clash, type ClashReason, type CiteHit } from 'src/bibtex'
import {
	audit_bibtex_dict,
	classify_path_fingerprints,
	delete_entry,
	entry_count,
	file_fingerprint,
	format_bibtex_for_ids,
	hits_from_cached_entries,
	ids_under_path,
	merge_rescan_hits,
	normalize_plugin_cache,
	rebuild_dict_from_hits,
	remove_entries_for_path,
	restore_entries_snapshot,
	retarget_fingerprint,
	retarget_source_paths,
	snapshot_entries_for_path,
	upsert_entry,
	type PathFingerprintMap,
	type PluginCacheShape,
	type ScanHit,
} from 'src/cache-ops'
import {
	delete_uncache_notice_text,
	duplicate_block_notice,
	paint_duplicate_tag_state,
	unknown_cite_title,
} from 'src/ux-copy'
import { text_may_contain_bibtex_block } from 'src/cite-span'
import { citation_popup } from 'src/citation-popup'
import { build_id_index, resolve_id, type IdIndex } from 'src/citekey-index'
import { build_doi_index, type DoiIndex } from 'src/doi-index'
import {
	audit_idle_after_unload,
	create_perf_counters,
	format_scale_report,
	is_plugin_idle,
	type IdleSnapshot,
	type PerfCounters,
} from 'src/idle-audit'
import { HoverRenderChild, unmount_card_manager } from 'src/hover'
import { EditorPrompt } from 'src/prompt'
import { PaperPanelView, PAPER_PANEL_VIEW_TYPE } from 'src/panel'
import { createHoverWidgetPlugin } from 'src/editor'
import { SaveCoalescer } from 'src/save-coalesce'
import { BibtexScholarSetting } from 'src/settings-tab'
import {
	cite_index_all_cites,
	cite_index_clear,
	cite_index_count_for,
	cite_index_remove_path,
	cite_index_retarget_path,
	cite_index_set_path,
	cite_index_paths_for,
	create_cite_path_index,
	extract_inline_cite_ids,
	scan_bibtex_hits_chunked,
	scan_inline_cites_chunked,
	type CitePathIndex,
} from 'src/vault-scan'

type BibtexScholarCache = PluginCacheShape

export default class BibtexScholar extends Plugin {
	cache: BibtexScholarCache
	/** O(1) DOI ownership map — rebuilt on load/rescan, maintained on mutations. */
	doi_index: DoiIndex = new Map()
	/** O(1) normalized-citekey → canonical-citekey map — same lifecycle as doi_index. */
	id_index: IdIndex = new Map()
	/**
	 * citekey -> clash reasons, from the last "Recache and collect collisions" scan.
	 * Unlike doi_index this is not kept live on every mutation — it's a snapshot,
	 * only rebuilt by rescan_vault(). Empty (no clash shown) until the first rescan.
	 */
	clash_reasons: Map<string, ClashReason[]> = new Map()
	renaming = false
	rename_timers = new Map<string, number>()
	/** Session flag for quiet_duplicate_notices (at most one toast per load). */
	private duplicate_notice_emitted_this_session = false
	/** Set true to abort an in-flight vault cite scan (best-effort). */
	private rename_scan_cancel = false
	/**
	 * Bumped to cancel an in-flight full rescan (S4).
	 * Each rescan captures its epoch; mismatch means abandon without writing cache.
	 */
	private rescan_epoch = 0
	/**
	 * Inline cite reverse index (SPEED S6). Not durable.
	 * `cite_index_ready` means a full vault pass has populated it; until then
	 * rename scans read every markdown file (and build the index in that pass).
	 */
	private cite_index: CitePathIndex = create_cite_path_index()
	private cite_index_ready = false
	private save_coalescer: SaveCoalescer | null = null
	/** Lightweight counters for idle / scale trust checks (Phase C). */
	perf: PerfCounters = create_perf_counters()

	async onload() {
		await this.load_cache()
		this.save_coalescer = new SaveCoalescer({
			delay_ms: 80,
			persist: async () => {
				await this.saveData(this.cache)
			},
			on_schedule: () => { this.perf.save_schedules++ },
			on_flush: () => { this.perf.save_flushes++ },
		})

		// setting tab
		this.addSettingTab(new BibtexScholarSetting(this.app, this))

		// bibtex code block processor
		this.registerMarkdownCodeBlockProcessor('bibtex', async (source, el, ctx) => await this.bibtex_codeblock_processor(source, el, ctx))

		// inline reference of paper
		// reading view (preview) — chips via post-processor
		this.registerMarkdownPostProcessor((el, ctx) => this.inline_ref_processor(el, ctx))
		// live preview only — pure source mode shows raw `{id}` / `[id]` text (no chips)
		const hover_widget_editor_plugin = createHoverWidgetPlugin(this, this.app)
		this.registerEditorExtension(hover_widget_editor_plugin)

		// commands for copy all bibtex entries to the clipboard
		this.addRibbonIcon(
			'scroll-text',
			'Copy all BibTeX',
			(evt: MouseEvent) => this.cp_bibtex()
		)

		// Copy/export and the rest of cache-maintenance are panel-only (bottom-right
		// corner buttons in PaperPanelView) — not command-palette entries, so the
		// palette doesn't carry the same near-duplicate clutter it had before.
		// "Uncache current file" stays in the palette too: it's the one cache
		// action people reach for mid-edit on the file they're looking at, so it's
		// worth a direct, hotkey-bindable entry alongside the panel button.
		this.addCommand({
			id: 'uncache-file-bibtex',
			name: 'Uncache BibTeX entries from current file',
			checkCallback: (checking: boolean) => {
				const current_file = this.app.workspace.getActiveFile()
				if (checking) return Boolean(current_file) // return true if active file exists
				if (current_file) {
					if (window.confirm(
						`Remove all cached BibTeX entries sourced from “${current_file.path}”? `
						+ 'Vault notes are not deleted. This is an explicit cache clear (no Undo toast).',
					)) {
						void this.uncache_bibtex_from_path(current_file.path)
					}
				}
			},
		})

		// Scale / perf snapshot for large libraries (see SPEED.md)
		this.addCommand({
			id: 'bibtex-scale-report',
			name: 'Show BibTeX library scale report',
			callback: () => {
				new Notice(this.scale_report(), 12e3)
			},
		})

		// events for rename and delete file
		this.registerEvent(this.app.vault.on('rename', (file, old_path) => {
			this.update_bibtex_source_path(old_path, file.path)
		}))

		this.registerEvent(this.app.vault.on('delete', (file) => {
			// Soft uncache with Undo — vault delete should not silently drop the library.
			void this.uncache_bibtex_from_path(file.path, { offer_undo: true })
		}))

		// File explorer / tab right-click menu — the same per-file actions available
		// via the command palette or the panel's corner buttons, localized to the file
		// being clicked rather than requiring it to already be the active file. Folders
		// get one directory-scoped action instead (see export_directory_bibtex): the
		// per-file actions above don't generalize to "a folder full of files" cleanly
		// (which file's content would "copy as markdown" even mean?), but exporting
		// everything the folder sources-or-cites to one .bib file does.
		this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
			if (file instanceof TFolder) {
				menu.addItem((item) => item
					.setTitle('Export BibTeX for this folder (sources + cited)')
					.setIcon('scroll-text')
					.onClick(() => { void this.export_directory_bibtex(file) }))
				return
			}

			if (!(file instanceof TFile) || file.extension !== 'md') return

			menu.addItem((item) => item
				.setTitle('Copy as standard markdown')
				.setIcon('scroll-text')
				.onClick(() => { void this.cp_std_md(file) }))

			menu.addItem((item) => item
				.setTitle('Copy with \\autocite{}')
				.setIcon('scroll-text')
				.onClick(() => { void this.cp_autocite_md(file) }))

			menu.addItem((item) => item
				.setTitle('Uncache BibTeX entries from this file')
				.setIcon('database')
				.onClick(() => {
					if (window.confirm(
						`Remove all cached BibTeX entries sourced from “${file.path}”? `
						+ 'Vault notes are not deleted. This is an explicit cache clear (no Undo toast).',
					)) {
						void this.uncache_bibtex_from_path(file.path)
					}
				}))
		}))

		// citekey rename: debounced modify only; skip files without ```bibtex (idle typing elsewhere)
		this.registerEvent(this.app.vault.on('modify', (file) => {
			if (this.renaming || !(file instanceof TFile) || file.extension !== 'md') {
				this.perf.modify_early_exits++
				return
			}
			const prev = this.rename_timers.get(file.path)
			if (prev) window.clearTimeout(prev)
			const t = window.setTimeout(() => {
				this.rename_timers.delete(file.path)
				void this.on_file_modified(file)
			}, 400)
			this.rename_timers.set(file.path, t)
			this.perf.modify_scheduled++
		}))

		this.addCommand({
			id: 'propagate-key-change',
			name: 'Propagate citekey rename',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile()
				if (checking) return Boolean(file)
				if (file) void this.on_file_modified(file, true)
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

		// cite paper editor prompt — live dict getter (survives rescan/uncache)
		this.registerEditorSuggest(new EditorPrompt(
			this.app,
			() => this.cache.bibtex_dict,
			({ returned, matched }) => {
				this.perf.suggest_returned = returned
				this.perf.suggest_matched = matched
			},
		))

		// paper panel — view reads plugin.cache live; pass plugin only for dict identity at open
		this.registerView(
			PAPER_PANEL_VIEW_TYPE,
			(leaf) => new PaperPanelView(leaf, this)
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
		// Flush durable state and drop idle work so disable/reload is clean.
		this.rename_scan_cancel = true
		this.rescan_epoch++
		this.invalidate_cite_index()
		for (const t of this.rename_timers.values()) {
			window.clearTimeout(t)
		}
		this.rename_timers.clear()
		citation_popup.dispose()
		unmount_card_manager()
		if (this.save_coalescer) {
			await this.save_coalescer.flush()
			this.save_coalescer.cancel()
		}
	}

	/** Drop reverse cite index — next rename scan rebuilds via a full pass. */
	invalidate_cite_index() {
		cite_index_clear(this.cite_index)
		this.cite_index_ready = false
	}

	/**
	 * Loads the plugin cache from storage.
	 * Normalizes corrupt/partial data so bibtex_dict is always a plain object.
	 */
	async load_cache() {
		this.cache = normalize_plugin_cache(await this.loadData())
		this.doi_index = build_doi_index(this.cache.bibtex_dict)
		this.id_index = build_id_index(this.cache.bibtex_dict)
	}

	/** Snapshot for idle trust checks (tests / debug). */
	idle_snapshot(): IdleSnapshot {
		return {
			popup_active: citation_popup.get_active_id() != null,
			save_dirty: this.save_coalescer?.is_dirty() ?? false,
			rename_timer_count: this.rename_timers.size,
			counters: { ...this.perf },
		}
	}

	is_idle(): boolean {
		return is_plugin_idle(this.idle_snapshot())
	}

	/** After unload-style cleanup: empty array means healthy idle. */
	audit_idle(): string[] {
		return audit_idle_after_unload(this.idle_snapshot())
	}

	/** One-line scale snapshot (entries, cache size, panel/suggest/rescan counters). */
	scale_report(): string {
		let cache_json_bytes: number | undefined
		try {
			cache_json_bytes = JSON.stringify(this.cache).length
		} catch {
			cache_json_bytes = undefined
		}
		return format_scale_report(this.perf, {
			entry_count: entry_count(this.cache.bibtex_dict),
			cache_json_bytes,
		})
	}

	/**
	 * Schedule a coalesced durable write (hot paths: codeblock paint, many upserts).
	 * Prefer {@link save_cache} when the caller must wait for disk.
	 */
	schedule_save_cache() {
		this.save_coalescer?.schedule()
	}

	/**
	 * Flush pending coalesced writes and wait for disk.
	 * P.S. The BibTeX entries are saved from this.cache.bibtex_dict
	 */
	async save_cache() {
		if (!this.save_coalescer) {
			await this.saveData(this.cache)
			return
		}
		// Ensure at least one write of current state.
		this.save_coalescer.schedule()
		await this.save_coalescer.flush()
	}

	/**
	 * Processes a BibTeX code block.
	 * It adds the BibTeX entry to the cache if no duplication is found.
	 * @param {string} source - The source text of the code block.
	 * @param {HTMLElement} el - The HTML element representing the code block.
	 * @param {MarkdownPostProcessorContext} ctx - The Markdown post-processing context.
	 */
	async bibtex_codeblock_processor(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		// Sequential: avoid forEach(async) races that interleave dict mutations + disk writes.
		const fields_ls = await parse_bibtex(source)
		let dirty = false
		const section_text = String(ctx.getSectionInfo(el)?.text ?? source)
		// One summary Notice for losers in this block (not one toast per entry).
		let id_dup_hits = 0
		let doi_dup_hits = 0
		let example_id: string | undefined
		let example_owner_path: string | undefined

		for (const fields of fields_ls) {
			const id = fields.id
			const bibtex_source = make_bibtex(fields)
			const id_duplicate = check_duplicate_id(
				this.cache.bibtex_dict, id,
				ctx.sourcePath,
				section_text,
				this.id_index,
			)
			const doi_duplicate = check_duplicate_doi(
				this.cache.bibtex_dict, fields.doi, id, ctx.sourcePath, this.doi_index,
			)
			const duplicate = id_duplicate || doi_duplicate

			let owner_path: string | undefined
			if (duplicate) {
				if (id_duplicate) {
					id_dup_hits++
					const owner = resolve_id(this.id_index, id)
					owner_path = owner !== undefined
						? this.cache.bibtex_dict[owner]?.source_path
						: undefined
					if (!example_id) {
						example_id = id
						example_owner_path = owner_path
					}
				}
				if (doi_duplicate) {
					doi_dup_hits++
					if (!example_id) {
						example_id = id
					}
				}
			} else if (upsert_entry(this.cache.bibtex_dict, id, fields, bibtex_source, ctx.sourcePath, this.doi_index, undefined, this.id_index)) {
				dirty = true
			}

			// render paper element (HoverRenderChild unmounts React when the section is discarded)
			const paper_bar = el.createEl('span', {
				cls: (duplicate) ? ('bibtex-hover-duplicate-id') : ('bibtex-entry'),
			})
			if (duplicate) {
				paper_bar.setAttribute(
					'title',
					paint_duplicate_tag_state(owner_path).title,
				)
			}
			const entry = this.cache.bibtex_dict[id] ?? {
				fields: fields,
				source_path: ctx.sourcePath,
			}
			ctx.addChild(new HoverRenderChild(paper_bar, entry, this, this.app, false))

			// Source tag: paint-time losers say "not cached"; else rescan clash label / "source".
			// data-citekey lets rescan patch open notes without a full preview re-render.
			const tag_state = duplicate
				? paint_duplicate_tag_state(owner_path)
				: source_tag_state(this.clash_reasons.get(id))
			el.createEl('code', {
				cls: tag_state.clashing ? 'bibtex-source-tag is-clashing' : 'bibtex-source-tag',
				text: tag_state.text,
				attr: {
					'data-citekey': id,
					...(tag_state.title ? { title: tag_state.title } : {}),
				},
			})
		}

		if (id_dup_hits > 0 || doi_dup_hits > 0) {
			const quiet = Boolean(this.cache.quiet_duplicate_notices)
			if (!quiet || !this.duplicate_notice_emitted_this_session) {
				this.duplicate_notice_emitted_this_session = true
				new Notice(
					duplicate_block_notice({
						id_hits: id_dup_hits,
						doi_hits: doi_dup_hits,
						example_id,
						example_owner_path,
					}),
					12e3,
				)
			}
		}

		// One coalesced write per codeblock paint, not per entry.
		if (dirty) {
			this.schedule_save_cache()
		}
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
				const canonical_id = resolve_id(this.id_index, paper_id)

				if (canonical_id === undefined || !this.cache.bibtex_dict[canonical_id]) {
					// Visual only — no Notice spam when opening notes with typos / stale cites.
					codeblock.addClass('bibtex-cite-unknown')
					codeblock.setAttribute('title', unknown_cite_title(paper_id))
					continue
				} else {
					const paper_bar = codeblock.createSpan()
					codeblock.replaceWith(paper_bar)
					ctx.addChild(new HoverRenderChild(
						paper_bar,
						this.cache.bibtex_dict[canonical_id],
						this,
						this.app,
						text[0] === '[',
					))
				}
			}
		}
	}

	/**
	 * Full library as BibTeX source (abstracts omitted).
	 * P.S. Abstracts are omitted to ensure LaTeX compiles cleanly.
	 */
	format_library_bibtex(): string {
		return format_bibtex_for_ids(this.cache.bibtex_dict, Object.keys(this.cache.bibtex_dict))
	}

	cp_bibtex() {
		navigator.clipboard.writeText(this.format_library_bibtex())
		new Notice('Copied BibTeX entries to clipboard')
	}

	/**
	 * Write `body` to a vault path, creating parent folders as needed.
	 * Overwrites an existing file at that path. Returns false (with a Notice)
	 * if `dest` names something that already exists but isn't a file.
	 */
	private async write_bib_file(dest: string, body: string): Promise<boolean> {
		const folder = dest.includes('/') ? dest.slice(0, dest.lastIndexOf('/')) : ''
		if (folder) {
			const exists = await this.app.vault.adapter.exists(folder)
			if (!exists) {
				await this.app.vault.createFolder(folder)
			}
		}
		const existing = this.app.vault.getAbstractFileByPath(dest)
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, body)
		} else if (existing) {
			new Notice(`Cannot export: ${dest} is not a file`)
			return false
		} else {
			await this.app.vault.create(dest, body)
		}
		return true
	}

	/**
	 * Write the library to a vault path as a `.bib` file (abstracts omitted).
	 * Overwrites when the file already exists. Remembers the path in settings.
	 */
	async export_bibtex_file(path: string) {
		const dest = normalizePath(path.trim() || this.cache.export_bib_path || 'bibliography.bib')
		this.cache.export_bib_path = dest
		if (!(await this.write_bib_file(dest, this.format_library_bibtex()))) return
		await this.save_cache()
		const n = entry_count(this.cache.bibtex_dict)
		new Notice(`Exported ${n} entr${n === 1 ? 'y' : 'ies'} to ${dest}`)
	}

	/**
	 * Write a `.bib` file for one directory subtree (recursive): entries sourced
	 * from any markdown file under it, *plus* entries cited (`` `{id}` ``/`` `[id]` ``)
	 * by any note under it even when the ```bibtex block that defines them lives
	 * elsewhere in the vault — "what this folder's notes actually reference,"
	 * not just "what was pasted into this folder." Written next to the folder
	 * as `<folder name>.bib` (vault root exports to `bibliography.bib`),
	 * overwriting a same-named file from a previous export.
	 */
	async export_directory_bibtex(folder: TFolder) {
		const prefix = folder.path === '' ? '' : `${folder.path}/`
		const label = folder.path === '' ? 'vault root' : folder.path
		const paths = this.app.vault.getMarkdownFiles()
			.filter((f) => f.path.startsWith(prefix))
			.map((f) => f.path)

		if (paths.length === 0) {
			new Notice(`No markdown files in ${label}`)
			return
		}

		// Directory-scoped index: built fresh each time (folders are exported rarely,
		// not worth keeping this warm alongside the vault-wide cite_index).
		const dir_cite_index = create_cite_path_index()
		const notice = new Notice(`Scanning ${label}… 0/${paths.length}`, 0)
		await scan_inline_cites_chunked({
			paths,
			read: async (p) => {
				const af = this.app.vault.getAbstractFileByPath(p)
				return af instanceof TFile ? this.app.vault.read(af) : ''
			},
			chunk_size: 32,
			yield_ms: 0,
			cite_index: dir_cite_index,
			on_progress: (done, total) => notice.setMessage(`Scanning ${label}… ${done}/${total}`),
		})
		notice.hide()

		const ids = new Set(ids_under_path(this.cache.bibtex_dict, prefix))
		for (const cite_id of cite_index_all_cites(dir_cite_index)) {
			const canonical = resolve_id(this.id_index, cite_id)
			if (canonical !== undefined && this.cache.bibtex_dict[canonical]) {
				ids.add(canonical)
			}
		}

		if (ids.size === 0) {
			new Notice(`No BibTeX entries sourced from or cited in ${label}`)
			return
		}

		const dest = normalizePath(folder.path === '' ? 'bibliography.bib' : `${folder.path}/${folder.name}.bib`)
		if (!(await this.write_bib_file(dest, format_bibtex_for_ids(this.cache.bibtex_dict, ids)))) return
		new Notice(`Exported ${ids.size} entr${ids.size === 1 ? 'y' : 'ies'} from ${label} to ${dest}`)
	}

	/**
	 * Copy a file's content as standard markdown, i.e. replacing inline references with url links.
	 * @param target - Defaults to the active file (command palette); the file-menu handler passes
	 * the right-clicked file explicitly, since that need not be the active one.
	 */
	async cp_std_md(target?: TFile) {
		const current_file = target ?? this.app.workspace.getActiveFile()
		// read file content
		if (current_file) {
			let content = await this.app.vault.read(current_file)
			content = content.replace(/```bibtex[\s\S]*?```/g, '')
			content = content.replace(/\`(\{|\[)([^\}\]]+)(\}|\])\`/g, (match, p1, id, p3) => {
				const canonical_id = resolve_id(this.id_index, id)
				const entry = canonical_id !== undefined ? this.cache.bibtex_dict[canonical_id] : undefined
				if (!entry) {
					return match
				}
				const fields = entry.fields
				if (fields.url) {
					return `[${id}](${fields.url})`
				} else if (fields.doi) {
					return `[${id}](http://dx.doi.org/${fields.doi})`
				} else {
					return `[${id}](data:text/plain,${encodeURIComponent(entry_source(entry))})`
				}
			})
			navigator.clipboard.writeText(content)
			new Notice('Copied standard markdown to clipboard')
		} else {
			new Notice('No active file to copy')
		}
	}

	/**
	 * Copy a file's content with `{id}` replaced as \autocite{id}.
	 * @param target - Defaults to the active file (command palette); the file-menu handler passes
	 * the right-clicked file explicitly, since that need not be the active one.
	 */
	async cp_autocite_md(target?: TFile) {
		const current_file = target ?? this.app.workspace.getActiveFile()
		// read file content
		if (current_file) {
			let content = await this.app.vault.read(current_file)
			content = content.replace(/```bibtex[\s\S]*?```/g, '')
			content = content.replace(/\`(\{|\[)([^\}\]]+)(\}|\])\`/g, (match, p1, id, p3) => {
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
		if (delete_entry(this.cache.bibtex_dict, paper_id, this.doi_index, this.id_index)) {
			await this.save_cache()
			new Notice(`Uncached ${paper_id}`)
		}
	}

	/**
	 * Uncache all BibTeX entries whose source is `path`.
	 * @param offer_undo - when true (vault delete), keep a short-lived snapshot and an Undo notice.
	 */
	async uncache_bibtex_from_path(path: string, opts?: { offer_undo?: boolean }) {
		const snapshot = snapshot_entries_for_path(this.cache.bibtex_dict, path)
		const n = Object.keys(snapshot).length
		const fingerprint = this.cache.path_fingerprints[path]
		const had_fp = fingerprint !== undefined

		remove_entries_for_path(this.cache.bibtex_dict, path, this.doi_index, this.id_index)
		if (had_fp) {
			delete this.cache.path_fingerprints[path]
		}
		if (this.cite_index_ready) {
			cite_index_remove_path(this.cite_index, path)
		}
		if (n > 0 || had_fp) {
			await this.save_cache()
		}

		if (n === 0) {
			return
		}

		if (opts?.offer_undo) {
			this.show_delete_uncache_undo(path, snapshot, fingerprint)
		} else {
			new Notice(`Uncached BibTeX entries from ${path}`)
		}
	}

	/**
	 * Notice with an Undo control after a vault file delete dropped cache rows.
	 * Snapshot is in-memory only; Undo is best-effort until the notice expires.
	 */
	private show_delete_uncache_undo(
		path: string,
		snapshot: BibtexDict,
		fingerprint: string | undefined,
	) {
		const count = Object.keys(snapshot).length
		const notice = new Notice('', 16e3)
		const root = notice.noticeEl
		root.empty()
		root.createSpan({ text: `${delete_uncache_notice_text(count, path)} ` })
		const undo = root.createEl('a', {
			text: 'Undo',
			cls: 'bibtex-notice-undo',
			attr: { href: '#' },
		})
		let used = false
		undo.addEventListener('click', (e) => {
			e.preventDefault()
			if (used) {
				return
			}
			used = true
			const { restored, skipped } = restore_entries_snapshot(
				this.cache.bibtex_dict,
				snapshot,
				this.doi_index,
				this.id_index,
			)
			if (fingerprint !== undefined) {
				this.cache.path_fingerprints[path] = fingerprint
			}
			void this.save_cache()
			notice.hide()
			const skip_note = skipped > 0 ? ` (${skipped} already re-occupied)` : ''
			new Notice(`Restored ${restored} BibTeX entr${restored === 1 ? 'y' : 'ies'} to cache${skip_note}`)
		})
	}

	/**
	 * Uncache all BibTeX entry
	 */
	async uncache_bibtex_all() {
		this.cache.bibtex_dict = {}
		this.cache.path_fingerprints = {}
		this.doi_index = new Map()
		this.id_index = new Map()
		this.clash_reasons = new Map()
		this.invalidate_cite_index()
		await this.save_cache()
		// Snapshot cleared — strip clash chrome from any still-open ```bibtex tags.
		this.refresh_source_clash_tags()
		new Notice('Uncached all BibTeX entries')
	}

	/**
	 * Command-palette entry: vault rescan, then notice with clash count.
	 * @param hard - when true, ignore fingerprints and re-read every file (full clash harvest).
	 */
	async recache_vault_command(hard = false) {
		new Notice(hard ? 'Hard-resetting BibTeX from vault…' : 'Recaching BibTeX from vault…')
		const clashes = await this.rescan_vault({ hard })
		if (clashes == null) {
			new Notice('Recache cancelled — cache unchanged')
			return
		}
		const n = entry_count(this.cache.bibtex_dict)
		if (clashes.length > 0) {
			new Notice(
				`Recached ${n} BibTeX entr${n === 1 ? 'y' : 'ies'}: ${clashes.length} collision group${clashes.length === 1 ? '' : 's'} found. Open the Paper panel and use Recache and collect collisions to review them.`,
				10e3
			)
		} else {
			new Notice(`Recached ${n} BibTeX entr${n === 1 ? 'y' : 'ies'}: no collisions found.`)
		}
	}

	/**
	 * Scan ```bibtex blocks, rebuild cache (first id + DOI wins), return undirected clashes.
	 * Chunked + cancelable (S4). Incremental via path fingerprints (S5); hard resets re-read all.
	 * On cancel returns null and leaves cache untouched.
	 */
	async rescan_vault(opts?: { hard?: boolean }): Promise<Clash<ScanHit>[] | null> {
		const hard = opts?.hard === true
		const epoch = ++this.rescan_epoch
		const t0 = Date.now()

		const files = this.app.vault.getMarkdownFiles()
			.slice()
			.sort((a, b) => a.path.localeCompare(b.path))

		const current_fp: PathFingerprintMap = {}
		for (const f of files) {
			current_fp[f.path] = file_fingerprint(f.stat.mtime, f.stat.size)
		}
		const vault_paths = files.map((f) => f.path)
		const prev_fp = this.cache.path_fingerprints ?? {}

		const classified = hard
			? {
				new: vault_paths.slice(),
				changed: [] as string[],
				unchanged: [] as string[],
				deleted: Object.keys(prev_fp).filter((p) => !current_fp[p]),
			}
			: classify_path_fingerprints(vault_paths, current_fp, prev_fp)

		const to_read = hard
			? vault_paths
			: classified.new.concat(classified.changed).sort((a, b) => a.localeCompare(b))

		const label = hard ? 'Hard rescan' : 'Rescanning vault'
		const notice = new Notice(
			to_read.length === 0
				? `${label}… all ${vault_paths.length} files unchanged`
				: `${label}… 0/${to_read.length}`,
			0,
		)

		const result = await scan_bibtex_hits_chunked({
			paths: to_read,
			read: async (path) => {
				const af = this.app.vault.getAbstractFileByPath(path)
				if (!(af instanceof TFile)) return ''
				return this.app.vault.read(af)
			},
			chunk_size: 32,
			yield_ms: 0,
			should_cancel: () => this.rescan_epoch !== epoch,
			on_progress: (done, total) => {
				notice.setMessage(`${label}… ${done}/${total}`)
			},
		})
		notice.hide()

		const fp_skipped = hard ? 0 : classified.unchanged.length
		this.perf.rescan_ms = Date.now() - t0
		this.perf.rescan_files_read = result.files_read
		this.perf.rescan_files_skipped = result.files_skipped + fp_skipped

		// Partial harvest must not replace the live dict.
		if (result.cancelled || this.rescan_epoch !== epoch) {
			return null
		}

		const unchanged_set = new Set(hard ? [] : classified.unchanged)
		const cached_hits = hits_from_cached_entries(this.cache.bibtex_dict, unchanged_set)
		const all_hits = merge_rescan_hits(cached_hits, result.hits)

		// Replace dict atomically so live getters never see a half-cleared map.
		this.cache.bibtex_dict = rebuild_dict_from_hits(all_hits)
		this.cache.path_fingerprints = current_fp
		this.doi_index = build_doi_index(this.cache.bibtex_dict)
		this.id_index = build_id_index(this.cache.bibtex_dict)
		// Vault contents may have changed — rebuild cite reverse index on next rename.
		this.invalidate_cite_index()
		await this.save_cache()
		const clashes = find_clashes(all_hits)
		this.clash_reasons = build_clash_reasons_by_id(clashes)
		// clash_reasons is plugin state, not note text. Re-running the full
		// codeblock processor (previewMode.rerender) only hits Reading mode, and
		// re-fires duplicate Notices on every open loser. Patch painted tags in
		// place instead — works for Reading and Live Preview.
		this.refresh_source_clash_tags()
		return clashes
	}

	/**
	 * Update every painted ```bibtex source tag to match {@link clash_reasons}.
	 * Tags carry data-citekey from paint; we never re-parse or re-upsert.
	 */
	private refresh_source_clash_tags() {
		const nodes = this.app.workspace.containerEl.querySelectorAll('code.bibtex-source-tag[data-citekey]')
		for (const node of Array.from(nodes)) {
			if (!(node instanceof HTMLElement)) continue
			const id = node.getAttribute('data-citekey')
			if (!id) continue
			const state = source_tag_state(this.clash_reasons.get(id))
			node.setText(state.text)
			node.toggleClass('is-clashing', state.clashing)
			if (state.title) {
				node.setAttr('title', state.title)
			} else {
				node.removeAttribute('title')
			}
		}
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
		const text = await this.app.vault.read(file)
		// Keep reverse cite index warm on every md edit (cheap string pass).
		if (this.cite_index_ready) {
			cite_index_set_path(this.cite_index, file.path, extract_inline_cite_ids(text))
		}
		// Idle typing in notes without BibTeX: no parse, no vault-wide work.
		if (!from_command && !text_may_contain_bibtex_block(text)) {
			this.perf.modify_early_exits++
			return
		}
		const renames = await this.detect_citekey_renames(file, text)
		if (renames.length === 0) {
			if (from_command) new Notice('No citekey rename detected in this file')
			return
		}
		// one at a time
		const { old_id, new_id } = renames[0]
		await this.offer_rename(old_id, new_id)
	}

	async detect_citekey_renames(file: TFile, text?: string): Promise<{ old_id: string, new_id: string }[]> {
		const body = text ?? await this.app.vault.read(file)
		const current: BibtexField[] = []
		const block_re = /```bibtex[^\n]*\n([\s\S]*?)```/g
		let match: RegExpExecArray | null
		while ((match = block_re.exec(body)) !== null) {
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
				const other_id = resolve_id(this.id_index, fields.id)
				const other = other_id !== undefined ? this.cache.bibtex_dict[other_id] : undefined
				if (other && other.source_path !== file.path) continue
				out.push({ old_id, new_id: fields.id })
				used_new.add(fields.id)
				break
			}
		}
		return out
	}

	/**
	 * Bounded vault scan for inline cites (Phase B + SPEED S6):
	 * When the reverse index is ready, only known citing paths are read.
	 * Otherwise a full vault pass builds the index while scanning.
	 */
	async scan_inline_cites(old_id: string): Promise<CiteHit[]> {
		this.rename_scan_cancel = false
		const files = this.app.vault.getMarkdownFiles()
		const all_paths = files.map((f) => f.path)
		const active = this.app.workspace.getActiveFile()?.path
		const priority = active ? [active] : []

		const building = !this.cite_index_ready
		if (building) {
			// Fresh full pass — drop any partial state from a cancelled build.
			cite_index_clear(this.cite_index)
		}
		const paths = building
			? all_paths
			: (() => {
				const known = cite_index_paths_for(this.cite_index, old_id)
				// Always re-check the active file (may have a brand-new cite).
				if (active && !known.includes(active)) {
					return known.concat(active)
				}
				return known
			})()

		const notice = new Notice(
			paths.length === 0
				? `No indexed cites for \`${old_id}\``
				: `Scanning for \`${old_id}\`… 0/${paths.length}`,
			0,
		)
		const result = await scan_inline_cites_chunked({
			old_id,
			paths,
			priority_paths: priority,
			read: async (path) => {
				const af = this.app.vault.getAbstractFileByPath(path)
				if (!(af instanceof TFile)) return ''
				return this.app.vault.read(af)
			},
			chunk_size: 32,
			yield_ms: 0,
			should_cancel: () => this.rename_scan_cancel,
			// Build on full pass; refresh edges on restricted passes too.
			cite_index: this.cite_index,
			on_progress: (done, total) => {
				notice.setMessage(`Scanning for \`${old_id}\`… ${done}/${total}`)
			},
		})
		this.perf.rename_scan_files_read += result.files_read
		notice.hide()
		if (result.cancelled) {
			// Partial full-build is untrustworthy — force a complete rebuild next time.
			if (building) this.invalidate_cite_index()
			new Notice('Cite scan cancelled')
		} else if (building) {
			this.cite_index_ready = true
		}
		return result.hits
	}

	/**
	 * Warm `cite_index` for the whole vault without targeting any one
	 * citekey — backs panel features that need mention counts (e.g. paper
	 * panel "Most cited" sort) without going through the rename-scan flow.
	 * No-op (resolves true immediately) if already warm; the index then
	 * self-maintains via `on_file_modified` until `invalidate_cite_index()`.
	 * Returns false if cancelled (partial build is discarded, same as a
	 * cancelled rename scan).
	 */
	async ensure_cite_index(
		on_progress?: (done: number, total: number) => void,
		should_cancel?: () => boolean,
	): Promise<boolean> {
		if (this.cite_index_ready) {
			return true
		}
		const files = this.app.vault.getMarkdownFiles()
		const paths = files.map((f) => f.path)
		cite_index_clear(this.cite_index)

		const result = await scan_inline_cites_chunked({
			paths,
			read: async (path) => {
				const af = this.app.vault.getAbstractFileByPath(path)
				if (!(af instanceof TFile)) return ''
				return this.app.vault.read(af)
			},
			chunk_size: 32,
			yield_ms: 0,
			should_cancel: should_cancel ?? (() => false),
			cite_index: this.cite_index,
			on_progress,
		})

		if (result.cancelled) {
			this.invalidate_cite_index()
			return false
		}
		this.cite_index_ready = true
		return true
	}

	/** Distinct notes citing `id`, via the (possibly cold) reverse index — 0 if not built yet. */
	mention_count(id: string): number {
		return cite_index_count_for(this.cite_index, id)
	}

	async offer_rename(old_id: string, new_id: string) {
		const old = this.cache.bibtex_dict[old_id]
		if (!old) return

		const existing_id = resolve_id(this.id_index, new_id)
		const existing = existing_id !== undefined ? this.cache.bibtex_dict[existing_id] : undefined
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
		const existing_id = resolve_id(this.id_index, new_id)
		const existing = existing_id !== undefined ? this.cache.bibtex_dict[existing_id] : undefined
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
			// Move map entry + keep DOI/id index ownership on the new key.
			delete_entry(this.cache.bibtex_dict, old_id, this.doi_index, this.id_index)
			upsert_entry(
				this.cache.bibtex_dict,
				new_id,
				fields,
				make_bibtex(fields),
				old.source_path,
				this.doi_index,
				undefined,
				this.id_index,
			)
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
		const dict_changed = retarget_source_paths(this.cache.bibtex_dict, old_path, new_path)
		const fp_changed = retarget_fingerprint(this.cache.path_fingerprints, old_path, new_path)
		if (this.cite_index_ready) {
			cite_index_retarget_path(this.cite_index, old_path, new_path)
		}
		if (dict_changed || fp_changed) {
			await this.save_cache()
			if (dict_changed) {
				new Notice('Updated BibTeX entry paths')
			}
		}
	}

	/**
	 * Dev/support: list structural problems in the in-memory dict (empty = healthy).
	 */
	audit_cache(): string[] {
		return audit_bibtex_dict(this.cache.bibtex_dict)
	}

	/**
	 * Add paper panel to the right sidebar
	 */
	add_paper_panel() {
		const { workspace } = this.app
		const leaf = workspace.getRightLeaf(false)

		if (leaf) {
			leaf.setViewState({ type: PAPER_PANEL_VIEW_TYPE, active: true })
		}
	}
}
