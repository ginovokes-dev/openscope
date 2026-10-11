import $ from 'jquery';
import AirportController from '../airport/AirportController';
import AtisController from './AtisController';
import EventBus from '../lib/EventBus';
import { EVENT } from '../constants/eventNames';
import { SELECTORS } from '../constants/selectors';

const PANEL_TEMPLATE = `
    <div id="atis-panel" class="dialog atis-panel">
        <p class="dialog-title">ATIS <span class="atis-airport js-atis-airport"></span></p>
        <div class="atis-header">
            <span class="atis-letter js-atis-letter"></span>
            <span class="atis-time js-atis-time"></span>
            <span class="atis-badge js-atis-badge" hidden>UPDATE DUE</span>
        </div>
        <pre class="atis-text nice-scrollbar js-atis-text"></pre>
        <div class="atis-buttons">
            <button type="button" class="atis-button js-atis-update"
                title="Issue a new information letter from current conditions">Update ATIS</button>
            <button type="button" class="atis-button js-atis-speak" title="Hear the ATIS broadcast">Read aloud</button>
            <button type="button" class="atis-button js-atis-edit" title="Change runway, approach or remarks">Edit...</button>
        </div>
        <form class="atis-editor js-atis-editor" hidden>
            <div class="form-element">
                <span class="form-label">Arrival runway</span>
                <span class="form-type-select"><select class="js-atis-arrival"></select></span>
            </div>
            <div class="form-element">
                <span class="form-label">Departure runway</span>
                <span class="form-type-select"><select class="js-atis-departure"></select></span>
            </div>
            <p class="atis-note js-atis-runway-note" hidden>
                Traffic at this airport follows scripted procedures for its current runway, so runways cannot be changed.
            </p>
            <div class="form-element">
                <span class="form-label">Expected approach</span>
                <span class="form-type-select">
                    <select class="js-atis-approach">
                        <option value="ILS">ILS</option>
                        <option value="visual">Visual</option>
                        <option value="RNAV">RNAV (GNSS)</option>
                        <option value="">None announced</option>
                    </select>
                </span>
            </div>
            <div class="form-element">
                <span class="form-label">ATIS type</span>
                <span class="form-type-select">
                    <select class="js-atis-type">
                        <option value="combined">Combined</option>
                        <option value="arrival">Arrival</option>
                        <option value="departure">Departure</option>
                    </select>
                </span>
            </div>
            <label class="atis-remarks-label">Remarks and NOTAMs (one per line)
                <textarea class="atis-remarks js-atis-remarks" rows="3"
                    placeholder="e.g. Taxiway Bravo closed between Bravo 2 and Bravo 4"></textarea>
            </label>
            <div class="atis-buttons">
                <button type="submit" class="atis-button js-atis-issue">Issue new ATIS</button>
            </div>
        </form>
        <div class="dialog-footer js-atis-footer"></div>
    </div>`;

/**
 * The ATIS dialog: shows the current broadcast, lets the player issue updates and edit its content
 *
 * @class AtisPanel
 */
export default class AtisPanel {
    constructor($element) {
        this.$element = $element;
        this._eventBus = EventBus;
        this.$panel = $(PANEL_TEMPLATE);
        this.$airport = this.$panel.find('.js-atis-airport');
        this.$letter = this.$panel.find('.js-atis-letter');
        this.$time = this.$panel.find('.js-atis-time');
        this.$badge = this.$panel.find('.js-atis-badge');
        this.$text = this.$panel.find('.js-atis-text');
        this.$editor = this.$panel.find('.js-atis-editor');
        this.$footer = this.$panel.find('.js-atis-footer');

        this.$element.append(this.$panel);
        this._bind();
        this.render();
    }

    isOpen() {
        return this.$panel.hasClass(SELECTORS.CLASSNAMES.OPEN);
    }

    toggle() {
        this.$panel.toggleClass(SELECTORS.CLASSNAMES.OPEN);

        if (this.isOpen()) {
            this.render();
        }
    }

    close() {
        this.$panel.removeClass(SELECTORS.CLASSNAMES.OPEN);
    }

    /**
     * Refresh the displayed broadcast
     *
     * @for AtisPanel
     * @method render
     */
    render() {
        const atis = AtisController.getCurrent();
        const airport = AirportController.airport_get();

        if (!atis || !airport) {
            return;
        }

        this.$airport.text(`${airport.icao.toUpperCase()}`);
        this.$letter.text(`INFORMATION ${atis.letter}`);
        this.$time.text(`${atis.timeZ} UTC`);
        this.$text.text(atis.written);
        this.$badge.prop('hidden', !AtisController.isUpdateDue());
        this.$footer.text(AtisController.isAutomatic() ?
            'Automatic updates: a new letter is issued when conditions change (and every 30 minutes).' :
            'Manual updates: issue each new letter yourself. Pilots quote the last broadcast.');
    }

    _bind() {
        this._eventBus.on(EVENT.ATIS_UPDATED, () => this.render());
        this._eventBus.on(EVENT.ATIS_UPDATE_DUE, () => this.render());
        this._eventBus.on(EVENT.TOGGLE_ATIS, () => this.toggle());
        this.$element.find('.js-toggle-atis').on('click', () => this.toggle());

        this.$panel.find('.js-atis-update').on('click', () => {
            AtisController.issueUpdate();
        });

        this.$panel.find('.js-atis-speak').on('click', () => {
            const atis = AtisController.getCurrent();

            if (atis) {
                this._eventBus.trigger(EVENT.RADIO_TRANSMISSION, { kind: 'atis', speaker: 'ATIS', text: atis.spoken });
            }
        });

        this.$panel.find('.js-atis-edit').on('click', () => this._toggleEditor());

        this.$editor.on('submit', (event) => {
            event.preventDefault();
            this._submitEdit();
        });
    }

    _toggleEditor() {
        const shouldOpen = this.$editor.prop('hidden');

        this.$editor.prop('hidden', !shouldOpen);

        if (shouldOpen) {
            this._populateEditor();
        }
    }

    _populateEditor() {
        const state = AtisController.getEditableState();
        const $arrival = this.$panel.find('.js-atis-arrival');
        const $departure = this.$panel.find('.js-atis-departure');
        const options = state.runwayNames.map((name) => `<option value="${name}">${name}</option>`).join('');

        $arrival.html(options).val(state.arrivalRunway);
        $departure.html(options).val(state.departureRunway);
        $arrival.prop('disabled', !state.canChangeRunway);
        $departure.prop('disabled', !state.canChangeRunway);
        this.$panel.find('.js-atis-runway-note').prop('hidden', state.canChangeRunway);
        this.$panel.find('.js-atis-approach').val(state.approachType);
        this.$panel.find('.js-atis-type').val(state.type);
        this.$panel.find('.js-atis-remarks').val(state.remarks);
    }

    _submitEdit() {
        AtisController.applyEdit({
            arrivalRunway: this.$panel.find('.js-atis-arrival').val(),
            departureRunway: this.$panel.find('.js-atis-departure').val(),
            approachType: this.$panel.find('.js-atis-approach').val(),
            type: this.$panel.find('.js-atis-type').val(),
            remarks: this.$panel.find('.js-atis-remarks').val()
        });
        this.$editor.prop('hidden', true);
    }
}
