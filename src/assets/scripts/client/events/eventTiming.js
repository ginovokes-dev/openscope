/**
 * Timing for random events
 *
 * Failures (emergencies, go-arounds, radio failures...) and routine pilot requests run as two independent
 * Poisson-like processes. The player's "Failures and emergencies" setting scales the failure process;
 * the request process is slower and is switched off only by its own option.
 */

export const FAILURE_FREQUENCY = {
    OFF: 'off',
    RARE: 'rare',
    OCCASIONAL: 'occasional',
    FREQUENT: 'frequent',
    CHAOS: 'chaos'
};

/**
 * - `meanFailureSeconds`: average time between failure events (Infinity disables them)
 * - `meanRequestSeconds`: average time between pilot requests
 * - `maxActiveEmergencies`: new emergencies are held back while this many are unresolved
 * - `firstEventDelaySeconds`: [min, max] before the first event after a (re)start, so the player can settle in
 *
 * @property FREQUENCY_PROFILE
 * @type {object}
 * @final
 */
export const FREQUENCY_PROFILE = {
    [FAILURE_FREQUENCY.OFF]: {
        meanFailureSeconds: Infinity, meanRequestSeconds: 660, maxActiveEmergencies: 0, firstEventDelaySeconds: [240, 420]
    },
    [FAILURE_FREQUENCY.RARE]: {
        meanFailureSeconds: 3600, meanRequestSeconds: 540, maxActiveEmergencies: 1, firstEventDelaySeconds: [480, 900]
    },
    [FAILURE_FREQUENCY.OCCASIONAL]: {
        meanFailureSeconds: 1200, meanRequestSeconds: 420, maxActiveEmergencies: 1, firstEventDelaySeconds: [300, 600]
    },
    [FAILURE_FREQUENCY.FREQUENT]: {
        meanFailureSeconds: 600, meanRequestSeconds: 300, maxActiveEmergencies: 2, firstEventDelaySeconds: [180, 420]
    },
    [FAILURE_FREQUENCY.CHAOS]: {
        meanFailureSeconds: 240, meanRequestSeconds: 180, maxActiveEmergencies: 3, firstEventDelaySeconds: [90, 180]
    }
};

const MINIMUM_GAP_SECONDS = 90;

/**
 * @function getProfile
 * @param frequency {string}
 * @return {object}
 */
export const getFrequencyProfile = (frequency) => FREQUENCY_PROFILE[frequency] || FREQUENCY_PROFILE[FAILURE_FREQUENCY.RARE];

/**
 * Exponentially distributed wait with the given mean, never shorter than a minimum gap
 *
 * @function sampleExponentialDelay
 * @param meanSeconds {number}
 * @param random {function}
 * @return {number} seconds (Infinity when the mean is Infinity)
 */
export const sampleExponentialDelay = (meanSeconds, random = Math.random) => {
    if (meanSeconds === Infinity) {
        return Infinity;
    }

    const u = Math.max(random(), 1e-9);

    return Math.max(MINIMUM_GAP_SECONDS, -Math.log(u) * meanSeconds);
};

/**
 * @function sampleFirstEventDelay
 * @param frequency {string}
 * @param random {function}
 * @return {number}
 */
export const sampleFirstEventDelay = (frequency, random = Math.random) => {
    const [min, max] = getFrequencyProfile(frequency).firstEventDelaySeconds;

    return min + (random() * (max - min));
};
