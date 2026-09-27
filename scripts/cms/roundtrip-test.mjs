import assert from 'node:assert/strict';
import { marked } from 'marked';
import { JSDOM } from 'jsdom';
import { files, readContent, toDocument, fromDocument, portableTextToMarkdown } from './mapping.mjs';

function normalizeHtml(markdown) {
  // breaks: переносы строк значимы для сайта (renderGuide делает из них <br>), их потеря — расхождение
  const document = new JSDOM(marked.parse(markdown, { breaks: true })).window.document;
  const normalize = (node) => {
    if (node.nodeType === 3) return ['#text', node.textContent.replace(/\s+/g, ' ')];
    if (node.nodeType !== 1) return null;
    const attributes = [...node.attributes]
      .map(({ name, value }) => [name, value])
      .sort(([a], [b]) => a.localeCompare(b));
    const children = [...node.childNodes].map(normalize).filter((child) => child !== null);
    return [node.tagName.toLowerCase(), attributes, children];
  };
  return [...document.body.childNodes].map(normalize).filter((node) => node !== null);
}

function firstDifference(actual, expected, path = '$') {
  if (Object.is(actual, expected)) return null;
  if (typeof actual !== typeof expected || actual === null || expected === null) {
    return `${path}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`;
  }
  if (typeof actual !== 'object') return `${path}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`;
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  for (const key of keys) {
    if (!(key in actual) || !(key in expected)) return `${path}.${key}: поле отсутствует`;
    const result = firstDifference(actual[key], expected[key], `${path}.${key}`);
    if (result) return result;
  }
  return null;
}

let count = 0;
const differences = [];
for (const file of await files()) {
  try {
    const { data, body } = await readContent(file);
    const document = toDocument(file, data, body);
    const restored = fromDocument(file, document);
    const dataDifference = firstDifference(restored, data);
    if (dataDifference) differences.push(`${file.path}: ${dataDifference}`);
    if (body !== undefined) {
      const htmlDifference = firstDifference(
        normalizeHtml(portableTextToMarkdown(document.body)),
        normalizeHtml(body),
      );
      if (htmlDifference) differences.push(`${file.path}: HTML ${htmlDifference}`);
    }
    count++;
  } catch (error) {
    differences.push(`${file.path}: ${String(error)}`);
  }
}
for (const difference of differences) console.error(difference);
console.log(`${count} файлов, ${differences.length} расхождений`);
assert.equal(differences.length, 0);
