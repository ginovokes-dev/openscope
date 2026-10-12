import ava from 'ava';
import { parseAppActions } from '../../src/assets/scripts/client/radio/appActions';
import { normalizeTranscript } from '../../src/assets/scripts/client/radio/spokenNumbers';

const AIRPORTS = {
    manchester: 'EGCC', liverpool: 'EGGP', heathrow: 'EGLL', 'london heathrow': 'EGLL', egcc: 'EGCC'
};
const context = { resolveAirport: (words) => AIRPORTS[String(words).trim()] || null };
const parse = (text, extra = {}) => parseAppActions(normalizeTranscript(text), { ...context, ...extra });

ava('opens panels by name', (t) => {
    t.deepEqual(parse('open the ATIS'), [{ action: 'open', target: 'atis', value: '' }]);
    t.deepEqual(parse('show me the radio'), [{ action: 'open', target: 'radio', value: '' }]);
    t.deepEqual(parse('bring up the controls guide'), [{ action: 'open', target: 'controls', value: '' }]);
    t.deepEqual(parse('open the procedures list'), [{ action: 'open', target: 'procedures', value: '' }]);
    t.deepEqual(parse('close the radio'), [{ action: 'close', target: 'radio', value: '' }]);
});

ava('"latest information" opens the ATIS', (t) => {
    t.deepEqual(parse('give me the latest ATIS'), [{ action: 'open', target: 'atis', value: '' }]);
    t.deepEqual(parse('what is the current information'), [{ action: 'open', target: 'atis', value: '' }]);
});

ava('updating and reading the ATIS', (t) => {
    // updating also shows the new information letter
    t.deepEqual(parse('update the ATIS'), [
        { action: 'atis_update', target: '', value: '' },
        { action: 'open', target: 'atis', value: '' }
    ]);
    t.deepEqual(parse('issue a new information')[0], { action: 'atis_update', target: '', value: '' });
    t.true(parse('read the ATIS').some((action) => action.action === 'atis_read'));
});

ava('layers are shown and hidden', (t) => {
    t.deepEqual(parse('hide the SIDs'), [{ action: 'layer', target: 'sids', value: 'hide' }]);
    t.deepEqual(parse('show stars'), [{ action: 'layer', target: 'stars', value: 'show' }]);
    t.deepEqual(parse('turn off the airspace'), [{ action: 'layer', target: 'airspace', value: 'hide' }]);
    t.deepEqual(parse('show SIDs and STARs'), [
        { action: 'layer', target: 'sids', value: 'show' },
        { action: 'layer', target: 'stars', value: 'show' }
    ]);
});

ava('switching airports resolves names and codes', (t) => {
    t.deepEqual(parse('switch to Manchester'), [{ action: 'switch_airport', target: '', value: 'EGCC' }]);
    t.deepEqual(parse('take me to Liverpool'), [{ action: 'switch_airport', target: '', value: 'EGGP' }]);
    t.deepEqual(parse('load airport egcc'), [{ action: 'switch_airport', target: '', value: 'EGCC' }]);
    t.deepEqual(parse('go around'), []);
    t.deepEqual(parse('go to Atlantis'), []);
});

ava('zoom', (t) => {
    t.deepEqual(parse('zoom in'), [{ action: 'zoom', target: '', value: 'in' }]);
    t.deepEqual(parse('zoom out a bit'), [{ action: 'zoom', target: '', value: 'out' }]);
    t.deepEqual(parse('reset the view'), [{ action: 'zoom', target: '', value: 'reset' }]);
});

ava('traffic level', (t) => {
    t.deepEqual(parse('make it busier'), [{ action: 'traffic_level', target: '', value: 'more' }]);
    t.deepEqual(parse('set the traffic to quiet'), [{ action: 'traffic_level', target: '', value: 'quiet' }]);
    t.deepEqual(parse('less traffic please'), [{ action: 'traffic_level', target: '', value: 'less' }]);
    t.deepEqual(parse('set traffic to rush hour'), [{ action: 'traffic_level', target: '', value: 'rush' }]);
});

ava('time', (t) => {
    t.deepEqual(parse('pause'), [{ action: 'time', target: '', value: 'pause' }]);
    t.deepEqual(parse('resume the game'), [{ action: 'time', target: '', value: 'resume' }]);
    t.deepEqual(parse('speed up time to five'), [{ action: 'time', target: '', value: '5' }]);
    t.deepEqual(parse('back to normal speed'), [{ action: 'time', target: '', value: 'normal' }]);
});

ava('questions about conditions become info requests', (t) => {
    t.deepEqual(parse('what is the wind'), [{ action: 'info', target: 'wind', value: '' }]);
    t.deepEqual(parse('what is the QNH'), [{ action: 'info', target: 'qnh', value: '' }]);
    t.deepEqual(parse('which runway is in use'), [{ action: 'info', target: 'runway', value: '' }]);
    t.deepEqual(parse('how many aircraft are there'), [{ action: 'info', target: 'traffic', value: '' }]);
    t.deepEqual(parse("what's going on"), [{ action: 'info', target: 'summary', value: '' }]);
});

ava('sentences addressed to an aircraft are not application commands', (t) => {
    t.deepEqual(parse('speedbird one two three say fuel remaining', { hasAircraftMention: true }), []);
    t.deepEqual(parse('speedbird one two three pause', { hasAircraftMention: true }), []);
});
