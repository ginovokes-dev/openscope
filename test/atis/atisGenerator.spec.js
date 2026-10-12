/* eslint-disable arrow-parens, max-len, import/no-extraneous-dependencies */
import ava from 'ava';
import {
    buildAtis,
    buildCloudPhrases,
    buildTrendPhrases,
    buildVisibilityPhrases,
    buildWindPhrases,
    computeTransitionLevel,
    getInformationLetter,
    getNextInformationLetter,
    getTransitionAltitude,
    isCavok,
    spokenDigits,
    spokenQuantity,
    spokenRunway,
    usesImperialUnits
} from '../../src/assets/scripts/client/atis/atisGenerator';
import {
    buildStandingNotices,
    buildWeatherRemarks,
    createSeededRandom,
    seedFromString
} from '../../src/assets/scripts/client/atis/atisRemarks';

const CLEAR = {
    windDirection: 270,
    windSpeed: 12,
    windGust: null,
    windVariableFrom: null,
    windVariableTo: null,
    visibilityMeters: 9999,
    cloud: [],
    ceilingFeet: null,
    phenomena: [],
    temperatureC: 12,
    dewpointC: 7,
    qnhHpa: 1008
};

const input = (overrides = {}) => ({
    airportName: 'Liverpool',
    icao: 'EGGP',
    letter: 'BRAVO',
    timeUtc: Date.UTC(2026, 9, 11, 12, 50),
    arrivalRunway: '27',
    departureRunway: '27',
    approachType: 'ILS',
    weather: CLEAR,
    contactName: 'Liverpool Approach',
    ...overrides
});

ava('spoken helpers', (t) => {
    t.is(spokenDigits(1008), 'one zero zero eight');
    t.is(spokenDigits(9), 'niner');
    t.is(spokenRunway('27L'), 'two seven left');
    t.is(spokenRunway('09'), 'zero niner');
    t.is(spokenRunway('04C'), 'zero four centre');
    t.is(spokenQuantity(2500), 'two thousand five hundred');
    t.is(spokenQuantity(800), 'eight hundred');
    t.is(spokenQuantity(4000), 'four thousand');
    t.is(spokenQuantity(12000), 'one two thousand');
    t.is(spokenQuantity(0), 'zero');
});

ava('information letters advance and wrap', (t) => {
    t.is(getInformationLetter(0), 'ALPHA');
    t.is(getNextInformationLetter('ALPHA'), 'BRAVO');
    t.is(getNextInformationLetter('ZULU'), 'ALPHA');
    t.is(getInformationLetter(-1), 'ZULU');
});

ava('transition level matches published UK practice at standard pressure', (t) => {
    t.is(computeTransitionLevel(6000, 1013), 70);
    t.is(computeTransitionLevel(5000, 1013), 60);
    t.is(computeTransitionLevel(3000, 1013), 40);
    // low pressure raises the level
    t.true(computeTransitionLevel(6000, 990) > computeTransitionLevel(6000, 1013));
    // high pressure lowers it
    t.true(computeTransitionLevel(6000, 1035) < 70);
    // always a multiple of 5
    for (let qnh = 960; qnh <= 1045; qnh += 3) {
        t.is(computeTransitionLevel(6000, qnh) % 5, 0);
    }
});

ava('transition altitude falls back to regional defaults and honours overrides', (t) => {
    t.is(getTransitionAltitude('EGGP'), 6000);
    t.is(getTransitionAltitude('EIDW'), 5000);
    t.is(getTransitionAltitude('KSEA'), 18000);
    t.is(getTransitionAltitude('XXXX'), 5000);
    t.is(getTransitionAltitude('EGGP', 3000), 3000);
});

ava('unit systems by region', (t) => {
    t.true(usesImperialUnits('KJFK'));
    t.true(usesImperialUnits('CYYZ'));
    t.false(usesImperialUnits('EGLL'));
});

