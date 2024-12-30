import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian'

interface BibtexScholarSettings {
	mySetting: string
}

const DEFAULT_SETTINGS: BibtexScholarSettings = {
	mySetting: 'default'
}

export default class BibtexScholar extends Plugin {
	settings: BibtexScholarSettings

	async onload() {
		await this.load_settings()

		// settings tab
		this.addSettingTab(new BibtexScholarSettingTab(this.app, this))
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
