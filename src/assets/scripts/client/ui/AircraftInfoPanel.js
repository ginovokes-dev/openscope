import $ from 'jquery';
import EventBus from '../lib/EventBus';
import GameController from '../game/GameController';
import { buildAircraftInfo } from '../aircraft/aircraftActions';
import { getTransitionAltitude } from '../atis/atisGenerator';
import AirportController from '../airport/AirportController';
import { EVENT } from '../constants/eventNames';
import { GAME_OPTION_NAMES } from '../constants/gameOptionConstants';

const REFRESH_INTERVAL_MILLISECONDS = 400;

const PANEL_TEMPLATE = `
    <div id="aircraft-info" class="aircraft-info notSelectable" hidden>
        <div class="aircraft-info-header">
            <div class="aircraft-info-title">
                <span class="aircraft-info-callsign js-ai-callsign"></span>
                <span class="aircraft-info-spoken js-ai-spoken"></span>
            </div>
            <button type="button" class="aircraft-info-close js-ai-close" title="Close">&times;</button>
        </div>
        <div class="aircraft-info-subtitle js-ai-type"></div>
        <div class="aircraft-info-alerts js-ai-alerts"></div>

        <div class="aircraft-info-section">
            <div class="aircraft-info-row"><span>Squawk</span><b class="js-ai-squawk"></b></div>
            <div class="aircraft-info-row"><span>Status</span><b class="js-ai-phase"></b></div>
            <div class="aircraft-info-row"><span>From</span><b class="js-ai-origin"></b></div>
            <div class="aircraft-info-row"><span>To</span><b class="js-ai-destination"></b></div>
            <div class="aircraft-info-row"><span>Alternate</span><b class="js-ai-alternate"></b></div>
            <div class="aircraft-info-row"><span>Route</span><b class="js-ai-route"></b></div>
            <div class="aircraft-info-row"><span>Runway</span><b class="js-ai-runway"></b></div>
        </div>

        <div class="aircraft-info-section">
            <div class="aircraft-info-grid">
                <div><span>ALT</span><b class="js-ai-altitude"></b><i class="js-ai-assigned-altitude"></i></div>
                <div><span>HDG</span><b class="js-ai-heading"></b><i class="js-ai-assigned-heading"></i></div>
                <div><span>IAS</span><b class="js-ai-speed"></b><i class="js-ai-assigned-speed"></i></div>
                <div><span>GS</span><b class="js-ai-ground-speed"></b><i></i></div>
            </div>
            <div class="aircraft-info-row"><span>Position</span><b class="js-ai-position"></b></div>
            <div class="aircraft-info-row"><span>QNH</span><b class="js-ai-qnh"></b></div>
            <div class="aircraft-info-row"><span>ATIS</span><b class="js-ai-atis"></b></div>
        </div>

        <div class="aircraft-info-section js-ai-onboard">
            <div class="aircraft-info-row"><span>Souls on board</span><b class="js-ai-souls"></b></div>
            <div class="aircraft-info-row"><span>Fuel</span><b class="js-ai-fuel"></b></div>
            <div class="aircraft-info-bar"><div class="aircraft-info-bar-fill js-ai-fuel-bar"></div></div>
        </div>

        <div class="aircraft-info-actions">
            <button type="button" class="aircraft-info-button" data-command="sf" title="Say fuel remaining">Fuel?</button>
            <button type="button" class="aircraft-info-button" data-command="sob" title="Say souls on board">Souls?</button>
            <button type="button" class="aircraft-info-button" data-command="sint" title="Say intentions">Intentions?</button>
            <button type="button" class="aircraft-info-button" data-command="sinfo" title="Say which ATIS letter they have">ATIS?</button>
            <button type="button" class="aircraft-info-button js-ai-roger" data-command="roger" title="Acknowledge">Roger</button>
            <button type="button" class="aircraft-info-button js-ai-unable" data-command="unable" title="Deny the request">Unable</button>
            <button type="button" class="aircraft-info-button" data-command="ga" title="Order a go-around">Go around</button>
        </div>
    </div>`;

const formatNumber = (value) => Number(value).toLocaleString('en-GB');

/**
 * Side panel with the full picture of the selected aircraft: flight plan, state, what the pilot has asked
 * for, and what is on board. Updates continuously while open and stays open after commands are issued.
 *
 * @class AircraftInfoPanel
 */
export default class AircraftInfoPanel {
    constructor($element, aircraftController) {
        this.$element = $element;
        this._aircraftController = aircraftController;
        this._eventBus = EventBus;
        this._aircraft = null;
        this._lastRender = 0;
        this.$panel = $(PANEL_TEMPLATE);
        this.$element.append(this.$panel);
        this._find = (selector) => this.$panel.find(selector);
        this._bind();
    }

    isOpen() {
        return !this.$panel.prop('hidden');
    }

    /**
     * Show the panel for an aircraft
     *
     * @for AircraftInfoPanel
     * @method show
     * @param aircraft {AircraftModel}
     */
    show(aircraft) {
        this._aircraft = aircraft;
        this.$panel.prop('hidden', false);
        this._render(true);
    }

    hide() {
        this._aircraft = null;
        this.$panel.prop('hidden', true);
    }

    /**
     * Called every frame; throttled to a few refreshes a second
     *
     * @for AircraftInfoPanel
     * @method update
     */
    update() {
        if (!this._aircraft) {
            return;
        }

        const stillExists = this._aircraftController.aircraft.list.indexOf(this._aircraft) !== -1;

        if (!stillExists) {
            this.hide();

            return;
        }

        this._render(false);
    }

    // ------------------------------ PRIVATE ------------------------------

