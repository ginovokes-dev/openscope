# Data pipeline: generated airports, airlines and airport index

This directory contains the tooling that produced the *generated* part of openScope's data:

| Output | Produced by | Notes |
|---|---|---|
| `assets/airlines/<icao>.json` (new files) | `build-airlines.js` | real ICAO designator, real telephony call sign, fleet from the equipment seen on the airline's routes |
| `assets/airports/<icao>.json` (new files) | `build-airports.js` | real runways, airspace, exit gates, SIDs, fix-direct arrivals, spawn patterns from real route data |
| `assets/airports/airportLoadList.json` (new entries) + `airportLoadList.schema.json` | `build-airports.js` | append-only; existing entries are preserved byte for byte |
| `assets/airports/airportIndex.json` | `build-airport-index.js` | compact worldwide lookup by ICAO (name, city, country, position, longest hard runway ...) |
| validation | `check.js`, `client-smoke-test.js` | structural validator, and a headless test through the real client classes |

Everything is plain CommonJS Node (tested with Node 22; the code only uses features available since Node 11, the
version in `.nvmrc`). There are **no npm dependencies** except one *optional* development-time package
(`geomagnetism`, see below) that is never added to `package.json`.

> **Hand-authored files are never touched.** Every generated airport/airline/index file carries
> `"_generated": true` as its *first* key. The tools refuse to overwrite, prune or delete any file that does
> not carry the marker (existing hand-authored airports such as `egll.json` or `eick.json` have no marker).

## 1. Data sources

All inputs are **untrusted data**: they are only parsed as text (own CSV parser in `lib/csv.js`), validated field
by field, and never executed or `require`d.

| Data set | Licence | Files used | Download |
|---|---|---|---|
| OurAirports | public domain | `airports.csv`, `runways.csv`, `airport-frequencies.csv`, `navaids.csv`, `countries.csv` (`regions.csv` is not needed) | https://github.com/davidmegginson/ourairports-data |
| OpenFlights | ODbL 1.0 (attribution + share-alike) | `airlines.dat`, `routes.dat`, `airports.dat` (`planes.dat` is not needed) | https://github.com/jpatokal/openflights/tree/master/data |

Why these and not Wikipedia/ChartFox: neither Wikipedia nor ChartFox was reachable from the sandbox in which this
data set was built (only `raw.githubusercontent.com` and the npm registry were), so the openly licensed
OurAirports and OpenFlights data sets were used instead. That means **no official AIP SIDs/STARs, no ILS
tables, no transition altitudes and no airspace charts**; see "Limitations" below.

Download everything into one directory (any location, it is passed on the command line):

```sh
DATA=~/openscope-data && mkdir -p "$DATA" && cd "$DATA"
OA=https://raw.githubusercontent.com/davidmegginson/ourairports-data/main
OF=https://raw.githubusercontent.com/jpatokal/openflights/master/data
for f in airports runways airport-frequencies navaids countries; do curl -fLO "$OA/$f.csv"; done
# the OpenFlights files may keep their original names (airlines.dat ...) or the of_ prefix used below,
# which just avoids a clash with OurAirports' airports.csv when both live in one directory
curl -fL "$OF/airlines.dat" -o of_airlines.dat
curl -fL "$OF/routes.dat"   -o of_routes.dat
curl -fL "$OF/airports.dat" -o of_airports.dat
```

The committed output was generated from this snapshot (first 16 hex digits of the SHA-256 of each file):

```
bee4e45e2f3b3acb  airports.csv           bcc84c682d36c38e  runways.csv
dd465f8d451aa0de  airport-frequencies.csv  57fb332b75be1173  navaids.csv
2a9dbee691125b0c  countries.csv          39be1a432e8b04eb  of_airlines.dat
bd373706238134f6  of_routes.dat          9387cdb38df5bd66  of_airports.dat
```

OurAirports is updated nightly, so downloading again later gives different (usually better) data and therefore
different generated files. The OpenFlights route/airline tables have not been maintained since about 2014.

## 2. Running it

