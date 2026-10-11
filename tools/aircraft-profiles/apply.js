/* eslint-disable no-console */
/**
 * Writes the `profile` block from `profiles.js` into every `assets/aircraft/<icao>.json`.
 *
 * The files are edited textually (not re-serialised) so the hand-aligned formatting of the
 * existing aircraft definitions is left untouched. Re-running is safe: an existing `profile`
 * block is replaced.
 *
 * Usage: node tools/aircraft-profiles/apply.js
 */
const fs = require('fs');
const path = require('path');
const profiles = require('./profiles');

const AIRCRAFT_DIR = path.join(__dirname, '../../assets/aircraft');
const PROFILE_BLOCK_PATTERN = /,\s*"profile":\s*\{[^}]*\}(\s*)\}\s*$/;

const files = fs.readdirSync(AIRCRAFT_DIR).filter((f) => f.endsWith('.json') && f !== 'aircraft.json');
const missing = [];
let written = 0;

files.forEach((file) => {
    const filePath = path.join(AIRCRAFT_DIR, file);
    let text = fs.readFileSync(filePath, 'utf8');
    const icao = JSON.parse(text).icao;
    const entry = profiles[icao];

    if (!entry) {
        missing.push(icao);

        return;
    }

    const [seats, fuelBurnKgPerHour, fuelCapacityKg] = entry;
    const block = `,\n    "profile": {\n        "seats": ${seats},\n        "fuelBurnKgPerHour": ${fuelBurnKgPerHour},\n` +
        `        "fuelCapacityKg": ${fuelCapacityKg}\n    }\n}\n`;

    text = text.replace(PROFILE_BLOCK_PATTERN, '\n}\n');
    text = text.replace(/\s*\}\s*$/, block);

    JSON.parse(text); // throws if we broke the file
    fs.writeFileSync(filePath, text);
    written += 1;
});

const unusedKeys = Object.keys(profiles).filter((icao) => !files.some((f) => f.toLowerCase() === `${icao.toLowerCase()}.json`));

console.log(`wrote ${written} profiles`);

if (missing.length) {
    console.log(`WARNING: no profile for: ${missing.join(', ')}`);
    process.exitCode = 1;
}

if (unusedKeys.length) {
    console.log(`WARNING: profile entries without an aircraft file: ${unusedKeys.join(', ')}`);
}
