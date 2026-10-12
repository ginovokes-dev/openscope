/**
 * HTTP endpoints for the AI features
 *
 *   GET  /api/status               which features are available (so the UI can offer or hide them)
 *   POST /api/atc/interpret        free-form transmission -> commands and replies (Claude)
 *   POST /api/atc/notams           a few plausible NOTAM remarks for an airport (Claude)
 *   POST /api/voice/tts            speak text with a pilot voice (ElevenLabs), returns audio/mpeg
 *   POST /api/voice/stt            transcribe a recording (ElevenLabs), returns { text }
 */
const express = require('express');
const { readConfig } = require('./config');
const { createClient: createElevenLabsClient } = require('./elevenlabs');
const { interpretTransmission } = require('./interpret');

const SDK_UNAVAILABLE = 'The Anthropic SDK could not be loaded (it needs Node.js 18 or newer). Run `npm install` and start the server with a recent Node.';

let AnthropicClass;
let sdkLoadError = null;

try {
    // eslint-disable-next-line global-require
    AnthropicClass = require('@anthropic-ai/sdk');
    AnthropicClass = AnthropicClass.default || AnthropicClass;
} catch (error) {
    sdkLoadError = error;
}

/**
 * Collect a request body as a Buffer, refusing anything over the limit
 *
 * (`express.raw` only exists from Express 4.17; this project pins 4.16.)
 *
 * @function readRawBody
 * @param limitBytes {number}
 * @return {function} express middleware
 */
const readRawBody = (limitBytes) => (request, response, next) => {
    const chunks = [];
    let received = 0;
    let rejected = false;

    request.on('data', (chunk) => {
        received += chunk.length;

        if (received > limitBytes) {
            if (!rejected) {
                rejected = true;
                response.status(413).json({ error: 'Recording too large.' });
                request.destroy();
            }

            return;
        }

        chunks.push(chunk);
    });
    request.on('end', () => {
        if (!rejected) {
            request.body = Buffer.concat(chunks);
            next();
        }
    });
    request.on('error', () => {
        if (!rejected) {
            response.status(400).json({ error: 'Could not read the recording.' });
        }
    });
};

const keyFromRequest = (request, header, fallback) => String(request.get(header) || fallback || '').trim();

/**
 * Fixed-window limiter per client address, to protect API keys if the server is exposed
 *
 * @function createRateLimiter
 * @param limit {number} requests per window
 * @param windowMilliseconds {number}
 * @return {function} express middleware
 */
const createRateLimiter = (limit, windowMilliseconds = 60000) => {
    const hits = new Map();

    return (request, response, next) => {
        const now = Date.now();
        const key = request.ip || 'local';
        const entry = hits.get(key);

        if (!entry || now - entry.start > windowMilliseconds) {
            hits.set(key, { start: now, count: 1 });

            return next();
        }

        entry.count += 1;

        if (entry.count > limit) {
            return response.status(429).json({ error: 'Too many requests, please slow down.' });
        }

        return next();
    };
};

