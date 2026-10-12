/* eslint-disable arrow-parens, max-len, import/no-extraneous-dependencies */
import '@babel/polyfill';
import ava from 'ava';
import http from 'http';
import express from 'express';
import { parseDotEnv, readConfig } from '../../src/assets/scripts/server/ai/config';
import { COMMANDS, listAliases } from '../../src/assets/scripts/server/ai/commandReference';
import {
    COMMAND_PATTERN,
    OUTPUT_SCHEMA,
    SYSTEM_PROMPT,
    buildUserMessage,
    sanitizeResult
} from '../../src/assets/scripts/server/ai/interpret';
import {
    accentForCallsign,
    buildVoiceSettings,
    chooseVoice
} from '../../src/assets/scripts/server/ai/elevenlabs';
import { createRateLimiter, registerAiRoutes } from '../../src/assets/scripts/server/ai/routes';
import { AIRCRAFT_COMMAND_MAP } from '../../src/assets/scripts/client/commands/aircraftCommand/aircraftCommandMap';

// ---------------------------------------------------------------- helpers

// The shared test setup defines browser globals (jsdom); the Anthropic SDK refuses to run in a browser-like
// environment, and this code only ever runs in Node.
delete global.window;
delete global.document;
delete global.navigator;

const listen = (handler) => new Promise((resolve) => {
    const server = http.createServer(handler);

    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
});

const readBody = (request) => new Promise((resolve) => {
    const chunks = [];

    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
});

const startApp = async(env) => {
    const app = express();

    registerAiRoutes(app, env);

    return listen(app);
};

const AIRCRAFT = [
    {
        callsign: 'BAW123', spokenCallsign: 'Speedbird one two three', type: 'A320', category: 'arrival', phaseText: 'descending', altitude: 6000, onboard: { enduranceMinutes: 80, souls: 150 }, origin: { icao: 'EGLL' }
    },
    {
        callsign: 'EZY64A', spokenCallsign: 'Easy six four alpha', type: 'A319', category: 'departure', phaseText: 'climbing', altitude: 3000
    }
];

// ---------------------------------------------------------------- config

ava('parseDotEnv() reads simple, quoted and commented lines', (t) => {
    const values = parseDotEnv('# comment\nANTHROPIC_API_KEY=sk-test\nELEVENLABS_API_KEY="quoted value"\nexport ATC_LLM_MODEL=claude-haiku-5-5\n\nBAD LINE\n');

    t.deepEqual(values, { ANTHROPIC_API_KEY: 'sk-test', ELEVENLABS_API_KEY: 'quoted value', ATC_LLM_MODEL: 'claude-haiku-5-5' });
});

ava('readConfig() applies defaults and validates effort', (t) => {
    const defaults = readConfig({});

    t.is(defaults.model, 'claude-opus-5-5');
    t.is(defaults.effort, 'low');
    t.is(defaults.ttsModel, 'eleven_flash_v2_5');
    t.is(defaults.anthropicKey, '');
    t.is(readConfig({ ATC_LLM_EFFORT: 'none' }).effort, null);
    t.is(readConfig({ ATC_LLM_EFFORT: 'HIGH' }).effort, 'high');
    t.deepEqual(readConfig({ ELEVENLABS_VOICE_IDS: 'a, b ,,c' }).voiceIds, ['a', 'b', 'c']);
    t.is(readConfig({ ELEVENLABS_BASE_URL: 'http://x///' }).elevenLabsBaseUrl, 'http://x');
});

// ---------------------------------------------------------------- command reference stays in step with the client

ava('every alias shown to the model exists in the client command map', (t) => {
    const clientAliases = new Set();

    Object.values(AIRCRAFT_COMMAND_MAP).forEach((command) => command.aliases.forEach((alias) => clientAliases.add(alias)));
    listAliases().forEach((alias) => t.true(clientAliases.has(alias), `server prompt teaches "${alias}" but the client has no such alias`));
});

