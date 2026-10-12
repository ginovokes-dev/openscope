import ava from 'ava';
import { parseTaxiwayRefs } from '../../src/assets/scripts/client/radio/taxiwayRefs';

ava('spoken taxiway names become references', (t) => {
    t.deepEqual(parseTaxiwayRefs('alpha bravo'), ['A', 'B']);
    t.deepEqual(parseTaxiwayRefs('alpha one then zulu'), ['A1', 'Z']);
    t.deepEqual(parseTaxiwayRefs('golf, hotel five and kilo'), ['G', 'H5', 'K']);
    t.deepEqual(parseTaxiwayRefs('a1 b2'), ['A1', 'B2']);
});

ava('it stops at the first word that is not a taxiway', (t) => {
    t.deepEqual(parseTaxiwayRefs('alpha bravo hold short of the runway'), ['A', 'B']);
    t.deepEqual(parseTaxiwayRefs(''), []);
    t.deepEqual(parseTaxiwayRefs('the runway'), []);
});
