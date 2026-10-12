/**
 * Builds a believable, simple ground layout from nothing but the runways: a parallel taxiway for each runway with
 * connectors at both ends and in the middle, one apron with a terminal and rows of stands, and links joining the
 * taxiway systems together.
 *
 * It is not any real airport's layout and the chart says so. It exists so that every airport can be used for ground
 * movements, and it is replaced by the OpenStreetMap layout whenever that can be fetched (see `osmLayout.js`).
 *
 * Runways come in as `{ names: ['09', '27'], p0: [x, y], p1: [x, y] }` (km, `p0` the threshold of `names[0]`).
 */
import {
    addScaled,
    distanceBetween,
    nearestOnSegment,
    polylineLength,
    unitVector
} from './groundGeometry';

const TAXIWAY_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split('');
const HOLD_DISTANCE_FROM_CENTRELINE_KM = 0.07;
const RUNWAY_EDGE_KM = 0.03;
const END_CONNECTOR_DISTANCE_KM = 0.12;
const STAND_SPACING_KM = 0.075;
const STAND_ROW_OFFSET_KM = 0.075;

const distanceToRunway = (point, runway) => nearestOnSegment(point, runway.p0, runway.p1).distance;

const taxiwayOffsetFor = (lengthKm) => {
    if (lengthKm >= 2.4) {
        return 0.21;
    }

    return lengthKm >= 1.5 ? 0.16 : 0.12;
};

const pickSide = (runway, others, offset) => {
    const normal = [-runway.u[1], runway.u[0]];
    const middle = [(runway.p0[0] + runway.p1[0]) / 2, (runway.p0[1] + runway.p1[1]) / 2];
    const score = (side) => {
        const candidate = addScaled(middle, normal, side * (offset + 0.3));

        return others.length === 0 ? side : Math.min(...others.map((other) => distanceToRunway(candidate, other)));
    };

    return score(1) >= score(-1) ? 1 : -1;
};

const describeRunways = (runways) => runways.map((runway) => {
    const length = distanceBetween(runway.p0, runway.p1);

    return { ...runway, length, u: unitVector(runway.p0, runway.p1) };
}).sort((a, b) => b.length - a.length);

/**
 * The shortest straight link from one of `ends` to any segment of `taxiways`
 *
 * @function findLink
 * @param ends {array<array>}
 * @param taxiways {array<object>}
 * @return {object|null} `{ end, target, distance }`
 */
const findLink = (ends, taxiways) => {
    let best = null;

    taxiways.forEach((existing) => {
        for (let i = 1; i < existing.points.length; i += 1) {
            for (let j = 0; j < ends.length; j += 1) {
                const candidate = nearestOnSegment(ends[j], existing.points[i - 1], existing.points[i]);

                if (candidate.distance > 0.005 && (!best || candidate.distance < best.distance)) {
                    best = { end: ends[j], target: candidate.point, distance: candidate.distance };
                }
            }
        }
    });

    return best;
};
const rectangle = (center, u, n, width, depth) => [
    addScaled(addScaled(center, u, -width / 2), n, -depth / 2),
    addScaled(addScaled(center, u, width / 2), n, -depth / 2),
    addScaled(addScaled(center, u, width / 2), n, depth / 2),
    addScaled(addScaled(center, u, -width / 2), n, depth / 2)
];

/**
 * @function generateSchematicLayout
 * @param runwayList {array<object>}
 * @return {object} layout, see `AirportLayoutController`
 */
