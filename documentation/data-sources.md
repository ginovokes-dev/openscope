# Data sources and attribution

openScope's hand-authored airports are built from official charts (AIP). A large set of additional airports,
airlines and the worldwide airport index are **generated** from open data sets by the tools in
[`tools/data-pipeline`](../tools/data-pipeline/README.md). Generated files can be recognised by
`"_generated": true` as their first key (airports, airlines and `assets/airports/airportIndex.json`) and, for
airports, by `"generated": true` in `assets/airports/airportLoadList.json`. They are *not* derived from official
charts: see the README of the pipeline for exactly what is inferred.

Wikipedia and ChartFox were not reachable from the environment in which the data was generated, so open data
sets that can be downloaded from GitHub were used instead.

## OurAirports

Airport reference points, elevations, runways, navaids (gate names) and radio frequencies, as well as the
airport index, are derived from the OurAirports data set.

* Source: https://ourairports.com/data/ , https://github.com/davidmegginson/ourairports-data
* Licence: **public domain** (https://ourairports.com/data/ states that the data is released to the public domain
  and may be used without restriction). No attribution is required; it is given here out of courtesy:

> Contains data from OurAirports (https://ourairports.com), released to the public domain.

OurAirports is crowd-sourced and may contain errors. Do not use this data for navigation or any real-world
operational purpose.

## OpenFlights

Airline identities (ICAO designator, telephony call sign, name, country), the equipment seen on airline routes
(used for airline fleets), and the airline/city pairings used in the spawn patterns of the generated airports
are derived from the OpenFlights airline, airport and route databases.

* Source: https://openflights.org/data.php , https://github.com/jpatokal/openflights/tree/master/data
* Licence: **Open Database License (ODbL) 1.0**, https://opendatacommons.org/licenses/odbl/1-0/ ; the individual
  contents are available under the Database Contents License (DbCL).

Attribution notice:

> Contains information from the OpenFlights Airport, Airline and Route Database
> (https://openflights.org/data.php), which is made available here under the Open Database License (ODbL),
> https://opendatacommons.org/licenses/odbl/1-0/ .

Caveats that matter for users of the generated data:

* The route table is a snapshot from about **2014** and has not been maintained since. The airline/city pairings
  and aircraft types in the generated spawn patterns are *plausible real pairings*, not current timetables, and
  some of the airlines have ceased operating.
* The OpenFlights tables contain known attribution errors (routes filed under the wrong airline); the pipeline
  repairs or drops the clear cases (see the pipeline README, section 3.7).
* ODbL has attribution and share-alike provisions for derived databases. The generated airline fleets and spawn
  patterns are derived from OpenFlights data; the project maintainers should decide how to license those files.

## OpenStreetMap

Two things use OpenStreetMap data, both under the **Open Database Licence (ODbL)**:

* **Coastline backdrop** on the radar of the generated airports: coastline segments cut out of the `map.geo.json` of the npm package
  `@geo-maps/countries-coastline-1km` (derived from OpenStreetMap) by `tools/data-pipeline/lib/coast.js`. The segments are stored in the airport files
  (the `maps` block named "coastline").
* **Ground layouts** (taxiways, aprons, terminals, stands, holding positions): fetched **by your browser, on demand**, from the public
  Overpass API (`overpass-api.de`, with `overpass.kumi.systems` as a fallback) the first time you open an airport, and cached in your browser
  (`localStorage`, 90 days). Nothing is bundled in this repository and nothing is sent anywhere except an airport position and radius to the Overpass servers.
  The ground chart prints the credit whenever it shows such a layout:

> © OpenStreetMap contributors, available under the Open Database Licence: https://www.openstreetmap.org/copyright

Where the browser is offline, the Overpass servers are unreachable, or an airport is not mapped in enough detail, a generated schematic layout is drawn instead
(see [simulation-features.md](simulation-features.md#departures-and-the-ground-chart)). The setting **Airport ground layout** can turn the network request off.
OpenStreetMap data is crowd-sourced; do not use the ground chart for real navigation.

## Magnetic variation

`magnetic_north` of the generated airports was computed with the NOAA / BGS World Magnetic Model 2025 (epoch
1 January 2026) through the npm package [`geomagnetism`](https://www.npmjs.com/package/geomagnetism)
(Apache-2.0), which is a development-time tool only and not a dependency of openScope. If the package is not
installed the tool falls back to a coarse dipole approximation and flags the affected airports with
`info.coarseMagneticVariation`.

## New optional properties introduced for generated files

These properties are ignored by older code and are optional everywhere:

* top-level `"_generated": true` in airport, airline and index files;
* airport files: `"info": { "country", "city", "type", "longestRunwayM", "frequencies": {"atis","twr","app","gnd","dep"},
  "approximateRunways", "coarseMagneticVariation" }` (frequencies are MHz strings from OurAirports where available);
* `airportLoadList.json` entries: `"iata"`, `"country"` (ISO 3166-1 alpha-2), `"generated": true`;
* spawn patterns may use any ICAO aircraft type designator as the fleet part of `airline/<fleet>`
  (e.g. `"ezy/a320"`), even if the airline file does not declare such a fleet.
