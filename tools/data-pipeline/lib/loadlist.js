'use strict';
/**
 * Textual (byte-preserving) merge of generated entries into `airportLoadList.json`.
 *
 * The existing hand-authored entries are kept verbatim (including whatever whitespace quirks the
 * file has); only entries carrying `"generated": true` are removed and re-inserted. New entries
 * are placed in alphabetical position.
 */

const fs = require('fs');

/**
 * Split the text of a top-level JSON array of objects into the verbatim text of each element
 * (plus the whitespace that precedes it on its line).
 * Handles braces inside strings.
 *
 * @param {string} text
 * @returns {Array<{indent: string, chunk: string}>}
 */
function splitTopLevelObjects(text) {
    const chunks = [];
    let depth = 0;
    let inString = false;
    let escaped = false;
    let start = -1;
    let indent = '';

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }

            continue;
        }

        if (ch === '"') {
            inString = true;
        } else if (ch === '{') {
            if (depth === 0) {
                start = i;
                const lineStart = text.lastIndexOf('\n', i) + 1;
                const lead = text.slice(lineStart, i);

                indent = /^[ \t]*$/.test(lead) ? lead : '    ';
            }

            depth += 1;
        } else if (ch === '}') {
            depth -= 1;

            if (depth === 0 && start >= 0) {
                chunks.push({ indent, chunk: text.slice(start, i + 1) });
                start = -1;
            }
        }
    }

    return chunks;
}

function entryText(entry) {
    return JSON.stringify(entry, null, 4).split('\n').map((line) => `    ${line}`).join('\n');
}

/**
 * @param {string} file
 * @param {Array<Object>} generatedEntries
 * @param {{dryRun?: boolean}} options
 * @returns {{kept: number, added: number, removed: number, changed: boolean}}
 */
function mergeLoadList(file, generatedEntries, { dryRun = false } = {}) {
    const text = fs.readFileSync(file, 'utf8');
    const existing = splitTopLevelObjects(text).map((c) => ({ text: `${c.indent}${c.chunk}`, data: JSON.parse(c.chunk) }));
    const kept = existing.filter((e) => e.data.generated !== true);
    const removed = existing.length - kept.length;
    const handIcaos = new Set(kept.map((e) => e.data.icao));
    const fresh = generatedEntries
        .filter((e) => !handIcaos.has(e.icao))
        .slice()
        .sort((a, b) => (a.icao < b.icao ? -1 : 1))
        .map((entry) => ({ text: entryText(entry), data: entry }));

    const merged = [];
    let f = 0;

    for (const e of kept) {
        while (f < fresh.length && fresh[f].data.icao < e.data.icao) {
            merged.push(fresh[f].text);
            f += 1;
        }

        merged.push(e.text);
    }

    while (f < fresh.length) {
        merged.push(fresh[f].text);
        f += 1;
    }

    const next = `[\n${merged.join(',\n')}\n]\n`;
    const changed = next !== text;

    if (changed && !dryRun) {
        fs.writeFileSync(file, next);
    }

    return { kept: kept.length, added: fresh.length, removed, changed };
}

module.exports = { splitTopLevelObjects, mergeLoadList };