    _bind() {
        this._eventBus.on(EVENT.SELECT_AIRCRAFT, (aircraft) => this.show(aircraft));
        this._find('.js-ai-close').on('click', () => this.hide());
        this._find('.aircraft-info-button').on('click', (event) => {
            if (!this._aircraft) {
                return;
            }

            const command = $(event.currentTarget).data('command');

            this._eventBus.trigger(EVENT.SUBMIT_COMMAND, `${this._aircraft.callsign} ${command}`);
        });
    }

    _formatAltitude(feet) {
        const transitionAltitude = getTransitionAltitude(AirportController.airport_get().icao);

        if (feet > transitionAltitude) {
            return `FL${String(Math.round(feet / 100)).padStart(3, '0')}`;
        }

        return `${formatNumber(Math.round(feet / 10) * 10)} ft`;
    }

    _formatAirport(entry) {
        if (!entry) {
            return '-';
        }

        const place = entry.city || entry.name || '';

        return place ? `${entry.icao} ${place}` : entry.icao;
    }

    _alerts(info) {
        const alerts = [];

        if (info.emergency) {
            const level = info.emergency.level === 'ADVISORY' ? 'MINIMUM FUEL' : info.emergency.level;

            alerts.push({ text: `${level}: ${info.emergency.reason}`, kind: info.emergency.level === 'MAYDAY' ? 'danger' : 'warn' });
        }

        if (info.isNordo) {
            alerts.push({ text: 'NORDO: no radio, squawking 7600', kind: 'danger' });
        }

        if (info.diversion) {
            alerts.push({ text: `Diverting to ${info.diversion.city || info.diversion.icao} (${info.diversion.icao})`, kind: 'info' });
        }

        if (info.pendingRequest) {
            alerts.push({ text: `Request: ${info.pendingRequest.text}`, kind: 'info' });
        }

        if (info.atisLetterHeard && info.currentAtisLetter && info.atisLetterHeard !== info.currentAtisLetter) {
            alerts.push({ text: `Has old ATIS ${info.atisLetterHeard}; current is ${info.currentAtisLetter}`, kind: 'warn' });
        }

        return alerts;
    }

    _render(force) {
        const now = Date.now();

        if (!force && now - this._lastRender < REFRESH_INTERVAL_MILLISECONDS) {
            return;
        }

        this._lastRender = now;

        const info = buildAircraftInfo(this._aircraft);
        const detail = GameController.game.option.getOptionByName(GAME_OPTION_NAMES.AIRCRAFT_INFO_DETAIL) !== 'standard';
        const find = this._find;

        find('.js-ai-callsign').text(info.callsign);
        find('.js-ai-spoken').text(info.spokenCallsign);
        find('.js-ai-type').text(`${info.typeName} (${info.type}/${info.wakeCategory})  ${info.airlineCallsign ? `- ${info.airlineCallsign}` : ''}`);
        find('.js-ai-squawk').text(info.squawk);
        find('.js-ai-phase').text(`${info.category}, ${info.phaseText}${info.isControllable ? '' : ' (not yet on your frequency)'}`);
        find('.js-ai-origin').text(this._formatAirport(info.origin));
        find('.js-ai-destination').text(this._formatAirport(info.destination));
        find('.js-ai-alternate').text(this._formatAirport(info.alternate));
        find('.js-ai-route').text(info.route || 'vectors');
        find('.js-ai-runway').text(`${info.runway || '-'}${info.hasApproachClearance ? '  (cleared approach)' : ''}`);
        find('.js-ai-altitude').text(this._formatAltitude(info.altitude));
        find('.js-ai-assigned-altitude').text(info.assignedAltitude === null ? '' : `-> ${this._formatAltitude(info.assignedAltitude)}`);
        find('.js-ai-heading').text(String(info.heading).padStart(3, '0'));
        find('.js-ai-assigned-heading').text(info.assignedHeading === null ? '' : `-> ${String(info.assignedHeading).padStart(3, '0')}`);
        find('.js-ai-speed').text(`${info.speed} kt`);
        find('.js-ai-assigned-speed').text(info.assignedSpeed === null ? '' : `-> ${info.assignedSpeed}`);
        find('.js-ai-ground-speed').text(`${info.groundSpeed} kt`);
        find('.js-ai-position').text(`${info.distanceFromAirportNm} nm, bearing ${String(info.bearingFromAirport).padStart(3, '0')}`);
        find('.js-ai-qnh').text(info.qnh === null ? '-' : `${info.qnh} ${info.qnhUnit}`);
        find('.js-ai-atis').text(info.atisLetterHeard ? `has information ${info.atisLetterHeard}` : '-');

        const $onboard = find('.js-ai-onboard');

        $onboard.prop('hidden', !detail || !info.onboard);

        if (detail && info.onboard) {
            const { onboard } = info;

            find('.js-ai-souls').text(`${onboard.souls}  (${onboard.passengers} pax + ${onboard.crew} crew)`);
            find('.js-ai-fuel').text(`${formatNumber(onboard.fuelQuantity)} ${onboard.fuelUnit}  -  ${onboard.enduranceDisplay}`);
            find('.js-ai-fuel-bar')
                .css('width', `${Math.max(2, Math.min(100, onboard.fuelPercent))}%`)
                .attr('data-state', onboard.fuelState);
        }

        const $alerts = find('.js-ai-alerts').empty();

        this._alerts(info).forEach((alert) => {
            $alerts.append($('<div class="aircraft-info-alert"></div>').addClass(`aircraft-info-alert_${alert.kind}`).text(alert.text));
        });

        find('.js-ai-roger, .js-ai-unable').prop('hidden', !info.pendingRequest && !info.emergency);
    }
}
