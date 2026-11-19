import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXML, serializeXML, element, localName, childElements, attribute, textContent } from '../src/xml.js';

test('parses elements, attributes, text and CDATA', () => {
    const root = parseXML(`<?xml version="1.0"?>
        <!-- comment -->
        <a:root x="1" y='two'>
            <a:child name="a &amp; b">Text &lt;1&gt;</a:child>
            <a:empty/>
            <a:value><![CDATA[x < y]]></a:value>
        </a:root>`);
    assert.equal(root.name, 'a:root');
    assert.deepEqual(root.attributes, { x: '1', y: 'two' });
    const [child, empty, value] = childElements(root);
    assert.equal(attribute(child, 'name'), 'a & b');
    assert.equal(textContent(child), 'Text <1>');
    assert.deepEqual(empty.children, []);
    assert.equal(textContent(value), 'x < y');
});

test('localName and childElements ignore the namespace prefix', () => {
    const root = parseXML('<bpmn2:process><bpmn2:task/><other:task/><bpmn2:endEvent/></bpmn2:process>');
    assert.equal(localName('bpmn2:task'), 'task');
    assert.equal(localName('task'), 'task');
    assert.equal(childElements(root, 'task').length, 2);
});

test('serialize and parse are inverse', () => {
    const tree = element('r', { a: 'x "y" & z' }, [
        element('c', { empty: null }),
        element('t', {}, [{ text: '1 < 2 & 3' }]),
        element('d', {}, [{ cdata: 'contains ]]> inside' }])
    ]);
    const xml = serializeXML(tree);
    assert.ok(xml.startsWith('<?xml'));
    const parsed = parseXML(xml);
    assert.equal(attribute(parsed, 'a'), 'x "y" & z');
    assert.equal(attribute(childElements(parsed, 'c')[0], 'empty'), undefined);
    assert.equal(textContent(childElements(parsed, 't')[0]), '1 < 2 & 3');
    assert.equal(textContent(childElements(parsed, 'd')[0]), 'contains ]]> inside');
});

test('numeric character references are decoded', () => {
    assert.equal(textContent(parseXML('<a>&#228;&#x00FC;</a>')), 'äü');
});

test('malformed documents are rejected', () => {
    assert.throws(() => parseXML('<a><b></a>'), /closing tag/);
    assert.throws(() => parseXML('<a>'), /missing closing tag/);
    assert.throws(() => parseXML('just text'), /no root element/);
});
