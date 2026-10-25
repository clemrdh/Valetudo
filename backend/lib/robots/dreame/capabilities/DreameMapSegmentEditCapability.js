const DreameCustomSegments = require("../DreameCustomSegments");
const DreameMapParser = require("../DreameMapParser");
const fs = require("fs");
const mapEntities = require("../../../entities/map");
const MapSegmentEditCapability = require("../../../core/capabilities/MapSegmentEditCapability");
const RobotFirmwareError = require("../../../core/RobotFirmwareError");

const CUSTOM_SEGMENTS_FILE = "/data/maps_backup/custom_segments.json";
const CURRENT_FLOOR_FILE = "/data/maps_backup/current_floor.txt";

/**
 * @extends MapSegmentEditCapability<import("../DreameValetudoRobot")>
 */
class DreameMapSegmentEditCapability extends MapSegmentEditCapability {
    /**
     *
     * @param {object} options
     * @param {import("../DreameValetudoRobot")} options.robot
     *
     * @param {object} options.miot_actions
     * @param {object} options.miot_actions.map_edit
     * @param {number} options.miot_actions.map_edit.siid
     * @param {number} options.miot_actions.map_edit.aiid
     *
     * @param {object} options.miot_properties
     * @param {object} options.miot_properties.mapDetails
     * @param {number} options.miot_properties.mapDetails.piid
     * @param {object} options.miot_properties.actionResult
     * @param {number} options.miot_properties.actionResult.piid
     *
     */
    constructor(options) {
        super(options);

        this.miot_actions = options.miot_actions;
        this.miot_properties = options.miot_properties;
    }

    /**
     * @private
     */
    readCustomSegments() {
        const activeFloor = fs.existsSync(CURRENT_FLOOR_FILE) ?
            fs.readFileSync(CURRENT_FLOOR_FILE, "utf8").trim() :
            "default";
        let all = {};
        try {
            if (fs.existsSync(CUSTOM_SEGMENTS_FILE)) {
                all = JSON.parse(fs.readFileSync(CUSTOM_SEGMENTS_FILE, "utf8"));
            }
        } catch (e) {
            all = {};
        }
        if (!all[activeFloor]) {
            all[activeFloor] = {operations: [], names: {}};
        }
        return {activeFloor, all, cfg: all[activeFloor]};
    }

    /**
     * @private
     */
    async refreshFromDat2() {
        try {
            if (fs.existsSync("/data/ri/1.dat2") && typeof this.robot.preprocessAndParseMap === "function") {
                const dat2 = JSON.parse(fs.readFileSync("/data/ri/1.dat2", "utf8"));
                if (dat2.last_app_map) {
                    await this.robot.preprocessAndParseMap(dat2.last_app_map);
                }
            }
        } catch (e) {
            // ignore
        }
        this.robot.pollMap();
    }

    /**
     * @param {import("../../../entities/core/ValetudoMapSegment")} segmentA
     * @param {import("../../../entities/core/ValetudoMapSegment")} segmentB
     * @returns {Promise<void>}
     */
    async joinSegments(segmentA, segmentB) {
        const isAutoSegmented = (this.robot?.state?.map?.layers ?? []).some(l => {
            return l.type === "segment" && l.metaData?.autoSegmented === true;
        });

        if (isAutoSegmented) {
            const {all, cfg} = this.readCustomSegments();
            DreameCustomSegments.APPEND_OPERATION(cfg, {
                type: "join",
                targetId: String(segmentA.id),
                sourceId: String(segmentB.id)
            });

            // Names are stored by id, so the merged room would lose the name of B otherwise
            cfg.names = cfg.names ?? {};
            if (!cfg.names[String(segmentA.id)] && cfg.names[String(segmentB.id)]) {
                cfg.names[String(segmentA.id)] = cfg.names[String(segmentB.id)];
            }
            fs.writeFileSync(CUSTOM_SEGMENTS_FILE, JSON.stringify(all, null, 2), "utf8");
            await this.refreshFromDat2();
            return;
        }

        const res = await this.robot.sendCommand("action",
            {
                did: this.robot.deviceId,
                siid: this.miot_actions.map_edit.siid,
                aiid: this.miot_actions.map_edit.aiid,
                in: [
                    {
                        piid: this.miot_properties.mapDetails.piid,
                        value: JSON.stringify({
                            msr: [parseInt(segmentA.id), parseInt(segmentB.id)]
                        })
                    }
                ]
            },
            {timeout: 5000}
        );

        if (
            res && res.siid === this.miot_actions.map_edit.siid &&
            res.aiid === this.miot_actions.map_edit.aiid &&
            Array.isArray(res.out) && res.out.length === 1 &&
            res.out[0].piid === this.miot_properties.actionResult.piid
        ) {
            switch (res.out[0].value) {
                case 0:
                    this.robot.pollMap();
                    return;
                case 1:
                    throw new RobotFirmwareError("Segment join failed. Can't join segments that aren't adjacent to each other.");
                default:
                    throw new RobotFirmwareError("Got error " + res.out[0].value + " while merging segments.");
            }
        }
    }