const describeAnthropicError = (error) => {
    const status = error && error.status;

    if (status === 401) {
        return { status: 401, message: 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY or the key in the AI & Voice dialog.' };
    }

    if (status === 429) {
        return { status: 429, message: 'The language model is rate limited; try again in a moment.' };
    }

    if (status === 400) {
        return { status: 502, message: `The language model rejected the request: ${error.message}` };
    }

    return { status: 502, message: 'The language model could not be reached.' };
};

/**
 * @function registerAiRoutes
 * @param app {express.Application}
 * @param env {object} environment (defaults to `process.env`)
 */
const registerAiRoutes = (app, env = process.env) => {
    const config = readConfig(env);
    const router = express.Router();
    const limiter = createRateLimiter(config.rateLimitPerMinute);

    const llmKey = (request) => keyFromRequest(request, 'x-anthropic-key', config.anthropicKey);
    const voiceKey = (request) => keyFromRequest(request, 'x-elevenlabs-key', config.elevenLabsKey);
    const buildAnthropic = (apiKey) => new AnthropicClass({
        apiKey,
        baseURL: config.anthropicBaseUrl,
        maxRetries: 1,
        timeout: 45000
    });
    // one client per key, so the list of voices is fetched once rather than for every utterance
    const voiceClients = new Map();
    const buildVoiceClient = (apiKey) => {
        if (!voiceClients.has(apiKey)) {
            voiceClients.set(apiKey, createElevenLabsClient({
                apiKey,
                baseUrl: config.elevenLabsBaseUrl,
                ttsModel: config.ttsModel,
                sttModel: config.sttModel,
                configuredVoiceIds: config.voiceIds
            }));
        }

        return voiceClients.get(apiKey);
    };

    router.use(limiter);

    router.get('/status', (request, response) => {
        response.json({
            llm: Boolean(llmKey(request)) && !sdkLoadError,
            llmServerKey: Boolean(config.anthropicKey),
            voice: Boolean(voiceKey(request)),
            voiceServerKey: Boolean(config.elevenLabsKey),
            model: config.model,
            sdk: sdkLoadError ? SDK_UNAVAILABLE : 'ok'
        });
    });

    router.post('/atc/interpret', express.json({ limit: '1mb' }), async(request, response) => {
        if (sdkLoadError) {
            return response.status(501).json({ error: SDK_UNAVAILABLE });
        }

        const apiKey = llmKey(request);

        if (!apiKey) {
            return response.status(501).json({ error: 'No Anthropic API key is configured. Set ANTHROPIC_API_KEY or enter a key in the AI & Voice dialog.' });
        }

        try {
            const result = await interpretTransmission(buildAnthropic(apiKey), { model: config.model, effort: config.effort }, request.body);

            if (result.error) {
                return response.status(422).json(result);
            }

            return response.json(result);
        } catch (error) {
            const described = describeAnthropicError(error);

            return response.status(described.status).json({ error: described.message });
        }
    });

    router.post('/atc/notams', express.json({ limit: '64kb' }), async(request, response) => {
        if (sdkLoadError || !llmKey(request)) {
            return response.status(501).json({ error: 'The language model is not available.' });
        }

        const {
            icao, name, country, runways
        } = request.body || {};

        try {
            const result = await buildAnthropic(llmKey(request)).messages.create({
                model: config.model,
                max_tokens: 600,
                system: 'You write brief, plausible, harmless NOTAM-style operational remarks for an air traffic control training simulator ATIS. ' +
                    'Each remark is one short sentence in the style of a real ATIS. Never mention closures of the active runway or ILS outages, never invent frequencies.',
                output_config: {
                    ...(config.effort ? { effort: config.effort } : {}),
                    format: {
                        type: 'json_schema',
                        schema: {
                            type: 'object',
                            properties: { remarks: { type: 'array', items: { type: 'string' } } },
                            required: ['remarks'],
                            additionalProperties: false
                        }
                    }
                },
                messages: [{
                    role: 'user',
                    content: `Write 2 or 3 remarks for ${name || icao} (${icao}, ${country || 'unknown country'}). Runways: ${(runways || []).join(', ')}.`
                }]
            });
            const text = (result.content.find((block) => block.type === 'text') || {}).text || '{}';
            const remarks = (JSON.parse(text).remarks || []).map((remark) => String(remark).slice(0, 200)).slice(0, 3);

            return response.json({ remarks });
        } catch (error) {
            return response.status(502).json({ error: 'Could not generate remarks.' });
        }
    });

    router.post('/voice/tts', express.json({ limit: '16kb' }), async(request, response) => {
        const apiKey = voiceKey(request);

        if (!apiKey) {
            return response.status(501).json({ error: 'No ElevenLabs API key is configured.' });
        }

        try {
            const result = await buildVoiceClient(apiKey).synthesize({
                text: request.body && request.body.text,
                voiceKey: request.body && request.body.voiceKey,
                voiceId: request.body && request.body.voiceId
            });

            if (!result.ok) {
                return response.status(result.status === 401 ? 401 : 502).json({ error: result.error });
            }

            response.set('Content-Type', 'audio/mpeg');
            response.set('Cache-Control', 'private, max-age=3600');

            return response.send(result.body);
        } catch (error) {
            return response.status(502).json({ error: 'ElevenLabs could not be reached.' });
        }
    });

    router.post('/voice/stt', readRawBody(25 * 1024 * 1024), async(request, response) => {
        const apiKey = voiceKey(request);

        if (!apiKey) {
            return response.status(501).json({ error: 'No ElevenLabs API key is configured.' });
        }

        if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
            return response.status(400).json({ error: 'No audio received.' });
        }

        try {
            const result = await buildVoiceClient(apiKey).transcribe({ audio: request.body, contentType: request.get('content-type') });

            if (!result.ok) {
                return response.status(result.status === 401 ? 401 : 502).json({ error: result.error });
            }

            return response.json({ text: result.text });
        } catch (error) {
            return response.status(502).json({ error: 'ElevenLabs could not be reached.' });
        }
    });

    app.use('/api', router);

    return { config, router };
};

module.exports = {
    createRateLimiter,
    readRawBody,
    registerAiRoutes
};
