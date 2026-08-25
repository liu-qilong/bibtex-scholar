import { App, Modal, Setting, normalizePath } from 'obsidian'
import type BibtexScholar from 'src/main'

/**
 * Vault-wide cache maintenance — recache, hard reset, explicit uncache.
 * Opened from the paper panel corner control (and documents cache literacy).
 */
export class CacheOpsModal extends Modal {
	plugin: BibtexScholar

	constructor(app: App, plugin: BibtexScholar) {
		super(app)
		this.plugin = plugin
	}

	onOpen() {
		const { contentEl } = this
		contentEl.createEl('h4', { text: 'BibTeX cache' })

		contentEl.createEl('p', {
			cls: 'setting-item-description',
			text:
				'Your notes hold the BibTeX source. This plugin also keeps a cache so chips, '
				+ 'search, and copy work quickly. First copy of a citekey/DOI wins; later '
				+ 'duplicates stay in the note but are not written to the cache (tag: “not cached”). '
				+ 'Deleting a note soft-removes its cache rows with an Undo toast. The actions '
				+ 'below are explicit and permanent (no Undo).',
		})

		contentEl.createEl('h5', { text: 'Refresh library' })

		new Setting(contentEl)
			.setName('Recache from vault')
			.setDesc('Incremental rescan (changed files only). Reports collision groups.')
			.addButton((btn) => btn
				.setButtonText('Recache')
				.setCta()
				.onClick(() => {
					this.close()
					void this.plugin.recache_vault_command(false)
				}))

		new Setting(contentEl)
			.setName('Hard reset from vault')
			.setDesc('Re-reads every markdown file and rewrites fingerprints. Use if the cache looks stale or corrupted.')
			.addButton((btn) => btn
				.setButtonText('Hard reset')
				.onClick(() => {
					this.close()
					void this.plugin.recache_vault_command(true)
				}))

		contentEl.createEl('h5', { text: 'Remove from cache (explicit)' })
		contentEl.createEl('p', {
			cls: 'setting-item-description',
			text:
				'These drop cache rows only — they do not delete notes or ```bibtex blocks. '
				+ 'Unlike a vault file delete, there is no Undo toast. Reopen a note or recache to refill.',
		})

		const active_file = this.app.workspace.getActiveFile()
		new Setting(contentEl)
			.setName('Remove current file from cache')
			.setDesc(
				active_file
					? `Hard-remove BibTeX cache rows sourced from ${active_file.path}.`
					: 'No active file.',
			)
			.addButton((btn) => {
				btn.setButtonText('Remove file')
					.onClick(() => {
						if (!active_file) return
						if (!window.confirm(
							`Remove all cached BibTeX entries sourced from “${active_file.path}”? `
							+ 'This cannot be undone from a toast (unlike deleting the file).',
						)) return
						this.close()
						void this.plugin.uncache_bibtex_from_path(active_file.path)
					})
				if (!active_file) btn.setDisabled(true)
			})

		new Setting(contentEl)
			.setName('Clear entire cache')
			.setDesc('Hard-remove every cached entry. Vault files are untouched.')
			.addButton((btn) => btn
				.setButtonText('Clear all')
				.setWarning()
				.onClick(() => {
					if (!window.confirm(
						'Clear the entire BibTeX cache? This cannot be undone from a toast. '
						+ 'Vault notes are not deleted.',
					)) return
					this.close()
					void this.plugin.uncache_bibtex_all()
				}))
	}

	onClose() {
		this.contentEl.empty()
	}
}

/**
 * Copy/export: clipboard actions + write a .bib file into the vault.
 */
export class CopyExportModal extends Modal {
	plugin: BibtexScholar

	constructor(app: App, plugin: BibtexScholar) {
		super(app)
		this.plugin = plugin
	}

	onOpen() {
		const { contentEl } = this
		contentEl.createEl('h4', { text: 'Copy / export' })

		new Setting(contentEl)
			.setName('Copy all BibTeX entries')
			.setDesc('Every cached entry, abstract omitted, to the clipboard.')
			.addButton((btn) => btn
				.setButtonText('Copy')
				.onClick(() => {
					this.close()
					this.plugin.cp_bibtex()
				}))

		const active_file = this.app.workspace.getActiveFile()
		new Setting(contentEl)
			.setName('Copy as standard markdown')
			.setDesc(active_file ? 'Current file with `{id}`/`[id]` cites replaced by links.' : 'No active file.')
			.addButton((btn) => {
				btn.setButtonText('Copy')
					.onClick(() => {
						this.close()
						void this.plugin.cp_std_md()
					})
				if (!active_file) btn.setDisabled(true)
			})

		new Setting(contentEl)
			.setName('Copy with \\autocite{}')
			.setDesc(active_file ? 'Current file with `{id}`/`[id]` cites replaced by \\autocite{id}.' : 'No active file.')
			.addButton((btn) => {
				btn.setButtonText('Copy')
					.onClick(() => {
						this.close()
						void this.plugin.cp_autocite_md()
					})
				if (!active_file) btn.setDisabled(true)
			})

		contentEl.createEl('h5', { text: 'Export to vault' })

		let export_path = this.plugin.cache.export_bib_path || 'bibliography.bib'
		new Setting(contentEl)
			.setName('Export library to .bib file')
			.setDesc('Writes all cached entries (abstracts omitted) to a vault path. Overwrites if the file exists.')
			.addText((text) => {
				text.setPlaceholder('bibliography.bib')
					.setValue(export_path)
					.onChange((v) => {
						export_path = v.trim() || 'bibliography.bib'
					})
			})
			.addButton((btn) => btn
				.setButtonText('Export')
				.setCta()
				.onClick(() => {
					const path = normalizePath(export_path)
					this.close()
					void this.plugin.export_bibtex_file(path)
				}))
	}

	onClose() {
		this.contentEl.empty()
	}
}