ava('wind phrases cover calm, light, steady, gusting and variable winds', (t) => {
    t.is(buildWindPhrases({ ...CLEAR, windSpeed: 0 }).written, 'WIND CALM');
    t.is(buildWindPhrases({ ...CLEAR, windSpeed: 2 }).written, 'WIND VRB02KT');
    t.is(buildWindPhrases(CLEAR).written, 'WIND 270/12KT');
    t.is(buildWindPhrases(CLEAR).spoken, 'wind two seven zero degrees one two knots');
    t.is(buildWindPhrases({ ...CLEAR, windGust: 24 }).written, 'WIND 270/12KT GUSTING 24KT');
    t.true(buildWindPhrases({ ...CLEAR, windGust: 24 }).spoken.includes('gusting two four knots'));
    t.true(buildWindPhrases({ ...CLEAR, windVariableFrom: 240, windVariableTo: 300 }).written.includes('VRB BTN 240/300'));
    t.is(buildWindPhrases({ ...CLEAR, windDirection: 90, windSpeed: 5 }).written, 'WIND 090/05KT');
});

ava('visibility phrases', (t) => {
    t.is(buildVisibilityPhrases(CLEAR).written, 'VISIBILITY 10KM OR MORE');
    t.is(buildVisibilityPhrases({ ...CLEAR, visibilityMeters: 7000 }).written, 'VISIBILITY 7KM');
    t.is(buildVisibilityPhrases({ ...CLEAR, visibilityMeters: 800 }).spoken, 'visibility eight hundred metres');
    t.is(buildVisibilityPhrases(CLEAR, true).written, 'VISIBILITY 10SM');
    t.is(buildVisibilityPhrases({ ...CLEAR, visibilityMeters: 8000 }, true).written, 'VISIBILITY 5SM');
    t.is(buildVisibilityPhrases({ ...CLEAR, visibilityMeters: 2000 }, true).written, 'VISIBILITY 1.25SM');
});

ava('cloud phrases and CAVOK', (t) => {
    t.true(isCavok(CLEAR));
    t.is(buildCloudPhrases(CLEAR).written, 'CAVOK');
    t.false(isCavok({ ...CLEAR, cloud: [{ cover: 'FEW', baseFt: 2500, type: null }] }));
    t.true(isCavok({ ...CLEAR, cloud: [{ cover: 'FEW', baseFt: 6500, type: null }] }));
    t.false(isCavok({ ...CLEAR, cloud: [{ cover: 'SCT', baseFt: 6500, type: 'CB' }] }));
    t.false(isCavok({ ...CLEAR, visibilityMeters: 8000 }));

    const layered = { ...CLEAR, cloud: [{ cover: 'FEW', baseFt: 2500, type: null }, { cover: 'BKN', baseFt: 4000, type: null }] };

    t.is(buildCloudPhrases(layered).written, 'CLOUD FEW025 BKN040');
    t.is(buildCloudPhrases(layered).spoken, 'cloud few two thousand five hundred feet, broken four thousand feet');
    t.true(buildCloudPhrases({ ...CLEAR, visibilityMeters: 300, cloud: [{ cover: 'VV', baseFt: 100, type: null }] }).spoken.includes('vertical visibility one hundred feet'));
    t.true(buildCloudPhrases({ ...CLEAR, cloud: [{ cover: 'BKN', baseFt: 2000, type: 'CB' }] }).written.includes('BKN020CB'));
});

ava('trend phrases', (t) => {
    t.is(buildTrendPhrases(null).written, 'TREND NOSIG');
    const trend = buildTrendPhrases({
        visibilityMeters: 4000, ceilingFeet: 1200, phenomena: ['RA'], inMinutes: 25
    });

    t.true(trend.written.includes('VIS 4000M'));
    t.true(trend.written.includes('RA'));
    t.true(trend.written.includes('WITHIN 25 MIN'));
    t.true(trend.spoken.includes('rain'));
});

ava('a complete UK ATIS is assembled in ICAO order', (t) => {
    const atis = buildAtis(input());
    const ids = atis.lines.map((line) => line.id);

    t.deepEqual(ids, ['identification', 'runway', 'transition', 'wind', 'cloud', 'temperature', 'pressure', 'trend', 'acknowledge']);
    t.is(atis.letter, 'BRAVO');
    t.is(atis.timeZ, '1250');
    t.true(atis.written.startsWith('LIVERPOOL INFORMATION B 1250Z'));
    t.true(atis.written.includes('RWY IN USE 27 EXPECT ILS APPROACH'));
    // QNH 1008 is below 1013, so FL70 would be under 1000 ft above the 6000 ft transition altitude
    t.true(atis.written.includes('TRANSITION LEVEL 75'));
    t.true(atis.written.includes('CAVOK'));
    t.true(atis.written.includes('TEMP 12 DEW POINT 07'));
    t.true(atis.written.includes('QNH 1008'));
    t.true(atis.written.includes('ACKNOWLEDGE RECEIPT OF INFORMATION B ON FIRST CONTACT WITH LIVERPOOL APPROACH'));
    t.true(atis.spoken.includes('This is Liverpool information bravo, time one two five zero.'));
    t.true(atis.spoken.includes('QNH one zero zero eight.'));
    t.true(atis.spoken.includes('Information bravo out.'));
    t.false(atis.spoken.includes('  '));
});

