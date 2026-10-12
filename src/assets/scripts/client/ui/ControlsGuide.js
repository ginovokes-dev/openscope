import $ from 'jquery';
import EventBus from '../lib/EventBus';
import { EVENT } from '../constants/eventNames';
import { SELECTORS } from '../constants/selectors';
import { CONTROLS_GUIDE_SECTIONS } from './controlsGuideContent';

const buildTable = (rows) => {
    const hasCommands = rows.some((row) => row.type);
    const head = hasCommands ?
        '<tr><th>Say</th><th>Or type</th><th></th></tr>' :
        '<tr><th>Key</th><th>What it does</th></tr>';
    const body = rows.map((row) => (hasCommands ?
        `<tr><td class="controls-say">${row.say}</td><td class="controls-type"><code>${row.type}</code></td><td class="controls-note">${row.note || ''}</td></tr>` :
        `<tr><td class="controls-say">${row.say}</td><td class="controls-note">${row.note || ''}</td></tr>`
    )).join('');

    return `<table class="controls-table">${head}${body}</table>`;
};

const buildSection = (section) => {
    const intro = section.intro ? `<p class="controls-intro">${section.intro}</p>` : '';
    const table = section.rows ? buildTable(section.rows) : '';
    const items = section.items ? `<ul class="controls-items">${section.items.map((item) => `<li>${item}</li>`).join('')}</ul>` : '';

    return `<section class="controls-section js-controls-section" data-section="${section.id}" hidden>${intro}${table}${items}</section>`;
};

/**
 * In-game guide to the controls: how to clear departures and arrivals, every command in plain English and as typed,
 * the radio, emergencies and the hotkeys. Opens with F8.
 *
 * @class ControlsGuide
 */
export default class ControlsGuide {
    constructor($element) {
        this.$element = $element;
        this._eventBus = EventBus;

        const tabs = CONTROLS_GUIDE_SECTIONS.map((section) => `<button type="button" class="controls-tab js-controls-tab" data-section="${section.id}">${section.title}</button>`).join('');
        const sections = CONTROLS_GUIDE_SECTIONS.map(buildSection).join('');

        this.$dialog = $(`
            <div id="controls-guide" class="dialog controls-guide captures-keys">
                <p class="dialog-title">Controls</p>
                <div class="controls-tabs">${tabs}</div>
                <div class="controls-body nice-scrollbar">${sections}</div>
                <div class="dialog-footer">F8 opens and closes this guide</div>
            </div>`);
        this.$element.append(this.$dialog);
        this._bind();
        this.showSection(CONTROLS_GUIDE_SECTIONS[0].id);
    }

    isOpen() {
        return this.$dialog.hasClass(SELECTORS.CLASSNAMES.OPEN);
    }

    close() {
        this.$dialog.removeClass(SELECTORS.CLASSNAMES.OPEN);
    }

    toggle() {
        this.$dialog.toggleClass(SELECTORS.CLASSNAMES.OPEN);
    }

    /**
     * @for ControlsGuide
     * @method showSection
     * @param id {string}
     */
    showSection(id) {
        this.$dialog.find('.js-controls-section').each((index, element) => {
            $(element).prop('hidden', $(element).data('section') !== id);
        });
        this.$dialog.find('.js-controls-tab').each((index, element) => {
            $(element).toggleClass('is-selected', $(element).data('section') === id);
        });
        this.$dialog.find('.controls-body').scrollTop(0);
    }

    // ------------------------------ PRIVATE ------------------------------

    _bind() {
        this._eventBus.on(EVENT.TOGGLE_CONTROLS_GUIDE, () => this.toggle());
        this.$element.find('.js-toggle-controls-guide').on('click', () => this.toggle());
        this.$dialog.find('.js-controls-tab').on('click', (event) => this.showSection($(event.currentTarget).data('section')));
    }
}
