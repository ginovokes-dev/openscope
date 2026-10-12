import $ from 'jquery';
import AirportController from '../airport/AirportController';
import EventBus from '../lib/EventBus';
import NavigationLibrary from '../navigationLibrary/NavigationLibrary';
import { EVENT } from '../constants/eventNames';
import { PROCEDURE_TYPE } from '../constants/routeConstants';
import { SELECTORS } from '../constants/selectors';

const PANEL_TEMPLATE = `
    <div id="procedures-panel" class="procedures-panel captures-keys notSelectable">
        <div class="procedures-header">
            <span class="procedures-title">SIDs &amp; STARs</span>
            <button type="button" class="procedures-close js-procedures-close" title="Close (F6)">&times;</button>
        </div>
        <div class="procedures-switches">
            <label><input type="checkbox" class="js-procedures-sids"> Show SIDs</label>
            <label><input type="checkbox" class="js-procedures-stars"> Show STARs</label>
        </div>
        <div class="procedures-body nice-scrollbar js-procedures-body"></div>
        <div class="procedures-hint js-procedures-hint"></div>
    </div>`;

const runwayOf = (key, icao) => key.replace(icao, '');

/**
 * List of every SID and STAR at the airport. Click one to see it highlighted on the radar; with a departure
 * selected, click "Clear" next to a SID to give it that departure.
 *
 * @class ProceduresPanel
 */
export default class ProceduresPanel {
    constructor($element, getSelectedAircraft, executeCommandText) {
        this.$element = $element;
        this._getSelectedAircraft = getSelectedAircraft;
        this._executeCommandText = executeCommandText;
        this._highlighted = null;
        this.$panel = $(PANEL_TEMPLATE);
        this.$body = this.$panel.find('.js-procedures-body');
        this.$hint = this.$panel.find('.js-procedures-hint');
        this.$element.append(this.$panel);
        this._bind();
    }

    isOpen() {
        return this.$panel.hasClass(SELECTORS.CLASSNAMES.OPEN);
    }

    close() {
        this.$panel.removeClass(SELECTORS.CLASSNAMES.OPEN);
        this._highlight(null);
    }

    toggle() {
        if (this.isOpen()) {
            this.close();

            return;
        }

        this.render();
        this.$panel.addClass(SELECTORS.CLASSNAMES.OPEN);
    }

    /**
     * Rebuild the list for the current airport
     *
     * @for ProceduresPanel
     * @method render
     */
    render() {
        const airport = AirportController.airport_get();
        const icao = airport.icao.toUpperCase();
        const sids = NavigationLibrary.getProceduresByType(PROCEDURE_TYPE.SID);
        const stars = NavigationLibrary.getProceduresByType(PROCEDURE_TYPE.STAR);

        this.$body.empty();
        this._section('Departures (SIDs)', sids, icao, true);
        this._section('Arrivals (STARs)', stars, icao, false);

        if (sids.length === 0 && stars.length === 0) {
            this.$body.append('<p class="procedures-empty">This airport has no published procedures; use vectors and direct-to.</p>');
        }

        this.$panel.find('.js-procedures-sids').prop('checked', this._optionIsOn('drawSids'));
        this.$panel.find('.js-procedures-stars').prop('checked', this._optionIsOn('drawStars'));
        this._updateHint();
    }

    // ------------------------------ PRIVATE ------------------------------

    _optionIsOn(name) {
        return this._getOption(name) !== 'no';
    }

    _getOption(name) {
        return this._options ? this._options.getOptionByName(name) : 'yes';
    }

    setOptions(options) {
        this._options = options;
    }

    _section(title, procedures, icao, isSid) {
        if (procedures.length === 0) {
            return;
        }

        const $section = $('<div class="procedures-section"></div>');

        $('<div class="procedures-section-title"></div>').text(title).appendTo($section);

        procedures
            .slice()
            .sort((a, b) => a.icao.localeCompare(b.icao))
            .forEach((procedure) => {
                const fixes = isSid ? procedure.exitNames : procedure.entryNames;
                const runways = (isSid ? procedure.entryNames : procedure.exitNames).map((key) => runwayOf(key, icao));
                const $row = $('<div class="procedures-row"></div>').attr('data-id', procedure.icao);
                const $label = $('<div class="procedures-label"></div>');

                $('<span class="procedures-id"></span>').text(procedure.icao).appendTo($label);
                $('<span class="procedures-name"></span>').text(procedure.name).appendTo($label);
                $('<span class="procedures-detail"></span>')
                    .text(`${isSid ? 'to' : 'from'} ${fixes.join(', ')}  |  rwy ${runways.join(' ')}`)
                    .appendTo($label);
                $row.append($label);

                if (isSid) {
                    $('<button type="button" class="procedures-assign js-procedures-assign" title="Clear the selected departure via this SID">Clear</button>')
                        .attr('data-id', procedure.icao)
                        .appendTo($row);
                }

                $section.append($row);
            });

        this.$body.append($section);
    }

    _highlight(id) {
        this._highlighted = id;
        this.$body.find('.procedures-row').each((index, row) => {
            $(row).toggleClass('is-highlighted', $(row).data('id') === id);
        });
        EventBus.trigger(EVENT.HIGHLIGHT_PROCEDURE, id);
    }

    _updateHint() {
        const aircraft = this._getSelectedAircraft();
        const canAssign = Boolean(aircraft) && aircraft.category === 'departure' && aircraft.flightPhase === 'APRON';

        this.$body.find('.js-procedures-assign').prop('disabled', !canAssign);
        this.$hint.text(canAssign ?
            `Click Clear to give ${aircraft.callsign} a SID. Click a row to highlight it on the radar.` :
            'Click a row to highlight it on the radar. Select a departure at its stand to assign a SID.');
    }

    _bind() {
        EventBus.on(EVENT.TOGGLE_PROCEDURES, () => this.toggle());
        EventBus.on(EVENT.AIRPORT_CHANGE, () => {
            this._highlight(null);

            if (this.isOpen()) {
                this.render();
            }
        });
        EventBus.on(EVENT.SELECT_AIRCRAFT, () => this._updateHint());
        EventBus.on(EVENT.DESELECT_AIRCRAFT, () => this._updateHint());

        this.$element.find('.js-toggle-procedures').on('click', () => this.toggle());
        this.$panel.find('.js-procedures-close').on('click', () => this.close());
        this.$panel.on('click', '.procedures-row', (event) => {
            if ($(event.target).closest('.js-procedures-assign').length > 0) {
                return;
            }

            const id = $(event.currentTarget).data('id');

            this._highlight(this._highlighted === id ? null : id);
        });
        this.$panel.on('click', '.js-procedures-assign', (event) => {
            const aircraft = this._getSelectedAircraft();

            if (aircraft) {
                this._executeCommandText(`${aircraft.callsign} sid ${$(event.currentTarget).data('id')}`);
            }
        });
        this.$panel.find('.js-procedures-sids').on('change', (event) => this._setOption('drawSids', event.currentTarget.checked));
        this.$panel.find('.js-procedures-stars').on('change', (event) => this._setOption('drawStars', event.currentTarget.checked));
    }

    _setOption(name, isOn) {
        if (this._options) {
            this._options.setOptionByName(name, isOn ? 'yes' : 'no');
        }
    }
}
