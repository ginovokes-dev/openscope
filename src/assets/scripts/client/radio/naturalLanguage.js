/**
 * Typed or spoken text that is not a command-bar command but reads like a sentence
 *
 * @function looksLikeNaturalLanguage
 * @param text {string}
 * @return {boolean}
 */
export const looksLikeNaturalLanguage = (text) => {
    const words = String(text || '').trim().toLowerCase().split(/\s+/);
    const longWords = words.filter((word) => /^[a-z']{4,}$/.test(word));

    return words.length >= 3 && longWords.length >= 2;
};
