/**
 * Room edits on floors that the firmware didn't segment
 *
 * On such floors, DreameMapParser cuts the floor into rough zones by itself and replays the
 * edits made in the UI on top of them. These edits are stored per floor in
 * /data/maps_backup/custom_segments.json as one ordered list of operations, because a split
 * may target a segment that only exists thanks to an earlier join and vice versa.
 *
 * Coordinates of split lines are in map pixels, like the pixels of the map layers.
 */

const LINE_EXTENSION = 2; // px. Lets a line that stops just short of a wall still close the gap
const BARRIER_HALF_WIDTH = 0.75; // px. Wide enough that no 4-neighbour step can jump across the line
const MIN_SEGMENT_SIZE = 400; // px, so 1 m² with the usual 5 cm pixels
const FRAGMENT_SEARCH_RADIUS = 3; // px. Reaches across the walls around a piece of a room

class DreameCustomSegments {
    /**
     * Older files kept splits and joins in two separate lists, and the parser applied
     * all splits before all joins. They are converted in that same order.
     *
     * @param {object} floorConfig
     * @returns {Array<CustomSegmentOperation>}
     */
    static GET_OPERATIONS(floorConfig) {
        if (Array.isArray(floorConfig?.operations)) {
            return floorConfig.operations;
        }

        const splits = Array.isArray(floorConfig?.splits) ? floorConfig.splits : [];
        const joins = Array.isArray(floorConfig?.joins) ? floorConfig.joins : [];

        return [
            ...splits.map(sp => {
                return {
                    type: "split",
                    targetId: String(sp.targetId),
                    newId: String(sp.newId),
                    x1: sp.x1,
                    y1: sp.y1,
                    x2: sp.x2,
                    y2: sp.y2
                };
            }),
            ...joins.map(([segA, segB]) => {
                return {
                    type: "join",
                    targetId: String(segA),
                    sourceId: String(segB)
                };
            })
        ];
    }

    /**
     * @param {object} floorConfig modified in place
     * @param {CustomSegmentOperation} operation
     */
    static APPEND_OPERATION(floorConfig, operation) {
        floorConfig.operations = [...DreameCustomSegments.GET_OPERATIONS(floorConfig), operation];

        delete floorConfig.splits;
        delete floorConfig.joins;
    }

    /**
     * @param {Array<number>} existingIds
     * @param {Array<CustomSegmentOperation>} operations
     * @returns {string}
     */
    static NEXT_SEGMENT_ID(existingIds, operations) {
        let maxId = 5; // the zones of the automatic segmentation are 1 to 5

        const ids = [...existingIds];
        operations.forEach(op => {
            ids.push(op.targetId, op.newId, op.sourceId);
        });
        ids.forEach(id => {
            const n = parseInt(id, 10);

            if (!isNaN(n) && n > maxId) {
                maxId = n;
            }
        });

        return String(maxId + 1);
    }

    /**
     * @param {Array<Array<number>>} pixels [x, y] tuples
     * @param {Array<string>} segmentIds the segment of each pixel, updated in place
     * @param {Array<CustomSegmentOperation>} operations
     */
    static APPLY_OPERATIONS(pixels, segmentIds, operations) {
        // Tidying up after every step replays the map exactly as it was shown when each edit was made
        DreameCustomSegments.ABSORB_FRAGMENTS(pixels, segmentIds);

        operations.forEach(op => {
            if (op.type === "join") {
                for (let i = 0; i < segmentIds.length; i++) {
                    if (segmentIds[i] === op.sourceId) {
                        segmentIds[i] = op.targetId;
                    }
                }
            } else if (op.type === "split") {
                const indices = [];
                for (let i = 0; i < segmentIds.length; i++) {
                    if (segmentIds[i] === op.targetId) {
                        indices.push(i);
                    }
                }

                // A split that no longer closes, e.g. because the map changed, is skipped
                const cut = DreameCustomSegments.CUT(indices.map(i => {
                    return pixels[i];
                }), op);

                cut.moved.forEach(j => {
                    segmentIds[indices[j]] = op.newId;
                });
            }

            DreameCustomSegments.ABSORB_FRAGMENTS(pixels, segmentIds);
        });
    }