ava('split runway operations are announced separately', (t) => {
    const atis = buildAtis(input({ arrivalRunway: '27', departureRunway: '09' }));

    t.true(atis.written.includes('ARRIVAL RWY 27'));
    t.true(atis.written.includes('DEPARTURE RWY 09'));
});

ava('arrival-only and departure-only ATIS name their type', (t) => {
    t.true(buildAtis(input({ type: 'arrival' })).written.startsWith('LIVERPOOL ARRIVAL INFORMATION B'));
    t.true(buildAtis(input({ type: 'departure' })).spoken.includes('departure information bravo'));
});

ava('low visibility adds RVR and LVP notices', (t) => {
    const fog = {
        ...CLEAR, visibilityMeters: 400, phenomena: ['FG'], cloud: [{ cover: 'VV', baseFt: 100, type: null }], ceilingFeet: 100, windSpeed: 2
    };
    const atis = buildAtis(input({ weather: fog }));

    t.true(atis.written.includes('RVR RWY 27 450M'));
    t.true(atis.written.includes('LOW VISIBILITY PROCEDURES IN OPERATION'));
    t.true(atis.written.includes('WX FG'));
    t.true(atis.spoken.toLowerCase().includes('fog'));
});

ava('US airports use altimeter setting, statute miles and no transition level', (t) => {
    const atis = buildAtis(input({
        icao: 'KSEA', airportName: 'Seattle', arrivalRunway: '16L', departureRunway: '16L', weather: { ...CLEAR, qnhHpa: 1013 }
    }));

    t.true(atis.written.includes('ALTIMETER 29.91'));
    t.false(atis.written.includes('TRANSITION LEVEL'));
    t.true(atis.spoken.toLowerCase().includes('altimeter two niner niner one'));
});

ava('negative temperatures are spoken as minus', (t) => {
    const atis = buildAtis(input({ weather: { ...CLEAR, temperatureC: -2, dewpointC: -4 } }));

    t.true(atis.written.includes('TEMP M02 DEW POINT M04'));
    t.true(atis.spoken.toLowerCase().includes('temperature minus two, dewpoint minus four'));
});

ava('remarks and user notes are carried into the broadcast', (t) => {
    const atis = buildAtis(input({ remarks: ['Birds reported in the vicinity of the aerodrome', ''] }));

    t.true(atis.written.includes('BIRDS REPORTED IN THE VICINITY OF THE AERODROME'));
    t.true(atis.spoken.toLowerCase().includes('birds reported in the vicinity'));
    t.is(atis.lines.filter((line) => line.id.startsWith('remark')).length, 1);
});

ava('weather remarks follow the weather', (t) => {
    t.deepEqual(buildWeatherRemarks(CLEAR, '27'), []);
    t.deepEqual(buildWeatherRemarks({ ...CLEAR, phenomena: ['RA'] }, '27'), ['Runway 27 wet']);
    t.true(buildWeatherRemarks({ ...CLEAR, phenomena: ['SN'] }, '27')[0].includes('contaminated'));
    t.true(buildWeatherRemarks({ ...CLEAR, windGust: 32 }, '27').some((remark) => remark.includes('Windshear')));
    t.true(buildWeatherRemarks({ ...CLEAR, phenomena: ['TSRA'] }, '27').some((remark) => remark.includes('Thunderstorm')));
});

ava('standing notices are stable for a seed and different between airports', (t) => {
    const a1 = buildStandingNotices(createSeededRandom(seedFromString('EGGP')), 3);
    const a2 = buildStandingNotices(createSeededRandom(seedFromString('EGGP')), 3);
    const b = buildStandingNotices(createSeededRandom(seedFromString('EGPH')), 3);

    t.deepEqual(a1, a2);
    t.is(a1.length, 3);
    t.is(new Set(a1).size, 3);
    t.notDeepEqual(a1, b);
    a1.forEach((notice) => t.true(typeof notice === 'string' && notice.length > 10));
});