export const generateSchematicLayout = (runwayList) => {
    const runways = describeRunways(runwayList);
    const layout = {
        source: 'schematic',
        taxiways: [],
        aprons: [],
        terminals: [],
        stands: [],
        holds: []
    };
    const letters = TAXIWAY_LETTERS.slice();

    if (runways.length === 0) {
        return layout;
    }

    let primaryTaxiway = null;

    runways.forEach((runway, index) => {
        const ref = letters.shift() || `T${index}`;
        const existingTaxiways = layout.taxiways.slice();
        const offset = taxiwayOffsetFor(runway.length);
        const side = pickSide(runway, runways.filter((other) => other !== runway), offset);
        const normal = [-runway.u[1], runway.u[0]];
        const along = (distance) => addScaled(runway.p0, runway.u, distance);
        const offsetPoint = (distance, lateral) => addScaled(along(distance), normal, side * lateral);
        const endDistance = Math.min(END_CONNECTOR_DISTANCE_KM, runway.length / 4);
        const connectorDistances = [endDistance, runway.length - endDistance];

        if (runway.length >= 1.8) {
            connectorDistances.splice(1, 0, runway.length * 0.36, runway.length * 0.64);
        }

        const taxiwayPoints = [offsetPoint(0, offset)];

        connectorDistances.forEach((distance, connectorIndex) => {
            const holdPoint = offsetPoint(distance, HOLD_DISTANCE_FROM_CENTRELINE_KM);
            const taxiwayPoint = offsetPoint(distance, offset);
            const name = `${ref}${connectorIndex + 1}`;

            taxiwayPoints.push(taxiwayPoint);
            layout.taxiways.push({
                ref: name,
                kind: 'connector',
                points: [offsetPoint(distance, RUNWAY_EDGE_KM), holdPoint, taxiwayPoint]
            });

            if (connectorIndex === 0) {
                layout.holds.push({
                    runway: runway.names[0], x: holdPoint[0], y: holdPoint[1], taxiway: name
                });
            }

            if (connectorIndex === connectorDistances.length - 1) {
                layout.holds.push({
                    runway: runway.names[1], x: holdPoint[0], y: holdPoint[1], taxiway: name
                });
            }
        });

        taxiwayPoints.push(offsetPoint(runway.length, offset));
        layout.taxiways.push({ ref, kind: 'taxiway', points: taxiwayPoints });

        if (index === 0) {
            primaryTaxiway = {
                ref, points: taxiwayPoints, side, normal, u: runway.u, offset, length: runway.length
            };

            return;
        }

        // join this runway's taxiway to what exists so far: from its nearer end to the closest point of the network
        const link = findLink([taxiwayPoints[0], taxiwayPoints[taxiwayPoints.length - 1]], existingTaxiways);

        if (link) {
            layout.taxiways.push({ ref: '', kind: 'taxiway', points: [link.end, link.target] });
        }
    });

    // the terminal area, off the middle of the primary runway's taxiway
    const primary = primaryTaxiway;
    const taxiwayMiddle = primary.points[Math.floor(primary.points.length / 2)];
    const sideNormal = [primary.normal[0] * primary.side, primary.normal[1] * primary.side];
    const apronWidth = Math.max(0.4, Math.min(1.4, primary.length * 0.25));
    const apronDepth = 0.24;
    const linkLength = 0.18;
    const apronCenter = addScaled(taxiwayMiddle, sideNormal, linkLength + (apronDepth / 2));
    const laneStart = addScaled(apronCenter, primary.u, -((apronWidth / 2) - 0.03));
    const laneEnd = addScaled(apronCenter, primary.u, (apronWidth / 2) - 0.03);

    layout.aprons.push({ points: rectangle(apronCenter, primary.u, sideNormal, apronWidth, apronDepth) });
    layout.terminals.push({
        name: 'Terminal',
        points: rectangle(addScaled(apronCenter, sideNormal, (apronDepth / 2) + 0.05), primary.u, sideNormal, apronWidth, 0.07)
    });
    layout.taxiways.push({ ref: '', kind: 'taxiway', points: [taxiwayMiddle, apronCenter] });
    layout.taxiways.push({ ref: '', kind: 'taxilane', points: [laneStart, apronCenter, laneEnd] });

    const standsPerRow = Math.max(3, Math.floor((apronWidth - 0.06) / STAND_SPACING_KM));
    let standNumber = 1;

    [-1, 1].forEach((row) => {
        for (let i = 0; i < standsPerRow; i++) {
            const alongOffset = (i - ((standsPerRow - 1) / 2)) * STAND_SPACING_KM;
            const lanePoint = addScaled(apronCenter, primary.u, alongOffset);
            const standPoint = addScaled(lanePoint, sideNormal, row * STAND_ROW_OFFSET_KM);

            layout.taxiways.push({ ref: '', kind: 'stub', points: [lanePoint, standPoint] });
            layout.stands.push({
                ref: String(standNumber), x: standPoint[0], y: standPoint[1], heading: row > 0 ? 'toward' : 'away'
            });
            standNumber += 1;
        }
    });

    return layout;
};

/**
 * Total length of all taxiways in a layout, for the chart legend and for tests
 *
 * @function layoutTaxiwayLengthKm
 * @param layout {object}
 * @return {number}
 */
export const layoutTaxiwayLengthKm = (layout) => layout.taxiways.reduce((sum, taxiway) => sum + polylineLength(taxiway.points), 0);
