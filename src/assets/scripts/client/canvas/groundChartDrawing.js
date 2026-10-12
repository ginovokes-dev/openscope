/**
 * Canvas drawing for the ground chart: aprons, terminals, taxiways with their names, stands, runways and the holding
 * positions in front of them, and the aircraft moving about on it
 *
 * Every function takes the context (already translated to the airport centre) and a `toPx` that turns an `[x, y]`
 * in km into canvas pixels.
 */
import { nearestOnSegment } from '../ground/groundGeometry';

const COLORS = {
    apron: 'rgba(66, 92, 112, 0.55)',
    apronEdge: 'rgba(120, 150, 172, 0.7)',
    terminal: 'rgba(160, 182, 200, 0.6)',
    taxiway: '#5f7d94',
    taxiwayConnector: '#6f8ea6',
    taxilane: '#4f6b80',
    centreline: '#c9b640',
    runway: '#26343f',
    runwayEdge: '#dfe8ee',
    hold: '#ffb000',
    stand: '#9fb8cc',
    standUsed: '#ffb000',
    label: '#ffe36e',
    labelBackground: 'rgba(8, 18, 26, 0.75)',
    text: '#cfe0ec',
    aircraft: '#ffffff',
    selected: '#6ec6ff'
};

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const tracePath = (cc, points, toPx) => {
    points.forEach((point, index) => {
        const [x, y] = toPx(point);

        if (index === 0) {
            cc.moveTo(x, y);
        } else {
            cc.lineTo(x, y);
        }
    });
};

const midpointOf = (points) => {
    const middle = Math.floor(points.length / 2);

    return points.length % 2 === 1 ? points[middle] : [
        (points[middle - 1][0] + points[middle][0]) / 2,
        (points[middle - 1][1] + points[middle][1]) / 2
    ];
};

/**
 * @function drawGroundLayout
 * @param cc {CanvasRenderingContext2D}
 * @param options {object} `{ layout, runways, holds, standsInUse, scale, toPx }`
 */
