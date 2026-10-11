/**
 * Passenger load and fuel model for simulated aircraft
 *
 * Gives every aircraft believable "souls on board" and fuel state so pilots can answer questions
 * such as "say fuel remaining" or "say persons on board" with numbers that make sense for the type
 * and the stage of flight, and so a low-fuel emergency actually means something.
 *
 * All figures derive from the per-type `profile` block (typical seats, cruise burn and capacity)
 * in `assets/aircraft/*.json`. They are plausible, not flight-planning grade.
 *
 * Everything in this file is pure (a random source can be injected) for unit testing.
 */

/**
 * Regulatory-style fuel reserve policy, in minutes of flight at normal burn
 *
 * @property FUEL_POLICY
 * @type {object}
 * @final
 */
export const FUEL_POLICY = {
    /** turbine final reserve (EASA / ICAO: 30 min holding at 1,500 ft) */
    FINAL_RESERVE_MINUTES: 30,
    /** piston final reserve (45 min) */
    PISTON_FINAL_RESERVE_MINUTES: 45,
    /** pilots declare "minimum fuel" at or below this endurance */
    MINIMUM_FUEL_MINUTES: 35,
    /** pilots declare "MAYDAY MAYDAY MAYDAY fuel" at or below this endurance */
    EMERGENCY_FUEL_MINUTES: 15
};

/**
 * Average fuel flow over an arrival or whole-flight profile, relative to cruise burn.
 *
 * Endurance figures quoted to ATC use this so that what a pilot says ("we have one hour of fuel") agrees
 * with how the simulation then burns fuel over a typical mixed profile of descent, level flight and approach.
 *
 * @property PLANNED_FLOW_FACTOR
 * @type {number}
 * @final
 */
export const PLANNED_FLOW_FACTOR = 0.85;

const NAUTICAL_MILES_PER_HOUR_FACTOR = 0.9;

const DEFAULT_PROFILE = {
    seats: 150,
    fuelBurnKgPerHour: 2400,
    fuelCapacityKg: 19000
};

/**
 * @function getProfile
 * @param typeDefinition {AircraftTypeDefinitionModel|object}
 * @return {object} `{ seats, fuelBurnKgPerHour, fuelCapacityKg }`
 */
export const getProfile = (typeDefinition) => ({ ...DEFAULT_PROFILE, ...(typeDefinition?.profile ?? {}) });

const randomBetween = (min, max, random) => min + (random() * (max - min));

const isPiston = (typeDefinition) => typeDefinition?.engines?.type === 'P';

/**
 * Number of flight crew for a type
 *
 * @function getFlightCrewCount
 * @param typeDefinition {AircraftTypeDefinitionModel|object}
 * @return {number}
 */
export const getFlightCrewCount = (typeDefinition) => {
    const { seats } = getProfile(typeDefinition);
    const weightClass = typeDefinition?.weightClass;

    if (isPiston(typeDefinition) && seats <= 6) {
        return 1;
    }

    if (seats <= 6) {
        return 1 + (typeDefinition?.engines?.number > 1 ? 1 : 0);
    }

    if ((weightClass === 'H' || weightClass === 'J') && (typeDefinition?.engines?.number ?? 2) > 2) {
        return 3;
    }

    return 2;
};

/**
 * Number of cabin crew for a type (one per 50 seats, as per the EASA rule of thumb)
 *
 * @function getCabinCrewCount
 * @param typeDefinition {AircraftTypeDefinitionModel|object}
 * @return {number}
 */
export const getCabinCrewCount = (typeDefinition) => {
    const { seats } = getProfile(typeDefinition);

    if (seats <= 19) {
        return 0;
    }

    return Math.max(1, Math.ceil(seats / 50));
};

/**
 * Roll a passenger load for a flight
 *
 * @function buildPassengerLoad
 * @param typeDefinition {AircraftTypeDefinitionModel|object}
 * @param random {function} [defaults to Math.random]
 * @return {object} `{ passengers, flightCrew, cabinCrew, souls, seats }`
 */
