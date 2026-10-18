const fs = require("fs");
const MapSegmentRenameCapability = require("../../../core/capabilities/MapSegmentRenameCapability");
const RobotFirmwareError = require("../../../core/RobotFirmwareError");

const CUSTOM_SEGMENTS_FILE = "/data/maps_backup/custom_segments.json";
const CURRENT_FLOOR_FILE = "/data/maps_backup/current_floor.txt";

/**
 * @extends MapSegmentRenameCapability<import("../DreameValetudoRobot")>
 */
class DreameMapSegmentRenameCapability extends MapSegmentRenameCapability {
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
     * @param {import("../../../entities/core/ValetudoMapSegment")} segment
     * @param {string} name
     * @returns {Promise<void>}
     */
    async renameSegment(segment, name) {
        try {
            const activeFloor = fs.existsSync(CURRENT_FLOOR_FILE) ?
                fs.readFileSync(CURRENT_FLOOR_FILE, "utf8").trim() :
                "default";
            let all = {};
            if (fs.existsSync(CUSTOM_SEGMENTS_FILE)) {
                all = JSON.parse(fs.readFileSync(CUSTOM_SEGMENTS_FILE, "utf8"));
            }
            if (!all[activeFloor]) {
                all[activeFloor] = {splits: [], joins: [], names: {}};
            }
            if (!all[activeFloor].names) {
                all[activeFloor].names = {};
            }
            all[activeFloor].names[String(segment.id)] = name;
            fs.writeFileSync(CUSTOM_SEGMENTS_FILE, JSON.stringify(all, null, 2), "utf8");
        } catch (e) {
            // ignore
        }

        const mapLayers = this.robot?.state?.map?.layers ?? [];
        const isAutoSegmented = mapLayers.some(l => {
            return l.type === "segment" && l.metaData?.autoSegmented === true;
        });

        if (isAutoSegmented) {
            mapLayers.forEach(l => {
                if (l.type === "segment" && String(l.metaData?.segmentId) === String(segment.id)) {
                    l.metaData.name = name;
                }
            });
            if (typeof this.robot.emitMapUpdated === "function") {
                this.robot.emitMapUpdated();
            }
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
                            nsr: {
                                [segment.id]: {
                                    type: 0, //custom name?
                                    name: Buffer.from(name).toString("base64")
                                }
                            }
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
                default:
                    throw new RobotFirmwareError("Got error " + res.out[0].value + " while naming segment.");
            }
        }
    }
}

module.exports = DreameMapSegmentRenameCapability;
