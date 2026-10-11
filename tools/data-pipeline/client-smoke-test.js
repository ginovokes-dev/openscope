#!/usr/bin/env node
'use strict';
/**
 * Headless smoke test: pushes airport files through the REAL openScope client classes
 * (AirportModel, RunwayCollection, MapCollection, AirspaceModel, NavigationLibrary, SpawnPatternModel,
 * Fms, AircraftModel ...) using the repository's own Babel setup. Complements `check.js`, which is a
 * standalone structural validator; this script proves the files really load in the client code.
 *
 *   npm install                      (once; installs the dev dependencies incl. @babel/register, browser-env)
 *   node tools/data-pipeline/client-smoke-test.js [options]
 *
 * Options
 *   --airports eggp,egph   test only these airports (default: every generated airport in the load list)
 *   --all                  include hand-authored airports that are not disabled
 *   --sim                  additionally fly aircraft: for up to --max-patterns spawn patterns per direction
 *                          an arrival is spawned and flown for 40 minutes (must enter the airspace and reach
 *                          the airport fix) and a departure is cleared for take-off and flown until it leaves
 *                          the airspace on its SID gate (must climb to the initial altitude)
 *   --max-patterns N       patterns per direction and airport for --sim (default 2)
 *   --sample N             test only N airports spread evenly over the selection
 *
 * What counts as a failure: any exception, or any console.error / console.warn emitted by the client
 * while loading (the tool prints a de-duplicated list). The browser UI (DOM, speech) is stubbed.
 */

const fs = require('fs');
const path = require('path');
const { parseArgs, getNumber } = require('./lib/args');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLIENT = path.join(REPO_ROOT, 'src', 'assets', 'scripts', 'client');
const AIRPORTS_DIR = path.join(REPO_ROOT, 'assets', 'airports');

function setupClientEnvironment() {
    try {
        require.resolve('@babel/register', { paths: [REPO_ROOT] });
    } catch (error) {
        console.error('ERROR: @babel/register not found. Run `npm install` in the repository root first.');
        process.exit(2);
    }

    require(require.resolve('@babel/register', { paths: [REPO_ROOT] }))({
        only: [(file) => file.startsWith(`${path.join(REPO_ROOT, 'src')}${path.sep}`)],
        cache: false
    });

    require(require.resolve('browser-env', { paths: [REPO_ROOT] }))(['window']);

    global.window.gtag = () => {};
    global.gtag = () => {};
    global.localStorage = {};
    global.localStorage.getItem = (name) => global.localStorage[name];
    global.localStorage.setItem = (name, value) => {
        global.localStorage[name] = value;
    };
    global.zlsa = { atc: { loadAsset: () => ({ done: () => ({ fail: () => {} }) }) } };
    global.prop = { canvas: { draw_labels: true, dirty: true } };
}

const loadDefault = (p) => require(path.join(CLIENT, p)).default;

