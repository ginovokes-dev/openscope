/**
 * Fills in what a raw layout lacks so it can be used for taxiing: stands when the data has none, and a holding point
 * node for every runway end
 */
import {
    distanceBetween,
    isPointInPolygon,
    nearestOnSegment,
    polygonCentroid
} from './groundGeometry';

const MIN_HOLD_DISTANCE_FROM_CENTRELINE_KM = 0.04;
const MAX_HOLD_DISTANCE_FROM_THRESHOLD_KM = 0.9;
const STAND_SPACING_KM = 0.05;

const distanceToRunways = (point, runways) => Math.min(...runways.map((runway) => nearestOnSegment(point, runway.p0, runway.p1).distance));

/**
 * Stands to use when the layout has none: spots on the apron (graph nodes inside an apron polygon), or failing that
 * dead ends of the network far from any runway
 *
 * @function deriveStands
 * @param layout {object}
 * @param graph {GroundGraph}
 * @param runways {array<object>} `{ p0, p1 }`
 * @param maximum {number}
 * @return {array<object>} `[{ ref, x, y }]`
 */
export const deriveStands = (layout, graph, runways, maximum = 24) => {
    const chosen = [];
    const accept = (point) => {
        if (chosen.length < maximum && chosen.every((stand) => distanceBetween([stand.x, stand.y], point) >= STAND_SPACING_KM)) {
            chosen.push({ ref: String(chosen.length + 1), x: point[0], y: point[1] });
        }
    };

    layout.aprons.forEach((apron) => {
        graph.nodes.forEach((node, id) => {
            if (graph.adjacency[id].length > 0 && isPointInPolygon(node, apron.points)) {
                accept(node);
            }
        });

        if (chosen.length === 0) {
            accept(polygonCentroid(apron.points));
        }
    });

    if (chosen.length < 4) {
        graph.nodes
            .map((node, id) => ({ node, id }))
            .filter(({ id }) => graph.adjacency[id].length === 1)
            .map(({ node }) => ({ node, away: runways.length > 0 ? distanceToRunways(node, runways) : 0 }))
            .filter(({ away }) => away > 0.25)
            .sort((a, b) => b.away - a.away)
            .forEach(({ node }) => accept(node));
    }

    return chosen;
};

/**
 * The node where aircraft wait for a runway end: a mapped holding position when there is one close to the threshold,
 * otherwise the network node nearest the threshold that is clear of the runway
 *
 * @function holdNodeForRunway
 * @param layout {object}
 * @param graph {GroundGraph}
 * @param end {object} `{ name, threshold: [x, y] }`
 * @param runways {array<object>} `{ p0, p1 }` all runway centrelines
 * @return {number|null} node id
 */
export const holdNodeForRunway = (layout, graph, end, runways) => {
    const matches = layout.holds
        .filter((hold) => String(hold.runway || '').toUpperCase().split(/[/;,\s]+/).includes(String(end.name).toUpperCase()))
        .map((hold) => ({ hold, distance: distanceBetween([hold.x, hold.y], end.threshold) }))
        .filter(({ distance }) => distance <= MAX_HOLD_DISTANCE_FROM_THRESHOLD_KM)
        .sort((a, b) => a.distance - b.distance);

    for (let i = 0; i < matches.length; i++) {
        const id = graph.attachPoint([matches[i].hold.x, matches[i].hold.y], 0.1);

        if (id !== null) {
            return id;
        }
    }

    let best = null;

    graph.nodes.forEach((node, id) => {
        if (graph.adjacency[id].length === 0) {
            return;
        }

        const distance = distanceBetween(node, end.threshold);

        if (distance > MAX_HOLD_DISTANCE_FROM_THRESHOLD_KM || distanceToRunways(node, runways) < MIN_HOLD_DISTANCE_FROM_CENTRELINE_KM) {
            return;
        }

        if (!best || distance < best.distance) {
            best = { id, distance };
        }
    });

    return best ? best.id : null;
};
