'use strict';
/**
 * Minimal, defensive RFC-4180 CSV parser (no dependencies).
 *
 * - Handles quoted fields, embedded commas, embedded newlines and doubled quotes ("").
 * - Strips a leading UTF-8 BOM.
 * - Accepts \n, \r\n and bare \r line endings.
 * - Never evaluates anything; returns plain arrays / objects of strings.
 * - Tolerates ragged rows (missing cells become '', extra cells are ignored in
 *   `parseCsvObjects`).
 *
 * The same parser is also used for the OpenFlights `.dat` files, which are CSV
 * with `\N` as the NULL marker (see `normaliseNull`).
 */

/**
 * @param {string} text
 * @returns {string[][]} rows of cells
 */
function parseCsv(text) {
    if (typeof text !== 'string') {
        throw new TypeError('parseCsv expects a string');
    }

    if (text.charCodeAt(0) === 0xFEFF) {
        text = text.slice(1);
    }

    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;
    const n = text.length;

    while (i < n) {
        const ch = text[i];

        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 2;
                    continue;
                }

                inQuotes = false;
                i += 1;
                continue;
            }

            field += ch;
            i += 1;
            continue;
        }

        if (ch === '"') {
            inQuotes = true;
            i += 1;
        } else if (ch === ',') {
            row.push(field);
            field = '';
            i += 1;
        } else if (ch === '\r' || ch === '\n') {
            row.push(field);
            field = '';

            if (!(row.length === 1 && row[0] === '')) {
                rows.push(row);
            }

            row = [];

            if (ch === '\r' && text[i + 1] === '\n') {
                i += 2;
            } else {
                i += 1;
            }
        } else {
            field += ch;
            i += 1;
        }
    }

    // trailing field / row without terminating newline
    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    return rows;
}

/**
 * Parse CSV with a header row into an array of plain objects (string values).
 *
 * @param {string} text
 * @returns {Array<Object<string,string>>}
 */
function parseCsvObjects(text) {
    const rows = parseCsv(text);

    if (rows.length === 0) {
        return [];
    }

    const header = rows[0];
    const out = [];

    for (let r = 1; r < rows.length; r++) {
        const cells = rows[r];
        const obj = Object.create(null);

        for (let c = 0; c < header.length; c++) {
            obj[header[c]] = c < cells.length ? cells[c] : '';
        }

        out.push(obj);
    }

    return out;
}

/**
 * OpenFlights uses `\N` for NULL. Return '' for it.
 *
 * @param {string} value
 * @returns {string}
 */
function normaliseNull(value) {
    return value === '\\N' ? '' : value;
}

module.exports = { parseCsv, parseCsvObjects, normaliseNull };
