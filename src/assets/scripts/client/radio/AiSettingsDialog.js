import $ from 'jquery';
import EventBus from '../lib/EventBus';
import { EVENT } from '../constants/eventNames';
import { SELECTORS } from '../constants/selectors';
import {
    fetchStatus,
    loadKeys,
    loadPreferences,
    resetStatusCache,
    saveKeys,
    savePreferences
} from './aiClient';

const DIALOG_TEMPLATE = `
    <div id="ai-settings" class="dialog ai-settings">
        <p class="dialog-title">AI &amp; Voice</p>
        <div class="ai-settings-status js-ai-status"></div>
        <form class="ai-settings-form js-ai-form" autocomplete="off">
            <label class="ai-settings-label">Anthropic API key
                <input type="password" class="ai-settings-input js-ai-anthropic" placeholder="sk-ant-... (or set ANTHROPIC_API_KEY on the server)"
                    spellcheck="false" autocomplete="off">
            </label>
            <p class="ai-settings-hint">Lets you talk to pilots in your own words: any phrasing, questions ("how much fuel?"), requests and
                diversions. Without it the built-in phrase matcher understands standard phraseology.</p>
            <label class="ai-settings-label">ElevenLabs API key
                <input type="password" class="ai-settings-input js-ai-elevenlabs" placeholder="(or set ELEVENLABS_API_KEY on the server)"
                    spellcheck="false" autocomplete="off">
            </label>
            <p class="ai-settings-hint">Gives every pilot their own voice (accented to suit the airline) and turns your microphone
                into accurate speech-to-text. Without it the browser's own voices and speech recognition are used.</p>
            <label class="ai-settings-check"><input type="checkbox" class="js-ai-use-model"> Use the language model for transmissions</label>
            <label class="ai-settings-check"><input type="checkbox" class="js-ai-use-studio"> Use ElevenLabs voices for pilots</label>
            <label class="ai-settings-check"><input type="checkbox" class="js-ai-radio-effect"> Radio filter and squelch on pilot audio</label>
            <p class="ai-settings-hint">Keys are stored in this browser only and sent to the openScope server you are playing on. To hear pilots,
                turn on the speaker button at the bottom of the screen.</p>
            <div class="ai-settings-buttons">
                <button type="submit" class="atis-button">Save</button>
                <button type="button" class="atis-button js-ai-close">Close</button>
            </div>
        </form>
    </div>`;

const describe = (status) => {
    if (status.offline) {
        return 'Cannot reach the openScope server\'s AI endpoints (are you running it with `npm start`?). The built-in phrase matcher and browser voices are in use.';
    }

    const model = status.llm ? `Language model: ready (${status.model})` : 'Language model: not configured';
    const voice = status.voice ? 'ElevenLabs voices: ready' : 'ElevenLabs voices: not configured';

    return `${model}\n${voice}${status.sdk && status.sdk !== 'ok' ? `\n${status.sdk}` : ''}`;
};

/**
 * Dialog for the optional AI and voice integrations
 *
 * @class AiSettingsDialog
 */
export default class AiSettingsDialog {
    constructor($element, radioController) {
        this.$element = $element;
        this._radio = radioController;
        this.$dialog = $(DIALOG_TEMPLATE);
        this.$element.append(this.$dialog);
        this._bind();
    }

    isOpen() {
        return this.$dialog.hasClass(SELECTORS.CLASSNAMES.OPEN);
    }

    close() {
        this.$dialog.removeClass(SELECTORS.CLASSNAMES.OPEN);
    }

    toggle() {
        if (this.isOpen()) {
            this.close();

            return;
        }

        this._populate();
        this.$dialog.addClass(SELECTORS.CLASSNAMES.OPEN);
        resetStatusCache();
        fetchStatus(true).then((status) => this.$dialog.find('.js-ai-status').text(describe(status)));
    }

    // ------------------------------ PRIVATE ------------------------------

    _bind() {
        EventBus.on(EVENT.TOGGLE_AI_SETTINGS, () => this.toggle());
        this.$dialog.find('.js-ai-close').on('click', () => this.close());
        this.$dialog.find('.js-ai-form').on('submit', (event) => {
            event.preventDefault();
            this._save();
        });
    }

    _populate() {
        const keys = loadKeys();
        const preferences = loadPreferences();

        this.$dialog.find('.js-ai-anthropic').val(keys.anthropic);
        this.$dialog.find('.js-ai-elevenlabs').val(keys.elevenlabs);
        this.$dialog.find('.js-ai-use-model').prop('checked', preferences.useLanguageModel);
        this.$dialog.find('.js-ai-use-studio').prop('checked', preferences.useStudioVoices);
        this.$dialog.find('.js-ai-radio-effect').prop('checked', preferences.radioEffect);
        this.$dialog.find('.js-ai-status').text('Checking...');
    }

    async _save() {
        const stored = saveKeys({
            anthropic: this.$dialog.find('.js-ai-anthropic').val(),
            elevenlabs: this.$dialog.find('.js-ai-elevenlabs').val()
        });

        savePreferences({
            useLanguageModel: this.$dialog.find('.js-ai-use-model').is(':checked'),
            useStudioVoices: this.$dialog.find('.js-ai-use-studio').is(':checked'),
            radioEffect: this.$dialog.find('.js-ai-radio-effect').is(':checked')
        });

        const status = await this._radio.refreshStatus(true);
        const message = stored ? describe(status) : `${describe(status)}\nThis browser would not store the keys, so they will be forgotten when you leave.`;

        this.$dialog.find('.js-ai-status').text(message);
    }
}
