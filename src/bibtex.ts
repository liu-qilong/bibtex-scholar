import { App, Modal, ButtonComponent, Setting, Notice } from 'obsidian'
import BibtexScholar from 'src/main'
import { copy_to_clipboard } from 'src/hover'

export interface BibtexField {
    type: string,
    id: string,
    [key: string]: string,
}

export interface BibtexDict {
	[key: string]: {  // paper id
		fields: BibtexField,  // bibtex fields
		[key: string]: any,  // other data associated to the paper
	}
}

export async function parse_bitex(bibtex_source: string, lower_case_type: boolean = true): Promise<BibtexField[]> {
    // match type, id, & fields
    // p.s. no @ string in the fields!
    const entry_regex = /@([a-zA-Z]+){([^,]+),([^@]*)}/g
    let match
    let fields_ls: BibtexField[] = []
    // let match = entry_regex.exec(bibtex_source.replace(/\n/g, ''))

    while ((match = entry_regex.exec(bibtex_source.replace(/\n/g, ''))) !== null) {
        let fields: BibtexField = {
            type: match[1],
            id : match[2],
        }

        let fields_str = match[3]

        // parse bibtex fields
        let mode = 'key'
        let store = ''
        let max_layer = 0
        let stack = []
        let keys = []
        let values = []

        for (let [idx, char] of [...fields_str].entries()) {
            if (mode === 'key') {
                // parsing the key of a field
                if (char === '=') {
                    keys.push(store.replace(/^[, ]+/, '').replace(/[, ]+$/, ''))
                    store = ''
                    mode = 'value'
                } else {
                    store += char
                }
            } else if (mode === 'value') {
                // parsing the value of a field
                store += char

                if (char === '{') {
                    stack.push(char)
                    max_layer += 1

                    // if the value has {} pairs, remove the outmost {
                    if (max_layer === 1) {
                        store = ''
                    }
                } else if (char === '}') {
                    stack.pop()
                    
                    // if the value has {} pairs, discard the outmost }
                    if (stack.length === 0) {
                        store = store.slice(0, -1)
                    }
                }

                if ((max_layer > 0 && stack.length === 0) || (max_layer === 0 && (char === ',' || char === '}' || idx === fields_str.length - 1))) {
                    // when the field has {} pairs, complete parsing when the '{' stack is empty
                    // when the field has no {} layers, complete parsing when the ',' or '}' is encountered or the string ends
                    let value = store.replace(/^[ ]+/, '').replace(/[, ]+$/, '')

                    if (value[0] === '{' || value[-1] === '}') {
                        value = `"${value}"`
                    }

                    values.push(value)
                    store = ''
                    max_layer = 0
                    mode = 'key'
                }
            }
        }
        
        keys.map((key, idx) => { fields[key.toLowerCase()] = values[idx] })

        // if lower_case_type is true, convert bib_type to lower case
        if (lower_case_type === true) {
            fields['type'] = fields['type'].toLowerCase()
        }

        fields_ls.push(fields)
    }

    return fields_ls
}

export function make_bibtex(fields: BibtexField): string {
    let bibtex = `@${fields.type}{${fields.id},\n`

    for (let key in fields) {
        if (key === 'type' || key === 'id') {
            continue
        }

        bibtex += `  ${key} = {${fields[key]}},\n`
    }

    bibtex += '}\n'

    return bibtex
}

export function check_duplicate_id(bibtex_dict: BibtexDict, id: string, file_path: string, file_content: string): boolean {
    // if the id appears more than 1 time in the file
    // it means the id is duplicated in the same file
    function escape_reg_exp(string: string): string {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
    }
    
    const id_regex = new RegExp(`@[a-zA-Z]+{${escape_reg_exp(id)},`, 'g')
    let count = 0

    while (id_regex.exec(file_content.replace(/\n/g, '')) !== null) {
        count++
        if (count > 1) {
            return true
        }
    }

    // if the same id existed in bibtex_dict and it's from a different file
    // it means the id is duplicated in different files
    if (bibtex_dict[id] && (bibtex_dict[id].source_path != file_path)) {
        return true
    }

    // otherwise, the id is not duplicated
    return false
}

export function match_query(bibtex: BibtexDict, query: string): boolean {
    function match_query_single(q: string): boolean {
        const q_low_trim = q.toLowerCase().trim()

        if (q_low_trim.includes(':')) {
            // if the query is in the format of <key>:<value>
            // match the key and value separately
            let [key, value] = q_low_trim.split(':')
            key = key.trim()
            value = value.trim()
            if (key in bibtex.fields) {
                return String(bibtex.fields[key]).toLowerCase().includes(value)
            }
            return false
        } else {
            // if the query is not in the format of <key>:<value>
            // match the query in all fields
            for (let key in bibtex.fields) {
                if (String(bibtex.fields[key]).toLowerCase().includes(q_low_trim)) {
                    return true
                }
            }
            return false
        }
    }

    for (let q of query.split(';')) {
        if (q.length > 0 && !match_query_single(q)) {
            return false
        }
    }
    return true
}

