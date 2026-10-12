/* eslint-disable arrow-parens, max-len, import/no-extraneous-dependencies */
import ava from 'ava';
import { digitsToWords, normalizeTranscript } from '../../src/assets/scripts/client/radio/spokenNumbers';

const cases = [
    ['Speedbird one two three', 'speedbird 123'],
    ['speed bird wun two tree', 'speed bird 123'],
    ['Easy six four alpha, turn left heading two seven zero', 'easy 64a turn left heading 270'],
    ['descend flight level one zero zero', 'descend flight level 100'],
    ['descend altitude three thousand feet', 'descend altitude 3000 feet'],
    ['climb two thousand five hundred feet', 'climb 2500 feet'],
    ['maintain one two thousand', 'maintain 12000'],
    ['maintain fifteen hundred', 'maintain 1500'],
    ['reduce speed one eight zero knots', 'reduce speed 180 knots'],
    ['runway zero niner left', 'runway 09 left'],
    ['runway two seven', 'runway 27'],
    ['squawk four five two one', 'squawk 4521'],
    ['heading tree fife zero', 'heading 350'],
    ['speed one niner zero', 'speed 190'],
    ['turn right twenty degrees', 'turn right 20 degrees'],
    ['twenty five', '25'],
    ['ryanair seven eight bravo', 'ryanair 78b'],
    ['cleared to land runway two seven', 'cleared to land runway 27'],
    ['one hundred', '100'],
    ['QNH one zero zero eight', 'qnh 1008'],
    ['descend to three thousand', 'descend to 3000'],
    ['November one one seven kilo sierra', 'november 117ks'],
    ['golf alpha bravo charlie delta turn left', 'gabcd turn left'],
    ['hotel mike', 'hotel mike']
];

cases.forEach(([input, expected]) => {
    ava(`normalizeTranscript("${input}")`, (t) => {
        t.is(normalizeTranscript(input), expected);
    });
});

ava('"to" between numbers is the digit two, elsewhere it is left alone', (t) => {
    t.is(normalizeTranscript('heading one to zero'), 'heading 120');
    t.is(normalizeTranscript('direct to DET'), 'direct to det');
    t.is(normalizeTranscript('cleared to take off'), 'cleared to take off');
});

ava('digits that are already numeric pass through; empty input is safe', (t) => {
    t.is(normalizeTranscript('BAW123 turn left 270'), 'baw123 turn left 270');
    t.is(normalizeTranscript(''), '');
    t.is(normalizeTranscript(undefined), '');
});

ava('digitsToWords()', (t) => {
    t.is(digitsToWords('270'), 'two seven zero');
    t.is(digitsToWords('09L'), 'zero niner L');
});
