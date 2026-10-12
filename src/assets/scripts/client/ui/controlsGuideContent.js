/**
 * Text of the in-game controls guide (F8)
 *
 * Each section is `{ id, title, intro, rows | items }`. Rows have the plain English you could say on the radio, the
 * command-bar command that does the same, and what happens. Keep this in step with documentation/aircraft-commands.md.
 */
export const CONTROLS_GUIDE_SECTIONS = [
    {
        id: 'start',
        title: 'Getting started',
        intro: 'You are the approach and departure controller. Aircraft appear on the radar scope and as strips on the right. ' +
            'Everything you do is an instruction to an aircraft, by typing a command or by talking to it.',
        items: [
            '<b>Select an aircraft</b> by clicking it on the scope or its strip, or with <kbd>PageUp</kbd>/<kbd>PageDown</kbd>. The side panel shows its ' +
                'squawk, route, origin and destination, alternate, QNH, clearances, souls on board and fuel.',
            '<b>Type a command</b> in the bar at the bottom and press <kbd>Enter</kbd>. With an aircraft selected its callsign is filled in for you: ' +
                '<code>BAW123 d 30</code>. Press <kbd>Tab</kbd> to search the command list.',
            '<b>Or talk to it.</b> Press <kbd>F4</kbd> for the radio, then type a sentence or hold <kbd>Right Shift</kbd> and speak: ' +
                '"Speedbird one two three, descend flight level eight zero." Sentences typed in the command bar go to the radio too.',
            '<b>Read the ATIS</b> (<kbd>F3</kbd>), keep it up to date when the weather changes, and expect pilots to quote the information letter they last heard.',
            '<b>Watch the fuel.</b> Aircraft can declare minimum fuel, PAN or MAYDAY, or lose their radio (squawk 7600). Use <code>sf</code> to ask for fuel, ' +
                '<code>divert ICAO</code> to send an aircraft elsewhere. How often it happens is up to you: Settings &rarr; Events.'
        ]
    },
    {
        id: 'departures',
        title: 'Departures',
        intro: 'A departure starts at its stand. The pilot calls for the IFR clearance, and then nothing moves until you say so. In order:',
        rows: [
            { say: 'cleared to destination via the SID, squawk ...', type: 'BAW123 caf', note: 'Accepts the filed flight plan and SID; the pilot reads back destination, SID, runway, initial climb and squawk. Use <code>sid NAME</code> to give a different SID.' },
            { say: 'pushback and start up approved', type: 'BAW123 push', note: 'Optional: the pilot pushes back and calls ready to taxi. <code>taxi</code> from the stand also pushes back.' },
            { say: 'taxi to holding point runway two seven right', type: 'BAW123 taxi 27R', note: 'Taxi to and hold short of the runway along the taxiways (the route is drawn on the ground chart, <kbd>F9</kbd>); larger airports take longer. Name the taxiways to prefer with <code>BAW123 taxi 27R via A B</code>. <code>hp</code> (hold position) stops it, <code>taxi</code> sets it going again.' },
            { say: 'line up and wait runway two seven right', type: 'BAW123 lineup', note: 'Optional (alias <code>lu</code>): moves the aircraft onto the runway, visible on the radar, and holds there.' },
            { say: 'cleared for takeoff', type: 'BAW123 cto', note: 'Also numpad <kbd>/</kbd>. Nothing departs without it, and nothing departs without an IFR clearance. Check the wind in the ATIS first.' },
            { say: 'climb via the SID', type: 'BAW123 cvs', note: 'Climb as the SID says. Without it the aircraft climbs to the initial altitude it was cleared to (<code>BAW123 c 50</code> to change).' },
            { say: 'proceed direct to FIX', type: 'BAW123 pd FIX', note: 'After departure: vector (<code>fh 270</code>), climb (<code>c 100</code>) or route direct. It leaves your airspace at its exit fix.' }
        ]
    },
    {
        id: 'arrivals',
        title: 'Arrivals',
        intro: 'Arrivals come in on a STAR (or straight to a fix) and need to be sequenced, slowed, descended and cleared to land:',
        rows: [
            { say: 'descend via the STAR', type: 'BAW123 dvs', note: 'Follow the STAR\'s altitude and speed restrictions.' },
            { say: 'expect runway two seven right', type: 'BAW123 e 27R', note: 'Tells the pilot which runway to plan for (and which branch of the STAR to fly).' },
            { say: 'descend altitude three thousand feet', type: 'BAW123 d 30', note: 'Altitudes are in hundreds of feet. Flight levels above the transition altitude: <code>d 100</code> = FL100. Add <code>ex</code> to expedite.' },
            { say: 'reduce speed one eight zero', type: 'BAW123 sp 180', note: 'Speed in knots. Numpad <kbd>+</kbd>/<kbd>-</kbd> also work.' },
            { say: 'turn left heading two seven zero', type: 'BAW123 t l 270', note: 'Vector onto the extended centreline. Intercept at 30&deg; or less and below the glidepath.' },
            { say: 'cleared ILS runway two seven right', type: 'BAW123 i 27R', note: 'Also numpad <kbd>*</kbd>. The aircraft intercepts the localizer and glideslope and lands. It leaves frequency by itself.' },
            { say: 'go around', type: 'BAW123 ga', note: 'Climbs on the runway heading (present heading if not yet established) to a safe altitude and waits for you. Use it for a blocked runway or a bad approach.' },
            { say: 'hold at FIX, left, one minute legs', type: 'BAW123 hold FIX l 1min', note: '<code>xh</code> cancels the hold.' }
        ]
    },
    {
        id: 'basics',
        title: 'Heading, altitude, speed',
        rows: [
            { say: 'turn right heading zero nine zero', type: 'BAW123 t r 090', note: 'Left/right is optional: <code>fh 090</code> turns the short way.' },
            { say: 'turn left twenty degrees', type: 'BAW123 t l 20', note: 'One or two digits mean degrees to turn rather than a heading.' },
            { say: 'fly present heading', type: 'BAW123 fph', note: 'Cancel a turn. Before takeoff it means runway heading.' },
            { say: 'climb flight level one two zero', type: 'BAW123 c 120', note: 'c, d, a (altitude) are the same command; the aircraft goes up or down as needed.' },
            { say: 'maintain two five zero knots', type: 'BAW123 sp 250', note: 'Aircraft keep inside their flight envelope and will say <i>unable</i> if you ask too much.' },
            { say: 'squawk four five two one', type: 'BAW123 sq 4521', note: 'Squawk 7700 is a MAYDAY, 7600 a radio failure.' }
        ]
    },
    {
        id: 'routing',
        title: 'Routing',
        rows: [
            { say: 'proceed direct to FIX', type: 'BAW123 pd FIX', note: 'Alias: dct.' },
            { say: 'cross FIX at five thousand and two one zero knots', type: 'BAW123 x FIX a50 s210', note: 'A crossing restriction.' },
            { say: 'amend route', type: 'BAW123 route FIX1..FIX2', note: 'Edit the route; <code>rr</code> replaces it entirely.' },
            { say: 'cleared the NAME departure / arrival', type: 'BAW123 sid NAME', note: 'And <code>star TRANSITION.NAME.ICAO</code> for arrivals.' }
        ]
    },
    {
        id: 'abnormal',
        title: 'Emergencies, fuel & diversions',
        intro: 'Pilots speak up when something is wrong, and the side panel shows it in red or amber. Ask them anything:',
        rows: [
            { say: 'say fuel remaining / how much fuel do you have', type: 'BAW123 sf', note: 'Endurance in hours and minutes, plus the quantity, and whether the aircraft is at minimum fuel or in a fuel emergency.' },
            { say: 'say persons on board', type: 'BAW123 sob', note: 'Souls on board (passengers and crew).' },
            { say: 'say intentions', type: 'BAW123 sint', note: 'Repeats what the pilot has asked for.' },
            { say: 'say which information you have', type: 'BAW123 sinfo', note: 'The ATIS letter they hold. Update the ATIS if they have an old one.' },
            { say: 'roger / unable', type: 'BAW123 roger | BAW123 unable', note: 'Acknowledge a call, or turn a request down (they carry on as planned). To <i>grant</i> a request, just give the instruction, eg. <code>pd FIX</code>.' },
            { say: 'divert to Manchester', type: 'BAW123 divert EGCC', note: 'Any airport worldwide. The pilot checks fuel and runway length and tells you if it cannot reach it.' }
        ],
        items: [
            'Fuel runs down in real time. At about 35 minutes the pilot declares <b>minimum fuel</b> (an advisory: no priority yet, but no delays), ' +
                'at about 15 minutes a <b>fuel emergency</b> (squawk 7700), and an aircraft that runs dry crashes. Give them priority and land them, or divert them.',
            'Other events: medical emergencies, engine failure, smoke, loss of pressurisation, bird strike (reduced performance), radio failure (squawk 7600, ' +
                'no answers), windshear and operational go-arounds, weather diversion requests and requests for direct routings, altitudes or runways. ' +
                'Choose how often they occur under <b>Settings</b> (failure frequency, plus a switch per category).'
        ]
    },
    {
        id: 'radio',
        title: 'Radio & voice',
        intro: 'Free-form talking, as you would to a real pilot. Press <kbd>F4</kbd> for the radio panel.',
        items: [
            '<b>Say anything.</b> With an Anthropic key the language model understands any phrasing: "Speedbird one two three, can you give me a ' +
                'fuel state and report the airport in sight", "Speedbird one two three and Easy six four alpha, reduce speed two one zero", "go around, traffic on the runway". ' +
                'Without a key, standard phraseology is understood by the built-in matcher.',
            '<b>Talk by voice.</b> Hold <kbd>Right Shift</kbd> (or the microphone button), speak, and let go. Pilots answer aloud when the speaker button ' +
                'in the footer is on. With an ElevenLabs key every pilot has their own voice and accent; without one the browser\'s voices are used.',
            '<b>Name the aircraft first</b> ("Easy six four alpha, ..."), or select it and just give the instruction.',
            '<b>Set it up</b> under the cog in the radio panel (keys are kept in your browser), or put <code>ANTHROPIC_API_KEY</code> and ' +
                '<code>ELEVENLABS_API_KEY</code> in a <code>.env</code> file next to the server.'
        ]
    },
    {
        id: 'keys',
        title: 'Keys & mouse',
        rows: [
            { say: 'Click an aircraft', type: '', note: 'Select it. Click empty scope to deselect. Click and drag to pan, wheel to zoom.' },
            { say: 'PageUp / PageDown, &uarr; / &darr;', type: '', note: 'Select the previous or next aircraft.' },
            { say: 'Tab', type: '', note: 'Command search and autocomplete.' },
            { say: 'Esc', type: '', note: 'Close dialogs, then deselect.' },
            { say: 'F1 / F2', type: '', note: 'Shorten / lengthen the predicted track line.' },
            { say: 'F3', type: '', note: 'ATIS: read, update and edit.' },
            { say: 'F4', type: '', note: 'Radio panel: type or speak to pilots.' },
            { say: 'Right Shift (hold)', type: '', note: 'Push to talk from anywhere.' },
            { say: 'F6', type: '', note: 'SIDs and STARs: list, highlight, assign.' },
            { say: 'F9', type: '', note: 'Ground chart: taxiways, stands and holding points. It also appears by itself when you zoom in on the airfield; zoom with the wheel, click a taxiing aircraft to select it.' },
            { say: 'F8', type: '', note: 'This guide.' },
            { say: 'Numpad / * + -', type: '', note: 'Insert takeoff, ILS, speed up and speed down.' },
            { say: '` (backquote)', type: '', note: 'Switch between aircraft commands and scope commands.' }
        ]
    }
];
