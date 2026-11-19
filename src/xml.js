/**
 * Minimal XML parser and serializer, DOM-free so it runs in the browser
 * and in Node tests.
 *
 * Supports what BPMN files need: elements, attributes, text, CDATA,
 * comments, processing instructions and the five predefined entities plus
 * numeric character references. Namespaces are not resolved; element and
 * attribute names keep their prefix (use localName() to compare them).
 *
 * Tree format:
 *   element: { name, attributes: { name: value }, children: [] }
 *   text:    { text }
 *   CDATA:   { cdata }
 */

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

const TAG = /<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const ATTRIBUTE = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * Parses an XML document and returns its root element.
 *
 * @param {string} text
 * @returns {{name:string, attributes:object, children:object[]}}
 * @throws {Error} if the document is not well-formed
 */
export function parseXML(text) {
    const document = { children: [] };
    const stack = [document];
    let pos = 0;
    while (pos < text.length) {
        const current = stack[stack.length - 1];
        if (text.startsWith('<?', pos)) {
            pos = skipTo(text, '?>', pos);
        } else if (text.startsWith('<!--', pos)) {
            pos = skipTo(text, '-->', pos);
        } else if (text.startsWith('<![CDATA[', pos)) {
            const end = indexOf(text, ']]>', pos);
            current.children.push({ cdata: text.slice(pos + 9, end) });
            pos = end + 3;
        } else if (text.startsWith('<!', pos)) {
            pos = skipTo(text, '>', pos);
        } else if (text.startsWith('</', pos)) {
            const end = indexOf(text, '>', pos);
            const name = text.slice(pos + 2, end).trim();
            if (stack.length === 1 || current.name !== name) {
                throw new Error(`XML: unexpected closing tag </${name}>`);
            }
            stack.pop();
            pos = end + 1;
        } else if (text[pos] === '<') {
            TAG.lastIndex = pos;
            const match = TAG.exec(text);
            if (!match) {
                throw new Error(`XML: invalid tag at position ${pos}`);
            }
            const element = { name: match[1], attributes: parseAttributes(match[2]), children: [] };
            current.children.push(element);
            if (!match[3]) {
                stack.push(element);
            }
            pos = TAG.lastIndex;
        } else {
            const end = text.indexOf('<', pos);
            const raw = text.slice(pos, end < 0 ? text.length : end);
            if (raw.trim()) {
                current.children.push({ text: decode(raw) });
            }
            pos = end < 0 ? text.length : end;
        }
    }
    if (stack.length > 1) {
        throw new Error(`XML: missing closing tag </${stack[stack.length - 1].name}>`);
    }
    const root = document.children.find(child => child.name);
    if (!root) {
        throw new Error('XML: document has no root element');
    }
    return root;
}

/**
 * Serializes an element tree into an indented XML document.
 */
export function serializeXML(root) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + write(root, 0) + '\n';
}

/**
 * Creates an element. Attributes with value null or undefined are skipped.
 */
export function element(name, attributes = {}, children = []) {
    const clean = {};
    for (const [key, value] of Object.entries(attributes)) {
        if (value !== null && value !== undefined) {
            clean[key] = String(value);
        }
    }
    return { name, attributes: clean, children };
}

/**
 * Returns the name without namespace prefix ('bpmn2:task' → 'task').
 */
export function localName(name) {
    return name.slice(name.indexOf(':') + 1);
}

/**
 * Returns the child elements, optionally only those with the given local name.
 */
export function childElements(parent, name) {
    return parent.children.filter(child => child.name && (!name || localName(child.name) === name));
}

/**
 * Returns the value of the attribute with the given local name.
 */
export function attribute(el, name) {
    const key = Object.keys(el.attributes).find(key => localName(key) === name);
    return key === undefined ? undefined : el.attributes[key];
}

/**
 * Returns the text and CDATA content of an element (not of nested elements).
 */
export function textContent(el) {
    return el.children.map(child => child.text ?? child.cdata ?? '').join('');
}

function write(node, depth) {
    if (node.text !== undefined) {
        return escape(node.text);
    }
    if (node.cdata !== undefined) {
        return `<![CDATA[${node.cdata.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
    }
    const indent = '  '.repeat(depth);
    const attributes = Object.entries(node.attributes)
        .map(([key, value]) => ` ${key}="${escape(value).replaceAll('"', '&quot;')}"`)
        .join('');
    if (node.children.length === 0) {
        return `${indent}<${node.name}${attributes}/>`;
    }
    if (node.children.every(child => !child.name)) {
        const content = node.children.map(child => write(child, 0)).join('');
        return `${indent}<${node.name}${attributes}>${content}</${node.name}>`;
    }
    const content = node.children
        .map(child => child.name ? write(child, depth + 1) : indent + '  ' + write(child, 0))
        .join('\n');
    return `${indent}<${node.name}${attributes}>\n${content}\n${indent}</${node.name}>`;
}

function parseAttributes(source) {
    const attributes = {};
    for (const match of source.matchAll(ATTRIBUTE)) {
        attributes[match[1]] = decode(match[2] ?? match[3]);
    }
    return attributes;
}

function decode(text) {
    return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|\w+);/g, (entity, code) => {
        if (code.startsWith('#x')) {
            return String.fromCodePoint(parseInt(code.slice(2), 16));
        }
        if (code.startsWith('#')) {
            return String.fromCodePoint(parseInt(code.slice(1), 10));
        }
        return ENTITIES[code] ?? entity;
    });
}

function escape(text) {
    return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function indexOf(text, search, from) {
    const index = text.indexOf(search, from);
    if (index < 0) {
        throw new Error(`XML: missing '${search}'`);
    }
    return index;
}

function skipTo(text, search, from) {
    return indexOf(text, search, from) + search.length;
}
