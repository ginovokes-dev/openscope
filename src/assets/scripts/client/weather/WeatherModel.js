import {
    CLIMATE,
    REGIME_BLEND_MINUTES,
    REGIME_DEFINITION,
    REGIME_SEVERITY,
    TREND_LOOKAHEAD_MINUTES,
    VARIABILITY_PROFILE,
    WEATHER_REGIME,
    WEATHER_STEP_SECONDS,
    WEATHER_VARIABILITY
} from './weatherConstants';

const SECONDS_PER_MINUTE = 60;
const MAXIMUM_DIRECTION_SLEW_DEGREES_PER_MINUTE = 3;
const MINIMUM_GUSTING_MEAN_SPEED_KNOTS = 8;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, amount) => from + ((to - from) * amount);

/**
 * Wrap a direction in degrees into 1..360 (aviation convention: north is 360, never 0)
 *
 * @function normalizeDirection
 * @param degrees {number}
 * @return {number}
 */
export const normalizeDirection = (degrees) => {
    const wrapped = ((Math.round(degrees) % 360) + 360) % 360;

    return wrapped === 0 ? 360 : wrapped;
};

/**
 * Signed shortest angular difference `to - from`, in degrees (-180..180]
 *
 * @function angleDifference
 * @param from {number}
 * @param to {number}
 * @return {number}
 */
export const angleDifference = (from, to) => {
    let difference = (to - from) % 360;

    if (difference > 180) {
        difference -= 360;
    } else if (difference <= -180) {
        difference += 360;
    }

    return difference;
};

/**
 * Round a visibility to the step used when it is reported
 *
 * @function roundVisibility
 * @param meters {number}
 * @return {number} 9999 means "10 km or more"
 */
export const roundVisibility = (meters) => {
    if (meters >= 9500) {
        return 9999;
    }

    if (meters >= 5000) {
        return Math.round(meters / 1000) * 1000;
    }

    if (meters >= 800) {
        return Math.round(meters / 100) * 100;
    }

    return Math.max(50, Math.round(meters / 50) * 50);
};

/**
 * Lowest broken, overcast or vertical-visibility layer, in feet
 *
 * @function getCeilingFeet
 * @param cloudLayers {array<object>}
 * @return {number|null}
 */
export const getCeilingFeet = (cloudLayers) => {
    const ceilingLayers = cloudLayers.filter((layer) => layer.cover === 'BKN' || layer.cover === 'OVC' || layer.cover === 'VV');

    if (ceilingLayers.length === 0) {
        return null;
    }

    return Math.min(...ceilingLayers.map((layer) => layer.baseFt));
};

const VISIBILITY_BANDS = [150, 350, 600, 800, 1500, 3000, 5000, 9999];
const CEILING_BANDS = [100, 200, 500, 1000, 1500, 3000];

const bandOf = (value, bands) => {
    for (let i = 0; i < bands.length; i++) {
        if (value <= bands[i]) {
            return i;
        }
    }

    return bands.length;
};

const phenomenaKey = (phenomena) => [...phenomena].sort().join(' ');

/**
 * Decide whether the weather differs enough between two snapshots to warrant a new ATIS
 *
 * Thresholds follow the spirit of the ICAO Annex 3 "significant change" criteria: wind direction by 30
 * degrees or speed by 10 knots, visibility and ceiling crossing operating bands, the onset or end of
 * precipitation, fog or thunderstorms, and QNH by 2 hPa.
 *
 * @function hasSignificantWeatherChange
 * @param previous {object} snapshot
 * @param next {object} snapshot
 * @return {boolean}
 */
