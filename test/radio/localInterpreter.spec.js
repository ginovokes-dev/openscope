import ava from 'ava';
import { interpretLocally, extractCommands, findMentions } from '../../src/assets/scripts/client/radio/localInterpreter';
import { normalizeTranscript } from '../../src/assets/scripts/client/radio/spokenNumbers';

const BAW = {
    callsign: 'BAW123', airlineId: 'baw', airlineCallsign: 'Speedbird', flightNumber: '123', altitude: 5000
};
const EZY = {
    callsign: 'EZY64A', airlineId: 'ezy', airlineCallsign: 'Easy', flightNumber: '64A', altitude: 12000
};
const GABCD = {
    callsign: 'GABCD', airlineId: 'gabcd', airlineCallsign: '', flightNumber: 'abcd', altitude: 2000
};
const CONTEXT = {
    aircraft: [BAW, EZY],
    fixes: ['LAM', 'BNN', 'MAN', 'TNT'],
    runways: ['09L', '27R', '05', '23']
};

const commandsFor = (text, context = CONTEXT) => interpretLocally(text, context).transmissions.map((t) => t.commands);

ava('addresses an aircraft by telephony callsign and flight number', (t) => {
    const result = interpretLocally('Speedbird one two three turn left heading two seven zero', CONTEXT);

    t.is(result.transmissions.length, 1);
    t.is(result.transmissions[0].callsign, 'BAW123');
    t.deepEqual(result.transmissions[0].commands, ['t l 270']);
});

ava('addresses an aircraft by its written callsign', (t) => {
    t.deepEqual(commandsFor('BAW123 fly heading 090'), [['fh 090']]);
});

ava('flight numbers with letters are matched ("easy six four alpha")', (t) => {
    t.deepEqual(commandsFor('Easy six four alpha descend altitude three thousand feet'), [['d 30']]);
});

ava('findMentions returns aircraft in spoken order', (t) => {
    const mentions = findMentions(normalizeTranscript('easy six four alpha turn right speedbird one two three descend'), [BAW, EZY]);

    t.deepEqual(mentions.map((mention) => mention.aircraft.callsign), ['EZY64A', 'BAW123']);
});

ava('GA callsigns spelled phonetically are found', (t) => {
    const mentions = findMentions(normalizeTranscript('golf alpha bravo charlie delta squawk one two zero zero'), [GABCD]);

    t.is(mentions.length, 1);
});

ava('flight levels and altitudes become hundreds of feet', (t) => {
    t.deepEqual(commandsFor('Speedbird one two three descend flight level one zero zero'), [['d 100']]);
    t.deepEqual(commandsFor('Speedbird one two three climb and maintain one two thousand feet'), [['c 120']]);
    t.deepEqual(commandsFor('Speedbird one two three descend and maintain three thousand five hundred feet'), [['d 35']]);
});

ava('"maintain" picks climb or descend from the aircraft altitude', (t) => {
    t.deepEqual(commandsFor('Speedbird one two three maintain seven thousand feet'), [['c 70']]);
    t.deepEqual(commandsFor('Easy six four alpha maintain seven thousand feet'), [['d 70']]);
});

ava('expedite is added to altitude changes', (t) => {
    t.deepEqual(commandsFor('Speedbird one two three expedite descent descend flight level eight zero'), [['d 80 ex']]);
});

ava('speed instructions become sp commands', (t) => {
    t.deepEqual(commandsFor('Speedbird one two three reduce speed one eight zero'), [['sp 180']]);
    t.deepEqual(commandsFor('Speedbird one two three maintain two five zero knots'), [['sp 250']]);
});

ava('turns: absolute heading, left or right, and incremental degrees', (t) => {
    t.deepEqual(commandsFor('Speedbird one two three turn right heading zero nine zero'), [['t r 090']]);
    t.deepEqual(commandsFor('Speedbird one two three turn left twenty degrees'), [['t l 20']]);
    t.deepEqual(commandsFor('Speedbird one two three fly heading three six zero'), [['fh 360']]);
    t.deepEqual(commandsFor('Speedbird one two three fly present heading'), [['fph']]);
});

ava('multiple instructions in one transmission keep their spoken order', (t) => {
    t.deepEqual(
        commandsFor('Speedbird one two three turn left heading two seven zero descend altitude four thousand feet reduce speed two one zero'),
        [['t l 270', 'd 40', 'sp 210']]
    );
});

ava('ILS clearance resolves the airport runway name, including zero padding and sides', (t) => {
    t.deepEqual(commandsFor('Speedbird one two three cleared ILS runway two seven right'), [['i 27R']]);
    t.deepEqual(commandsFor('Speedbird one two three cleared ILS approach runway niner left'), [['i 09L']]);
    t.deepEqual(commandsFor('Speedbird one two three expect ILS runway zero five'), [['e 05']]);
});