ava('every aircraft command the client supports is explained to the model', (t) => {
    const taught = new Set(listAliases());
    // commands that are not controller instructions to a pilot
    const exempt = new Set(['moveDataBlock', 'delete', 'fix', 'land', 'abort', 'climbViaSid', 'descendViaStar', 'cancelHold', 'altitude', 'heading', 'speed']);

    Object.keys(AIRCRAFT_COMMAND_MAP).forEach((name) => {
        const command = AIRCRAFT_COMMAND_MAP[name];

        if (command.isSystemCommand || exempt.has(name)) {
            return;
        }

        t.true(command.aliases.some((alias) => taught.has(alias)), `command "${name}" is not taught to the model`);
    });
    // the exempt multi-alias commands must still have at least one alias taught
    ['altitude', 'heading', 'speed', 'cancelHold', 'climbViaSid', 'descendViaStar'].forEach((name) => {
        t.true(AIRCRAFT_COMMAND_MAP[name].aliases.some((alias) => taught.has(alias)), `${name} not taught`);
    });
    t.true(COMMANDS.length > 30);
});

ava('every example command in the reference passes the sanitiser pattern', (t) => {
    COMMANDS.forEach((command) => t.true(COMMAND_PATTERN.test(command.example), command.example));
});

ava('the system prompt contains the command table and the safety rules', (t) => {
    t.true(SYSTEM_PROMPT.includes('`d 30`'));
    t.true(SYSTEM_PROMPT.includes('divert'));
    t.true(SYSTEM_PROMPT.includes('HUNDREDS of feet'));
    t.true(SYSTEM_PROMPT.includes('Never invent an aircraft'));
});

// ---------------------------------------------------------------- sanitising model output

ava('sanitizeResult() keeps only real aircraft and well-formed commands', (t) => {
    const result = sanitizeResult({
        transmissions: [
            {
                callsign: 'baw 123', commands: ['t l 270', 'd 30', '; rm -rf /', '', 'x'.repeat(200)], reply: '  roger  ', intent: 'command'
            },
            {
                callsign: 'GHOST9', commands: ['sf'], reply: '', intent: 'query'
            },
            {
                callsign: 'EZY64A', commands: ['sf'], reply: 'x'.repeat(1000), intent: 'query'
            }
        ],
        controller_note: 'ok'
    }, AIRCRAFT);

    t.deepEqual(result.transmissions.map((x) => x.callsign), ['BAW123', 'EZY64A']);
    t.deepEqual(result.transmissions[0].commands, ['t l 270', 'd 30']);
    t.is(result.transmissions[0].reply, 'roger');
    t.is(result.transmissions[1].reply.length, 400);
});

ava('sanitizeResult() copes with garbage', (t) => {
    t.deepEqual(sanitizeResult(null, AIRCRAFT), { transmissions: [], app_actions: [], controller_note: '' });
    t.deepEqual(sanitizeResult({ transmissions: 'no' }, AIRCRAFT).transmissions, []);
    t.deepEqual(sanitizeResult({ transmissions: [{ callsign: 'BAW123', commands: 'nope' }] }, AIRCRAFT).transmissions[0].commands, []);
});

ava('buildUserMessage() compacts aircraft and truncates the transcript', (t) => {
    const message = JSON.parse(buildUserMessage({ transcript: 'a'.repeat(5000), aircraft: AIRCRAFT, history: new Array(30).fill('x') }));

    t.is(message.transcript.length, 600);
    t.is(message.history.length, 8);
    t.is(message.aircraft[0].callsign, 'BAW123');
    t.is(message.aircraft[0].fuelMinutes, 80);
    t.is(message.aircraft[0].origin, 'EGLL');
});

ava('the output schema is strict', (t) => {
    t.false(OUTPUT_SCHEMA.additionalProperties);
    t.false(OUTPUT_SCHEMA.properties.transmissions.items.additionalProperties);
    t.deepEqual(OUTPUT_SCHEMA.required, ['transmissions', 'app_actions', 'controller_note']);
});