export const hasSignificantWeatherChange = (previous, next) => {
    if (!previous || !next) {
        return false;
    }

    const meanSpeed = Math.max(previous.windSpeed, next.windSpeed);

    if (meanSpeed >= 5 && Math.abs(angleDifference(previous.windDirection, next.windDirection)) >= 30) {
        return true;
    }

    if (Math.abs(previous.windSpeed - next.windSpeed) >= 10) {
        return true;
    }

    if (Boolean(previous.windGust) !== Boolean(next.windGust)) {
        return true;
    }

    if (previous.windGust && next.windGust && Math.abs(previous.windGust - next.windGust) >= 10) {
        return true;
    }

    if (bandOf(previous.visibilityMeters, VISIBILITY_BANDS) !== bandOf(next.visibilityMeters, VISIBILITY_BANDS)) {
        return true;
    }

    const previousCeiling = previous.ceilingFeet ?? Infinity;
    const nextCeiling = next.ceilingFeet ?? Infinity;

    if (bandOf(previousCeiling, CEILING_BANDS) !== bandOf(nextCeiling, CEILING_BANDS)) {
        return true;
    }

    if (phenomenaKey(previous.phenomena) !== phenomenaKey(next.phenomena)) {
        return true;
    }

    return Math.abs(previous.qnhHpa - next.qnhHpa) >= 2;
};

/**
 * A believable, evolving surface weather state for one airport
 *
 * Pure and deterministic given an injected random source, so it can be unit tested without the sim.
 *
 * @class WeatherModel
 */
export default class WeatherModel {
    /**
     * @constructor
     * @param options {object}
     * @param options.latitudeDegrees {number} sets typical temperature
     * @param options.variability {string} one of `WEATHER_VARIABILITY`
     * @param options.baseWind {object} `{ angle, speed }` initial wind (the airport file's wind)
     * @param options.random {function} random source returning [0, 1)
     * @param options.startRegime {string} optional starting regime
     * @param options.seasonOffsetCelsius {number} optional fixed seasonal temperature offset
     */
    constructor({
        latitudeDegrees = 50,
        variability = WEATHER_VARIABILITY.NORMAL,
        baseWind = { angle: 270, speed: 8 },
        random = Math.random,
        startRegime = null,
        seasonOffsetCelsius = null
    } = {}) {
        this._random = random;
        this._variability = VARIABILITY_PROFILE[variability] ? variability : WEATHER_VARIABILITY.NORMAL;
        this._profile = VARIABILITY_PROFILE[this._variability];
        this._time = 0;
        this._stepAccumulator = 0;

        const season = seasonOffsetCelsius === null ? lerp(-6, 15, this._random()) : seasonOffsetCelsius;

        this._baseTemperature = 28 - (0.45 * Math.abs(latitudeDegrees)) + season;

        this._windDirection = normalizeDirection(baseWind.angle || 360);
        this._windMean = clamp(baseWind.speed || 0, 0, 60);
        this._windNoise = 0;
        this._windDirectionTarget = this._windDirection;
        this._variableRange = null;

        this._temperature = this._baseTemperature;
        this._qnh = CLIMATE.MEAN_QNH_HPA + lerp(-8, 8, this._random());

        this._regime = null;
        this._regimeStartedAt = 0;
        this._regimeEndsAt = Infinity;
        this._from = null;
        this._to = null;
        this._blend = 1;
        this._pending = null;

        this._enterRegime(startRegime && REGIME_DEFINITION[startRegime] ? startRegime : this._chooseInitialRegime(), true);
        this._scheduleNext();
    }

    get variability() {
        return this._variability;
    }

    get regime() {
        return this._regime;
    }

    /**
     * Change how lively the weather is. Takes effect from the next regime change.
     *
     * @for WeatherModel
     * @method setVariability
     * @param variability {string}
     */
    setVariability(variability) {
        if (!VARIABILITY_PROFILE[variability] || variability === this._variability) {
            return;
        }

        this._variability = variability;
        this._profile = VARIABILITY_PROFILE[variability];

        if (this._profile.meanMinutes === Infinity) {
            this._regimeEndsAt = Infinity;
            this._pending = null;
        } else {
            this._regimeEndsAt = this._time + this._sampleDurationSeconds();
            this._scheduleNext();
        }
    }