```sh
# optional but recommended: real magnetic declination (NOAA World Magnetic Model, epoch 2026-01-01).
# --no-save --prefix keeps package.json and package-lock.json untouched.
npm install --no-save --prefix tools/data-pipeline geomagnetism

# everything, in the right order (airlines -> airports -> index -> check)
node tools/data-pipeline/build-all.js --data-dir "$DATA"

# or step by step
node tools/data-pipeline/build-airlines.js      --data-dir "$DATA"
node tools/data-pipeline/build-airports.js      --data-dir "$DATA" [--max-airports 700] [--size-budget-mb 8]
node tools/data-pipeline/build-airport-index.js --data-dir "$DATA"
node tools/data-pipeline/check.js [--report]
node tools/data-pipeline/client-smoke-test.js [--sim]       # needs `npm install` in the repo root
```

`--data-dir` can also be given through the environment variable `PIPELINE_DATA_DIR`. All scripts are
**deterministic** (every random choice is seeded from the airport/airline ICAO; no timestamps or absolute paths
end up in the output) and **idempotent** (running twice leaves the files byte-identical; unchanged files are not
rewritten).

If `geomagnetism` cannot be loaded the tool prints a warning and falls back to a *coarse* centred-dipole
approximation, and flags every affected airport with `info.coarseMagneticVariation: true`. The generated files
embed the computed `magnetic_north`, so there is no runtime dependency on the package.

### Flags

| Flag | Script(s) | Meaning |
|---|---|---|
| `--data-dir DIR` | all builders | directory containing the downloaded files |
| `--dry-run` | builders | compute everything, write nothing |
| `--no-prune` | airlines, airports | keep previously generated files that are no longer selected (by default stale *generated* files are deleted; hand-authored files never are) |
| `--max-airports N` | airports | total number of **new** airports (default 700) |
| `--size-budget-mb N` | airports | stop adding ranked airports once the generated airport JSON would exceed N MB (default 8); the cut-off airport is the last one that fits |
| `--min-routes N` | airports | minimum number of real airline/city pairs for a *ranked* airport (default 3) |
| `--must-include GB,IE,..` | airports | countries whose airports with `scheduled_service=yes` are **always** generated, even with short/unpaved runways (default `GB,IE,IM,JE,GG`) |
| `--only ICAO,ICAO` | airports | generate only these airports (debugging; disables pruning and the load-list update) |
| `--exclude-defunct` | airlines, airports | drop carriers listed in `lib/defunct.js` (default: keep them, see "Limitations") |
| `--no-repair` | airlines, airports | disable the OpenFlights attribution repair (section 3.5) |
| `--summary-json FILE` | airports | also write a machine-readable summary |
| `--verbose` | airports | one line per airport |
| `--all-small` | index | keep every small airport in the index (default leaves out tiny strips, see 3.8) |
| `--report` / `--strict-hand` / `--no-git` / `--require A,B` | check | print sample airports / treat hand-authored files strictly / skip the "no tracked asset was modified" git check / override the list of airports that must exist |
| `--airports a,b` / `--all` / `--sim` / `--max-patterns N` / `--sample N` | client-smoke-test | see the header of the script |

If the generated airports have to be shrunk or grown, change `--max-airports` (or lower `--size-budget-mb`) and
re-run `build-all.js`: the airports with the lowest real traffic are dropped first, previously generated files
that fall out of the selection are pruned and the load list is rewritten.

## 3. How the data is derived (every heuristic, honestly)

### 3.1 Which airports

1. **Mandatory:** every OurAirports airport (types large/medium/small, 4-letter ICAO code) with
   `scheduled_service = yes` in the UK, Ireland, Isle of Man, Jersey and Guernsey (`--must-include`).
   For these the runway rules are relaxed (3.2) so that e.g. the Orkney/Hebrides island strips exist. Airports
   already in `assets/airports/` (EGCC, EGGW, EGKK, EGLC, EGLL, EGNM, EICK, EIDW, EINN ...) are skipped.
   A mandatory airport is still skipped when it has no runway longer than 400 m in the data (EIIM, a 158 m strip).
   Foula (`GB-FOA`) has no ICAO code and cannot be generated.
2. **Ranked:** all other airports, ordered by the number of distinct *(airline, other airport)* services found in
   the OpenFlights route table whose airline has an airline file and whose equipment maps to a known aircraft
   type and passes the runway filter (ties: ICAO). Airports are taken from the top until `--max-airports` or
   `--size-budget-mb` is reached. An airport needs a usable runway (3.2); airports without one are skipped and
   the next one is tried.

### 3.2 Runways

* Source: OurAirports `runways.csv`. Closed runways, helipads and non-numeric identifiers are dropped. A
  trailing `T` (true-north designator, Arctic Canada) is dropped from the name.
