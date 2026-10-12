import $ from 'jquery';
import EventBus from '../lib/EventBus';
import { EVENT } from '../constants/eventNames';
import { SELECTORS } from '../constants/selectors';

const MAXIMUM_LINES = 120;
const PUSH_TO_TALK_CODE = 'ShiftRight';

const PANEL_TEMPLATE = `
    <div id="radio-panel" class="radio-panel captures-keys notSelectable">
        <div class="radio-header">
            <span class="radio-title">RADIO</span>
            <span class="radio-mode js-radio-mode"></span>
            <span class="radio-header-buttons">
                <button type="button" class="radio-icon-button js-radio-settings" title="AI &amp; Voice settings">&#9881;</button>
                <button type="button" class="radio-icon-button js-radio-close" title="Close (F4)">&times;</button>
            </span>
        </div>
        <div class="radio-log nice-scrollbar js-radio-log"></div>
        <form class="radio-form js-radio-form" autocomplete="off">
            <button type="button" class="radio-mic js-radio-mic" title="Hold to talk (or hold Right Shift)">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11z"/>
                </svg>
            </button>
            <input class="radio-input js-radio-input" type="text" spellcheck="false" autocapitalize="off" autocorrect="off"
                placeholder="Speedbird one two three, descend flight level eight zero">
            <button type="submit" class="radio-send js-radio-send">Send</button>
        </form>
        <div class="radio-status js-radio-status"></div>
    </div>`;

const formatClock = (date) => `${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}`;

/**
 * Docked radio panel: transcript of everything said on frequency, a text box and a push-to-talk microphone
 *
 * Opens with F4 or the radio button in the footer. Hold the microphone button (or Right Shift, anywhere) to talk;
 * type a transmission and press Enter instead if you prefer. The same transcript receives what the pilots say,
 * including readbacks, so you can follow the frequency even with the sound off.
 *
 * @class RadioPanel
 */
export default class RadioPanel {
    constructor($element, radioController) {
        this.$element = $element;
        this._radio = radioController;
        this._eventBus = EventBus;
        this.$panel = $(PANEL_TEMPLATE);
        this.$log = this.$panel.find('.js-radio-log');
        this.$input = this.$panel.find('.js-radio-input');
        this.$mic = this.$panel.find('.js-radio-mic');
        this.$mode = this.$panel.find('.js-radio-mode');
        this.$status = this.$panel.find('.js-radio-status');
        this._isHoldingKey = false;
        this._commandHistory = [];
        this._commandHistoryIndex = -1;

        this.$element.append(this.$panel);
        this._bind();
        this._renderState();
    }

    isOpen() {
        return this.$panel.hasClass(SELECTORS.CLASSNAMES.OPEN);
    }

    toggle() {
        this.$panel.toggleClass(SELECTORS.CLASSNAMES.OPEN);

        if (this.isOpen()) {
            this._radio.refreshStatus(true);
            this.$input.trigger('focus');
            this._scrollToEnd();
        }
    }

    close() {
        this.$panel.removeClass(SELECTORS.CLASSNAMES.OPEN);
    }

    /**
     * Add a line to the transcript
     *
     * @for RadioPanel
     * @method addLine
     * @param transmission {object} `{ kind: 'controller'|'pilot'|'atis'|'system', speaker, text, isWarning }`
     */
    addLine(transmission) {
        const text = String(transmission.text || '').trim();

        if (!text) {
            return;
        }

        const $line = $('<div class="radio-line"></div>').addClass(`radio-line_${transmission.kind}`);

        if (transmission.isWarning) {
            $line.addClass('radio-line_warning');
        }

        $('<span class="radio-line-time"></span>').text(formatClock(new Date())).appendTo($line);
        $('<span class="radio-line-speaker"></span>').text(transmission.speaker || '').appendTo($line);
        $('<span class="radio-line-text"></span>').text(text).appendTo($line);

        const wasAtEnd = this._isScrolledToEnd();

        this.$log.append($line);

        while (this.$log.children().length > MAXIMUM_LINES) {
            this.$log.children().first().remove();
        }

        if (wasAtEnd) {
            this._scrollToEnd();
        }
    }