    /**
     * Impose a surface wind (eg. when the player drags the wind sliders)
     *
     * @for WeatherModel
     * @method setWind
     * @param wind {object} `{ angle, speed }`
     */
    setWind({ angle, speed }) {
        this._windDirection = normalizeDirection(angle || 360);
        this._windDirectionTarget = this._windDirection;
        this._windMean = clamp(speed, 0, 60);
        this._windNoise = 0;

        if (this._to) {
            this._to.windMean = this._windMean;
        }

        if (this._from) {
            this._from.windMean = this._windMean;
        }
    }

    /**
     * Jump straight to a regime (eg. for scripted scenarios or the test harness)
     *
     * @for WeatherModel
     * @method forceRegime
     * @param regime {string}
     */
    forceRegime(regime) {
        if (!REGIME_DEFINITION[regime]) {
            return;
        }

        this._enterRegime(regime, false);
        this._scheduleNext();
    }

    /**
     * Advance the simulation
     *
     * @for WeatherModel
     * @method tick
     * @param deltaSeconds {number} simulated seconds elapsed
     * @return {boolean} true when the state advanced
     */
    tick(deltaSeconds) {
        if (!(deltaSeconds > 0)) {
            return false;
        }

        this._stepAccumulator += deltaSeconds;
        let advanced = false;

        while (this._stepAccumulator >= WEATHER_STEP_SECONDS) {
            this._stepAccumulator -= WEATHER_STEP_SECONDS;
            this._step(WEATHER_STEP_SECONDS);
            advanced = true;
        }

        return advanced;
    }

    /**
     * Current weather, rounded as it would be reported
     *
     * @for WeatherModel
     * @method getSnapshot
     * @return {object}
     */
    getSnapshot() {
        const blend = this._blend;
        const useTo = blend >= 0.5;
        const source = useTo ? this._to : this._from;
        const cloud = this._blendCloud(blend);
        const visibilityMeters = roundVisibility(lerp(this._from.visibility, this._to.visibility, blend));
        const windSpeed = Math.round(clamp(this._windMean + this._windNoise, 0, 70));
        const gusting = source.gustSpread > 0 && windSpeed >= MINIMUM_GUSTING_MEAN_SPEED_KNOTS;
        const windGust = gusting ? windSpeed + Math.round(source.gustSpread) : null;
        const dewpointSpread = lerp(this._from.dewpointSpread, this._to.dewpointSpread, blend);
        const temperature = Math.round(this._temperature);
        const dewpoint = Math.round(this._temperature - dewpointSpread);
        const variable = windSpeed >= 3 && this._variableRange ? this._variableRange : null;

        return {
            regime: this._regime,
            windDirection: Math.round(this._windDirection / 10) * 10 || 360,
            windSpeed,
            windGust,
            windVariableFrom: variable ? normalizeDirection(Math.round((this._windDirection - variable) / 10) * 10) : null,
            windVariableTo: variable ? normalizeDirection(Math.round((this._windDirection + variable) / 10) * 10) : null,
            visibilityMeters,
            cloud,
            ceilingFeet: getCeilingFeet(cloud),
            phenomena: [...source.phenomena],
            temperatureC: temperature,
            dewpointC: Math.min(dewpoint, temperature),
            qnhHpa: Math.round(clamp(this._qnh, CLIMATE.MIN_QNH_HPA, CLIMATE.MAX_QNH_HPA))
        };
    }

    /**
     * Details of the next regime change when it is close enough to be forecast
     *
     * @for WeatherModel
     * @method getUpcoming
     * @return {object|null} `{ regime, label, inMinutes, visibilityMeters, ceilingFeet, phenomena, windSpeed }`
     */
    getUpcoming() {
        if (!this._pending || this._regimeEndsAt === Infinity) {
            return null;
        }

        const inMinutes = (this._regimeEndsAt - this._time) / SECONDS_PER_MINUTE;

        if (inMinutes > TREND_LOOKAHEAD_MINUTES || inMinutes < 0) {
            return null;
        }

        return {
            regime: this._pending.regime,
            label: REGIME_DEFINITION[this._pending.regime].label,
            inMinutes: Math.max(1, Math.round(inMinutes)),
            visibilityMeters: roundVisibility(this._pending.visibility),
            ceilingFeet: getCeilingFeet(this._pending.cloud),
            phenomena: [...this._pending.phenomena],
            windSpeed: Math.round(this._pending.windMean)
        };
    }