// ---------------------------------------------------------------- voices

ava('voices are stable per callsign and accents follow the operator', (t) => {
    const voices = [
        { id: 'uk1', accent: 'british' }, { id: 'uk2', accent: 'british' },
        { id: 'us1', accent: 'american' }, { id: 'au1', accent: 'australian' }
    ];

    t.is(chooseVoice('BAW123', voices).id, chooseVoice('BAW123', voices).id);
    t.true(['uk1', 'uk2'].includes(chooseVoice('BAW123', voices).id));
    t.is(chooseVoice('QFA7', voices).id, 'au1');
    t.is(accentForCallsign('DAL42'), 'american');
    t.is(accentForCallsign('ZZZ1'), null);
    t.is(chooseVoice('ANY', []), null);
    t.truthy(chooseVoice('ZZZ1', voices));
});

ava('voice settings vary a little between pilots but stay in range', (t) => {
    const seen = new Set();

    for (let i = 0; i < 40; i++) {
        const settings = buildVoiceSettings(`PILOT${i}`);

        seen.add(settings.stability.toFixed(3));
        t.true(settings.stability >= 0.35 && settings.stability <= 0.65);
        t.true(settings.speed >= 1 && settings.speed <= 1.1);
    }

    t.true(seen.size > 10);
});

// ---------------------------------------------------------------- rate limiting

ava('the rate limiter blocks after the limit', async(t) => {
    const app = express();

    app.use(createRateLimiter(3));
    app.get('/', (request, response) => response.send('ok'));

    const { server, url } = await listen(app);
    const statuses = [];

    for (let i = 0; i < 5; i++) {
        // sequential on purpose: the limiter counts requests in order
        // eslint-disable-next-line no-await-in-loop
        statuses.push((await fetch(url)).status);
    }

    server.close();
    t.deepEqual(statuses, [200, 200, 200, 429, 429]);
});

// ---------------------------------------------------------------- end to end against fake upstreams

ava.serial('GET /api/status reports what is configured, and a per-request key counts', async(t) => {
    const { server, url } = await startApp({});
    const bare = await (await fetch(`${url}/api/status`)).json();
    const withKeys = await (await fetch(`${url}/api/status`, { headers: { 'x-anthropic-key': 'sk-a', 'x-elevenlabs-key': 'el-b' } })).json();

    server.close();
    t.false(bare.llm);
    t.false(bare.voice);
    t.true(withKeys.llm);
    t.true(withKeys.voice);
    t.is(bare.model, 'claude-opus-5-5');
});

