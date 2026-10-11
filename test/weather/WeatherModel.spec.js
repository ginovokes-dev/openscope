/* eslint-disable arrow-parens, max-len, import/no-extraneous-dependencies */
import ava from 'ava';
import WeatherModel, {
    angleDifference,
    getCeilingFeet,
    hasSignificantWeatherChange,
    normalizeDirection,
    roundVisibility
} from '../../src/assets/scripts/client/weather/WeatherModel';
import {
    REGIME_SEVERITY,
    WEATHER_REGIME,
    WEATHER_VARIABILITY
} from '../../src/assets/scripts/client/weather/weatherConstants';

// small deterministic PRNG (mulberry32)
const seeded = (seed) => {
    let a = seed;

    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);

        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

const run = (model, minutes) => {
    const snapshots = [];

    for (let i = 0; i < minutes * 2; i++) {
        model.tick(30);
        snapshots.push(model.getSnapshot());
    }

    return snapshots;
};

ava('normalizeDirection() uses 1..360 and never 0', (t) => {
    t.is(normalizeDirection(0), 360);
    t.is(normalizeDirection(360), 360);
    t.is(normalizeDirection(-10), 350);
    t.is(normalizeDirection(725), 5);
});

ava('angleDifference() takes the short way round', (t) => {
    t.is(angleDifference(350, 10), 20);
    t.is(angleDifference(10, 350), -20);
    t.is(angleDifference(90, 270), 180);
});

ava('roundVisibility() follows reporting steps', (t) => {
    t.is(roundVisibility(12000), 9999);
    t.is(roundVisibility(9600), 9999);
    t.is(roundVisibility(7400), 7000);
    t.is(roundVisibility(4349), 4300);
    t.is(roundVisibility(620), 600);
    t.is(roundVisibility(130), 150);
    t.is(roundVisibility(20), 50);
});

ava('getCeilingFeet() ignores few and scattered layers', (t) => {
    t.is(getCeilingFeet([{ cover: 'FEW', baseFt: 1000 }, { cover: 'SCT', baseFt: 1500 }]), null);
    t.is(getCeilingFeet([{ cover: 'SCT', baseFt: 1000 }, { cover: 'BKN', baseFt: 2500 }, { cover: 'OVC', baseFt: 4000 }]), 2500);
    t.is(getCeilingFeet([{ cover: 'VV', baseFt: 100 }]), 100);
});

ava('the initial snapshot honours the airport file wind', (t) => {
    const model = new WeatherModel({ baseWind: { angle: 250, speed: 9 }, random: seeded(1), startRegime: WEATHER_REGIME.FAIR });
    const snapshot = model.getSnapshot();

    t.is(snapshot.windDirection, 250);
    t.true(Math.abs(snapshot.windSpeed - 9) <= 3);
});

ava('the same seed produces the same weather', (t) => {
    const a = run(new WeatherModel({ random: seeded(42) }), 180);
    const b = run(new WeatherModel({ random: seeded(42) }), 180);

    t.deepEqual(a, b);
});

ava('static variability never changes regime or drifts the wind direction', (t) => {
    const model = new WeatherModel({
        variability: WEATHER_VARIABILITY.STATIC,
        baseWind: { angle: 270, speed: 8 },
        random: seeded(7)
    });
    const snapshots = run(model, 600);

    snapshots.forEach((snapshot) => {
        t.is(snapshot.regime, snapshots[0].regime);
        t.is(snapshot.windDirection, 270);
    });
    t.is(model.getUpcoming(), null);
});

ava('snapshots are always within reportable bounds', (t) => {
    [WEATHER_VARIABILITY.CALM, WEATHER_VARIABILITY.NORMAL, WEATHER_VARIABILITY.LIVELY, WEATHER_VARIABILITY.SEVERE].forEach((variability) => {
        for (let seed = 1; seed <= 6; seed++) {
            const snapshots = run(new WeatherModel({ variability, random: seeded(seed * 97), latitudeDegrees: 53 }), 600);

            snapshots.forEach((s) => {
                t.true(s.windDirection >= 1 && s.windDirection <= 360);
                t.is(s.windDirection % 10, 0);
                t.true(s.windSpeed >= 0 && s.windSpeed <= 70);
                t.true(s.windGust === null || s.windGust > s.windSpeed);
                t.true(s.visibilityMeters >= 50 && s.visibilityMeters <= 9999);
                t.true(s.qnhHpa >= 985 && s.qnhHpa <= 1038);
                t.true(s.dewpointC <= s.temperatureC);
                t.true(Number.isFinite(s.temperatureC));
                s.cloud.forEach((layer) => t.true(layer.baseFt > 0));
            });
        }
    });
});

ava('calm variability never produces rain, fog or storms', (t) => {
    const allowed = new Set(REGIME_SEVERITY.slice(0, 3));

    for (let seed = 1; seed <= 10; seed++) {
        run(new WeatherModel({ variability: WEATHER_VARIABILITY.CALM, random: seeded(seed) }), 720).forEach((s) => {
            t.true(allowed.has(s.regime), `${s.regime} should not occur in calm weather`);
        });
    }
});