    /**
     * Keeps every segment in one piece. Only the largest connected part of a segment keeps its id.
     * The other parts, and segments too small to be a room, go to the segment that has the most
     * pixels around them, looking through walls up to FRAGMENT_SEARCH_RADIUS. That can be their
     * own segment, e.g. for a room cut in two by furniture. Parts with no neighbour stay as they are.
     *
     * @param {Array<Array<number>>} pixels [x, y] tuples
     * @param {Array<string>} segmentIds the segment of each pixel, updated in place
     */
    static ABSORB_FRAGMENTS(pixels, segmentIds) {
        const indexByKey = new Map();
        pixels.forEach(([x, y], i) => {
            indexByKey.set(PIXEL_KEY(x, y), i);
        });

        const partOf = new Int32Array(pixels.length).fill(-1);
        const parts = [];

        for (let i = 0; i < pixels.length; i++) {
            if (partOf[i] !== -1) {
                continue;
            }

            const part = {segmentId: segmentIds[i], members: []};
            const stack = [i];
            partOf[i] = parts.length;

            while (stack.length > 0) {
                const j = stack.pop();
                const [x, y] = pixels[j];

                part.members.push(j);
                [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].forEach(([nx, ny]) => {
                    const n = indexByKey.get(PIXEL_KEY(nx, ny));

                    if (n !== undefined && partOf[n] === -1 && segmentIds[n] === part.segmentId) {
                        partOf[n] = parts.length;
                        stack.push(n);
                    }
                });
            }

            parts.push(part);
        }

        const sizes = {};
        const largest = {};
        parts.forEach((part, idx) => {
            sizes[part.segmentId] = (sizes[part.segmentId] ?? 0) + part.members.length;

            if (largest[part.segmentId] === undefined || part.members.length > parts[largest[part.segmentId]].members.length) {
                largest[part.segmentId] = idx;
            }
        });
        const isFragment = parts.map((part, idx) => {
            return largest[part.segmentId] !== idx || sizes[part.segmentId] < MIN_SEGMENT_SIZE;
        });

        parts.forEach((part, idx) => {
            if (!isFragment[idx]) {
                return;
            }

            const counts = {};
            part.members.forEach(i => {
                const [x, y] = pixels[i];

                for (let dx = -FRAGMENT_SEARCH_RADIUS; dx <= FRAGMENT_SEARCH_RADIUS; dx++) {
                    for (let dy = -FRAGMENT_SEARCH_RADIUS; dy <= FRAGMENT_SEARCH_RADIUS; dy++) {
                        const n = indexByKey.get(PIXEL_KEY(x + dx, y + dy));

                        if (n !== undefined && !isFragment[partOf[n]]) {
                            const neighbourId = parts[partOf[n]].segmentId;
                            counts[neighbourId] = (counts[neighbourId] ?? 0) + 1;
                        }
                    }
                }
            });

            let newId = part.segmentId;
            Object.keys(counts).forEach(id => {
                if (counts[id] > (counts[newId] ?? 0)) {
                    newId = id;
                }
            });
            part.members.forEach(i => {
                segmentIds[i] = newId;
            });
        });
    }

    /**
     * Checks a split requested from the UI and orients its line so that the new id goes to
     * the smaller part. The existing name and room settings then stay with the larger one.
     *
     * @param {Array<Array<number>>} pixels of the segment to split
     * @param {CutLine} line
     * @returns {{result: "ok"|"not_closed"|"too_small", line: CutLine}}
     */
    static PLAN_SPLIT(pixels, line) {
        let cut = DreameCustomSegments.CUT(pixels, line);

        if (!cut.closed) {
            return {result: "not_closed", line: line};
        }

        if (cut.moved.length > pixels.length - cut.moved.length) {
            line = {x1: line.x2, y1: line.y2, x2: line.x1, y2: line.y1};
            cut = DreameCustomSegments.CUT(pixels, line);
        }

        if (Math.min(cut.moved.length, pixels.length - cut.moved.length) < MIN_SEGMENT_SIZE) {
            return {result: "too_small", line: line};
        }

        return {result: "ok", line: line};
    }