ava('direct and hold only accept fixes that exist at the airport', (t) => {
    t.deepEqual(commandsFor('Speedbird one two three proceed direct Lambourne'), [[]]);
    t.deepEqual(commandsFor('Speedbird one two three proceed direct LAM'), [['pd LAM']]);
    t.deepEqual(commandsFor('Speedbird one two three hold at BNN'), [['hold BNN']]);
    t.deepEqual(commandsFor('Speedbird one two three hold at BNN left'), [['hold BNN l']]);
});

ava('departure ground sequence: clearance, pushback, line up, hold position', (t) => {
    t.deepEqual(commandsFor('Speedbird one two three cleared to Dublin via the Daventry two departure squawk four seven two one'), [['caf', 'sq 4721']]);
    t.deepEqual(commandsFor('Speedbird one two three pushback and start up approved'), [['push']]);
    t.deepEqual(commandsFor('Speedbird one two three line up and wait runway two seven right'), [['lineup']]);
    t.deepEqual(commandsFor('Speedbird one two three hold position'), [['hp']]);
    t.false(commandsFor('Speedbird one two three cleared to land runway two seven right').some((list) => list.includes('caf')));
});

ava('go around, takeoff, taxi, squawk and divert', (t) => {
    t.deepEqual(commandsFor('Speedbird one two three go around'), [['ga']]);
    t.deepEqual(commandsFor('Speedbird one two three runway two seven right cleared for takeoff'), [['cto']]);
    t.deepEqual(commandsFor('Speedbird one two three taxi to holding point runway two seven right'), [['taxi 27R']]);
    t.deepEqual(commandsFor('Speedbird one two three squawk four five two one'), [['sq 4521']]);
    t.deepEqual(commandsFor('Speedbird one two three divert to Manchester EGCC'), [['divert EGCC']]);
});

ava('questions map to the say commands', (t) => {
    t.deepEqual(commandsFor('Speedbird one two three say fuel remaining'), [['sf']]);
    t.deepEqual(commandsFor('Speedbird one two three how much fuel do you have'), [['sf']]);
    t.deepEqual(commandsFor('Speedbird one two three say persons on board'), [['sob']]);
    t.deepEqual(commandsFor('Speedbird one two three say intentions'), [['sint']]);
    t.deepEqual(commandsFor('Speedbird one two three say which information you have'), [['sinfo']]);
});

ava('acknowledgements only count when nothing else was asked', (t) => {
    t.deepEqual(commandsFor('Speedbird one two three roger'), [['roger']]);
    t.deepEqual(commandsFor('Speedbird one two three unable'), [['unable']]);
    t.deepEqual(commandsFor('Speedbird one two three roger descend flight level eight zero'), [['d 80']]);
});

ava('two aircraft in one transmission are split at the second callsign', (t) => {
    const result = interpretLocally('Speedbird one two three descend flight level eight zero easy six four alpha turn right heading one eight zero', CONTEXT);

    t.deepEqual(result.transmissions.map((entry) => [entry.callsign, entry.commands]), [
        ['BAW123', ['d 80']],
        ['EZY64A', ['t r 180']]
    ]);
});

ava('an aircraft named twice (call-up then readback) is addressed once', (t) => {
    const result = interpretLocally('Speedbird one two three descend flight level eight zero speedbird one two three', CONTEXT);

    t.is(result.transmissions.length, 1);
});

ava('falls back to the selected aircraft when none is named', (t) => {
    const result = interpretLocally('go around', { ...CONTEXT, selectedCallsign: 'EZY64A' });

    t.is(result.transmissions[0].callsign, 'EZY64A');
    t.deepEqual(result.transmissions[0].commands, ['ga']);
});

ava('explains itself when no aircraft can be identified', (t) => {
    const result = interpretLocally('descend flight level eight zero', CONTEXT);

    t.is(result.transmissions.length, 0);
    t.true(result.controller_note.length > 0);
});

ava('asks the controller to repeat when nothing in the sentence is understood', (t) => {
    const result = interpretLocally('Speedbird one two three have you seen the football', CONTEXT);

    t.is(result.transmissions[0].intent, 'unclear');
    t.deepEqual(result.transmissions[0].commands, []);
    t.is(result.transmissions[0].reply, 'say again');
});

ava('empty input produces nothing', (t) => {
    t.deepEqual(interpretLocally('   ', CONTEXT).transmissions, []);
});

ava('extractCommands works on a bare segment', (t) => {
    t.deepEqual(extractCommands('cleared as filed', BAW), ['caf']);
    t.deepEqual(extractCommands('climb via sid', BAW), ['cvs']);
    t.deepEqual(extractCommands('descend via star', BAW), ['dvs']);
});