* Normal airports: **hard surface** (asphalt/concrete/bitumen/"PEM"/paved) and at least **800 m**. Blank/unknown
  surfaces are treated as paved at scheduled large/medium airports for runways of at least 1,200 m (a data-entry
  gap, e.g. several Chinese airports). Relaxed airports: any non-water surface, at least 400 m.
* Names are zero padded (`9L` -> `09L`); the two ends must be reciprocal (differ by 18, L<->R swapped); duplicate
  names are dropped; at most 6 runways are kept (longest hard runways first).
* Geometry: the thresholds are the OurAirports runway-end coordinates, moved along the runway by the displaced
  threshold (max 35 % of the length). With only one end known the other end is derived from heading and length.
  With no usable coordinates (or coordinates contradicting the runway name by more than 25 degrees, or farther
  than 15 km from the airport) the runway is **centred on the airport reference point** using the name-derived
  heading. Such airports carry `info.approximateRunways: true` (45 of the 700 generated airports, mostly Chinese,
  Brazilian and small island fields). Elevations are the runway-end elevations, else the airport elevation.
* `info.longestRunwayM` records the longer of the stated length and the drawn threshold-to-threshold distance.

### 3.3 ILS flags (an inference, not data)

OurAirports has no ILS information, so `ils` is inferred conservatively: a runway is eligible if it is
hard-surfaced, at least 1,400 m long, lit (or at a non-small airport) and the airport has scheduled service.
OurAirports `large_airport`: both ends of **every** eligible runway get `ils: true`; every other airport: both ends
of the **longest** eligible runway only. Everything else is `false`. This will be wrong for individual runways
(e.g. a large airport with a non-precision secondary runway).

### 3.4 Airspace, gates, SIDs, STARs

The airport is classified from its real traffic (`importance = ln(services + 1) / ln(700)`) and its OurAirports
type into `hub` / `large` / `medium` / `small`. The class sets:

| class | ctr_radius | ceiling above field | initial_alt above field | max gates | GA share |
|---|---|---|---|---|---|
| hub | 90 km | +12,000 ft | +5,000 ft | 8 | 4 % |
| large | 75 km | +11,000 ft | +5,000 ft | 7 | 7 % |
| medium | 60 km | +9,000 ft | +4,000 ft | 6 | 12 % |
| small | 45 km | +7,000 ft | +3,000 ft | 5 | 25 % |

* **Airspace** is a 24-vertex regular polygon of `ctr_radius` around the reference point (class C, class D for
  small), floor 0 (lower for airports below sea level, because the client treats aircraft below the floor as
  outside the airspace), ceiling = `ctr_ceiling`. The client **requires** an `airspace` polygon (the pre-spawn
  code dereferences it), so one is always generated.
* **Gates** are placed in *scope space* (magnetic bearing/distance exactly as the client positions things):
  the bearings to the real other airports are clustered by weighted peak picking into 3..8 sectors. Each gate
  is snapped to a **real navaid** (OurAirports VOR/VOR-DME/VORTAC/NDB/NDB-DME, ident 2-5 letters) if one lies
  within +-28 degrees of the sector bearing and between 4 and 38 NM outside the airspace edge; the gate is then
  that navaid (real name, real position, spoken name from the navaid name). Otherwise the gate is a unique,
  pronounceable synthetic five-letter name at ~8-14 NM outside the edge. Names never collide with each other,
  runway names, any ICAO airport code, or the client's aircraft command words (`lib/gates.js`).
  Gates are deliberately **just outside** the airspace polygon (not on its boundary): arrivals must spawn
  outside controlled airspace, and the pre-spawn calculation needs the first waypoint outside.
* **Inner fix:** 12-20 NM from the airport on the line gate -> airport (a real navaid within +-9 degrees / 4 NM if
  one exists, else synthetic). Arrival routes are fix-direct: `GATE..INNER..<ICAO>`; a fix named after the airport
  ICAO sits on the reference point (precedent: `egnm.json` uses `...LBA`).
* **SIDs:** one per gate, e.g. `WBA3D` ("Wolverhampton Three Delta"), `rwy` entries for **every** runway end
  (`<ICAO><rwy>` keys, as the client requires), `exitPoints` = the gate, empty `body`. Because the FMS refuses
  routes with fewer than two waypoints, every runway end also gets a hidden climb-out fix `_RWY<opposite end><dd>DME`
  (3-4 NM beyond the far end of the runway, documented naming convention), which is the first SID waypoint.
  Spawn routes use the default departure runway; the client re-targets the SID when the active runway is changed
  (all runway ends are defined).
