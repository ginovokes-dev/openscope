import ava from 'ava';
import sinon from 'sinon';
import GameController from '../../src/assets/scripts/client/game/GameController';
import {
    DEFAULT_TRAFFIC_LEVEL,
    TRAFFIC_LEVELS,
    activateTrafficLevels,
    getTrafficLevel
} from '../../src/assets/scripts/client/trafficGenerator/trafficLevel';

ava.serial('before the application switches the levels on, rates are used unchanged', (t) => {
    const level = getTrafficLevel();

    t.is(level.name, 'unscaled');
    t.is(level.multiplier, 1);
    t.is(level.maximumArrivals, Infinity);
    t.is(level.maximumWaitingDepartures, Infinity);
});

ava.serial('levels get busier from quiet to rush hour', (t) => {
    const names = ['quiet', 'medium', 'busy', 'rush'];

    names.slice(1).forEach((name, index) => {
        const previous = TRAFFIC_LEVELS[names[index]];
        const current = TRAFFIC_LEVELS[name];

        t.true(current.multiplier > previous.multiplier);
        t.true(current.maximumArrivals > previous.maximumArrivals);
        t.true(current.minimumArrivalGapSeconds < previous.minimumArrivalGapSeconds);
        t.true(current.maximumWaitingDepartures > previous.maximumWaitingDepartures);
    });
    t.is(DEFAULT_TRAFFIC_LEVEL, 'medium');
});

ava.serial('once active, the level follows the setting and falls back to the default for an unknown value', (t) => {
    activateTrafficLevels();
    sinon.stub(GameController, 'game').value({});

    const option = sinon.stub(GameController, 'getGameOption');

    option.returns('busy');
    t.is(getTrafficLevel().name, 'busy');
    t.is(getTrafficLevel().maximumArrivals, TRAFFIC_LEVELS.busy.maximumArrivals);

    option.returns('chaos-monkey');
    t.is(getTrafficLevel().multiplier, TRAFFIC_LEVELS[DEFAULT_TRAFFIC_LEVEL].multiplier);

    option.throws(new Error('no options yet'));
    t.is(getTrafficLevel().name, 'unscaled');
    sinon.restore();
});
