# Simulation features

This page describes the realism, events, radio and voice features added on top of the original openScope
simulation, how to configure them, and what they do not do.

- [Playing: the controls guide](#playing-the-controls-guide)
- [Airports](#airports)
- [Traffic and aircraft](#traffic-and-aircraft)
- [Weather and the ATIS](#weather-and-the-atis)
- [Failures, emergencies and fuel](#failures-emergencies-and-fuel)
- [The aircraft panel](#the-aircraft-panel)
- [The radar: procedures, traffic level and readability](#the-radar-procedures-traffic-level-and-readability)
- [Departures and the ground chart](#departures-and-the-ground-chart)
- [Typing and talking in plain words](#typing-and-talking-in-plain-words)
- [Radio: free-form text and voice](#radio-free-form-text-and-voice)
- [Setting up the AI and voice features](#setting-up-the-ai-and-voice-features)
- [Settings reference](#settings-reference)
- [Limitations and what is not done yet](#limitations-and-what-is-not-done-yet)

## Playing: the controls guide

Press `F8` (or the controls button in the footer) for the in-game controls guide. It shows, for departures
and arrivals, the order in which to clear an aircraft, and every command in plain English next to the command that does it.
The full command reference is in [aircraft-commands.md](aircraft-commands.md).

A normal departure is `caf` (cleared as filed; the pilot has asked for it), optionally `push`, `taxi [runway]`, optionally `lineup`, then `cto` (cleared for takeoff), and `cvs` (climb via SID).
A normal arrival is `dvs` or altitude and speed instructions, `e [runway]`, vectors, and `i [runway]` (cleared ILS).

## Airports

885 airports can be played (65 from the original project and 820 generated). The airport switcher searches by name, ICAO or IATA code, city and country
("liverpool", "lpl", "united kingdom").

- 65 airports are the hand-authored files from the original project (for example KSEA, KLAX and EGCC).
- 820 are **generated** by [`tools/data-pipeline`](../tools/data-pipeline/README.md) from the public-domain OurAirports data and
  the OpenFlights route table: real runways and elevations, controller frequencies, airspace sized to the airport, exit gates named
  after real navaids, and traffic from the airline and city pairs that actually fly there. Every file carries `"_generated": true`.
- Every UK airport with scheduled service is included, plus the main UK business and general aviation airports (Biggin Hill,
  Farnborough, Northolt, Oxford, Cranfield ...). Heathrow, Gatwick and London City were disabled in the original project because their
  files used an obsolete format; they are now regenerated.
- A worldwide airport index (`assets/airports/airportIndex.json`, about 6,000 airports) provides names, cities and positions for every
  origin, destination and diversion airport.

Generated airports do **not** have official procedures: SIDs and STARs are generated routes between each runway and the gates (named
after nearby navaids; the STARs fan in from every gate and join a final approach fix on each runway, the SIDs leave on a track that
suits the gate), ILS availability is inferred from the runway data, and transition altitudes are regional defaults. Departure routes
that make no sense for a runway are not offered for it. They are for training and fun, not for navigation. See [data-sources.md](data-sources.md) for the data licences and attribution.

## Traffic and aircraft

- Aircraft types are matched to runways. The longest runway must be at least 75% of the larger of the type's takeoff and landing distance, with
  floors for the biggest aircraft (an A380 needs at least 3,000 m), and light/medium/large caps for small airports. So Liverpool (2,285 m) sees A320s, 737s, ATRs and
  the occasional business jet, and Manchester sees internationals including 787s, A330s and 777s.
- Airline fleets are weighted (a carrier's workhorse type appears more often than its rare types), and any ICAO aircraft type can be used as a fleet entry in a spawn pattern.
- There are 740 airlines with their real telephony callsigns ("Speedbird", "Easy", "Ryanair", "Shamrock").
- Each aircraft type has a `profile` (typical seats, fuel burn, fuel capacity) which drives the souls on board and the fuel remaining; see [aircraft-format.md](aircraft-format.md).

## Weather and the ATIS

The wind, visibility, cloud, temperature and QNH drift through realistic regimes (CAVOK to fog, showers, storms, snow) rather than staying constant.
Takeoff and landing winds therefore change during a session. **Settings → Weather changes** sets how lively it is, from *Static* (the airport file's wind) to *Severe*.

Each airport has a generated ATIS in the ICAO/UK order (information letter, time, runway in use, transition level, wind, visibility, cloud, temperature, QNH,
remarks), with US airports using US units. Press `F3`:

- **Update ATIS** issues a new information letter from current conditions.
- **Edit...** lets you change the runway in use, the expected approach, the ATIS type and add your own remarks and NOTAMs.
- **Read aloud** speaks it, as the broadcast would sound.

With **Settings → ATIS updates = Manual** you issue every update yourself, and pilots who called in on an old letter say so.

## Failures, emergencies and fuel

Aircraft burn fuel in real time. The failure rate is a setting (**Settings → Failures and emergencies**): Off, Rare (about one event an hour, the default),
Occasional, Frequent or Chaos, with a switch for each category (fuel, medical, technical, weather, pilot requests, traffic).

Events include: low fuel (minimum fuel advisory, then MAYDAY fuel), medical emergencies, engine failure, smoke, loss of pressurisation, bird strike,
radio failure (squawk 7600, the aircraft stops answering), windshear and operational go-arounds, weather diversion requests and requests for direct routings,
altitudes or runways. Emergencies squawk 7700 and the aircraft panel shows them.

Handling an emergency well earns a bonus; an aircraft that runs out of fuel crashes and costs you a large penalty. Use `sf` for fuel state, `divert [ICAO]` to send an
aircraft elsewhere, `roger` and `unable` to answer requests.

## The aircraft panel

Click an aircraft (or select it with PageUp/PageDown). The side panel shows the callsign and its spoken form, type, squawk, status, origin, destination,
alternate, route, runway, altitude/heading/speed with their assigned values, position relative to the airport, QNH, the ATIS letter the pilot holds, souls on board and
fuel remaining with endurance, any emergency or pending request, and buttons for the common queries. **Settings → Aircraft info panel detail = Standard** hides the
souls and fuel lines (a real controller would have to ask), for a harder game.

## The radar: procedures, traffic level and readability

- **SIDs and STARs are drawn and labelled by default** (blue departure routes, orange arrival routes), tied to the runway they belong to: when the ATIS
  runway changes, only the routes for the runway in use stand out. Switch them off in Settings → Radar, from the footer buttons, or by saying "hide the SIDs".
- **`F6` opens the procedures list** (also a footer button): every SID and STAR of the airport with its runways and gates. Hover or click a row to highlight it on the radar;
  with an aircraft selected, a button assigns the procedure to it.
- Airports are drawn with a ring and their identifier, neighbouring airports are shown as small markers with their codes, and the coastline is drawn behind the radar
  at generated airports, so it is easy to see where you are. Runway lines are thicker the further you zoom in.
- **Traffic level** (Settings → Traffic, or "make it quieter / busier"): *Quiet*, *Medium* (default), *Busy* and *Rush hour*. The level scales how often aircraft are
  generated and caps how many arrivals can be in the airspace at once, how close together they come, and how many departures can queue, so the radar is never flooded.
- Departures wait for you by default: nothing takes off or even taxis until you clear it (Settings → Departures → *Tower controller*: *You* by default, *Automatic* to
  restore the original behaviour of departures lining up and departing by themselves).

## Departures and the ground chart

**The sequence.** A departure appears at a stand. After a short while the pilot calls Delivery: *"Seattle Delivery, UAL8 at the stand, request IFR clearance to Reno,
information victor, expecting runway 16L"*. Then:

| You say / type | What happens |
|---|---|
| `caf` (or `sid NAME`) | IFR clearance. The pilot reads back destination, SID, runway, initial climb and squawk |
| `push` | Pushback and start-up approved. The pilot calls "ready to taxi" a little later. Optional: `taxi` from the stand pushes back too |
| `taxi 16L` or `taxi 16L via A B` | The aircraft taxis along the routed taxiways (about 20 knots; larger airports take longer) to the holding point of that runway and calls ready for departure |
| `hp` | Hold position. `taxi` sets the aircraft going again |
| `lineup` | Line up and wait: the aircraft moves onto the runway and shows on the radar. Optional |
| `cto` | Cleared for takeoff. Nothing departs without it, and without an IFR clearance the pilot refuses |

Everything also works as plain words ("Speedbird one two three, taxi to holding point runway two seven right via alpha bravo"), and the aircraft panel has a button per step with the sensible next one highlighted.
Departures from hand-made airports that file no destination are given a plausible one in the direction their SID leaves the airspace.

**The ground chart** (`F9`, the footer button, "open the ground chart", or just zoom in on the airfield) shows the aprons, terminal, taxiways with their names, stands, holding-position bars,
runway surfaces, the aircraft on the ground (click one to select it) and the route of the selected aircraft. The layout comes from:

1. **OpenStreetMap** (the real thing), fetched by the browser from the Overpass API the first time an airport is opened and cached for 90 days; or
2. a **generated schematic**: a parallel taxiway with connectors for every runway, one apron with a terminal and stands. It is clearly labelled as generated.
   It is used immediately, while the real layout loads, when offline, when the airport is not mapped in OpenStreetMap, or when Settings → Ground → *Airport ground layout* is *Generated schematic only*.

Taxi routes are found by A* over the taxiway graph (gaps in OpenStreetMap data of up to 80 m are bridged), and naming taxiways in `taxi ... via` makes the route prefer them.
The chart legend credits OpenStreetMap contributors (ODbL) whenever its data is shown; see [data-sources.md](data-sources.md).

## Typing and talking in plain words

You can type in the command bar or the radio panel, or speak, instead of learning the commands. The command bar sends anything that is not a command to the radio.

- Shorthand: after the callsign, the one-letter commands need no space and can be chained: `d20` (descend 2,000 ft), `c30`, `h270` (fly heading 270), `s210` (speed 210), `d20 s210 h270`. Say "Speedbird one two three, d twenty" or "dee twenty" - it works spoken too.
- Aircraft: "Speedbird one two three, descend flight level eight zero", "the center flight level zero five zero" (a typical mis-hearing of "descend flight level 050" - it is repaired),
  "cleared to Dublin via the Daventry departure, squawk four seven two one", "line up and wait", "hold position".
- The application: "open the ATIS", "give me the latest information", "update the ATIS", "what is the wind", "which runway is in use", "hide the SIDs", "show the stars",
  "open the ground chart", "open settings", "make it quieter", "rush hour", "switch to Manchester", "zoom in", "pause", "speed up time".
- Speech is repaired before it is interpreted: known mis-hearings of phraseology ("heating" → "heading", "for" between digits → "four"), words close to a callsign or a fix that exists right now,
  and "speed bird" → "speedbird". The browser recogniser is asked for several alternatives and the one that reads most like an ATC call is used; ElevenLabs speech-to-text is used when a key is set.
- With an Anthropic key the language model also gets the application actions as part of its answer, so any phrasing works; without one the built-in matcher handles the phrases above.

## Radio: free-form text and voice

Press `F4` for the radio panel. Type a transmission and press Enter, or hold the microphone button (or **Right Shift**, from anywhere) and speak.
Any sentence typed in the command bar that is not a command is sent to the radio.

- **With an Anthropic API key**, a language model reads what you said together with the live state of the airport, the weather, the ATIS and every aircraft, works out which aircraft
  you are talking to, and returns the simulator commands to carry out plus, where there is no command for it, what the pilot would say. It is told to use the sim's own readbacks and exact figures (fuel, souls, altitude)
  rather than inventing them, and everything it returns is validated against the aircraft that exist and the command grammar.
  Anything can be said: "say fuel remaining", "go around, traffic on the runway", "Speedbird one two three, how much fuel do you have and report the field in sight".
- **Without a key**, a built-in phrase matcher understands standard phraseology (headings, altitudes, speeds, ILS, direct, hold, go around, takeoff, taxi, squawk, divert and the "say..." queries),
  numbers spoken as digits ("two seven zero", "three thousand five hundred"), and NATO letters.
- **Speech output.** Turn on the speaker button in the footer. With an ElevenLabs key each pilot gets a stable voice, chosen from the callsign (with an accent that suits the airline
  when your account has voices labelled with accents), played through a radio band-pass filter and squelch. Without a key the browser's own voices are used.
- **Speech input.** With an ElevenLabs key your recording is transcribed by ElevenLabs speech-to-text. Without one, the browser's own speech recognition is used (Chrome, Edge and Safari).

Everything goes through the same command path as typing, so scoring, validation and readbacks are identical.

## Setting up the AI and voice features

The features work without any keys (see above). To enable the language model and studio voices, either:

1. Copy `.env.example` to `.env` next to where you start the server and fill in `ANTHROPIC_API_KEY` and/or `ELEVENLABS_API_KEY`, then `npm run start`. The startup message says what is enabled.
2. Or open the radio panel, press the cog (**AI & Voice**) and paste the keys. They are stored in your browser only and are sent as headers to the server you are playing on.

Optional settings (also in `.env`): `ATC_LLM_MODEL` (default `claude-opus-5-5`; a smaller model is faster and cheaper), `ATC_LLM_EFFORT`, `ELEVENLABS_VOICE_IDS`, `ELEVENLABS_BASE_URL`, `ANTHROPIC_BASE_URL`.

The server exposes `GET /api/status`, `POST /api/atc/interpret`, `POST /api/atc/notams`, `POST /api/voice/tts` and `POST /api/voice/stt`. They are rate limited per client address. If you expose the server beyond your own machine,
put the keys in the browser dialog rather than the server's `.env`, or the server will spend your keys on behalf of anyone who can reach it. Each radio call sends the state of the simulation (not personal data) to Anthropic, and each spoken
reply sends its text to ElevenLabs.

## Settings reference

Open the settings (cog in the footer). New settings:

| Group | Setting | Values |
|---|---|---|
| Weather and ATIS | Weather changes | Static, Calm, Normal, Lively, Severe |
| Weather and ATIS | ATIS updates | Automatic, Manual |
| Failures and events | Failures and emergencies | Off, Rare, Occasional, Frequent, Chaos |
| Failures and events | Low fuel, Medical, Technical, Weather, Pilot requests, Traffic | On, Off (each) |
| Aircraft information | Aircraft info panel detail | Full (default), Standard |
| Aircraft information | Fuel units | Kilograms, Pounds |
| Departures | Tower controller | You (default), Automatic |
| Traffic | How busy is the airport | Quiet, Medium (default), Busy, Rush hour |
| Radar | Show SIDs, Show STARs | Yes (default), No |
| Ground | Airport ground layout | Real (OpenStreetMap), else generated (default); Generated schematic only |

## Limitations and what is not done yet

- **Delivery and ground are played by you through the same commands**: there are no separate delivery, ground and tower frequencies, but the pilots do call Delivery, Ground and Tower by name and the whole sequence
  (clearance, pushback, taxi, line up, takeoff) is there. Arrivals still disappear on landing; they do not vacate and taxi to a stand. Pushback is a timer, not a movement. Taxiing aircraft do not
  give way to each other or stop for runway crossings.
- **The real ground layouts could not be tested against live OpenStreetMap data** where this was developed (only GitHub and the npm registry were reachable): the fetch, parsing, routing, caching and
  drawing were tested with a synthetic Overpass response and the unit tests. Real airports differ (taxiways mapped in pieces, missing stands, differently tagged holding positions), so the layout code
  bridges gaps, derives stands from aprons or dead ends and picks holding points from the network when they are not mapped. If a real airport looks wrong, set *Airport ground layout* to *Generated schematic only*.
- The live language model and ElevenLabs integrations have been tested against recorded/faked servers and the unit tests, not exercised with real keys during development.
- Generated airports have no real SIDs/STARs, approach charts or transition altitudes (see [Airports](#airports)); the OpenFlights route table is a 2014 snapshot, so some airline and route pairings are out of date.
- Changing the runway in use (ATIS editor) is only possible at airports whose traffic does not follow scripted runway-specific routes; generated airports can always change runway for new traffic, aircraft already inbound keep the runway they were told to expect.
- Four airports that were disabled in the original project (EDDT, ESPA, OSDI, WIMM) are still disabled (closed, or no usable data).
- Wikipedia and ChartFox were not reachable when the data was built, so airport and callsign data come from OurAirports and OpenFlights; it is not a copy of ChartFox's charts.