* **STARs:** none (`"stars": {}`); arrivals are vectored to the ILS by the player.
* **Wind:** prevailing direction by latitude (250 degrees mid-latitudes, 80 degrees tropics) +-25, the primary
  runway end facing it is `arrivalRunway`/`departureRunway`; wind angle = that heading (magnetic) +-25 degrees,
  5-12 kt.
* **Maps:** `Base Map` (the gate -> inner fix -> airport arrival lines) and `Extended Runway Centrelines`
  (10 NM centrelines with ticks at 5 and 10 NM for every ILS end, or the primary runway if there is no ILS).
* `has_terrain: false`; no `transition_altitude` (no data; the client uses country defaults); no `airac`.
* **Radio names** `<Place> Tower/Approach/Radar` (`Departure` outside GB/IE). `<Place>` is the OurAirports
  municipality when it appears in the airport name, otherwise the name without generic words if one or two words
  remain, otherwise the OpenFlights city ("Charles de Gaulle" -> Paris, "Ingliston" -> Edinburgh); a leading
  "London" is dropped (Stansted, Southend).
* **`info`** (new optional top-level object, ignored by older code): `country`, `city`, `type` (OurAirports),
  `longestRunwayM`, `frequencies` (`atis/twr/app/gnd/dep` in MHz, strings, from OurAirports when present) and the
  flags `approximateRunways` / `coarseMagneticVariation` when applicable.

### 3.5 Traffic

* **Services.** Each OpenFlights route record becomes a service on the unordered pair *(airline, airport A, airport
  B)*; codeshare records and records with stops are dropped; the two directions of a route are *not* added up (the
  larger of the two counts is used). Only airlines flagged active in OpenFlights are used.
* **Equipment.** IATA equipment codes are mapped to openScope ICAO types with the hand-written table in
  `lib/equipment.js` (e.g. `73H` -> `B738`, `32S` -> `A320`, `E90` -> `E190`, `DH4` -> `DH8D`, `388` -> `A388`,
  `146` -> `RJ85`); generic family codes are split over typical variants (`CRJ`, `330`, `DH8` ...) and map to
  present-day variants. Codes without a type file in `assets/aircraft` (Fokker 28, Yak-40, Il-114, Trislander ...)
  or not in the table are dropped.
* **Realism filter** (`lib/realism.js`): a type is allowed at an airport if
  `longest runway >= max(takeoff, min(landing, 1.3 * takeoff)) * derate * (1 + 2.5 % per 1000 ft elevation)`
  using `runway.takeoff`/`landing` from `assets/aircraft/*.json`, with `derate` = 0.85 up to 2.0 km, 0.90 up to 2.6
  km and 0.95 above. The aircraft files hold near-maximum-weight figures, so airline operations are allowed a
  15 % margin for regional/narrow-body types (so an ATR 72 needs ~1.2 km, an E190 ~1.6 km, an A320 ~1.6 km, an A321
  ~2.2 km), while A380/B748/B744 etc. stay strict (A388 needs ~2.9 km, B744 ~3.2 km). Wide-bodies appear **only**
  where the real route data contains them and the runway allows them; the synthetic fallbacks never use
  wide-bodies.
* **Patterns.** Per airport, the other airports are ranked by their number of airline/type combinations. The top
  3-10 (by airport importance) get **their own arrival pattern (`origin` = real ICAO) and departure pattern
  (`destination` = real ICAO)**, routed through the gate nearest to that city's bearing; the remaining cities are
  folded into one catch-all pattern per gate (`origin`/`destination` empty). Airline entries are
  `["<airline>/<type>", weight]` (weights = number of real route/equipment combinations, top 12 per pattern). The
  pattern count is 2-36 per airport (typically 15-30). Spawn parameters: `method: "random"`, arrivals `speed: 250` and
  `altitude: [ceiling-4000, ceiling-1000]` (>= field + 3,000 ft), departures `altitude/speed: ""`.
* **Rates.** Total movements per hour `5 + 35 * importance^1.6` (between ~6 and 40; `level` in the load list follows
  the documented thresholds from the final total: below 20 beginner, 20-40 easy), split evenly between arrivals and
  departures and over the patterns in proportion to their weights (minimum 0.05/h per pattern).
