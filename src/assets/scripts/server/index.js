const express = require('express');
const http = require('http');
const path = require('path');
const colors = require('ansi-colors');
const { loadDotEnv } = require('./ai/config');
const { registerAiRoutes } = require('./ai/routes');

const app = express();
const server = http.Server(app);

const PORT = process.env.PORT || 3003;

// keys for the AI features may live in a `.env` file next to where the server is started
loadDotEnv();

app.use('/assets', express.static(path.join(__dirname, '/../../../assets')));

const { config: aiConfig } = registerAiRoutes(app);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '/../../../index.html'));
});

server.listen(PORT, () => {
    console.log(colors.green.bold(`\nListening on PORT ${PORT}`));
    console.log(`AI pilots (Claude): ${aiConfig.anthropicKey ? colors.green(`enabled (${aiConfig.model})`) : colors.yellow('no ANTHROPIC_API_KEY set (text commands only, or enter a key in the AI & Voice dialog)')}`);
    console.log(`Voice (ElevenLabs): ${aiConfig.elevenLabsKey ? colors.green('enabled') : colors.yellow('no ELEVENLABS_API_KEY set (browser voices will be used)')}`);
});
