'use strict';
/**
 * The OpenFlights snapshot is ~2014. Its "active" flag therefore still marks some carriers that
 * have since ceased operating. This is a small, hand-curated list (best effort, from general
 * knowledge, NOT exhaustive) of ICAO airline designators known to have stopped flying.
 *
 * Behaviour:
 *  - Where a clear successor brand exists (SUCCESSOR) AND an airline file for the successor exists in
 *    `assets/airlines/`, the carrier's routes are re-attributed to the successor (US Airways -> American,
 *    Continental -> United, ...). This always happens.
 *  - Otherwise the carrier is KEPT by default (the data set is a 2014 snapshot and many regional
 *    airports would otherwise lose most of their real traffic, e.g. Flybe at Southampton); pass
 *    `--exclude-defunct` to the builders to drop them instead.
 *
 * Existing hand-authored airline files are never modified or deleted, defunct or not.
 */

const DEFUNCT = new Set([
    'BER', // Air Berlin (2017)
    'NLY', // Niki (2017)
    'TRS', // AirTran Airways (merged into Southwest 2014-2018)
    'AAF', // Aigle Azur (2019)
    'ADR', // Adria Airways (2019)
    'BMR', // flybmi (2019)
    'CIO', // Cobalt Air (2018)
    'TCX', // Thomas Cook Airlines UK (2019)
    'TCW', // Thomas Cook Airlines Scandinavia (2019)
    'MON', // Monarch Airlines (2017)
    'GMI', // Germania (2019)
    'PRI', // Primera Air (2018)
    'WOW', // WOW air (2019)
    'JAI', // Jet Airways (2019)
    'KFR', // Kingfisher Airlines (2012)
    'SPN', // Spanair (2012)
    'MAH', // Malev (2012)
    'CIM', // Cimber Sterling (2012)
    'BIT', // Brit Air (merged into HOP! 2016)
    'RAE', // Regional (merged into HOP! 2016)
    'RLA', // Airlinair (merged into HOP! 2016)
    'TSO', // Transaero (2015)
    'MOV', // VIM Airlines (2017)
    'ELL', // Estonian Air (2015)
    'CYP', // Cyprus Airways (2015)
    'AEW', // Aerosvit (2013)
    'COA', // Continental Airlines (merged into United 2012)
    'NWA', // Northwest Airlines (merged into Delta 2010)
    'USA', // US Airways (merged into American 2015)
    'VRD', // Virgin America (merged into Alaska 2018)
    'ASQ', // ExpressJet (2020)
    'CPZ', // Compass Airlines (2020)
    'FLG', // Pinnacle Airlines (2013)
    'GLA', // Great Lakes Airlines (2018)
    'CJC', // Colgan Air (2012)
    'AEY', // Air Italy (2022)
    'AZA', // Alitalia (2021)
    'BEE', // Flybe (2023)
    'ISK', // InterSky (2018)
    'SRK', // Skywork Airlines (2019)
    'DWT', // Darwin Airline / Etihad Regional (2017)
    'ADH', // Air One (merged into Alitalia 2014)
    'AYZ', // Atlant-Soyuz (2011)
    'FLZ', // Air Florida (1984)
    'MXA', // Mexicana (2010)
    'LBC', // Albanian Airlines (2011)
    'ANK', // Air Nippon (merged into ANA 2012)
    'PLI' // Aeroper (defunct)
]);

const SUCCESSOR = {
    AZA: 'ITY',
    USA: 'AAL',
    COA: 'UAL',
    NWA: 'DAL',
    VRD: 'ASA',
    TRS: 'SWA',
    BIT: 'HOP',
    RAE: 'HOP',
    RLA: 'HOP'
};

module.exports = { DEFUNCT, SUCCESSOR };
