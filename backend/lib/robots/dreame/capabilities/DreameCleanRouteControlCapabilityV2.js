const fs = require("fs");
const CleanRouteControlCapability = require("../../../core/capabilities/CleanRouteControlCapability");
const DreameMiotServices = require("../DreameMiotServices");
const DreameUtils = require("../DreameUtils");
const Logger = require("../../../Logger");

/**
 * @extends CleanRouteControlCapability<import("../DreameValetudoRobot")>
 */
class DreameCleanRouteControlCapabilityV2 extends CleanRouteControlCapability {

    /**
     * @param {object} options
     * @param {import("../DreameValetudoRobot")} options.robot
     * @param {boolean} [options.quickSupported]
     */
    constructor(options) {
        super(options);

        this.siid = DreameMiotServices["GEN2"].VACUUM_2.SIID;
        this.piid = DreameMiotServices["GEN2"].VACUUM_2.PROPERTIES.MISC_TUNABLES.PIID;

        this.quickSupported = options.quickSupported ?? true;
    }

    async getRoute() {
        const res = await this.robot.miotHelper.readProperty(this.siid, this.piid);
        const deserializedResponse = DreameUtils.DESERIALIZE_MISC_TUNABLES(res);

        let rawRoute = deserializedResponse.CleanRoute;

        // During selectclean/orderclean, node_lethe.so (0x894690) returns current_cleansets[0].clean_route
        // instead of the persisted CleanRoute in robot_state.json if custom_clean_set is active.
        try {
            const stateRaw = fs.readFileSync("/data/zt_conmon_file/robot_state.json", "utf8");
            const stateArr = JSON.parse(stateRaw);
            const entry = Array.isArray(stateArr) ? stateArr.find(e => e && e.k === "CleanRoute") : null;

            if (entry && [1, 2, 3, 4].includes(entry.v)) {
                rawRoute = entry.v;
            }
        } catch (e) {
            // Fallback to MIOT response if robot_state.json is not readable
        }

        switch (rawRoute) {
            case 4:
                return DreameCleanRouteControlCapabilityV2.ROUTE.QUICK;
            case 3:
                return DreameCleanRouteControlCapabilityV2.ROUTE.DEEP;
            case 2:
                return DreameCleanRouteControlCapabilityV2.ROUTE.INTENSIVE;
            case 1:
                return DreameCleanRouteControlCapabilityV2.ROUTE.NORMAL;
            default:
                throw new Error(`Received invalid value ${rawRoute}`);
        }
    }

    async setRoute(newRoute) {
        let val;

        switch (newRoute) {
            case DreameCleanRouteControlCapabilityV2.ROUTE.QUICK:
                val = 4;
                break;
            case DreameCleanRouteControlCapabilityV2.ROUTE.DEEP:
                val = 3;
                break;
            case DreameCleanRouteControlCapabilityV2.ROUTE.INTENSIVE:
                val = 2;
                break;
            case DreameCleanRouteControlCapabilityV2.ROUTE.NORMAL:
                val = 1;
                break;
            default:
                throw new Error(`Received invalid value ${newRoute}`);
        }

        await this.robot.miotHelper.writeProperty(
            DreameMiotServices["GEN2"].VACUUM_2.SIID,
            DreameMiotServices["GEN2"].VACUUM_2.PROPERTIES.MISC_TUNABLES.PIID,
            DreameUtils.SERIALIZE_MISC_TUNABLES_SINGLE_TUNABLE({
                CleanRoute: val
            })
        );

        // In node_lethe.so, writing MISC_TUNABLES (4.50) updates Blackboard clean_route (0x891738)
        // but does NOT set clean_set_change = 1, so PlanCleansets::tick() (0xeed1c in liblethe_tactics_tree.so)
        // does not push the new trajectory to a running job unless MOP_DOCK_SETTINGS (4.23) is also written (0x587efc).
        // Furthermore, HandleCleanPrefer (0xe52b0) only applies Intensive (2) and Deep (3) when operationMode is Mop (1).
        try {
            const mopDockRes = await this.robot.miotHelper.readProperty(
                DreameMiotServices["GEN2"].VACUUM_2.SIID,
                DreameMiotServices["GEN2"].VACUUM_2.PROPERTIES.MOP_DOCK_SETTINGS.PIID
            );

            if (mopDockRes !== null && mopDockRes !== undefined) {
                const deserialized = DreameUtils.DESERIALIZE_MOP_DOCK_SETTINGS(mopDockRes);
                let targetOpMode = deserialized.operationMode;

                if (
                    (val === 2 || val === 3) &&
                    (targetOpMode === 0 || targetOpMode === 2)
                ) {
                    targetOpMode = 1; // Switch to Mop mode so firmware applies Intensive / Deep route
                }

                await this.robot.miotHelper.writeProperty(
                    DreameMiotServices["GEN2"].VACUUM_2.SIID,
                    DreameMiotServices["GEN2"].VACUUM_2.PROPERTIES.MOP_DOCK_SETTINGS.PIID,
                    DreameUtils.SERIALIZE_MOP_DOCK_SETTINGS({
                        waterGrade: deserialized.waterGrade,
                        padCleaningFrequency: deserialized.padCleaningFrequency,
                        operationMode: targetOpMode
                    })
                );

                await this.robot.pollState();
            }
        } catch (e) {
            Logger.warn("Failed to trigger live clean_set_change on MOP_DOCK_SETTINGS after setRoute", e);
        }
    }

    getProperties() {
        const properties = {
            supportedRoutes: [
                DreameCleanRouteControlCapabilityV2.ROUTE.NORMAL,
                DreameCleanRouteControlCapabilityV2.ROUTE.INTENSIVE,
                DreameCleanRouteControlCapabilityV2.ROUTE.DEEP,
            ],
            mopOnly: [
                DreameCleanRouteControlCapabilityV2.ROUTE.INTENSIVE,
                DreameCleanRouteControlCapabilityV2.ROUTE.DEEP,
            ],
            oneTime: []
        };

        if (this.quickSupported) {
            properties.supportedRoutes.unshift(DreameCleanRouteControlCapabilityV2.ROUTE.QUICK);
        }

        return properties;
    }
}

module.exports = DreameCleanRouteControlCapabilityV2;