* **General aviation.** Where the country has a GA airline file (`g` for GB, `ei` for IE, `n` for US, `d`, `f`,
  ... see `GA_BY_COUNTRY` in `lib/traffic.js`), GA/business traffic takes 4 % (hub) to 25 % (small) of the rate:
  light singles, turboprops and, by class and runway length, business jets (`g/c172`, `g/pc12`, `g/c550` ...).
* **No usable real routes** (e.g. most Scottish island strips): a country-level mix of the domestic airline/type
  combinations in the data (never wide-bodies) spread over the gates, plus GA; if even that is empty the airport is
  GA-only. In the committed data set 670 airports are built from real routes, 12 from the country mix and 18 are GA-only.
* **Fleet contract with the client.** Spawn entries use `airline/<icao type>` (lower case) for *any* type, e.g.
  `ezy/a319` or `g/c172`, even where the airline file declares no such fleet. This relies on the client
  synthesising a single-type fleet for an undeclared ICAO type designator (agreed contract). For the 133 **new**
  airline files every type has its own fleet, but most existing hand-authored airline files do not declare
  per-type fleets, so a large share of entries relies on the contract (`check.js` prints the exact numbers).
  Without that client change those entries throw "Invalid fleetName".

### 3.6 Airlines

* Candidates: OpenFlights airlines flagged active with a 3-letter ICAO code, a usable telephony call sign, **and
  at least one route** in the data (otherwise there is no fleet information). Airlines that already have a file are
  skipped (existing files are never modified), as are call signs that duplicate an existing airline's call sign.
* Call signs are cleaned (ASCII, title case, acronyms without vowels such as `CSA` kept) and rejected when empty or
  garbage. Flight number formats depend on the airline's country group (e.g. `####`,`###@`,`##@@`,`###` for
  Western Europe where alphanumeric flight numbers are common; numeric only for North America, Eastern Europe, East
  Asia; never a leading zero).
* Fleets: `default` = every type seen on the airline's routes (weight = route count, scaled to <= 100), `short`
  and/or `long` (weight class H/J and 757/767-class is long) and one single-type fleet per type (`a320`, `b738` ...).

### 3.7 Defects of the OpenFlights data that are handled

