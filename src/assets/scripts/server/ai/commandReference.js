/**
 * The aircraft command language, as shown to the language model
 *
 * Every alias listed here must exist in the client's `aircraftCommandMap` (there is a test that keeps the two
 * in step), and every command defined by the client should have an entry here so the model can use it.
 */

/**
 * `syntax` uses `[value]` for arguments. `say` is the radiotelephony the controller would use.
 */
const COMMANDS = [
    {
        name: 'heading', aliases: ['h', 't', 'fh'], syntax: 't [l|r] [hdg]', say: 'turn left/right heading 270 / fly heading 270', example: 't l 270'
    },
    {
        name: 'turn by degrees', aliases: ['t'], syntax: 't [l|r] [degrees]', say: 'turn left 30 degrees', example: 't l 30'
    },
    {
        name: 'fly present heading', aliases: ['fph'], syntax: 'fph', say: 'fly present heading / continue straight ahead / fly runway heading (departures)', example: 'fph'
    },
    {
        name: 'altitude', aliases: ['c', 'd', 'a'], syntax: 'c|d [alt] [ex]', say: 'climb/descend and maintain 3000 feet / flight level 100 [expedite]; altitude is in HUNDREDS of feet', example: 'd 30'
    },
    {
        name: 'speed', aliases: ['sp', '+', '-'], syntax: 'sp [knots]', say: 'reduce/increase speed 180 knots / maintain 250 knots', example: 'sp 180'
    },
    {
        name: 'direct', aliases: ['pd', 'dct'], syntax: 'pd [fix]', say: 'proceed direct to FIX', example: 'pd DET'
    },
    {
        name: 'hold', aliases: ['hold'], syntax: 'hold [fix] [l|r] [legMin]min [radial]', say: 'hold at FIX (left hand pattern, one minute legs)', example: 'hold DET l 2min'
    },
    {
        name: 'cancel hold', aliases: ['xh', 'continue'], syntax: 'xh [fix]', say: 'cancel the hold / resume own navigation', example: 'xh'
    },
    {
        name: 'ILS', aliases: ['i', 'ils'], syntax: 'i [runway]', say: 'cleared ILS runway 27 approach', example: 'i 27'
    },
    {
        name: 'expect runway', aliases: ['e'], syntax: 'e [runway]', say: 'expect runway 27', example: 'e 27'
    },
    {
        name: 'descend via STAR', aliases: ['dvs'], syntax: 'dvs [alt]', say: 'descend via the STAR [to altitude]', example: 'dvs'
    },
    {
        name: 'climb via SID', aliases: ['cvs'], syntax: 'cvs [alt]', say: 'climb via the SID [to altitude]', example: 'cvs'
    },
    {
        name: 'cleared as filed', aliases: ['caf'], syntax: 'caf', say: 'cleared as filed / ATC clearance (IFR departure clearance)', example: 'caf'
    },
    {
        name: 'SID', aliases: ['sid'], syntax: 'sid [name]', say: 'cleared via the NAME departure', example: 'sid DET2Y'
    },
    {
        name: 'STAR', aliases: ['star'], syntax: 'star [transition.name.airport]', say: 'amend the arrival route to ...', example: 'star MLP.GLASR9.KSEA'
    },
    {
        name: 'route', aliases: ['route', 'rr'], syntax: 'route [dotted route] | rr [full route]', say: 'amend the route / reroute', example: 'route FESKO..RUFUS..CHOIR'
    },
    {
        name: 'cross', aliases: ['x'], syntax: 'x [fix] a[alt] s[speed]', say: 'cross FIX at 5000 feet and 210 knots', example: 'x DET a50 s210'
    },
    {
        name: 'taxi / hold short', aliases: ['taxi', 'w'], syntax: 'taxi [runway] [via TWY ...]', say: 'taxi to and hold short of runway 27 via alpha bravo', example: 'taxi 27 via A B'
    },
    {
        name: 'pushback', aliases: ['push', 'pb'], syntax: 'push', say: 'pushback and start up approved', example: 'push'
    },
    {
        name: 'line up and wait', aliases: ['lineup', 'lu'], syntax: 'lineup', say: 'line up and wait runway 27', example: 'lineup'
    },
    {
        name: 'hold position', aliases: ['hp'], syntax: 'hp', say: 'hold position', example: 'hp'
    },
    {
        name: 'takeoff', aliases: ['to', 'cto'], syntax: 'cto', say: 'cleared for takeoff', example: 'cto'
    },
    {
        name: 'go around', aliases: ['ga'], syntax: 'ga', say: 'go around', example: 'ga'
    },
    {
        name: 'divert', aliases: ['divert', 'dvt'], syntax: 'divert [ICAO]', say: 'divert to Manchester (use the ICAO code, eg EGCC)', example: 'divert EGCC'
    },
    {
        name: 'squawk', aliases: ['sq'], syntax: 'sq [4 octal digits]', say: 'squawk 4521', example: 'sq 4521'
    },
    {
        name: 'say altitude', aliases: ['sa'], syntax: 'sa', say: 'say altitude', example: 'sa'
    },
    {
        name: 'say assigned altitude', aliases: ['saa'], syntax: 'saa', say: 'say assigned altitude', example: 'saa'
    },
    {
        name: 'say heading', aliases: ['sh'], syntax: 'sh', say: 'say heading', example: 'sh'
    },
    {
        name: 'say assigned heading', aliases: ['sah'], syntax: 'sah', say: 'say assigned heading', example: 'sah'
    },
    {
        name: 'say airspeed', aliases: ['si'], syntax: 'si', say: 'say airspeed / say indicated airspeed', example: 'si'
    },
    {
        name: 'say assigned speed', aliases: ['sas'], syntax: 'sas', say: 'say assigned speed', example: 'sas'
    },
    {
        name: 'say route', aliases: ['sr'], syntax: 'sr', say: 'say route / say flight plan', example: 'sr'
    },
    {
        name: 'say fuel', aliases: ['sf'], syntax: 'sf', say: 'say fuel remaining / how much fuel do you have / say endurance', example: 'sf'
    },
    {
        name: 'say souls on board', aliases: ['sob'], syntax: 'sob', say: 'say souls on board / persons on board', example: 'sob'
    },
    {
        name: 'say intentions', aliases: ['sint'], syntax: 'sint', say: 'say intentions / what are your intentions / say request', example: 'sint'
    },
    {
        name: 'say ATIS information', aliases: ['sinfo'], syntax: 'sinfo', say: 'say information / which ATIS do you have', example: 'sinfo'
    },
    {
        name: 'acknowledge', aliases: ['roger'], syntax: 'roger', say: 'roger / copy / acknowledged (answers a pilot request or report)', example: 'roger'
    },
    {
        name: 'refuse request', aliases: ['unable'], syntax: 'unable', say: 'unable / negative / request denied', example: 'unable'
    }
];

/**
 * Every alias the model may produce
 *
 * @function listAliases
 * @return {array<string>}
 */
const listAliases = () => {
    const aliases = new Set();

    COMMANDS.forEach((command) => command.aliases.forEach((alias) => aliases.add(alias)));

    return [...aliases];
};

/**
 * @function renderCommandTable
 * @return {string}
 */
const renderCommandTable = () => COMMANDS
    .map((command) => `- ${command.say}\n    -> \`${command.example}\`   (syntax: ${command.syntax})`)
    .join('\n');

module.exports = {
    COMMANDS,
    listAliases,
    renderCommandTable
};
