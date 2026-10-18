const DreameMapParser = require("../DreameMapParser");
const entities = require("../../../entities");
const MapSegmentationCapability = require("../../../core/capabilities/MapSegmentationCapability");

/**
 * @extends MapSegmentationCapability<import("../DreameValetudoRobot")>
 */
class DreameMapSegmentationCapability extends MapSegmentationCapability {
    /**
     *
     * @param {object} options
     * @param {import("../DreameValetudoRobot")} options.robot
     *
     * @param {object} options.miot_actions
     * @param {object} options.miot_actions.start
     * @param {number} options.miot_actions.start.siid
     * @param {number} options.miot_actions.start.aiid
     *
     * @param {object} options.miot_properties
     * @param {object} options.miot_properties.mode
     * @param {object} options.miot_properties.mode.piid
     * @param {object} options.miot_properties.additionalCleanupParameters
     * @param {number} options.miot_properties.additionalCleanupParameters.piid
     *
     * @param {number} options.segmentCleaningModeId
     * @param {number} options.iterationsSupported
     * @param {boolean} options.customOrderSupported
     * 
     * @param {boolean} [options.newOrder]
     */
    constructor(options) {
        super(options);

        this.miot_actions = options.miot_actions;
        this.miot_properties = options.miot_properties;

        this.segmentCleaningModeId = options.segmentCleaningModeId;
        this.iterationsSupported = options.iterationsSupported;
        this.customOrderSupported = options.customOrderSupported;

        this.newOrder = !!options.newOrder;
    }
    /**
     *
     * @param {Array<import("../../../entities/core/ValetudoMapSegment")>} segments
     * @param {object} [options]
     * @param {number} [options.iterations]
     * @param {boolean} [options.customOrder]
     * @returns {Promise<void>}
     */
    async executeSegmentAction(segments, options) {
        const FanSpeedStateAttribute = this.robot.state.getFirstMatchingAttribute({
            attributeClass: entities.state.attributes.PresetSelectionStateAttribute.name,
            attributeType: entities.state.attributes.PresetSelectionStateAttribute.TYPE.FAN_SPEED
        });
        const WaterGradeAttribute = this.robot.state.getFirstMatchingAttribute({
            attributeClass: entities.state.attributes.PresetSelectionStateAttribute.name,
            attributeType: entities.state.attributes.PresetSelectionStateAttribute.TYPE.WATER_GRADE
        });

        let fanSpeed = FanSpeedStateAttribute?.metaData?.rawValue ?? 1;
        let waterGrade = WaterGradeAttribute?.metaData?.rawValue ?? 1;

        const mapLayers = this.robot?.state?.map?.layers ?? [];
        const pixelSize = this.robot?.state?.map?.pixelSize ?? 5;
        const isAutoSegmented = mapLayers.some(l => {
            return l.type === "segment" && l.metaData?.autoSegmented === true;
        });

        if (isAutoSegmented) {
            const zones = [];
            const iterations = typeof options?.iterations === "number" ? options.iterations : 1;

            segments.forEach(seg => {
                const layer = mapLayers.find(l => {
                    return l.type === "segment" && String(l.metaData?.segmentId) === String(seg.id);
                });

                if (layer && layer.dimensions) {
                    const xMin = layer.dimensions.x.min * pixelSize;
                    const xMax = (layer.dimensions.x.max + 1) * pixelSize;
                    const yMin = layer.dimensions.y.min * pixelSize;
                    const yMax = (layer.dimensions.y.max + 1) * pixelSize;
                    const pA = DreameMapParser.CONVERT_TO_DREAME_COORDINATES(xMin, yMin);
                    const pC = DreameMapParser.CONVERT_TO_DREAME_COORDINATES(xMax, yMax);

                    zones.push([
                        Math.min(pA.x, pC.x),
                        Math.min(pA.y, pC.y),
                        Math.max(pA.x, pC.x),
                        Math.max(pA.y, pC.y),
                        iterations,
                        fanSpeed,
                        waterGrade
                    ]);
                }
            });

            if (zones.length > 0) {
                await this.robot.miotHelper.executeAction(
                    this.miot_actions.start.siid,
                    this.miot_actions.start.aiid,
                    [
                        {
                            piid: this.miot_properties.mode.piid,
                            value: 19
                        },
                        {
                            piid: this.miot_properties.additionalCleanupParameters.piid,
                            value: JSON.stringify({"areas": zones})
                        }
                    ]
                );
                return;
            }
        }

        const mappedSegments = segments.map((segment, i) => {
            return [
                parseInt(segment.id),
                typeof options?.iterations === "number" ? options.iterations : 1,
                fanSpeed,
                waterGrade,
                this.newOrder ? 1 : i + 1 // on older robots, this determines the order in which the segments should be cleaned
            ];
        });

        await this.robot.miotHelper.executeAction(
            this.miot_actions.start.siid,
            this.miot_actions.start.aiid,
            [
                {
                    piid: this.miot_properties.mode.piid,
                    value: this.segmentCleaningModeId
                },
                {
                    piid: this.miot_properties.additionalCleanupParameters.piid,
                    value: JSON.stringify({"selects": mappedSegments})
                }
            ]
        );
    }

    /**
     * @returns {import("../../../core/capabilities/MapSegmentationCapability").MapSegmentationCapabilityProperties}
     */
    getProperties() {
        return {
            iterationCount: {
                min: 1,
                max: this.iterationsSupported
            },
            customOrderSupport: this.customOrderSupported
        };
    }
}

module.exports = DreameMapSegmentationCapability;