    /**
     * Cuts a room along a line segment instead of an infinite line. Like with the firmware,
     * the line has to run from wall to wall: the parts it separates on its positive side,
     * where (x2-x1)*(y-y1) - (y2-y1)*(x-x1) > 0, are moved. Parts of the room that the line
     * doesn't touch are left alone.
     *
     * @param {Array<Array<number>>} pixels [x, y] tuples of one segment
     * @param {CutLine} line
     * @returns {{closed: boolean, moved: Array<number>}} moved holds indices into pixels
     */
    static CUT(pixels, line) {
        const length = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);

        if (!(length > 0)) {
            return {closed: false, moved: []};
        }

        const ux = (line.x2 - line.x1) / length;
        const uy = (line.y2 - line.y1) / length;
        const along = new Float64Array(pixels.length);
        const across = new Float64Array(pixels.length);
        const isBarrier = new Uint8Array(pixels.length);
        const indexByKey = new Map();

        pixels.forEach(([x, y], i) => {
            const rx = x - line.x1;
            const ry = y - line.y1;

            along[i] = rx * ux + ry * uy;
            across[i] = ux * ry - uy * rx;
            isBarrier[i] = (
                along[i] >= -LINE_EXTENSION && along[i] <= length + LINE_EXTENSION &&
                Math.abs(across[i]) <= BARRIER_HALF_WIDTH
            ) ? 1 : 0;
            indexByKey.set(PIXEL_KEY(x, y), i);
        });

        const isNextToLine = i => {
            return along[i] >= 0 && along[i] <= length && Math.abs(across[i]) <= BARRIER_HALF_WIDTH + 1;
        };
        const visited = new Uint8Array(pixels.length);
        const parts = [];

        for (let i = 0; i < pixels.length; i++) {
            if (isBarrier[i] || visited[i]) {
                continue;
            }

            const part = {members: [], positive: false, negative: false};
            const stack = [i];
            visited[i] = 1;

            while (stack.length > 0) {
                const j = stack.pop();
                const [x, y] = pixels[j];

                part.members.push(j);
                if (isNextToLine(j)) {
                    if (across[j] > 0) {
                        part.positive = true;
                    } else {
                        part.negative = true;
                    }
                }

                [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].forEach(([nx, ny]) => {
                    const n = indexByKey.get(PIXEL_KEY(nx, ny));

                    if (n !== undefined && !isBarrier[n] && !visited[n]) {
                        visited[n] = 1;
                        stack.push(n);
                    }
                });
            }

            parts.push(part);
        }

        // A part on both sides means the room is still connected around one end of the line
        const closed = parts.some(p => {
            return p.positive && !p.negative;
        }) && parts.some(p => {
            return p.negative && !p.positive;
        }) && !parts.some(p => {
            return p.positive && p.negative;
        });

        if (!closed) {
            return {closed: false, moved: []};
        }

        const moved = [];
        parts.forEach(p => {
            if (p.positive) {
                moved.push(...p.members);
            }
        });
        for (let i = 0; i < pixels.length; i++) {
            if (isBarrier[i] && along[i] >= 0 && along[i] <= length && across[i] > 0) {
                moved.push(i);
            }
        }

        return {closed: true, moved: moved};
    }
}

/**
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
function PIXEL_KEY(x, y) {
    return x * 65536 + y;
}

/**
 * @typedef {object} CutLine
 * @property {number} x1
 * @property {number} y1
 * @property {number} x2
 * @property {number} y2
 */

/**
 * @typedef {object} CustomSegmentOperation
 * @property {"split"|"join"} type
 * @property {string} targetId the segment that is split, or that the other one is merged into
 * @property {string} [newId] split only
 * @property {number} [x1] split only
 * @property {number} [y1] split only
 * @property {number} [x2] split only
 * @property {number} [y2] split only
 * @property {string} [sourceId] join only: the segment that disappears
 */

DreameCustomSegments.MIN_SEGMENT_SIZE = MIN_SEGMENT_SIZE;

module.exports = DreameCustomSegments;
