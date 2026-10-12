/* eslint-disable no-underscore-dangle, no-unused-vars, no-undef, global-require */
import $ from 'jquery';
import _get from 'lodash/get';
import _has from 'lodash/has';
import EventTracker from './EventTracker';
import EventBus from './lib/EventBus';
import voiceOutput from './radio/voiceOutput';
import { EVENT } from './constants/eventNames';
import { radio_heading, radio_altitude } from './utilities/radioUtilities';
import { STORAGE_KEY } from './constants/storageKeys';
import { SELECTORS } from './constants/selectors';
import {
    VOICES,
    LOWER_PITCH,
    HIGHER_PITCH,
    NORMAL_SPEED,
    FASTER_SPEED
} from './constants/speechConstants';
import { TRACKABLE_EVENT } from './constants/trackableEvents';

/**
 *
 * @function speech_init
 */
export const speech_init = () => {
    prop.speech = {};
    prop.speech.synthesis = window.speechSynthesis;
    prop.speech.enabled = false;

    if (_get(localStorage, STORAGE_KEY.ATC_SPEECH_ENABLED, false) === true) {
        prop.speech.enabled = true;
        $(SELECTORS.DOM_SELECTORS.TOGGLE_SPEECH).addClass(SELECTORS.CLASSNAMES.ACTIVE);
    }
};

/**
 *
 * @function randomizePilotVoice
 */
export const randomizePilotVoice = () => {
    const voice = VOICES[Math.floor(Math.random() * VOICES.length)];
    const pitch = (Math.random() * (LOWER_PITCH - HIGHER_PITCH) + HIGHER_PITCH).toFixed(1);
    const rate = (Math.random() * (NORMAL_SPEED - FASTER_SPEED) + FASTER_SPEED).toFixed(3);

    return {
        voice,
        pitch,
        rate
    };
};

/**
 * Turn the parts of a pilot transmission into the words that are spoken
 *
 * @function buildSpokenText
 * @param sentence {array<object>} `[{ type: 'callsign'|'altitude'|'speed'|'heading'|'text', content }]`
 * @return {string}
 */
const buildSpokenText = (sentence) => {
    let textToSay = '';

    for (let i = 0; i < sentence.length; i++) {
        const singleSentence = sentence[i];

        switch (singleSentence.type) {
            case 'callsign':
                textToSay += ` ${singleSentence.content.getRadioCallsign()} `;
                break;
            case 'altitude':
                textToSay += ` ${radio_altitude(singleSentence.content)} `;
                break;
            case 'speed': case 'heading':
                textToSay += ` ${radio_heading(singleSentence.content)} `;
                break;
            case 'text':
                textToSay += ` ${singleSentence.content} `;
                break;
            default:
                break;
        }
    }

    return textToSay.replace(/\s+/g, ' ').trim();
};

/**
 * Say something as a pilot: shown in the radio transcript, and spoken when speech is enabled
 *
 * @function speech_say
 * @param sentence {array<object>}
 * @param pilotVoice {object} `{ voice, pitch, rate, key }` the aircraft's voice; `key` (the callsign) keeps a studio voice stable
 */
export const speech_say = (sentence, pilotVoice) => {
    const textToSay = buildSpokenText(sentence);
    const callsignPart = sentence.find((part) => part.type === 'callsign');

    EventBus.trigger(EVENT.RADIO_TRANSMISSION, {
        kind: 'pilot',
        speaker: callsignPart ? callsignPart.content.callsign : _get(pilotVoice, 'key', ''),
        text: textToSay
    });

    if (_get(prop, 'speech.enabled', false)) {
        voiceOutput.speak({ text: textToSay, voiceKey: _get(pilotVoice, 'key', textToSay), pilotVoice });
    }
};

/**
 *
 * @function speech_toggle
 */
export const speech_toggle = () => {
    const $speechToggleElement = $(SELECTORS.DOM_SELECTORS.TOGGLE_SPEECH);
    prop.speech.enabled = !prop.speech.enabled;

    if (!prop.speech.enabled) {
        voiceOutput.stop();
    }

    $speechToggleElement.toggleClass(SELECTORS.CLASSNAMES.ACTIVE);

    localStorage[STORAGE_KEY.ATC_SPEECH_ENABLED] = prop.speech.enabled;
    const hasClass = $speechToggleElement.hasClass(SELECTORS.CLASSNAMES.ACTIVE);

    EventTracker.recordEvent(TRACKABLE_EVENT.OPTIONS, 'speech', `${hasClass}`);
};
