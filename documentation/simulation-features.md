# Simulation features

This page describes the realism, events, radio and voice features added on top of the original openScope
simulation, how to configure them, and what they do not do.

- [Playing: the controls guide](#playing-the-controls-guide)
- [Airports](#airports)
- [Traffic and aircraft](#traffic-and-aircraft)
- [Weather and the ATIS](#weather-and-the-atis)
- [Failures, emergencies and fuel](#failures-emergencies-and-fuel)
- [The aircraft panel](#the-aircraft-panel)
- [Radio: free-form text and voice](#radio-free-form-text-and-voice)
- [Setting up the AI and voice features](#setting-up-the-ai-and-voice-features)
- [Settings reference](#settings-reference)
- [Limitations and what is not done yet](#limitations-and-what-is-not-done-yet)

## Playing: the controls guide

Press `F8` (or the controls button in the footer) for the in-game controls guide. It shows, for departures
and arrivals, the order in which to clear an aircraft, and every command in plain English next to the command that does it.
The full command reference is in [aircraft-commands.md](aircraft-commands.md).

A normal departure is `caf` (cleared as filed), `taxi [runway]`, `cvs` (climb via SID) and `cto` (cleared for takeoff).
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

Generated airports do **not** have official procedures: SIDs and STARs are direct-to-fix routes between runway and gates named
after nearby navaids, ILS availability is inferred from the runway data, and transition altitudes are regional defaults. They are for
training and fun, not for navigation. See [data-sources.md](data-sources.md) for the data licences and attribution.

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

## Limitations and what is not done yet

- **Tower, ground and delivery positions are not implemented.** You control approach and departure. Tower-issued IFR clearances, ground movements and a "tower controller can do anything" mode are planned.
- The live language model and ElevenLabs integrations have been tested against recorded/faked servers and the unit tests, not exercised with real keys during development.
- Generated airports have no real SIDs/STARs, approach charts or transition altitudes (see [Airports](#airports)); the OpenFlights route table is a 2014 snapshot, so some airline and route pairings are out of date.
- Changing the runway in use (ATIS editor) is not possible at airports whose traffic follows scripted runway-specific routes.
- Four airports that were disabled in the original project (EDDT, ESPA, OSDI, WIMM) are still disabled (closed, or no usable data).
- Wikipedia and ChartFox were not reachable when the data was built, so airport and callsign data come from OurAirports and OpenFlights; it is not a copy of ChartFox's charts.
