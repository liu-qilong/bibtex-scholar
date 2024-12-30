import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, MarkdownPostProcessorContext } from 'obsidian'
// import { link } from 'fs'
// import { getAPI } from "obsidian-dataview"
import { renderThread } from './src/paperthread'
import { renderMdList } from './src/mdlist'

interface MyPluginSettings {
	mySetting: string
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

export default class MyPlugin extends Plugin {
    settings: MyPluginSettings

    async onload() {
        await this.loadSettings()

        // register markdown code block post processor
		this.registerMarkdownCodeBlockProcessor('paperthread', 
		(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => { 
			renderThread(source, el, ctx, this.app)
		})

        this.registerMarkdownCodeBlockProcessor('mdlist', renderMdList)

        // setting tab
        this.addSettingTab(new SampleSettingTab(this.app, this))
    }

    onunload() {

    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
    }

    async saveSettings() {
        await this.saveData(this.settings)
    }
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin

	constructor(app: App, plugin: MyPlugin) {
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
					await this.plugin.saveSettings()
				}))
	}
}
