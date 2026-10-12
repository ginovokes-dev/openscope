import ava from 'ava';
import sinon from 'sinon';
import AirportController from '../../src/assets/scripts/client/airport/AirportController';
import NavigationLibrary from '../../src/assets/scripts/client/navigationLibrary/NavigationLibrary';
import { adaptRouteToActiveRunway, areAllRoutesRunwayIndependent } from '../../src/assets/scripts/client/aircraft/routeRunway';

const airport = (arrival, departure) => ({
    icao: 'eggp',
    arrivalRunwayModel: { name: arrival },
    departureRunwayModel: { name: departure }
});

const procedure = (entries, exits) => ({
    hasEntry: (name) => entries.includes(name),
    hasExit: (name) => exits.includes(name)
});

ava.afterEach(() => sinon.restore());

ava.serial('an arrival route is moved to the runway in use when the STAR is published for it', (t) => {
    sinon.stub(AirportController, 'airport_get').returns(airport('09', '09'));
    sinon.stub(NavigationLibrary, 'hasProcedure').returns(true);
    sinon.stub(NavigationLibrary, 'getProcedure').returns(procedure([], ['EGGP09', 'EGGP27']));

    t.is(adaptRouteToActiveRunway('WBA.WBA2I.EGGP27', 'arrival'), 'WBA.WBA2I.EGGP09');
});

ava.serial('a departure route is moved to the runway in use when the SID is published for it', (t) => {
    sinon.stub(AirportController, 'airport_get').returns(airport('09', '09'));
    sinon.stub(NavigationLibrary, 'hasProcedure').returns(true);
    sinon.stub(NavigationLibrary, 'getProcedure').returns(procedure(['EGGP09', 'EGGP27'], []));

    t.is(adaptRouteToActiveRunway('EGGP27.WBA3D.WBA', 'departure'), 'EGGP09.WBA3D.WBA');
});

ava.serial('the route is left alone when the runway matches, is not published, or is not this airport\'s', (t) => {
    sinon.stub(AirportController, 'airport_get').returns(airport('27', '27'));
    sinon.stub(NavigationLibrary, 'hasProcedure').returns(true);
    sinon.stub(NavigationLibrary, 'getProcedure').returns(procedure([], ['EGGP27']));

    t.is(adaptRouteToActiveRunway('WBA.WBA2I.EGGP27', 'arrival'), 'WBA.WBA2I.EGGP27');

    AirportController.airport_get.returns(airport('09', '09'));
    t.is(adaptRouteToActiveRunway('WBA.WBA2I.EGGP27', 'arrival'), 'WBA.WBA2I.EGGP27');
    t.is(adaptRouteToActiveRunway('WBA.WBA2I.EGCC27', 'arrival'), 'WBA.WBA2I.EGCC27');
    t.is(adaptRouteToActiveRunway('WBA..DET', 'arrival'), 'WBA..DET');
    t.is(adaptRouteToActiveRunway('WBA.WBA2I.EGGP27', 'overflight'), 'WBA.WBA2I.EGGP27');
});

ava.serial('the route is left alone when the procedure is unknown', (t) => {
    sinon.stub(AirportController, 'airport_get').returns(airport('09', '09'));
    sinon.stub(NavigationLibrary, 'hasProcedure').returns(false);

    t.is(adaptRouteToActiveRunway('WBA.WBA2I.EGGP27', 'arrival'), 'WBA.WBA2I.EGGP27');
});

ava.serial('routes that are not tied to a runway can always change runway; tied ones need the procedure for every runway', (t) => {
    sinon.stub(AirportController, 'airport_get').returns(airport('09', '09'));
    sinon.stub(NavigationLibrary, 'hasProcedure').returns(true);

    const getProcedure = sinon.stub(NavigationLibrary, 'getProcedure');

    t.true(areAllRoutesRunwayIndependent(['WBA..DET', 'TNT..LAM'], ['09', '27']));

    getProcedure.returns(procedure([], ['EGGP09', 'EGGP27']));
    t.true(areAllRoutesRunwayIndependent(['WBA.WBA2I.EGGP27'], ['09', '27']));

    getProcedure.returns(procedure([], ['EGGP27']));
    t.false(areAllRoutesRunwayIndependent(['WBA.WBA2I.EGGP27'], ['09', '27']));
});
