import ava from 'ava';
import { closestWord, repairTranscript, scoreTranscript } from '../../src/assets/scripts/client/radio/transcriptRepair';
import { interpretLocally } from '../../src/assets/scripts/client/radio/localInterpreter';

const BAW = {
    callsign: 'BAW123', airlineId: 'baw', airlineCallsign: 'Speedbird', flightNumber: '123', altitude: 9000
};
const RYR = {
    callsign: 'RYR78B', airlineId: 'ryr', airlineCallsign: 'Ryanair', flightNumber: '78B', altitude: 4000
};
const CONTEXT = { aircraft: [BAW, RYR], fixes: ['BODKE', 'WBA', 'TNL'], runways: ['09', '27'] };

ava('common mishearings of phraseology are repaired', (t) => {
    t.is(repairTranscript('the center flight level zero five zero'), 'descend flight level zero five zero');
    t.is(repairTranscript('turn left heating two seven zero'), 'turn left heading two seven zero');
    t.is(repairTranscript('descend flight love one zero zero'), 'descend flight level one zero zero');
    t.is(repairTranscript('cleared ills runway two seven'), 'cleared ils runway two seven');
    t.is(repairTranscript('squark four five two one'), 'squawk four five two one');
    t.is(repairTranscript('cleared for take off'), 'cleared for takeoff');
});

ava('"for" and "won" are numbers only inside numbers', (t) => {
    t.is(repairTranscript('heading two seven for'), 'heading two seven four');
    t.is(repairTranscript('cleared for takeoff'), 'cleared for takeoff');
    t.is(repairTranscript('squawk won two zero zero'), 'squawk one two zero zero');
});

ava('telephony of aircraft that exist is matched by closeness', (t) => {
    const context = { telephonyWords: ['speedbird', 'ryanair'] };

    t.is(repairTranscript('speed bird one two three', context), 'speedbird one two three');
    t.is(repairTranscript('ryan air seven eight bravo', context), 'ryanair seven eight bravo');
    t.is(repairTranscript('speedbert one two three', context), 'speedbird one two three');
});

ava('fix names are corrected after direct, hold and to', (t) => {
    const context = { fixNames: ['BODKE', 'WBA'] };

    t.is(repairTranscript('proceed direct to bodkey', context), 'proceed direct to bodke');
});

ava('unrelated words are left alone', (t) => {
    t.is(repairTranscript('thank you very much', {}), 'thank you very much');
    t.is(closestWord('zebra', ['climb', 'descend']), null);
    t.is(closestWord('decend', ['descend', 'climb']), 'descend');
});

ava('the interpreter understands a garbled transmission', (t) => {
    const result = interpretLocally('speed bird one two three the center flight level zero five zero', CONTEXT);

    t.deepEqual(result.transmissions.map((entry) => [entry.callsign, entry.commands]), [['BAW123', ['d 50']]]);
    t.is(result.repairedText, 'speedbird one two three descend flight level zero five zero');
});

ava('flight levels in every spoken shape give the same altitude', (t) => {
    ['descend flight level zero five zero', 'descend FL050', 'descend FL 050', 'descend flight level fifty', 'descend five thousand feet'].forEach((phrase) => {
        const result = interpretLocally(`speedbird one two three ${phrase}`, CONTEXT);

        t.deepEqual(result.transmissions[0].commands, ['d 50'], phrase);
    });
});

ava('application commands are not sent to an aircraft', (t) => {
    const result = interpretLocally('open the ATIS', { ...CONTEXT, selectedCallsign: 'BAW123' });

    t.deepEqual(result.transmissions, []);
    t.deepEqual(result.appActions, [{ action: 'open', target: 'atis', value: '' }]);
});

ava('a question about "you" goes to the selected pilot, not the application', (t) => {
    const result = interpretLocally('which information do you have', { ...CONTEXT, selectedCallsign: 'BAW123' });

    t.deepEqual(result.transmissions[0].commands, ['sinfo']);
    t.deepEqual(result.appActions, []);
});

ava('alternatives that read like ATC phraseology score higher', (t) => {
    const context = { telephonyWords: ['speedbird'], fixNames: [] };
    const good = scoreTranscript('speedbird one two three descend flight level one zero zero', context);
    const bad = scoreTranscript('speed word won to tree the sent fright lover won zero zero', context);
    const chatter = scoreTranscript('what a lovely day for a picnic', context);

    t.true(good > bad);
    t.true(good > chatter);
});

ava('shorthand alternatives beat look-alike chatter: "d 20" over "the 20"', (t) => {
    const context = { telephonyWords: ['speedbird'], fixNames: [] };

    t.true(scoreTranscript('speedbird one two three d 20', context) > scoreTranscript('speedbird one two three the 20', context));
    t.true(scoreTranscript('speedbird one two three d20', context) > scoreTranscript('speedbird one two three the twenty', context));
    t.true(scoreTranscript('speedbird one two three dee 20', context) > scoreTranscript('speedbird one two three bee 20', context));
});
