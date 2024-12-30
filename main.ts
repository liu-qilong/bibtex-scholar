import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, MarkdownRenderer } from 'obsidian'
import { parse_bitex } from 'src/parse'

interface BibtexScholarSettings {
	mySetting: string
}

const DEFAULT_SETTINGS: BibtexScholarSettings = {
	mySetting: 'default'
}

export default class BibtexScholar extends Plugin {
	settings: BibtexScholarSettings
	allbibtex = []

	async onload() {
		await this.load_settings()

		// settings tab
		this.addSettingTab(new BibtexScholarSettingTab(this.app, this))

		this.registerMarkdownCodeBlockProcessor('bibtex', (source, el, ctx) => {
			const fields = parse_bitex(source)

			el.createEl('hr')
			const table = el.createEl('table')
      		const body = table.createEl('tbody')
			
			for (const key in fields) {
				const tr = body.createEl('tr')
				const td1 = tr.createEl('td')
				td1.innerText = key
				const td2 = tr.createEl('td')
				MarkdownRenderer.render(this.app, fields[key], td2, '', this)
			}
		})
	}

	onunload() {

	}

	async load_settings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
	}

	async save_settings() {
		await this.saveData(this.settings)
	}
}

class BibtexScholarSettingTab extends PluginSettingTab {
	plugin: BibtexScholar

	constructor(app: App, plugin: BibtexScholar) {
		super(app, plugin)
		this.plugin = plugin
	}

	display(): void {
		const {containerEl} = this

		containerEl.empty()

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value
					await this.plugin.save_settings()
				}))
	}
}
