'use strict';
/**
 * Small deterministic PRNG helpers. Everything the generators randomise is seeded from a
 * string (normally the airport/airline ICAO), so re-running the tool reproduces identical files.
 */

/** FNV-1a 32 bit hash of a string. */
function hashString(str) {
    let h = 0x811c9dc5;

    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }

    return h >>> 0;
}

/** mulberry32 generator returning floats in [0, 1). */
function mulberry32(seed) {
    let a = seed >>> 0;

    return function next() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * @param {string} seedString
 * @returns {{next: function(): number, int: function(number, number): number, pick: function(Array): *}}
 */
function createRng(seedString) {
    const next = mulberry32(hashString(String(seedString)));

    return {
        next,
        /** integer in [min, max] inclusive */
        int(min, max) {
            return min + Math.floor(next() * (max - min + 1));
        },
        pick(list) {
            return list[Math.floor(next() * list.length)];
        },
        /** uniform float in [min, max) */
        float(min, max) {
            return min + next() * (max - min);
        }
    };
}

module.exports = { hashString, mulberry32, createRng };