export const drawGroundLayout = (cc, {
    layout, runways, holds, standsInUse, scale, toPx
}) => {
    cc.save();
    cc.lineJoin = 'round';
    cc.lineCap = 'round';

    // aprons and terminals
    layout.aprons.forEach(({ points }) => {
        cc.beginPath();
        tracePath(cc, points, toPx);
        cc.closePath();
        cc.fillStyle = COLORS.apron;
        cc.fill();
        cc.strokeStyle = COLORS.apronEdge;
        cc.lineWidth = 1;
        cc.stroke();
    });
    layout.terminals.forEach(({ points }) => {
        cc.beginPath();
        tracePath(cc, points, toPx);
        cc.closePath();
        cc.fillStyle = COLORS.terminal;
        cc.fill();
    });

    // runways: surface, edges and centreline
    const runwayWidth = clamp(0.045 * scale, 4, 90);

    runways.forEach(({ p0, p1 }) => {
        cc.beginPath();
        tracePath(cc, [p0, p1], toPx);
        cc.lineCap = 'butt';
        cc.strokeStyle = COLORS.runwayEdge;
        cc.lineWidth = runwayWidth + 2;
        cc.stroke();
        cc.strokeStyle = COLORS.runway;
        cc.lineWidth = runwayWidth;
        cc.stroke();

        if (runwayWidth >= 8) {
            cc.setLineDash([runwayWidth * 1.2, runwayWidth * 1.2]);
            cc.strokeStyle = COLORS.runwayEdge;
            cc.lineWidth = 1;
            cc.stroke();
            cc.setLineDash([]);
        }

        cc.lineCap = 'round';
    });

    // taxiways, widest first so connectors sit on top
    const widthFor = (kind) => {
        const full = clamp(0.024 * scale, 2, 16);

        return kind === 'taxilane' || kind === 'stub' ? full * 0.6 : full;
    };
    const colourFor = (kind) => {
        if (kind === 'connector') {
            return COLORS.taxiwayConnector;
        }

        return kind === 'taxilane' || kind === 'stub' ? COLORS.taxilane : COLORS.taxiway;
    };

    layout.taxiways.forEach(({ points, kind }) => {
        cc.beginPath();
        tracePath(cc, points, toPx);
        cc.strokeStyle = colourFor(kind);
        cc.lineWidth = widthFor(kind);
        cc.stroke();
    });

    if (scale >= 90) {
        cc.setLineDash([6, 6]);
        cc.strokeStyle = COLORS.centreline;
        cc.lineWidth = 1;
        layout.taxiways.forEach(({ points, kind }) => {
            if (kind === 'stub') {
                return;
            }

            cc.beginPath();
            tracePath(cc, points, toPx);
            cc.stroke();
        });
        cc.setLineDash([]);
    }

    // holding positions: a bar across the taxiway on the runway side
    holds.forEach(({ point }) => {
        const [x, y] = toPx(point);
        let nearest = null;

        runways.forEach(({ p0, p1 }) => {
            const candidate = nearestOnSegment(point, p0, p1);

            if (!nearest || candidate.distance < nearest.distance) {
                nearest = candidate;
            }
        });

        if (!nearest) {
            return;
        }

        const [nx, ny] = toPx(nearest.point);
        const length = Math.hypot(nx - x, ny - y) || 1;
        const ux = (nx - x) / length;
        const uy = (ny - y) / length;
        const half = clamp(0.013 * scale, 3, 14);
        const bx = x + (ux * clamp(0.012 * scale, 2, 10));
        const by = y + (uy * clamp(0.012 * scale, 2, 10));

        cc.beginPath();
        cc.moveTo(bx - (uy * half), by + (ux * half));
        cc.lineTo(bx + (uy * half), by - (ux * half));
        cc.strokeStyle = COLORS.hold;
        cc.lineWidth = clamp(0.004 * scale, 2, 4);
        cc.stroke();
    });

    // stands
    if (scale >= 60) {
        const size = clamp(0.014 * scale, 3, 13);

        cc.font = '10px monoOne, monospace';
        cc.textAlign = 'center';
        cc.textBaseline = 'middle';
        layout.stands.forEach((stand, index) => {
            const [x, y] = toPx([stand.x, stand.y]);
            const inUse = standsInUse.has(index);

            cc.strokeStyle = inUse ? COLORS.standUsed : COLORS.stand;
            cc.lineWidth = 1;
            cc.strokeRect(x - size, y - size, size * 2, size * 2);

            if (scale >= 200 && stand.ref) {
                cc.fillStyle = COLORS.text;
                cc.fillText(stand.ref, x, y);
            }
        });
    }

    // taxiway names
    if (scale >= 70) {
        cc.font = 'bold 11px monoOne, monospace';
        cc.textAlign = 'center';
        cc.textBaseline = 'middle';

        const labelled = new Set();

        layout.taxiways.forEach(({ ref, kind, points }) => {
            if (!ref || kind === 'stub' || (kind === 'connector' && scale < 160)) {
                return;
            }

            const [x, y] = toPx(midpointOf(points));
            const key = `${ref}:${Math.round(x / 120)}:${Math.round(y / 120)}`;

            if (labelled.has(key) || x < -300 || y < -300 || x > 3000 || y > 2000) {
                return;
            }

            labelled.add(key);

            const width = (ref.length * 7) + 8;

            cc.fillStyle = COLORS.labelBackground;
            cc.fillRect(x - (width / 2), y - 8, width, 16);
            cc.fillStyle = COLORS.label;
            cc.fillText(ref, x, y);
        });
    }

    // runway designators
    if (scale >= 40) {
        cc.font = 'bold 13px monoOne, monospace';
        cc.fillStyle = COLORS.runwayEdge;
        cc.textAlign = 'center';
        cc.textBaseline = 'middle';
        runways.forEach(({ names, p0, p1 }) => {
            [[names[0], p0, p1], [names[1], p1, p0]].forEach(([name, from, to]) => {
                const [x, y] = toPx(from);
                const [tx, ty] = toPx(to);
                const length = Math.hypot(tx - x, ty - y) || 1;
                const offset = clamp(0.06 * scale, 14, 48);

                cc.fillText(name, x + (((tx - x) / length) * offset), y + (((ty - y) / length) * offset));
            });
        });
    }

    cc.restore();
};

const SHORT_STATUS = {
    'at the stand': 'STAND',
    'waiting for IFR clearance': 'REQ CLR',
    'at the stand, cleared': 'CLEARED',
    'pushing back': 'PUSH',
    'ready to taxi': 'READY',
    taxiing: 'TAXI',
    'holding position': 'HOLD POS',
    'holding short': 'HOLD SHORT',
    'lined up on the runway': 'LINED UP'
};

