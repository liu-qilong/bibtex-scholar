export interface BibtexField {
    [key: string]: string;
}

export function parse_bitex(bibtex_source: string, lower_case_type: boolean = true): BibtexField | null {
    // match type, id, & fields
    const entryRegex = /@([a-zA-Z]+){([^,]+),(.*)}/g
    let match = entryRegex.exec(bibtex_source.replace(/\n/g, ''))

    if (!match) {
        console.error(`No match found for the provided BibTeX source: ${bibtex_source}`)
        return null
    }

    let fields: BibtexField = {}
    fields['type'] = match[1]
    fields['id'] = match[2]
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

    return fields
}