    // ------------------------------ PRIVATE ------------------------------

    _gaussian() {
        const u = Math.max(this._random(), 1e-9);
        const v = this._random();

        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    _isRegimeAllowed(regime) {
        const severity = REGIME_SEVERITY.indexOf(regime);

        if (severity > this._profile.maxSeverity) {
            return false;
        }

        if (regime === WEATHER_REGIME.SNOW) {
            return this._baseTemperature <= 3;
        }

        return true;
    }

    _chooseInitialRegime() {
        const candidates = [
            [WEATHER_REGIME.CAVOK, 3],
            [WEATHER_REGIME.FAIR, 4],
            [WEATHER_REGIME.CLOUDY, 3],
            [WEATHER_REGIME.SHOWERS, 1.5],
            [WEATHER_REGIME.RAIN, 1]
        ].filter(([regime]) => this._isRegimeAllowed(regime));

        return this._chooseWeighted(candidates) || WEATHER_REGIME.CAVOK;
    }

    _chooseWeighted(entries) {
        const total = entries.reduce((sum, entry) => sum + entry[1], 0);

        if (total <= 0) {
            return null;
        }

        let roll = this._random() * total;

        for (let i = 0; i < entries.length; i++) {
            roll -= entries[i][1];

            if (roll < 0) {
                return entries[i][0];
            }
        }

        return entries[entries.length - 1][0];
    }

    _sampleDurationSeconds() {
        if (this._profile.meanMinutes === Infinity) {
            return Infinity;
        }

        return this._profile.meanMinutes * SECONDS_PER_MINUTE * lerp(0.5, 1.5, this._random());
    }

    _chooseNextRegime(current) {
        const neighbours = Object.entries(REGIME_DEFINITION[current].neighbours)
            .filter(([regime]) => this._isRegimeAllowed(regime));

        // everything severe can be reached from a benign state only through its neighbours; if the
        // variability cap blocks every neighbour, fall back to the benign end of the scale
        return this._chooseWeighted(neighbours) || (current === WEATHER_REGIME.CAVOK ? WEATHER_REGIME.FAIR : WEATHER_REGIME.CAVOK);
    }

    /**
     * Sample the numeric targets for a regime
     */
    _sampleRegime(regime) {
        const definition = REGIME_DEFINITION[regime];
        const windMean = lerp(definition.wind[0], definition.wind[1], this._random());
        const isGusty = this._random() < definition.gustChance && windMean >= MINIMUM_GUSTING_MEAN_SPEED_KNOTS;
        const gustSpread = isGusty ? clamp(windMean * lerp(0.35, 0.7, this._random()), 10, 24) : 0;
        const visibility = lerp(definition.visibility[0], definition.visibility[1], this._random());
        const cloud = definition.cloud.map(([cover, [min, max], type]) => ({
            cover,
            baseFt: Math.round(lerp(min, max, this._random()) / 100) * 100,
            type: type || null
        }));
        const phenomena = definition.phenomena.length > 0 ?
            [definition.phenomena[Math.floor(this._random() * definition.phenomena.length)]] :
            [];

        return {
            regime,
            windMean,
            gustSpread,
            visibility,
            cloud,
            phenomena,
            qnhTarget: CLIMATE.MEAN_QNH_HPA + definition.qnhShift + (this._gaussian() * 2),
            dewpointSpread: lerp(definition.dewpointSpread[0], definition.dewpointSpread[1], this._random())
        };
    }

    _enterRegime(regime, isInitial) {
        const sampled = this._pending && this._pending.regime === regime && !isInitial ?
            this._pending :
            this._sampleRegime(regime);

        this._from = this._to || { ...sampled, cloud: sampled.cloud.map((layer) => ({ ...layer })) };
        this._to = sampled;
        this._blend = isInitial ? 1 : 0;
        this._regime = regime;
        this._regimeStartedAt = this._time;
        this._regimeEndsAt = this._time + this._sampleDurationSeconds();

        if (!isInitial) {
            const shift = this._gaussian() * this._profile.frontShiftDegrees;

            this._windDirectionTarget = normalizeDirection(this._windDirection + shift);
        }

        // some wind regimes are reported as varying between two directions
        const isLightAndVariable = sampled.windMean >= 3 && sampled.windMean <= 10 && this._random() < 0.3;

        this._variableRange = isLightAndVariable ? Math.round(lerp(30, 55, this._random())) : null;

        if (regime === WEATHER_REGIME.SNOW) {
            this._temperature = Math.min(this._temperature, 0);
        }

        if (isInitial) {
            this._from = this._to;
            this._windMean = this._windMean || sampled.windMean;
        }

        this._pending = null;
    }

    _scheduleNext() {
        if (this._regimeEndsAt === Infinity) {
            this._pending = null;

            return;
        }

        this._pending = this._sampleRegime(this._chooseNextRegime(this._regime));
    }

    _step(seconds) {
        this._time += seconds;
        const minutes = seconds / SECONDS_PER_MINUTE;

        if (this._time >= this._regimeEndsAt) {
            this._enterRegime(this._pending ? this._pending.regime : this._chooseNextRegime(this._regime), false);
            this._scheduleNext();
        }

        // blend numeric targets
        if (this._blend < 1) {
            this._blend = Math.min(1, this._blend + (minutes / REGIME_BLEND_MINUTES));
        }

        // mean wind speed eases toward target, turbulence is a correlated random walk around it
        const meanTarget = this._to.windMean;

        this._windMean += (meanTarget - this._windMean) * Math.min(1, minutes / 8);
        this._windNoise = (this._windNoise * 0.85) + (this._gaussian() * Math.max(0.6, this._windMean * 0.06));

        // direction: slew toward the target set by a front, plus a slow random walk
        const remaining = angleDifference(this._windDirection, this._windDirectionTarget);
        const maximumSlew = MAXIMUM_DIRECTION_SLEW_DEGREES_PER_MINUTE * minutes;

        this._windDirection += clamp(remaining, -maximumSlew, maximumSlew);
        this._windDirection += this._gaussian() * this._profile.directionDriftDegreesPerMinute * Math.sqrt(minutes);
        this._windDirection = ((this._windDirection % 360) + 360) % 360;

        if (Math.abs(remaining) < 1) {
            this._windDirectionTarget = this._windDirection;
        }

        // pressure relaxes toward the regime's target, with noise
        const relaxation = Math.min(1, minutes / CLIMATE.QNH_RELAXATION_MINUTES);

        this._qnh += (this._to.qnhTarget - this._qnh) * relaxation;
        this._qnh += this._gaussian() * 0.12 * Math.sqrt(minutes);
        this._qnh = clamp(this._qnh, CLIMATE.MIN_QNH_HPA, CLIMATE.MAX_QNH_HPA);

        // temperature: bounded random walk around the climatological value
        const temperatureTarget = this._regime === WEATHER_REGIME.SNOW ? Math.min(this._baseTemperature, -1) : this._baseTemperature;

        this._temperature += (temperatureTarget - this._temperature) * Math.min(1, minutes / 120);
        this._temperature += this._gaussian() * 0.05 * Math.sqrt(minutes);
        this._temperature = clamp(this._temperature, this._baseTemperature - 8, this._baseTemperature + 8);
    }

    _blendCloud(blend) {
        const useTo = blend >= 0.5;
        const layers = useTo ? this._to.cloud : this._from.cloud;
        const other = useTo ? this._from.cloud : this._to.cloud;

        return layers.map((layer, index) => {
            const counterpart = other[index];
            const progress = useTo ? (1 - ((blend - 0.5) * 2)) : (blend * 2);

            // bases drift toward the neighbouring regime's layer while the blend is in progress
            const baseFt = counterpart ?
                Math.round(lerp(layer.baseFt, counterpart.baseFt, progress * 0.5) / 100) * 100 :
                layer.baseFt;

            return { cover: layer.cover, baseFt, type: layer.type };
        });
    }
}