    /**
     * @param {import("../../../entities/core/ValetudoMapSegment")} segment
     * @param {object} pA
     * @param {number} pA.x
     * @param {number} pA.y
     * @param {object} pB
     * @param {number} pB.x
     * @param {number} pB.y
     * @returns {Promise<void>}
     */
    async splitSegment(segment, pA, pB) {
        const mapLayers = this.robot?.state?.map?.layers ?? [];
        const isAutoSegmented = mapLayers.some(l => {
            return l.type === "segment" && l.metaData?.autoSegmented === true;
        });

        if (isAutoSegmented) {
            const pixelSize = this.robot?.state?.map?.pixelSize ?? 5;
            const layer = mapLayers.find(l => {
                return l.type === "segment" && String(l.metaData?.segmentId) === String(segment.id);
            });
            const flatPixels = mapEntities.MapLayer.DECOMPRESS_PIXELS(layer?.compressedPixels);
            const pixels = [];
            for (let i = 0; i < flatPixels.length; i += 2) {
                pixels.push([flatPixels[i], flatPixels[i + 1]]);
            }

            const plan = DreameCustomSegments.PLAN_SPLIT(pixels, {
                x1: pA.x / pixelSize,
                y1: pA.y / pixelSize,
                x2: pB.x / pixelSize,
                y2: pB.y / pixelSize
            });

            switch (plan.result) {
                case "not_closed":
                    throw new RobotFirmwareError("Failed to split segment. Both ends of the cutting line need to be connected with a wall surrounding the chosen segment, and the two parts must not touch anywhere else.");
                case "too_small":
                    throw new RobotFirmwareError("Failed to split segment. At least one of the resulting segments is too small.");
            }

            const {all, cfg} = this.readCustomSegments();
            const operations = DreameCustomSegments.GET_OPERATIONS(cfg);
            const newId = DreameCustomSegments.NEXT_SEGMENT_ID(
                mapLayers.map(l => {
                    return l.metaData?.segmentId;
                }),
                operations
            );
            DreameCustomSegments.APPEND_OPERATION(cfg, Object.assign({
                type: "split",
                targetId: String(segment.id),
                newId: newId
            }, plan.line));
            fs.writeFileSync(CUSTOM_SEGMENTS_FILE, JSON.stringify(all, null, 2), "utf8");
            await this.refreshFromDat2();
            return;
        }

        pA = DreameMapParser.CONVERT_TO_DREAME_COORDINATES(pA.x, pA.y);
        pB = DreameMapParser.CONVERT_TO_DREAME_COORDINATES(pB.x, pB.y);

        const res = await this.robot.sendCommand("action",
            {
                did: this.robot.deviceId,
                siid: this.miot_actions.map_edit.siid,
                aiid: this.miot_actions.map_edit.aiid,
                in: [
                    {
                        piid: this.miot_properties.mapDetails.piid,
                        value: JSON.stringify({
                            dsr: [pA.x, pA.y, pB.x, pB.y],
                            dsrid: [pA.x, pA.y, pB.x, pB.y, parseInt(segment.id)]
                        })
                    }
                ]
            },
            {timeout: 5000}
        );

        if (
            res && res.siid === this.miot_actions.map_edit.siid &&
            res.aiid === this.miot_actions.map_edit.aiid &&
            Array.isArray(res.out) && res.out.length === 1 &&
            res.out[0].piid === this.miot_properties.actionResult.piid
        ) {
            switch (res.out[0].value) {
                case 0:
                    this.robot.pollMap();
                    return;
                case 5:
                    throw new RobotFirmwareError("Failed to split segment. Both ends of the cutting line need to be connected with a wall surrounding the chosen segment.");
                case 6:
                    throw new RobotFirmwareError("Failed to split segment. At least one of the resulting segments is too small.");
                default:
                    throw new RobotFirmwareError("Got error " + res.out[0].value + " while splitting segments.");
            }
        }
    }
}

module.exports = DreameMapSegmentEditCapability;
