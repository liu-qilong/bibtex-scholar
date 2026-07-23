import { App, Notice, PluginSettingTab, Setting, normalizePath } from 'obsidian'
import {
	CARD_FONT_SIZE_MAX,
	CARD_FONT_SIZE_MIN,
	entry_count,
	LIST_FONT_SIZE_MAX,
	LIST_FONT_SIZE_MIN,
	normalize_card_font_size,
	normalize_list_font_size,
	normalize_panel_chip_font_size,
	PANEL_CHIP_FONT_SIZE_MAX,
	PANEL_CHIP_FONT_SIZE_MIN,
} from 'src/cache-ops'
import { OPEN_DEBOUNCE_MS } from 'src/citation-popup'
import { format_diagnostics_report } from 'src/idle-audit'
import type BibtexScholar from 'src/main'
import { FileSuggest, FolderSuggest } from 'src/prompt'

/**
 * Plugin settings tab (paths, card/panel chrome, notices, local diagnostics).
 * Extracted from main so the plugin class stays lifecycle-focused (D1).
 */
export class BibtexScholarSetting extends PluginSettingTab {
	plugin: BibtexScholar

	constructor(app: App, plugin: BibtexScholar) {
		super(app, plugin)
		this.plugin = plugin
	}

	display(): void {
		const { containerEl } = this
		containerEl.empty()

		new Setting(containerEl).setName('Paths & templates').setHeading()

		new Setting(containerEl)
			.setName('Paper note folder')
			.setDesc('Notes created from the note button are placed here. No trailing /.')
			.addSearch((search) => {
				search
					.setValue(this.plugin.cache.note_folder)
					.onChange(async (value) => {
						this.plugin.cache.note_folder = normalizePath(value)
						await this.plugin.save_cache()
					})
				new FolderSuggest(this.app, search.inputEl)
			})

		new Setting(containerEl)
			.setName('PDF folder')
			.setDesc('PDFs uploaded from the pdf button are placed here. No trailing /.')
			.addSearch((search) => {
				search
					.setValue(this.plugin.cache.pdf_folder)
					.onChange(async (value) => {
						this.plugin.cache.pdf_folder = normalizePath(value)
						await this.plugin.save_cache()
					})
				new FolderSuggest(this.app, search.inputEl)
			})

		new Setting(containerEl)
			.setName('Paper note template')
			.setDesc('Path to a template file used when creating associated paper notes from BibTeX entries. Leave empty to use the default.')
			.addSearch((search) => {
				search
					.setPlaceholder('templates/bibtex-note.md')
					.setValue(this.plugin.cache.template_path || '')
					.onChange(async (value) => {
						this.plugin.cache.template_path = normalizePath(value)
						await this.plugin.save_cache()
					})
				new FileSuggest(this.app, search.inputEl)
			})

		new Setting(containerEl)
			.setName('Default fetch mode')
			.setDesc('Default lookup mode when fetching a BibTeX entry online.')
			.addDropdown((dropdown) => dropdown
				.addOption('doi', 'DOI')
				.addOption('manual', 'Manual')
				.setValue(this.plugin.cache.fetch_mode)
				.onChange(async (value) => {
					this.plugin.cache.fetch_mode = value
					await this.plugin.save_cache()
				}))

		new Setting(containerEl)
			.setName('Default .bib export path')
			.setDesc('Vault-relative path used by Copy/export → Export library to .bib file.')
			.addText((text) => {
				text
					.setPlaceholder('bibliography.bib')
					.setValue(this.plugin.cache.export_bib_path || 'bibliography.bib')
					.onChange(async (value) => {
						this.plugin.cache.export_bib_path = normalizePath(value.trim() || 'bibliography.bib')
						await this.plugin.save_cache()
					})
			})

		new Setting(containerEl).setName('Citation card').setHeading()

		const font_size = normalize_card_font_size(this.plugin.cache.card_font_size)
		new Setting(containerEl)
			.setName('Citation card font size')
			.setDesc(
				`Base font size for the floating citation card (title, actions, and fields) — shown `
				+ `everywhere: inline cites, codeblocks, and the paper panel. `
				+ `Range ${CARD_FONT_SIZE_MIN}–${CARD_FONT_SIZE_MAX}px. Current: ${font_size}px.`,
			)
			.addSlider((slider) => {
				slider
					.setLimits(CARD_FONT_SIZE_MIN, CARD_FONT_SIZE_MAX, 1)
					.setValue(font_size)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.cache.card_font_size = normalize_card_font_size(value)
						await this.plugin.save_cache()
						this.display()
					})
			})

		new Setting(containerEl)
			.setName('Wider citation cards')
			.setDesc(
				'Use a slightly wider floating card so titles and abstracts wrap less and need less scrolling.',
			)
			.addToggle((toggle) => {
				toggle
					.setValue(Boolean(this.plugin.cache.card_wide))
					.onChange(async (value) => {
						this.plugin.cache.card_wide = value
						await this.plugin.save_cache()
					})
			})

		new Setting(containerEl).setName('Notices & literacy').setHeading()

		new Setting(containerEl)
			.setName('Quiet duplicate notices')
			.setDesc(
				'When on, the “not cached (duplicate)” toast appears at most once per Obsidian session. '
				+ 'Source tags still show “not cached” and chip tooltips still explain first-wins. '
				+ 'Unknown inline cites never toast (visual only).',
			)
			.addToggle((toggle) => {
				toggle
					.setValue(Boolean(this.plugin.cache.quiet_duplicate_notices))
					.onChange(async (value) => {
						this.plugin.cache.quiet_duplicate_notices = value
						await this.plugin.save_cache()
					})
			})

		new Setting(containerEl).setName('Paper panel').setHeading()

		const chip_font_size = normalize_panel_chip_font_size(this.plugin.cache.panel_chip_font_size)
		new Setting(containerEl)
			.setName('Paper panel discover text size')
			.setDesc(
				`Text size for discover-mode chips in the paper panel — independent of the citation `
				+ `card font size and the list-mode size below. `
				+ `Range ${PANEL_CHIP_FONT_SIZE_MIN}–${PANEL_CHIP_FONT_SIZE_MAX}px. Current: ${chip_font_size}px. `
				+ `Reopen the paper panel after changing this.`,
			)
			.addSlider((slider) => {
				slider
					.setLimits(PANEL_CHIP_FONT_SIZE_MIN, PANEL_CHIP_FONT_SIZE_MAX, 1)
					.setValue(chip_font_size)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.cache.panel_chip_font_size = normalize_panel_chip_font_size(value)
						await this.plugin.save_cache()
						this.display()
					})
			})

		const list_font_size = normalize_list_font_size(this.plugin.cache.list_font_size)
		new Setting(containerEl)
			.setName('Paper panel list text size')
			.setDesc(
				`Text size for list-mode rows in the paper panel — independent of the citation card `
				+ `font size and the discover-mode size above. Row height scales with it. `
				+ `Range ${LIST_FONT_SIZE_MIN}–${LIST_FONT_SIZE_MAX}px. Current: ${list_font_size}px. `
				+ `Reopen the paper panel after changing this.`,
			)
			.addSlider((slider) => {
				slider
					.setLimits(LIST_FONT_SIZE_MIN, LIST_FONT_SIZE_MAX, 1)
					.setValue(list_font_size)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.cache.list_font_size = normalize_list_font_size(value)
						await this.plugin.save_cache()
						this.display()
					})
			})

		new Setting(containerEl)
			.setName('Missing PDF panel')
			.setDesc(
				'Show a toggle button in the paper panel, beside the clash button, that lists cached '
				+ 'references with no matching PDF file. Off by default. Reopen the panel after changing.',
			)
			.addToggle((toggle) => {
				toggle
					.setValue(Boolean(this.plugin.cache.missing_pdf_enabled))
					.onChange(async (value) => {
						this.plugin.cache.missing_pdf_enabled = value
						await this.plugin.save_cache()
					})
			})

		new Setting(containerEl)
			.setName('Double hover debounce in paper panel')
			.setDesc(
				'Wait twice as long '
				+ `(${OPEN_DEBOUNCE_MS * 2}ms instead of ${OPEN_DEBOUNCE_MS}ms) before a hover opens the `
				+ 'citation card in the paper panel, to reduce accidental opens while skimming. '
				+ 'Inline cites and codeblocks are unchanged.',
			)
			.addToggle((toggle) => {
				toggle
					.setValue(Boolean(this.plugin.cache.panel_double_debounce_enabled))
					.onChange(async (value) => {
						this.plugin.cache.panel_double_debounce_enabled = value
						await this.plugin.save_cache()
					})
			})

		new Setting(containerEl).setName('Diagnostics').setHeading()

		const diag_pre = containerEl.createEl('pre', {
			cls: 'bibtex-diagnostics-report',
			text: this.build_diagnostics_text(),
		})

		new Setting(containerEl)
			.setName('Local library diagnostics')
			.setDesc(
				'No network or telemetry — counters and a structural cache audit only. '
				+ 'Also available via command “Show BibTeX library scale report”.',
			)
			.addButton((btn) => btn
				.setButtonText('Refresh')
				.onClick(() => {
					diag_pre.setText(this.build_diagnostics_text())
				}))
			.addButton((btn) => btn
				.setButtonText('Copy')
				.onClick(async () => {
					const text = this.build_diagnostics_text()
					await navigator.clipboard.writeText(text)
					new Notice('Diagnostics copied to clipboard')
				}))
	}

	private build_diagnostics_text(): string {
		let cache_json_bytes: number | undefined
		try {
			cache_json_bytes = JSON.stringify(this.plugin.cache).length
		} catch {
			cache_json_bytes = undefined
		}
		return format_diagnostics_report(this.plugin.idle_snapshot().counters, {
			entry_count: entry_count(this.plugin.cache.bibtex_dict),
			cache_json_bytes,
			idle: this.plugin.is_idle(),
			audit_lines: this.plugin.audit_cache(),
			quiet_duplicate_notices: Boolean(this.plugin.cache.quiet_duplicate_notices),
		})
	}
}