* **Mis-attributed routes.** In `routes.dat` many records carry the OpenFlights id of the wrong airline when IATA
  codes were shared (Monarch's Birmingham-Spain flights are filed under "Air Bourbon", Vueling's under "Formosa
  Airlines", Gol's under "City Connexion Airlines" ...). `lib/repair.js`: an airline with at least 6 route records
  *none* of which touches its home country (territories count as home) is suspicious; its records are moved to
  another **active** airline with the same IATA code if that airline's home-country share on those records is at
  least 60 %, otherwise they are **dropped**. For the committed data set this re-attributes 4 airlines and drops 103 (listed by `build-airlines.js --verbose`);
  disable with `--no-repair`. Without it 200 instead of 133 new airline files would be generated; the 67 lost ones
  mostly have no trustworthy route data.
* **Stale airlines.** The snapshot is ~2014. Merged carriers are re-attributed to their successor when that
  airline has a file (US Airways -> American, Continental -> United, Northwest -> Delta, Virgin America -> Alaska,
  AirTran -> Southwest, Brit Air/Regional/Airlinair -> HOP!). Other carriers that have since ceased to operate
  (`lib/defunct.js`: Flybe, Monarch, Thomas Cook, Air Berlin ...) are **kept by default**, because otherwise whole
  regional markets (Flybe at Southampton, Exeter, Newquay ...) would lose nearly all their real traffic; run
  with `--exclude-defunct` to drop them. The list in `defunct.js` is best effort and not exhaustive.

### 3.8 Airport index

`airportIndex.json`: `{"_generated": true, "fields": [icao, iata, name, city, country, lat, lon, elev_ft, rwy_m, type],
"airports": [[...], ...]}`, rows sorted by ICAO, lat/lon rounded to 3 decimals (~100 m), `rwy_m` = longest
non-closed hard-surface runway in metres (0 if none). Contents: every OurAirports airport of type large/medium/small
with a 4-letter ICAO code **and** (an IATA code, or scheduled service, or a file in `assets/airports/`). To stay
near the 600 KB target, `small_airport`s without a hard runway of at least 1,400 m are left out unless they have
scheduled service, a file in the repository, or are the origin/destination of a generated spawn pattern
(`--all-small` keeps them).

### 3.9 Load list

Entries `{"icao","level","name","premium": false,"iata","country","generated": true}` are merged **textually** into
`airportLoadList.json` in alphabetical position, so existing entries stay byte-identical (the diff is pure
insertion). Entries marked `"generated": true` are removed and re-inserted on every run. `name` is the OurAirports
name (usually English, occasionally the local-language name). The schema was extended with the optional `iata`,
`country` and `generated` properties.

## 4. Validation

* `check.js` validates every generated airport and airline file, the load list, the index, the "required"
  airports (EGGP, EGPH, EGPF, EGBB, EGNT, EGGD, EGNX, EGSS, EGHI, EGAA, EGAC, EGPD, EGFF ...), and that no tracked
  hand-authored asset was modified (`git status`). It checks coordinate formats, reciprocal runway names and sane
  lengths, geometry in scope space (airport inside the airspace, arrival spawn outside, second fix inside),
  gate/fix name rules, SID `rwy` keys, that every fix referenced by SIDs and routes exists, that each SID yields at
  least two waypoints, spawn pattern shapes (documented keys, route forms, categories, altitudes), that every
  airline id and aircraft type resolves to an asset file, and the runway realism filter. Exit code 1 on any error.
  Problems in hand-authored files are only warnings.
* `client-smoke-test.js` loads every generated airport through the real client classes (so unlike `check.js` it
  would notice a loader change) and with `--sim` flies aircraft for each pattern. Verified result for the committed
  data: all 700 airports load with zero console output; with `--sim` 700/700 sampled arrivals enter the airspace and
  reach the airport fix and 700/700 departures take off, climb to the initial altitude and leave through their SID
  gate. (Weather, separation, ILS captures and scoring are not exercised.)

## 5. Limitations and known problems

* **Not official procedures.** SIDs are just "exit gate" stubs; there are no STARs, holds, altitude restrictions
  or published instrument approaches. Gate positions and the airspace circle are generated, not charted.
* **2014 route data.** Services are plausible real pairings, not today's timetables: a few markets are missing
  entirely (e.g. nothing for most Scottish island strips), some carriers no longer exist, frequencies are unknown
  (weights are counts of airline/equipment combinations) and equipment is whatever was filed (generic codes are
  mapped to modern variants). Unmappable equipment is dropped, so some airlines lose part of their fleet.
* **ILS and lighting are inferred** (3.3); approximate runway geometry for the airports listed in
  `info.approximateRunways`; OurAirports elevation/threshold data can be off by tens of feet.
* **Airspace/class/ceiling** are class-based constants, not the real CTR/TMA.
* Names: official airport names are OurAirports' (not Jeppesen's); navaid "spoken" names come from the navaid name
  with VOR/NDB words stripped and are not guaranteed to be pronounced the way the real facility is.
* Wind is a plausible default only.
* The OpenFlights defect repair and the defunct list are heuristics; use `--no-repair` / `--exclude-defunct` to
  see the effect.
* Dependence on the client contract for undeclared fleets (3.5).
* **Licence note (please review):** the generated spawn patterns and airline fleets are derived from OpenFlights
  data, which is licensed under the Open Database License. ODbL requires attribution and "share-alike" for a derived
  *database*; whether the game data falls under that is a licensing decision for the project maintainers (this is
  not legal advice). Attribution text is in `documentation/data-sources.md`.

## 6. Attribution

See `documentation/data-sources.md` (OurAirports public domain notice, OpenFlights ODbL notice, NOAA WMM /
`geomagnetism` note).

## 7. Layout

```
build-all.js  build-airlines.js  build-airports.js  build-airport-index.js
check.js  client-smoke-test.js
lib/
  airport.js      one airport file (runways, airspace, gates, SIDs, patterns, maps)
  gates.js        bearing clustering, navaid snapping, command-word deny list
  traffic.js      real-city collection, GA mixes, country fallback mix
  realism.js      runway-length filter
  runways.js      OurAirports runway rows -> openScope runways
  routes.js       OpenFlights routes -> services      repair.js  attribution repair
  equipment.js    IATA equipment -> ICAO type table   defunct.js stale carriers / successors
  naming.js       call sign cleaning, radio/spoken/synthetic names
  data.js csv.js  loaders and CSV parser              context.js  loads everything once
  geo.js          great-circle + scope-space maths    magvar.js   declination
  format.js loadlist.js repo.js args.js rng.js         output, load list merge, safe writes, CLI, PRNG
```