ava('severe variability does eventually produce several different regimes', (t) => {
    const seen = new Set();

    for (let seed = 1; seed <= 6; seed++) {
        run(new WeatherModel({ variability: WEATHER_VARIABILITY.SEVERE, random: seeded(seed * 13), latitudeDegrees: 55 }), 900)
            .forEach((s) => seen.add(s.regime));
    }

    t.true(seen.size >= 5, `saw only ${[...seen].join(',')}`);
});

ava('snow only occurs in cold climates', (t) => {
    const warm = new WeatherModel({ variability: WEATHER_VARIABILITY.SEVERE, random: seeded(3), latitudeDegrees: 1, seasonOffsetCelsius: 5 });

    run(warm, 1200).forEach((s) => t.not(s.regime, WEATHER_REGIME.SNOW));

    const cold = new WeatherModel({ variability: WEATHER_VARIABILITY.SEVERE, random: seeded(5), latitudeDegrees: 60, seasonOffsetCelsius: -10 });
    const coldRegimes = new Set(run(cold, 2400).map((s) => s.regime));

    t.true(coldRegimes.has(WEATHER_REGIME.SNOW) || coldRegimes.size > 3);
});

ava('forceRegime() produces matching conditions after the blend completes', (t) => {
    // static variability keeps a forced regime in place indefinitely
    const model = new WeatherModel({ random: seeded(11), variability: WEATHER_VARIABILITY.STATIC, latitudeDegrees: 53 });

    model.forceRegime(WEATHER_REGIME.FOG);
    run(model, 20);
    const snapshot = model.getSnapshot();

    t.true(snapshot.visibilityMeters <= 900);
    t.deepEqual(snapshot.phenomena, ['FG']);
    t.true(snapshot.ceilingFeet !== null && snapshot.ceilingFeet <= 300);
});

ava('thunderstorms are gusty with cumulonimbus', (t) => {
    const model = new WeatherModel({ random: seeded(21), variability: WEATHER_VARIABILITY.STATIC });

    model.forceRegime(WEATHER_REGIME.THUNDERSTORM);
    const snapshot = run(model, 20).pop();

    t.true(snapshot.phenomena[0].includes('TS'));
    t.true(snapshot.cloud.some((layer) => layer.type === 'CB'));
    t.true(snapshot.windSpeed >= 8);
});

ava('setWind() overrides the surface wind immediately', (t) => {
    const model = new WeatherModel({ random: seeded(2), variability: WEATHER_VARIABILITY.STATIC });

    model.setWind({ angle: 90, speed: 17 });

    const snapshot = model.getSnapshot();

    t.is(snapshot.windDirection, 90);
    t.true(Math.abs(snapshot.windSpeed - 17) <= 3);
});

ava('a coming regime change is forecast before it happens', (t) => {
    const model = new WeatherModel({ random: seeded(8), variability: WEATHER_VARIABILITY.LIVELY });
    let forecast = null;

    for (let i = 0; i < 2 * 600 && !forecast; i++) {
        model.tick(30);
        forecast = model.getUpcoming();
    }

    t.truthy(forecast);
    t.true(forecast.inMinutes >= 1 && forecast.inMinutes <= 40);

    // after waiting that long, the regime really does change to what was forecast
    let changedTo = null;

    for (let i = 0; i < 2 * (forecast.inMinutes + 2) && !changedTo; i++) {
        model.tick(30);

        if (model.regime !== forecast.regime && i > 0) {
            continue;
        }

        if (model.regime === forecast.regime) {
            changedTo = model.regime;
        }
    }

    t.is(changedTo, forecast.regime);
});

ava('hasSignificantWeatherChange() applies ICAO-style thresholds', (t) => {
    const base = {
        windDirection: 270,
        windSpeed: 10,
        windGust: null,
        visibilityMeters: 9999,
        ceilingFeet: 4000,
        phenomena: [],
        qnhHpa: 1013
    };

    t.false(hasSignificantWeatherChange(base, { ...base, windDirection: 290 }));
    t.true(hasSignificantWeatherChange(base, { ...base, windDirection: 310 }));
    t.false(hasSignificantWeatherChange(base, { ...base, windSpeed: 15 }));
    t.true(hasSignificantWeatherChange(base, { ...base, windSpeed: 21 }));
    t.true(hasSignificantWeatherChange(base, { ...base, windGust: 22 }));
    t.true(hasSignificantWeatherChange(base, { ...base, visibilityMeters: 4000 }));
    t.false(hasSignificantWeatherChange(base, { ...base, visibilityMeters: 9999, ceilingFeet: 4500 }));
    t.true(hasSignificantWeatherChange(base, { ...base, ceilingFeet: 900 }));
    t.true(hasSignificantWeatherChange(base, { ...base, phenomena: ['RA'] }));
    t.true(hasSignificantWeatherChange(base, { ...base, qnhHpa: 1010 }));
    t.false(hasSignificantWeatherChange(base, { ...base, qnhHpa: 1012 }));
    t.false(hasSignificantWeatherChange(null, base));
});

ava('direction changes in light winds are not significant', (t) => {
    const calm = { windDirection: 90, windSpeed: 2, windGust: null, visibilityMeters: 9999, ceilingFeet: null, phenomena: [], qnhHpa: 1013 };

    t.false(hasSignificantWeatherChange(calm, { ...calm, windDirection: 270 }));
});