    // ------------------------------ PRIVATE ------------------------------

    _bind() {
        this._eventBus.on(EVENT.TOGGLE_RADIO, () => this.toggle());
        this._eventBus.on(EVENT.RADIO_TRANSMISSION, (transmission) => this.addLine(transmission));
        this._radio.subscribe(() => this._renderState());

        this.$element.find('.js-toggle-radio').on('click', () => this.toggle());
        this.$panel.find('.js-radio-close').on('click', () => this.close());
        this.$panel.find('.js-radio-settings').on('click', () => this._eventBus.trigger(EVENT.TOGGLE_AI_SETTINGS));

        this.$panel.find('.js-radio-form').on('submit', (event) => {
            event.preventDefault();

            const text = this.$input.val().trim();

            if (!text) {
                return;
            }

            this._commandHistory.unshift(text);
            this._commandHistoryIndex = -1;
            this.$input.val('');
            this._radio.submit(text, { source: 'text' });
        });

        this.$input.on('keydown', (event) => this._onInputKeydown(event));

        // push to talk: hold the microphone button...
        this.$mic.on('mousedown touchstart', (event) => {
            event.preventDefault();
            this._radio.startListening();
        });
        $(window).on('mouseup touchend', () => {
            if (!this._isHoldingKey) {
                this._radio.stopListening();
            }
        });

        // ...or hold Right Shift from anywhere
        $(window).on('keydown', (event) => {
            if (event.originalEvent.code === PUSH_TO_TALK_CODE && !event.originalEvent.repeat && !this._isHoldingKey) {
                this._isHoldingKey = true;
                this._radio.startListening();
            }
        });
        $(window).on('keyup', (event) => {
            if (event.originalEvent.code === PUSH_TO_TALK_CODE && this._isHoldingKey) {
                this._isHoldingKey = false;
                this._radio.stopListening();
            }
        });
    }

    _onInputKeydown(event) {
        const { code } = event.originalEvent;

        if (code === 'Escape') {
            this.close();

            return;
        }

        if (code === 'ArrowUp' || code === 'ArrowDown') {
            event.preventDefault();

            const step = code === 'ArrowUp' ? 1 : -1;
            const next = Math.max(-1, Math.min(this._commandHistory.length - 1, this._commandHistoryIndex + step));

            this._commandHistoryIndex = next;
            this.$input.val(next === -1 ? '' : this._commandHistory[next]);
        }
    }

    _renderState() {
        const state = this._radio.getState();
        const { microphone } = state;
        const isListening = microphone.state === 'listening';
        const isTranscribing = microphone.state === 'transcribing';
        let status = '';

        this.$mode
            .text(state.mode === 'ai' ? 'AI' : 'BUILT-IN')
            .attr('data-mode', state.mode)
            .attr('title', state.mode === 'ai' ?
                'A language model understands free-form speech and text' :
                'No language model available: standard phraseology is understood. Add an Anthropic key in the settings (cog) for free-form speech.');
        this.$mic.toggleClass('is-listening', isListening).prop('disabled', !state.isMicrophoneSupported);
        this.$panel.toggleClass('is-busy', state.isBusy || isTranscribing);

        if (isListening) {
            status = microphone.interim ? `Hearing: ${microphone.interim}` : 'Listening... let go to send';
        } else if (isTranscribing) {
            status = 'Transcribing...';
        } else if (state.isBusy) {
            status = 'Thinking...';
        } else if (state.isSpeaking) {
            status = 'Pilot is transmitting...';
        } else if (!state.isMicrophoneSupported) {
            status = 'Voice input is not supported in this browser.';
        }

        this.$status.text(status);
    }

    _isScrolledToEnd() {
        const element = this.$log.get(0);

        return element.scrollHeight - element.scrollTop - element.clientHeight < 40;
    }

    _scrollToEnd() {
        this.$log.scrollTop(this.$log.get(0).scrollHeight);
    }
}