/**
 * Aircraft on the ground: a small aeroplane glyph pointing the way it faces, with callsign and what it is doing
 *
 * @function drawGroundTraffic
 * @param cc {CanvasRenderingContext2D}
 * @param options {object} `{ aircraft, scale, toPx, selected }`
 */
export const drawGroundTraffic = (cc, {
    aircraft, scale, toPx, selected
}) => {
    const size = clamp(0.03 * scale, 6, 24);

    cc.save();
    cc.font = '11px monoOne, monospace';
    cc.textBaseline = 'alphabetic';

    aircraft.forEach((plane) => {
        const [x, y] = toPx(plane.relativePosition);

        if (x < -50 || y < -50 || x > cc.canvas.width + 50 || y > cc.canvas.height + 50) {
            return;
        }

        const isSelected = plane === selected;

        cc.save();
        cc.translate(x, y);
        cc.rotate(plane.heading);
        cc.beginPath();
        cc.moveTo(0, -size);
        cc.lineTo(size * 0.2, -size * 0.3);
        cc.lineTo(size * 0.95, size * 0.15);
        cc.lineTo(size * 0.95, size * 0.35);
        cc.lineTo(size * 0.2, size * 0.2);
        cc.lineTo(size * 0.15, size * 0.75);
        cc.lineTo(size * 0.5, size * 0.95);
        cc.lineTo(size * 0.5, size * 1.05);
        cc.lineTo(0, size * 0.95);
        cc.lineTo(-size * 0.5, size * 1.05);
        cc.lineTo(-size * 0.5, size * 0.95);
        cc.lineTo(-size * 0.15, size * 0.75);
        cc.lineTo(-size * 0.2, size * 0.2);
        cc.lineTo(-size * 0.95, size * 0.35);
        cc.lineTo(-size * 0.95, size * 0.15);
        cc.lineTo(-size * 0.2, -size * 0.3);
        cc.closePath();
        cc.fillStyle = isSelected ? COLORS.selected : COLORS.aircraft;
        cc.fill();
        cc.restore();

        const label = plane.callsign;
        const status = SHORT_STATUS[plane.getGroundStatus()] || '';

        cc.fillStyle = COLORS.labelBackground;
        cc.fillRect(x + size + 3, y - 19, Math.max(label.length, status.length + 1) * 7 + 6, status ? 26 : 14);
        cc.fillStyle = isSelected ? COLORS.selected : COLORS.aircraft;
        cc.fillText(label, x + size + 6, y - 8);
        cc.fillStyle = COLORS.label;
        cc.fillText(status, x + size + 6, y + 3);
    });

    cc.restore();
};

/**
 * The planned route of the selected aircraft, drawn over the taxiways
 *
 * @function drawTaxiRoute
 * @param cc {CanvasRenderingContext2D}
 * @param route {object} `{ points }`
 * @param toPx {function}
 */
export const drawTaxiRoute = (cc, route, toPx) => {
    cc.save();
    cc.beginPath();
    tracePath(cc, route.points, toPx);
    cc.strokeStyle = COLORS.selected;
    cc.lineWidth = 3;
    cc.setLineDash([10, 6]);
    cc.stroke();
    cc.restore();
};

/**
 * Legend in the corner: what the chart is and where its layout came from
 *
 * @function drawGroundLegend
 * @param cc {CanvasRenderingContext2D}
 * @param options {object} `{ icao, source, height }`
 */
export const drawGroundLegend = (cc, { icao, source, height }) => {
    cc.save();
    cc.font = '11px monoOne, monospace';
    cc.textAlign = 'left';
    cc.textBaseline = 'alphabetic';
    cc.fillStyle = COLORS.labelBackground;
    cc.fillRect(8, height - 74, 360, 48);
    cc.fillStyle = COLORS.label;
    cc.fillText(`${icao.toUpperCase()} GROUND CHART`, 14, height - 56);
    cc.fillStyle = COLORS.text;
    cc.fillText(source, 14, height - 40);
    cc.fillText('Zoom with the wheel; F9 hides the chart. Not for navigation.', 14, height - 26);
    cc.restore();
};