function main() {
    const args = parseArgs(process.argv.slice(2));

    setupClientEnvironment();

    const captured = [];

    // Babel itself may print "Browserslist: caniuse-lite is outdated" on first use; that is not client output
    const capture = (level) => (...a) => {
        const text = a.map(String).join(' ');

        if (!/browserslist|caniuse-lite/i.test(text)) {
            captured.push(`${level}: ${text}`);
        }
    };

    console.error = capture('error');
    console.warn = capture('warn');

    const out = (s) => process.stdout.write(`${s}\n`);
    const AirportController = loadDefault('airport/AirportController');
    const NavigationLibrary = loadDefault('navigationLibrary/NavigationLibrary');
    const SpawnPatternCollection = loadDefault('trafficGenerator/SpawnPatternCollection');
    const Fms = loadDefault('aircraft/FlightManagementSystem/Fms');
    const AircraftModel = loadDefault('aircraft/AircraftModel');
    const AircraftTypeDefinitionCollection = loadDefault('aircraft/AircraftTypeDefinitionCollection');
    const TimeKeeper = loadDefault('engine/TimeKeeper');
    const UiController = loadDefault('ui/UiController');
    const { convertStaticPositionToDynamic } = require(path.join(CLIENT, 'base/staticPositionToDynamicPositionHelper'));
    const { FLIGHT_PHASE } = require(path.join(CLIENT, 'constants/aircraftConstants'));

    // headless: no DOM, no speech
    UiController.ui_log = () => {};
    AircraftModel.prototype.callUp = function callUp() {};
    AircraftModel.prototype.radioCall = function radioCall() {};

    const loadList = JSON.parse(fs.readFileSync(path.join(AIRPORTS_DIR, 'airportLoadList.json'), 'utf8'));
    const aircraftDir = path.join(REPO_ROOT, 'assets', 'aircraft');
    const aircraftCollection = new AircraftTypeDefinitionCollection(
        fs.readdirSync(aircraftDir).filter((f) => f !== 'aircraft.json').map((f) => JSON.parse(fs.readFileSync(path.join(aircraftDir, f), 'utf8')))
    );
    let targets;

    if (args.airports && args.airports !== true) {
        targets = String(args.airports).toLowerCase().split(',');
    } else {
        targets = loadList.filter((e) => !e.disabled && (args.all || e.generated === true)).map((e) => e.icao);
    }

    const sample = getNumber(args, 'sample', 0);

    if (sample > 0 && sample < targets.length) {
        targets = Array.from({ length: sample }, (unused, i) => targets[Math.floor((i * targets.length) / sample)]);
    }

    const maxPatterns = getNumber(args, 'max-patterns', 2);
    const sim = Boolean(args.sim);
    const results = { airports: 0, failed: 0, patterns: 0, arrivalsFlown: 0, departuresFlown: 0 };
    const failures = [];
    const consoleOutput = new Map();

    const tick = () => {
        TimeKeeper._isPaused = false; // eslint-disable-line no-underscore-dangle
        TimeKeeper._frameDeltaTime = 0.5; // eslint-disable-line no-underscore-dangle
        TimeKeeper._accumulatedDeltaTime += 0.5; // eslint-disable-line no-underscore-dangle
    };
    const flush = (icao) => {
        for (const line of captured.splice(0, captured.length)) {
            const key = line.slice(0, 160);

            consoleOutput.set(key, (consoleOutput.get(key) || []).concat(icao));
        }
    };
    const typeFor = (model) => {
        const spec = model.airlines[0].name;
        const typeName = spec.includes('/') ? spec.split('/')[1].toUpperCase() : 'A320';

        return aircraftCollection.findAircraftTypeDefinitionModelByIcao(typeName) || aircraftCollection.findAircraftTypeDefinitionModelByIcao('A320');
    };
    const firstDistinct = (models, category) => {
        const seen = new Set();

        return models.filter((m) => m.category === category && !seen.has(m.routeString) && seen.add(m.routeString)).slice(0, maxPatterns);
    };

    for (const icao of targets) {
        let json;

        try {
            json = JSON.parse(fs.readFileSync(path.join(AIRPORTS_DIR, `${icao}.json`), 'utf8'));
        } catch (error) {
            failures.push(`${icao}: cannot read/parse (${error.message})`);
            results.failed += 1;
            continue;
        }

        try {
            AirportController.reset();
            NavigationLibrary.reset();
            SpawnPatternCollection.reset();
            TimeKeeper._accumulatedDeltaTime = 0; // eslint-disable-line no-underscore-dangle
            AirportController.init(icao, json, loadList.filter((e) => e.icao === icao));

            const airport = AirportController.airport_get();

            if (!airport || !airport.loaded) {
                throw new Error('airport did not finish loading');
            }

            NavigationLibrary.init(json);
            SpawnPatternCollection.init(json);

            const models = SpawnPatternCollection.spawnPatternModels;

            for (const model of models) {
                results.patterns += 1;

                const pre = model.isDeparture() ? null : model.preSpawnAircraftList[0];

                new Fms({ // eslint-disable-line no-new
                    altitude: model.isDeparture() ? '' : model.altitude,
                    category: model.category,
                    destination: model.destination,
                    model: typeFor(model),
                    nextFix: pre ? pre.nextFix : null,
                    origin: model.origin,
                    routeString: model.routeString
                });
            }

            // switching the active departure runway must keep every departure route valid
            for (const model of SpawnPatternCollection.departureModels) {
                for (const pair of airport.runways) {
                    pair.forEach((runway) => model._routeModel.updateSidLegForDepartureRunwayModel(runway)); // eslint-disable-line no-underscore-dangle
                }
            }

            if (sim) {
                for (const model of firstDistinct(models, 'arrival')) {
                    const pre = model.preSpawnAircraftList[0] || {};
                    const typeDef = typeFor(model);
                    const aircraft = new AircraftModel(Object.assign({
                        transponderCode: 1234, callsign: '123', destination: model.destination, origin: model.origin, fleet: 'default',
                        airline: model.airlines[0].name.split('/')[0], airlineCallsign: 'test', altitude: model.altitude, speed: model.speed,
                        heading: model.heading, category: 'arrival', icao: typeDef.icao, model: typeDef,
                        positionModel: convertStaticPositionToDynamic(model.positionModel), routeString: model.routeString, waypoints: []
                    }, pre.positionModel ? { positionModel: pre.positionModel, heading: pre.heading, altitude: pre.altitude, nextFix: pre.nextFix } : {}));
                    let controllable = false;
                    let minDistanceKm = Infinity;

                    for (let t = 0; t < 4800; t++) {
                        tick();
                        aircraft.update();
                        controllable = controllable || aircraft.isControllable;
                        minDistanceKm = Math.min(minDistanceKm, aircraft.distance);
                    }

                    results.arrivalsFlown += 1;

                    if (!controllable || minDistanceKm >= 8) {
                        failures.push(`${icao} arrival ${model.routeString}: controllable=${controllable}, closest approach ${minDistanceKm.toFixed(1)} km`);
                    }
                }

                for (const model of firstDistinct(models, 'departure')) {
                    const typeDef = typeFor(model);
                    const aircraft = new AircraftModel({
                        transponderCode: 1234, callsign: '456', destination: model.destination, origin: model.origin, fleet: 'default',
                        airline: model.airlines[0].name.split('/')[0], airlineCallsign: 'test', altitude: 0, speed: 0, heading: 0,
                        category: 'departure', icao: typeDef.icao, model: typeDef,
                        positionModel: convertStaticPositionToDynamic(model.positionModel), routeString: model.routeString, waypoints: []
                    });

                    aircraft.pilot.clearedAsFiled();
                    aircraft.moveToRunway(aircraft.fms.departureRunwayModel);
                    aircraft.fms.departureRunwayModel.addAircraftToQueue(aircraft.id);
                    aircraft.setFlightPhase(FLIGHT_PHASE.WAITING);
                    aircraft.shouldTakeOffWhenRunwayIsClear = true;

                    let maxAltitude = -Infinity;
                    let left = false;

                    for (let t = 0; t < 3600 && !left; t++) {
                        tick();
                        aircraft.update();
                        maxAltitude = Math.max(maxAltitude, aircraft.altitude);
                        left = aircraft.isRemovable;
                    }

                    results.departuresFlown += 1;

                    if (!left || maxAltitude < json.initial_alt - 500) {
                        failures.push(`${icao} departure ${model.routeString}: left airspace=${left}, max altitude ${Math.round(maxAltitude)} ft`);
                    }
                }
            }

            flush(icao);
            results.airports += 1;
        } catch (error) {
            flush(icao);
            failures.push(`${icao}: ${error.stack.split('\n').slice(0, 3).join(' <- ')}`);
            results.failed += 1;
        }
    }

    out(JSON.stringify(results));

    if (consoleOutput.size) {
        out(`console.error/warn output by the client (${consoleOutput.size} distinct):`);

        for (const [line, list] of Array.from(consoleOutput.entries()).slice(0, 20)) {
            out(`  [${list.length}x] ${line} (e.g. ${list.slice(0, 3).join(', ')})`);
        }
    }

    failures.slice(0, 50).forEach((f) => out(`FAIL ${f}`));
    out(failures.length === 0 && consoleOutput.size === 0 ? 'OK: no failures, no console output' : `${failures.length} failures`);

    process.exit(failures.length === 0 && consoleOutput.size === 0 ? 0 : 1);
}

main();