export const buildPassengerLoad = (typeDefinition, random = Math.random) => {
    const { seats } = getProfile(typeDefinition);
    const flightCrew = getFlightCrewCount(typeDefinition);
    const cabinCrew = getCabinCrewCount(typeDefinition);
    let passengers = 0;

    if (seats > 0) {
        if (seats <= 19) {
            // light aircraft / business jets: few people, rarely full
            passengers = Math.min(seats - flightCrew, Math.round(randomBetween(0, seats - flightCrew + 0.99, random)));
        } else {
            // airline flights: a load factor weighted toward the busy end of the range
            const loadFactor = randomBetween(0.6, 0.98, random) ** 0.7;

            passengers = Math.round(seats * Math.min(loadFactor, 1));
        }
    }

    return {
        seats,
        passengers: Math.max(0, passengers),
        flightCrew,
        cabinCrew,
        souls: Math.max(0, passengers) + flightCrew + cabinCrew
    };
};

/**
 * Fuel flow multiplier relative to the type's cruise burn for the present state of flight
 *
 * @function getFuelFlowFactor
 * @param state {object} `{ isOnGround, isMoving, isEngineRunning, trend, altitude }`
 * @return {number}
 */
export const getFuelFlowFactor = ({
    isOnGround, isMoving = true, isEngineRunning = true, trend = 0, altitude = 0
}) => {
    if (!isEngineRunning) {
        return 0;
    }

    if (isOnGround) {
        return isMoving ? 0.3 : 0.18;
    }

    if (trend > 0) {
        return altitude < 10000 ? 1.8 : 1.4;
    }

    if (trend < 0) {
        return altitude < 10000 ? 0.55 : 0.45;
    }

    return altitude < 10000 ? 0.8 : 1;
};

/**
 * @function getBurnRateKgPerSecond
 * @param typeDefinition {AircraftTypeDefinitionModel|object}
 * @param state {object} see `getFuelFlowFactor`
 * @return {number}
 */
export const getBurnRateKgPerSecond = (typeDefinition, state) => {
    const { fuelBurnKgPerHour } = getProfile(typeDefinition);

    return (fuelBurnKgPerHour * getFuelFlowFactor(state)) / 3600;
};

/**
 * Remaining endurance, in minutes, quoted at the planned average fuel flow
 *
 * @function getEnduranceMinutes
 * @param typeDefinition {AircraftTypeDefinitionModel|object}
 * @param fuelKg {number}
 * @return {number}
 */
export const getEnduranceMinutes = (typeDefinition, fuelKg) => {
    const { fuelBurnKgPerHour } = getProfile(typeDefinition);
    const plannedBurnKgPerMinute = (fuelBurnKgPerHour * PLANNED_FLOW_FACTOR) / 60;

    return Math.max(0, fuelKg / plannedBurnKgPerMinute);
};

/**
 * Fuel, in kilograms, that gives the requested endurance
 *
 * @function getFuelForEnduranceMinutes
 * @param typeDefinition {AircraftTypeDefinitionModel|object}
 * @param minutes {number}
 * @return {number}
 */
export const getFuelForEnduranceMinutes = (typeDefinition, minutes) => {
    const { fuelBurnKgPerHour } = getProfile(typeDefinition);

    return minutes * ((fuelBurnKgPerHour * PLANNED_FLOW_FACTOR) / 60);
};

/**
 * Bucket an endurance into the fuel states pilots communicate
 *
 * @function getFuelState
 * @param enduranceMinutes {number}
 * @return {string} one of `normal`, `minimum`, `emergency`
 */
export const getFuelState = (enduranceMinutes) => {
    if (enduranceMinutes <= FUEL_POLICY.EMERGENCY_FUEL_MINUTES) {
        return 'emergency';
    }

    if (enduranceMinutes <= FUEL_POLICY.MINIMUM_FUEL_MINUTES) {
        return 'minimum';
    }

    return 'normal';
};

/**
 * Fuel on board for an aircraft that spawns already airborne and inbound (arrival or overflight)
 *
 * Remaining fuel at the airspace boundary is final reserve + alternate + contingency + whatever
 * discretionary fuel the captain decided to carry. A `fuelProblem` flag cuts that down to a
 * minimum-fuel (default) or emergency-fuel level.
 *
 * @function buildInboundFuel
 * @param typeDefinition {AircraftTypeDefinitionModel|object}
 * @param options {object} `{ fuelProblem: false|'minimum'|'emergency', isOverflight: false, random }`
 * @return {number} kilograms
 */
