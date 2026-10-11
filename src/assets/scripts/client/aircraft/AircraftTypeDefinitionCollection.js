import _find from 'lodash/find';
import _map from 'lodash/map';
import BaseCollection from '../base/BaseCollection';
import AircraftTypeDefinitionModel from './AircraftTypeDefinitionModel';
import { airlineNameAndFleetHelper } from '../airline/airlineHelpers';
import { MAXIMUM_FLEET_DRAWS, findLeastDemandingType } from './aircraftSuitability';
import { isEmptyOrNotArray } from '../utilities/validatorUtilities';

/**
 * Collection of `AircraftModel` objects
 *
 * Responsible for creating new `AircraftModel` objects when a spawnInterval
 * fires its `createAircraftWithSpawnPatternModel` callback.
 *
 * This collection also keeps a list of `AircraftTypeDefinitionModel` objects, which define each
 * aircraft type.
 *
 * @class AircraftTypeDefinitionCollection
 * @extends BaseCollection
 */
/* istanbul ignore next */
export default class AircraftTypeDefinitionCollection extends BaseCollection {
    /**
     * @constructor
     * @for AircraftTypeDefinitionCollection
     * @param aircraftTypeDefinitionList {array<object>}
     */
    constructor(aircraftTypeDefinitionList) {
        super();

        if (isEmptyOrNotArray(aircraftTypeDefinitionList)) {
            throw new TypeError('Invalid aircraftTypeDefinitionList passed to AircraftTypeDefinitionCollection constructor. ' +
                `Expected a non-empty array, but received ${typeof aircraftTypeDefinitionList}`);
        }

        /**
         * A collection of `AircraftTypeDefinitionModel` objects
         *
         * Not using the inherited `_items` property here for readability
         * and the fact that we need this property to be public.
         *
         * @property definitionList
         * @type {array}
         * @default []
         */
        this.definitionList = [];

        this.init(aircraftTypeDefinitionList);
    }

    /**
     * Lifecycle method. Should be run only once on instantiation.
     *
     * Initializes instance properties.
     *
     * @for AircraftTypeDefinitionCollection
     * @method init
     * @param aircraftTypeDefinitionList {array<object>}
     */
    init(aircraftTypeDefinitionList) {
        this.definitionList = this._buildAircraftTypeDefinitionModelList(aircraftTypeDefinitionList);
    }

    /**
     * @for AircraftTypeDefinitionCollection
     * @method findAircraftTypeDefinitionModelByIcao
     * @param icao {string}
     * @return {AircraftTypeDefinitionModel}
     */
    findAircraftTypeDefinitionModelByIcao(icao) {
        return _find(this.definitionList, { icao: icao.toUpperCase() });
    }

    /**
     * Given an `airlineId`, find a random aircraft type from the airline.
     *
     * Besides named fleets, the fleet part of an `airlineId` (eg. `ezy/a320`) may be an aircraft
     * type designator that the airline does not declare as a fleet; that type is used directly.
     *
     * When an `isSuitable` predicate is supplied, fleet draws that fail it are discarded and re-drawn
     * (up to `MAXIMUM_FLEET_DRAWS` times). If every draw fails, the least demanding type that was
     * drawn is used so that a spawn is never lost to an over-strict filter.
     *
     * @for AircraftTypeDefinitionCollection
     * @method getAircraftDefinitionForAirlineId
     * @param airlineId {string}
     * @param airlineModel {AirlineModel}
     * @param isSuitable {function} [optional] receives an AircraftTypeDefinitionModel, returns a boolean
     * @return aircraftDefinition {AircraftTypeDefinitionModel}
     */
    getAircraftDefinitionForAirlineId(airlineId, airlineModel, isSuitable = null) {
        const { fleet } = airlineNameAndFleetHelper([airlineId]);
        const explicitDefinition = this._findUndeclaredFleetTypeDefinition(fleet, airlineModel);

        if (explicitDefinition) {
            return explicitDefinition;
        }

        const rejectedDefinitions = [];

        for (let i = 0; i < MAXIMUM_FLEET_DRAWS; i++) {
            const aircraftType = airlineModel.getRandomAircraftType(fleet).toUpperCase();
            const aircraftDefinition = this.findAircraftTypeDefinitionModelByIcao(aircraftType);

            if (typeof aircraftDefinition === 'undefined') {
                console.error(`Undefined aircraftDefinition found for ${aircraftType}`);

                continue;
            }

            if (isSuitable === null || isSuitable(aircraftDefinition)) {
                return aircraftDefinition;
            }

            rejectedDefinitions.push(aircraftDefinition);
        }

        const leastDemandingDefinition = findLeastDemandingType(rejectedDefinitions);

        if (leastDemandingDefinition) {
            return leastDemandingDefinition;
        }

        console.error(`Unable to find any known aircraft type for airline "${airlineId}", using A320`);

        return this.findAircraftTypeDefinitionModelByIcao('A320') || this.definitionList[0];
    }

    /**
     * Returns the definition when `fleetName` is not a declared fleet but is a known aircraft type
     *
     * @for AircraftTypeDefinitionCollection
     * @method _findUndeclaredFleetTypeDefinition
     * @param fleetName {string}
     * @param airlineModel {AirlineModel}
     * @return {AircraftTypeDefinitionModel|undefined}
     * @private
     */
    _findUndeclaredFleetTypeDefinition(fleetName, airlineModel) {
        if (!fleetName || fleetName === 'default' || airlineModel.hasFleet(fleetName)) {
            return undefined;
        }

        return this.findAircraftTypeDefinitionModelByIcao(fleetName);
    }

    /**
     * Loop through aircraft defined in the `definitionList` and create an
     * `AircraftTypeDefinitionModel` for each.
     *
     * @for AircraftTypeDefinitionCollection
     * @method _buildAircraftTypeDefinitionModelList
     * @param aircraftTypeDefinitionList {array}
     * @return definitionList {array<AircraftTypeDefinitionModel>}
     * @private
     */
    _buildAircraftTypeDefinitionModelList(aircraftTypeDefinitionList) {
        const definitionList = _map(aircraftTypeDefinitionList, (aircraftDefinition) => {
            // this is not using a direct return simply for readability
            return new AircraftTypeDefinitionModel(aircraftDefinition);
        });

        return definitionList;
    }
}
