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

export function parse_bitex(bibtex_source: string, lower_case_type: boolean = true): BibtexField[] | null {
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

        bibtex += `    ${key} = {${fields[key]}},\n`
    }

    bibtex += '}\n'

    return bibtex
}