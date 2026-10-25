const assert = require("node:assert");
const { describe, it } = require("node:test");

const DreameCustomSegments = require("../../../../lib/robots/dreame/DreameCustomSegments");

function rect(x0, y0, x1, y1) {
    const pixels = [];

    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            pixels.push([x, y]);
        }
    }

    return pixels;
}

// Two 20x20 rooms joined by a 4 px wide door at x 8-11, y 20-21
const ROOM_A = rect(0, 0, 19, 19);
const DOOR = rect(8, 20, 11, 21);
const ROOM_B = rect(0, 22, 19, 41);
const ACROSS_DOOR = {x1: 6, y1: 21, x2: 13, y2: 21};

describe("DreameCustomSegments", () => {
    it("cuts along the line only between the walls", () => {
        const pixels = [...ROOM_A, ...DOOR, ...ROOM_B];
        const cut = DreameCustomSegments.CUT(pixels, ACROSS_DOOR);
        const moved = cut.moved.map(i => {
            return pixels[i].join(",");
        }).sort();

        assert.strictEqual(cut.closed, true);
        assert.deepStrictEqual(moved, ROOM_B.map(p => {
            return p.join(",");
        }).sort());
    });

    it("refuses a line that doesn't reach the walls", () => {
        const pixels = [...ROOM_A, ...DOOR, ...ROOM_B];
        const cut = DreameCustomSegments.CUT(pixels, {x1: 6, y1: 21, x2: 8, y2: 21});

        assert.deepStrictEqual(cut, {closed: false, moved: []});
    });

    it("leaves parts of the segment that the line doesn't touch alone", () => {
        const pixels = [...ROOM_A, ...DOOR, ...ROOM_B, ...rect(40, 30, 49, 39)];
        const cut = DreameCustomSegments.CUT(pixels, ACROSS_DOOR);

        assert.strictEqual(cut.closed, true);
        assert.strictEqual(cut.moved.length, ROOM_B.length);
    });

    it("gives the new id to the smaller part", () => {
        const pixels = [...rect(0, 0, 29, 19), ...DOOR, ...ROOM_B];

        assert.deepStrictEqual(DreameCustomSegments.PLAN_SPLIT(pixels, ACROSS_DOOR), {result: "ok", line: ACROSS_DOOR});
        assert.deepStrictEqual(
            DreameCustomSegments.PLAN_SPLIT(pixels, {x1: 13, y1: 21, x2: 6, y2: 21}),
            {result: "ok", line: ACROSS_DOOR}
        );
    });

    it("refuses splits that leave a tiny segment", () => {
        const pixels = [...ROOM_A, ...DOOR, ...rect(6, 22, 13, 29)];

        assert.strictEqual(DreameCustomSegments.PLAN_SPLIT(pixels, ACROSS_DOOR).result, "too_small");
    });

    it("splits a segment that only exists thanks to an earlier join", () => {
        const pixels = [...ROOM_A, ...DOOR, ...ROOM_B];
        const segmentIds = [
            ...ROOM_A.map(() => {
                return "1";
            }),
            ...DOOR.map(() => {
                return "1";
            }),
            ...ROOM_B.map(() => {
                return "2";
            })
        ];

        DreameCustomSegments.APPLY_OPERATIONS(pixels, segmentIds, [
            {type: "join", targetId: "1", sourceId: "2"},
            Object.assign({type: "split", targetId: "1", newId: "6"}, ACROSS_DOOR)
        ]);

        assert.deepStrictEqual([...new Set(segmentIds.slice(0, ROOM_A.length + DOOR.length))], ["1"]);
        assert.deepStrictEqual([...new Set(segmentIds.slice(ROOM_A.length + DOOR.length))], ["6"]);
    });

    it("gives a piece of a room enclosed by walls to the room around it", () => {
        // Room 9 has a 1 px wall ring around x 9-14, y 7-11, with a piece of room 6 inside
        const hole = p => {
            return p[0] >= 9 && p[0] <= 14 && p[1] >= 7 && p[1] <= 11;
        };
        const room9 = rect(0, 0, 29, 19).filter(p => {
            return !hole(p);
        });
        const piece = rect(10, 8, 13, 10);
        const room6 = rect(40, 0, 69, 19);
        const pixels = [...room9, ...piece, ...room6];
        const segmentIds = pixels.map((p, i) => {
            return i < room9.length ? "9" : "6";
        });

        DreameCustomSegments.ABSORB_FRAGMENTS(pixels, segmentIds);

        assert.deepStrictEqual([...new Set(segmentIds.slice(0, room9.length + piece.length))], ["9"]);
        assert.deepStrictEqual([...new Set(segmentIds.slice(room9.length + piece.length))], ["6"]);
    });

    it("merges segments too small to be a room into their neighbour", () => {
        const room5 = rect(0, 0, 29, 19);
        const strip = rect(0, 20, 9, 21);
        const pixels = [...room5, ...strip];
        const segmentIds = pixels.map((p, i) => {
            return i < room5.length ? "5" : "3";
        });

        DreameCustomSegments.ABSORB_FRAGMENTS(pixels, segmentIds);

        assert.deepStrictEqual([...new Set(segmentIds)], ["5"]);
    });

    it("keeps a piece next to its own room, e.g. behind furniture", () => {
        const room6 = rect(0, 0, 19, 19);
        const piece = rect(21, 0, 24, 19);
        const room9 = rect(40, 0, 69, 19);
        const pixels = [...room6, ...piece, ...room9];
        const segmentIds = pixels.map((p, i) => {
            return i < room6.length + piece.length ? "6" : "9";
        });

        DreameCustomSegments.ABSORB_FRAGMENTS(pixels, segmentIds);

        assert.deepStrictEqual([...new Set(segmentIds.slice(0, room6.length + piece.length))], ["6"]);
    });

    it("leaves pieces without any neighbour alone", () => {
        const room6 = rect(0, 0, 29, 19);
        const island = rect(60, 60, 63, 63);
        const pixels = [...room6, ...island];
        const segmentIds = pixels.map(() => {
            return "6";
        });

        DreameCustomSegments.ABSORB_FRAGMENTS(pixels, segmentIds);

        assert.deepStrictEqual([...new Set(segmentIds)], ["6"]);
    });

    it("converts legacy files with splits before joins", () => {
        const operations = DreameCustomSegments.GET_OPERATIONS({
            splits: [{targetId: "1", newId: "6", x1: 1, y1: 2, x2: 3, y2: 4}],
            joins: [["6", "1"]],
            names: {}
        });

        assert.deepStrictEqual(operations, [
            {type: "split", targetId: "1", newId: "6", x1: 1, y1: 2, x2: 3, y2: 4},
            {type: "join", targetId: "6", sourceId: "1"}
        ]);
    });

    it("appends operations in order and drops the legacy lists", () => {
        const floorConfig = {splits: [], joins: [["1", "2"]], names: {}};

        DreameCustomSegments.APPEND_OPERATION(floorConfig, {type: "join", targetId: "1", sourceId: "4"});

        assert.deepStrictEqual(floorConfig, {
            names: {},
            operations: [
                {type: "join", targetId: "1", sourceId: "2"},
                {type: "join", targetId: "1", sourceId: "4"}
            ]
        });
    });

    it("picks a segment id that no operation uses", () => {
        assert.strictEqual(DreameCustomSegments.NEXT_SEGMENT_ID(["3", "6"], [
            {type: "split", targetId: "6", newId: "11", x1: 0, y1: 0, x2: 1, y2: 1}
        ]), "12");
        assert.strictEqual(DreameCustomSegments.NEXT_SEGMENT_ID([], []), "6");
    });
});
