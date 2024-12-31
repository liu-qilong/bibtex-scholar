import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, MarkdownRenderer } from 'obsidian'
import { parse_bitex, BibtexField } from 'src/parse'

interface BibtexScholarCache {
	bibtex_dict: Map<string, BibtexField> | {}
}

const DEFAULT_SETTINGS: BibtexScholarCache = {
	bibtex_dict: {}
}

export default class BibtexScholar extends Plugin {
	cache: BibtexScholarCache
	allbibtex = []

	async onload() {
		await this.load_cache()

		// bibtex code block processor
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

	async load_cache() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
	}

	async save_cache() {
		await this.saveData(this.settings)
	}
}