export const buildInboundFuel = (typeDefinition, { fuelProblem = false, isOverflight = false, random = Math.random } = {}) => {
    const { fuelCapacityKg } = getProfile(typeDefinition);
    const reserve = isPiston(typeDefinition) ? FUEL_POLICY.PISTON_FINAL_RESERVE_MINUTES : FUEL_POLICY.FINAL_RESERVE_MINUTES;
    let minutes;

    if (fuelProblem === 'emergency') {
        minutes = randomBetween(8, FUEL_POLICY.EMERGENCY_FUEL_MINUTES, random);
    } else if (fuelProblem) {
        minutes = randomBetween(FUEL_POLICY.EMERGENCY_FUEL_MINUTES + 7, FUEL_POLICY.MINIMUM_FUEL_MINUTES - 2, random);
    } else {
        const alternate = randomBetween(20, 55, random);
        const contingency = randomBetween(3, 10, random);
        const discretionary = randomBetween(0, 40, random);
        const enRoute = isOverflight ? randomBetween(30, 150, random) : 0;

        minutes = reserve + alternate + contingency + discretionary + enRoute;
    }

    return Math.min(getFuelForEnduranceMinutes(typeDefinition, minutes), fuelCapacityKg * 0.95);
};

/**
 * Fuel on board for a departure at the gate, planned for a given sector length
 *
 * @function buildDepartureFuel
 * @param typeDefinition {AircraftTypeDefinitionModel|object}
 * @param sectorNauticalMiles {number} planned sector length (use a default when the destination is unknown)
 * @param random {function}
 * @return {number} kilograms
 */
export const buildDepartureFuel = (typeDefinition, sectorNauticalMiles = 300, random = Math.random) => {
    const { fuelBurnKgPerHour, fuelCapacityKg } = getProfile(typeDefinition);
    const cruiseSpeed = typeDefinition?.speed?.cruise ?? 450;
    const tripHours = sectorNauticalMiles / (cruiseSpeed * NAUTICAL_MILES_PER_HOUR_FACTOR);
    const tripFuel = fuelBurnKgPerHour * (tripHours + 0.25) * PLANNED_FLOW_FACTOR;
    const taxiFuel = fuelBurnKgPerHour * 0.3 * (randomBetween(8, 18, random) / 60);
    const contingency = tripFuel * 0.05;
    const reserve = isPiston(typeDefinition) ? FUEL_POLICY.PISTON_FINAL_RESERVE_MINUTES : FUEL_POLICY.FINAL_RESERVE_MINUTES;
    const alternate = getFuelForEnduranceMinutes(typeDefinition, randomBetween(20, 50, random));
    const finalReserve = getFuelForEnduranceMinutes(typeDefinition, reserve);
    const discretionary = getFuelForEnduranceMinutes(typeDefinition, randomBetween(0, 20, random));

    return Math.min(tripFuel + taxiFuel + contingency + alternate + finalReserve + discretionary, fuelCapacityKg);
};

/**
 * Speak an endurance the way a pilot reports it ("one hour twenty", "forty five minutes")
 *
 * @function formatEnduranceForRadio
 * @param enduranceMinutes {number}
 * @return {string}
 */
export const formatEnduranceForRadio = (enduranceMinutes) => {
    const total = Math.max(0, Math.round(enduranceMinutes / 5) * 5);
    const hours = Math.floor(total / 60);
    const minutes = total % 60;

    if (hours === 0) {
        return `${minutes} minutes`;
    }

    const hourWord = hours === 1 ? 'hour' : 'hours';

    if (minutes === 0) {
        return `${hours} ${hourWord}`;
    }

    return `${hours} ${hourWord} ${minutes} minutes`;
};

/**
 * Compact form for display ("1h20")
 *
 * @function formatEnduranceForDisplay
 * @param enduranceMinutes {number}
 * @return {string}
 */
export const formatEnduranceForDisplay = (enduranceMinutes) => {
    const total = Math.max(0, Math.round(enduranceMinutes));
    const hours = Math.floor(total / 60);
    const minutes = total % 60;

    return `${hours}h${String(minutes).padStart(2, '0')}`;
};