export class FetchBibtexOnline extends Modal {
    plugin: BibtexScholar
    changable_el: HTMLElement
    btn: ButtonComponent

    doi: string = ''
    id_surfix: string = ''
    abstract: string = ''
    bibtex: string = ''

    constructor(app: App, plugin: BibtexScholar) {
        super(app)
        this.plugin = plugin
    }

    onOpen() {
        const { contentEl } = this
        contentEl.createEl('h4', { text: 'Fetch BibTeX Online' })

        new Setting(contentEl)
			.setName('Mode')
			.setDesc('')
			.addDropdown(dropdown => dropdown
                .addOptions({
                    'doi': 'DOI',
                    'manual': 'Manual',
                })
                .onChange(async (value) => {
                    if (value === 'doi') {
                        this.switch_doi_mode()
                    } else {
                        this.switch_manual_mode()
                    }
                })
            )
        
        new Setting(contentEl)
			.setName('ID Surfix')
			.setDesc('Surfix to the paper ID')
			.addText(text => text
				.setValue(this.id_surfix)
				.onChange(async (value) => {
					this.id_surfix = value
				}))

        new Setting(contentEl)
            .setName('Abstract')
            .setDesc('Abstract of the paper')
            .addText(text => text
                .setValue(this.abstract)
                .onChange(async (value) => {
                    this.abstract = value
                }))
        
        this.changable_el = contentEl.createDiv()
        this.switch_doi_mode()
    }

    switch_doi_mode() {
        this.changable_el.empty()

        new Setting(this.changable_el)
            .setName('DOI')
            .setDesc('Digital Object Identifier (DOI) of the paper')
            .addText(text => text
                .setValue(this.doi)
                .onChange(async (value) => {
                    this.doi = value
                }))

        new Setting(this.changable_el)
            .addButton(btn => {
                btn.setButtonText('Fetch')
                    .onClick(async () => await this.onfetch())
                this.btn = btn
            })
    }

    switch_manual_mode() {
        this.changable_el.empty()

        new Setting(this.changable_el)
            .setName('BibTeX')
            .setDesc('BibTeX of the paper')
            .addTextArea(textarea => textarea
                .setValue(this.bibtex)
                .onChange(async (value) => {
                    this.bibtex = value
                }))

        new Setting(this.changable_el)
            .addButton(btn => {
                btn.setButtonText('Process')
                    .onClick(async () => this.on_process(this.bibtex))
                this.btn = btn
            })
    }

    process_bibtex_field(field: BibtexField) {
        // gen id
        let authors = field.author.split(' and ')
        let first_author = authors[0]
        let last_name, first_name

        if (first_author.includes(',')) {
            [last_name, first_name] = first_author.split(',').map(str => str.trim())
        } else {
            let name_parts = first_author.split(' ').map(str => str.trim())
            last_name = name_parts.pop()
            first_name = name_parts.join(' ')
        }

        field['id'] = `${first_name}${last_name}${field['year'] || ''}`.replace(/[^a-zA-Z0-9]/g, '') + this.id_surfix

        // fix duplication
        if (field.id in this.plugin.cache.bibtex_dict) {
            field.id += '+'
        }

        // add abstract
        if (this.abstract != '') {
            field.abstract = this.abstract
        }

        return field
    }

    async onfetch() {
        this.btn.setIcon('loader')

        async function fetch_bibtex(doi: string) {
            return fetch(`https://doi.org/${doi}`, { headers: { Accept: "application/x-bibtex" }})
                .then(response => response.text())
                .catch(error => {
                    console.error('Error:', error)
                })
        }

        await fetch_bibtex(this.doi).then(async (bibtex) => {
            const fields = await parse_bitex(String(bibtex))

            if (fields.length != 0) {
                this.bibtex = make_bibtex(this.process_bibtex_field(fields[0]))
                copy_to_clipboard(this.bibtex)
                this.btn.setIcon('check')
            } else {
                new Notice('Fetch failed')
                this.btn.setIcon('ban')
            }

            setTimeout(() => this.btn.setButtonText('Fetch'), 1000)
        })
    }

    async on_process(bibtex: string) {
        this.btn.setIcon('loader')
        const fields = await parse_bitex(bibtex)

        if (fields.length != 0) {
            this.bibtex = make_bibtex(this.process_bibtex_field(fields[0]))
            copy_to_clipboard(this.bibtex)
            this.btn.setIcon('check')
        } else {
            new Notice('Process failed')
            this.btn.setIcon('ban')
        }

        setTimeout(() => this.btn.setButtonText('Process'), 1000)
    }
}