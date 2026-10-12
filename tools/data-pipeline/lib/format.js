'use strict';
/**
 * JSON serialisation that is compact but diff-friendly:
 *
 *  - every top-level key is on its own line;
 *  - for "collection" keys (fixes, runways, sids, spawnPatterns, maps, airspace, fleets ...)
 *    every direct child is also on its own line;
 *  - everything deeper is serialised compactly (no spaces) on that line;
 *  - for `maps[].lines` every line segment is on its own line.
 */

const EXPAND_KEYS = new Set(['fixes', 'runways', 'sids', 'stars', 'spawnPatterns', 'maps', 'airspace', 'fleets', 'airports']);

function compact(value) {
    return JSON.stringify(value);
}

function serializeExpanded(value, indent, childIndent = indent + 4) {
    const pad = ' '.repeat(indent);
    const padIn = ' '.repeat(childIndent);

    if (Array.isArray(value)) {
        if (value.length === 0) {
            return '[]';
        }

        const items = value.map((child) => `${padIn}${compact(child)}`);

        return `[\n${items.join(',\n')}\n${pad}]`;
    }

    if (value && typeof value === 'object') {
        const keys = Object.keys(value);

        if (keys.length === 0) {
            return '{}';
        }

        const items = keys.map((key) => `${padIn}${JSON.stringify(key)}: ${compact(value[key])}`);

        return `{\n${items.join(',\n')}\n${pad}}`;
    }

    return compact(value);
}

/** maps need one more level: each map's `lines` array on separate rows. */
function serializeMaps(maps) {
    if (!Array.isArray(maps) || maps.length === 0) {
        return compact(maps);
    }

    const items = maps.map((map) => {
        const lines = (map.lines || []).map((line) => `            ${compact(line)}`).join(',\n');
        const rest = Object.assign({}, map);

        delete rest.lines;

        const head = compact(rest).slice(0, -1); // drop closing brace

        return `        ${head},"lines": [\n${lines}\n        ]}`;
    });

    return `[\n${items.join(',\n')}\n    ]`;
}

/**
 * @param {Object} obj
 * @returns {string} JSON text with trailing newline
 */
function serializeFile(obj) {
    const keys = Object.keys(obj);
    const rows = keys.map((key) => {
        const value = obj[key];
        let text;

        if (key === 'maps') {
            text = serializeMaps(value);
        } else if (key === 'airports') {
            text = serializeExpanded(value, 4, 0); // the (large) airport index: rows unindented to save space
        } else if (EXPAND_KEYS.has(key) && value && typeof value === 'object') {
            text = serializeExpanded(value, 4);
        } else {
            text = compact(value);
        }

        return `    ${JSON.stringify(key)}: ${text}`;
    });

    return `{\n${rows.join(',\n')}\n}\n`;
}

module.exports = { serializeFile };