ava.serial('endpoints answer 501 when no key is configured', async(t) => {
    const { server, url } = await startApp({});
    const interpret = await fetch(`${url}/api/atc/interpret`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"transcript":"x"}' });
    const tts = await fetch(`${url}/api/voice/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"text":"x"}' });
    const stt = await fetch(`${url}/api/voice/stt`, { method: 'POST', body: Buffer.from('abc') });

    server.close();
    t.is(interpret.status, 501);
    t.is(tts.status, 501);
    t.is(stt.status, 501);
});

ava.serial('POST /api/atc/interpret calls Claude with a grounded, structured request and sanitises the answer', async(t) => {
    let seen = null;
    const anthropic = await listen(async(request, response) => {
        const body = JSON.parse((await readBody(request)).toString());

        seen = { path: request.url, key: request.headers['x-api-key'], body };
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            model: body.model,
            stop_reason: 'end_turn',
            stop_sequence: null,
            content: [{
                type: 'text',
                text: JSON.stringify({
                    transmissions: [
                        {
                            callsign: 'BAW123', commands: ['t l 270', 'd 30', 'bad;command'], reply: '', intent: 'command'
                        },
                        {
                            callsign: 'NOTREAL', commands: ['sf'], reply: '', intent: 'query'
                        }
                    ],
                    controller_note: ''
                })
            }],
            usage: { input_tokens: 1200, output_tokens: 80 }
        }));
    });
    const { server, url } = await startApp({ ANTHROPIC_API_KEY: 'sk-ant-test', ANTHROPIC_BASE_URL: anthropic.url });
    const reply = await fetch(`${url}/api/atc/interpret`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transcript: 'speedbird one two three turn left heading two seven zero descend three thousand', aircraft: AIRCRAFT, airport: { icao: 'EGGP' } })
    });
    const result = await reply.json();

    server.close();
    anthropic.server.close();

    t.is(reply.status, 200);
    t.deepEqual(result.transmissions, [{
        callsign: 'BAW123', commands: ['t l 270', 'd 30'], reply: '', intent: 'command'
    }]);
    t.is(seen.path, '/v1/messages');
    t.is(seen.key, 'sk-ant-test');
    t.is(seen.body.model, 'claude-opus-5-5');
    t.is(seen.body.output_config.effort, 'low');
    t.is(seen.body.output_config.format.type, 'json_schema');
    t.is(seen.body.system[0].text, SYSTEM_PROMPT);
    t.is(JSON.parse(seen.body.messages[0].content).transcript.startsWith('speedbird one two three'), true);
    t.is(result.usage.input, 1200);
});

ava.serial('a browser-supplied key is used when the server has none, and refusal / bad JSON are reported', async(t) => {
    let key = null;
    let mode = 'refusal';
    const anthropic = await listen(async(request, response) => {
        key = request.headers['x-api-key'];
        await readBody(request);
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({
            id: 'm',
            type: 'message',
            role: 'assistant',
            model: 'x',
            stop_sequence: null,
            stop_reason: mode === 'refusal' ? 'refusal' : 'end_turn',
            content: mode === 'refusal' ? [] : [{ type: 'text', text: 'not json' }],
            usage: { input_tokens: 1, output_tokens: 1 }
        }));
    });
    const { server, url } = await startApp({ ANTHROPIC_BASE_URL: anthropic.url });
    const ask = () => fetch(`${url}/api/atc/interpret`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-anthropic-key': 'sk-byo' },
        body: JSON.stringify({ transcript: 'hello', aircraft: AIRCRAFT })
    });
    const refused = await ask();

    mode = 'garbage';
    const garbage = await ask();

    server.close();
    anthropic.server.close();
    t.is(key, 'sk-byo');
    t.is(refused.status, 422);
    t.true((await refused.json()).error.includes('declined'));
    t.is(garbage.status, 422);
});

ava.serial('upstream authentication failures are explained', async(t) => {
    const anthropic = await listen(async(request, response) => {
        await readBody(request);
        response.statusCode = 401;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
    });
    const { server, url } = await startApp({ ANTHROPIC_API_KEY: 'bad', ANTHROPIC_BASE_URL: anthropic.url });
    const reply = await fetch(`${url}/api/atc/interpret`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transcript: 'x', aircraft: [] }) });

    server.close();
    anthropic.server.close();
    t.is(reply.status, 401);
    t.true((await reply.json()).error.includes('rejected'));
});

ava.serial('empty transcripts are rejected without calling the model', async(t) => {
    let called = false;
    const anthropic = await listen((request, response) => { called = true; response.end('{}'); });
    const { server, url } = await startApp({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: anthropic.url });
    const reply = await fetch(`${url}/api/atc/interpret`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transcript: '   ' }) });

    server.close();
    anthropic.server.close();
    t.is(reply.status, 422);
    t.false(called);
});

ava.serial('TTS and STT go through ElevenLabs with the right shapes', async(t) => {
    const calls = [];
    const eleven = await listen(async(request, response) => {
        const body = await readBody(request);

        calls.push({
            method: request.method, url: request.url, key: request.headers['xi-api-key'], type: request.headers['content-type'], body
        });

        if (request.url.startsWith('/v1/voices')) {
            response.setHeader('content-type', 'application/json');

            return response.end(JSON.stringify({
                voices: [
                    { voice_id: 'brit-1', name: 'Brit', labels: { accent: 'british', gender: 'male' } },
                    { voice_id: 'amer-1', name: 'Yank', labels: { accent: 'american', gender: 'female' } }
                ]
            }));
        }

        if (request.url.startsWith('/v1/text-to-speech/')) {
            response.setHeader('content-type', 'audio/mpeg');

            return response.end(Buffer.from('ID3-fake-mp3'));
        }

        if (request.url.startsWith('/v1/speech-to-text')) {
            response.setHeader('content-type', 'application/json');

            return response.end(JSON.stringify({ text: ' speedbird one two three descend three thousand ' }));
        }

        response.statusCode = 404;

        return response.end();
    });
    const { server, url } = await startApp({ ELEVENLABS_API_KEY: 'el-key', ELEVENLABS_BASE_URL: eleven.url });
    const tts = await fetch(`${url}/api/voice/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Speedbird one two three, descending three thousand', voiceKey: 'BAW123' }) });
    const audio = Buffer.from(await tts.arrayBuffer()).toString();
    const stt = await fetch(`${url}/api/voice/stt`, { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: Buffer.from('RIFFfakeaudio') });
    const transcript = await stt.json();

    server.close();
    eleven.server.close();

    t.is(tts.status, 200);
    t.is(tts.headers.get('content-type'), 'audio/mpeg');
    t.is(audio, 'ID3-fake-mp3');
    const ttsCall = calls.find((call) => call.url.startsWith('/v1/text-to-speech/'));

    // a BAW callsign gets the British voice
    t.true(ttsCall.url.startsWith('/v1/text-to-speech/brit-1'));
    t.true(ttsCall.url.includes('output_format=mp3_44100_64'));
    t.is(ttsCall.key, 'el-key');
    const ttsBody = JSON.parse(ttsCall.body.toString());

    t.is(ttsBody.model_id, 'eleven_flash_v2_5');
    t.true(ttsBody.text.startsWith('Speedbird one two three'));
    t.true(ttsBody.voice_settings.stability > 0);

    t.is(transcript.text, 'speedbird one two three descend three thousand');
    const sttCall = calls.find((call) => call.url.startsWith('/v1/speech-to-text'));

    t.true(sttCall.type.startsWith('multipart/form-data'));
    t.true(sttCall.body.toString().includes('scribe_v1'));
    t.true(sttCall.body.toString().includes('RIFFfakeaudio'));
});

ava.serial('STT rejects an empty recording and TTS rejects empty text', async(t) => {
    const { server, url } = await startApp({ ELEVENLABS_API_KEY: 'k', ELEVENLABS_BASE_URL: 'http://127.0.0.1:1' });
    const stt = await fetch(`${url}/api/voice/stt`, { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: Buffer.alloc(0) });
    const tts = await fetch(`${url}/api/voice/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '  ' }) });

    server.close();
    t.is(stt.status, 400);
    t.is(tts.status, 502);
});

ava('sanitizeResult() keeps well-formed application actions and drops the rest', (t) => {
    const result = sanitizeResult({
        transmissions: [],
        app_actions: [
            { action: 'open', target: 'ATIS', value: '' },
            { action: 'switch_airport', target: '', value: 'EGCC' },
            { action: 'switch_airport', target: '', value: 'Manchester' },
            { action: 'format_disk', target: 'c', value: '' },
            { action: 'layer', target: 'sids; drop', value: 'hide' },
            null
        ],
        controller_note: ''
    }, AIRCRAFT);

    t.deepEqual(result.app_actions, [
        { action: 'open', target: 'atis', value: '' },
        { action: 'switch_airport', target: '', value: 'EGCC' },
        { action: 'layer', target: 'sidsdrop', value: 'hide' }
    ]);
});

ava('the user message carries the repaired transcript', (t) => {
    const message = JSON.parse(buildUserMessage({ transcript: 'the center flight level zero five zero', repairedTranscript: 'descend flight level zero five zero', aircraft: [] }));

    t.is(message.repairedTranscript, 'descend flight level zero five zero');
});
