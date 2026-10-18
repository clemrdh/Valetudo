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
     * @param {string} [options.fanSpeed]
     * @param {string} [options.waterGrade]
     * @param {Object.<string, {iterations?: number, fanSpeed?: string, waterGrade?: string, operationMode?: string}>} [options.perSegmentConfigs]
     * @returns {Promise<void>}
     */
    async executeSegmentAction(segments, options) {
        const FAN_SPEED_MAP = {
            low: 0,
            medium: 1,
            high: 2,
            max: 3,
            turbo: 3
        };
        const WATER_GRADE_MAP = {
            low: 1,
            medium: 2,
            high: 3
        };

        const FanSpeedStateAttribute = this.robot.state.getFirstMatchingAttribute({
            attributeClass: entities.state.attributes.PresetSelectionStateAttribute.name,
            attributeType: entities.state.attributes.PresetSelectionStateAttribute.TYPE.FAN_SPEED
        });
        const WaterGradeAttribute = this.robot.state.getFirstMatchingAttribute({
            attributeClass: entities.state.attributes.PresetSelectionStateAttribute.name,
            attributeType: entities.state.attributes.PresetSelectionStateAttribute.TYPE.WATER_GRADE
        });

        let defaultFanSpeed = FanSpeedStateAttribute?.metaData?.rawValue ?? 1;
        let defaultWaterGrade = WaterGradeAttribute?.metaData?.rawValue ?? 2;

        if (options?.fanSpeed && FAN_SPEED_MAP[options.fanSpeed] !== undefined) {
            defaultFanSpeed = FAN_SPEED_MAP[options.fanSpeed];
        }
        if (options?.waterGrade && WATER_GRADE_MAP[options.waterGrade] !== undefined) {
            defaultWaterGrade = WATER_GRADE_MAP[options.waterGrade];
        }

        const defaultIterations = typeof options?.iterations === "number" ? options.iterations : 1;
        const perSegmentConfigs = options?.perSegmentConfigs || {};

        const resolveSegParams = (segId) => {
            const cfg = perSegmentConfigs[String(segId)] || {};
            const segIter = typeof cfg.iterations === "number" && cfg.iterations >= 1 && cfg.iterations <= 3 ?
                cfg.iterations :
                defaultIterations;
            const segFan = cfg.fanSpeed && FAN_SPEED_MAP[cfg.fanSpeed] !== undefined ?
                FAN_SPEED_MAP[cfg.fanSpeed] :
                defaultFanSpeed;
            const segWater = cfg.waterGrade && WATER_GRADE_MAP[cfg.waterGrade] !== undefined ?
                WATER_GRADE_MAP[cfg.waterGrade] :
                defaultWaterGrade;

            return {
                iterations: segIter,
                fanSpeed: segFan,
                waterGrade: segWater
            };
        };

        const mapLayers = this.robot?.state?.map?.layers ?? [];
        const pixelSize = this.robot?.state?.map?.pixelSize ?? 5;
        const isAutoSegmented = mapLayers.some(l => {
            return l.type === "segment" && l.metaData?.autoSegmented === true;
        });

        if (isAutoSegmented) {
            const zones = [];

            segments.forEach(seg => {
                const layer = mapLayers.find(l => {
                    return l.type === "segment" && String(l.metaData?.segmentId) === String(seg.id);
                });

                if (layer && layer.dimensions) {
                    const params = resolveSegParams(seg.id);
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
                        params.iterations,
                        params.fanSpeed,
                        params.waterGrade
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
            const params = resolveSegParams(segment.id);

            return [
                parseInt(segment.id),
                params.iterations,
                params.fanSpeed,
                params.waterGrade,
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
