import {
    FUEL_POLICY,
    buildDepartureFuel,
    buildInboundFuel,
    buildPassengerLoad,
    formatEnduranceForDisplay,
    formatEnduranceForRadio,
    getBurnRateKgPerSecond,
    getEnduranceMinutes,
    getFuelForEnduranceMinutes,
    getProfile
} from './aircraftProfile';

const KILOGRAMS_PER_POUND = 0.45359237;

/**
 * Fuel states in increasing severity. `exhausted` means the tanks are dry.
 *
 * @property FUEL_STATE
 * @type {object}
 * @final
 */
export const FUEL_STATE = {
    NORMAL: 'normal',
    MINIMUM: 'minimum',
    EMERGENCY: 'emergency',
    EXHAUSTED: 'exhausted'
};

const SEVERITY = [FUEL_STATE.NORMAL, FUEL_STATE.MINIMUM, FUEL_STATE.EMERGENCY, FUEL_STATE.EXHAUSTED];

/**
 * What is on board an aircraft: people and fuel
 *
 * Pure (no DOM, no sim singletons) so the passenger and fuel behaviour can be unit tested directly.
 * `AircraftModel` owns one of these, burns fuel on each update and reacts to the fuel-state changes
 * that `burn()` reports.
 *
 * @class OnboardState
 */
export default class OnboardState {
    /**
     * @constructor
     * @param options {object}
     * @param options.typeDefinition {AircraftTypeDefinitionModel|object}
     * @param options.category {string} `arrival`, `departure` or `overflight`
     * @param options.sectorNauticalMiles {number} planned sector length for departures
     * @param options.fuelProblem {boolean|string} `false`, `'minimum'` or `'emergency'`
     * @param options.random {function}
     */
    constructor({
        typeDefinition,
        category = 'arrival',
        sectorNauticalMiles = 300,
        fuelProblem = false,
        random = Math.random
    }) {
        this._typeDefinition = typeDefinition;
        const load = buildPassengerLoad(typeDefinition, random);

        this.seats = load.seats;
        this.passengers = load.passengers;
        this.flightCrew = load.flightCrew;
        this.cabinCrew = load.cabinCrew;
        this.souls = load.souls;

        this.fuelCapacityKg = getProfile(typeDefinition).fuelCapacityKg;
        this.fuelKg = category === 'departure' ?
            buildDepartureFuel(typeDefinition, sectorNauticalMiles, random) :
            buildInboundFuel(typeDefinition, { fuelProblem, isOverflight: category === 'overflight', random });
        this.initialFuelKg = this.fuelKg;
        this._highestReportedSeverity = SEVERITY.indexOf(this.fuelState);
    }

    /**
     * Minutes of flight remaining at the planned average fuel flow
     *
     * @for OnboardState
     * @property enduranceMinutes
     * @type {number}
     */
    get enduranceMinutes() {
        return getEnduranceMinutes(this._typeDefinition, this.fuelKg);
    }

    /**
     * @for OnboardState
     * @property fuelState
     * @type {string}
     */
    get fuelState() {
        if (this.fuelKg <= 0) {
            return FUEL_STATE.EXHAUSTED;
        }

        const endurance = this.enduranceMinutes;

        if (endurance <= FUEL_POLICY.EMERGENCY_FUEL_MINUTES) {
            return FUEL_STATE.EMERGENCY;
        }

        if (endurance <= FUEL_POLICY.MINIMUM_FUEL_MINUTES) {
            return FUEL_STATE.MINIMUM;
        }

        return FUEL_STATE.NORMAL;
    }

    /**
     * Burn fuel
     *
     * @for OnboardState
     * @method burn
     * @param deltaSeconds {number} simulated seconds
     * @param flightState {object} `{ isOnGround, isMoving, isEngineRunning, trend, altitude }`
     * @return {array<string>} fuel states newly reached (only ever more severe than any reported before)
     */
    burn(deltaSeconds, flightState) {
        if (!(deltaSeconds > 0) || this.fuelKg <= 0) {
            return [];
        }

        this.fuelKg = Math.max(0, this.fuelKg - (getBurnRateKgPerSecond(this._typeDefinition, flightState) * deltaSeconds));

        const severity = SEVERITY.indexOf(this.fuelState);

        if (severity <= this._highestReportedSeverity) {
            return [];
        }

        const reached = SEVERITY.slice(this._highestReportedSeverity + 1, severity + 1);

        this._highestReportedSeverity = severity;

        return reached;
    }

    /**
     * Set fuel so that `minutes` of endurance remain (used by fuel-related events)
     *
     * Lowering fuel below a threshold does not by itself report a state change; the aircraft declares it
     * explicitly. Raising fuel clears states already reported so they can be declared again.
     *
     * @for OnboardState
     * @method setEnduranceMinutes
     * @param minutes {number}
     */
    setEnduranceMinutes(minutes) {
        this.fuelKg = Math.min(getFuelForEnduranceMinutes(this._typeDefinition, minutes), this.fuelCapacityKg);
        this._highestReportedSeverity = SEVERITY.indexOf(FUEL_STATE.NORMAL);
    }

    /**
     * Mark a fuel state as already declared so `burn()` will not announce it again
     *
     * @for OnboardState
     * @method markReported
     * @param state {string}
     */
    markReported(state) {
        this._highestReportedSeverity = Math.max(this._highestReportedSeverity, SEVERITY.indexOf(state));
    }

    /**
     * Fuel quantity in the requested unit
     *
     * @for OnboardState
     * @method getFuelQuantity
     * @param unit {string} `kg` or `lb`
     * @return {number} rounded to the nearest 10
     */
    getFuelQuantity(unit = 'kg') {
        const value = unit === 'lb' ? this.fuelKg / KILOGRAMS_PER_POUND : this.fuelKg;

        return Math.round(value / 10) * 10;
    }

    /**
     * @for OnboardState
     * @method describe
     * @param unit {string}
     * @return {object} human readable fuel and people summary
     */
    describe(unit = 'kg') {
        const endurance = this.enduranceMinutes;

        return {
            souls: this.souls,
            passengers: this.passengers,
            crew: this.flightCrew + this.cabinCrew,
            fuelQuantity: this.getFuelQuantity(unit),
            fuelUnit: unit,
            enduranceMinutes: Math.round(endurance),
            enduranceDisplay: formatEnduranceForDisplay(endurance),
            enduranceSpoken: formatEnduranceForRadio(endurance),
            fuelState: this.fuelState,
            fuelPercent: Math.round((this.fuelKg / this.fuelCapacityKg) * 100)
        };
    }
}
