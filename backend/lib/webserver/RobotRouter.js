const child_process = require("child_process");
const express = require("express");
const fs = require("fs");
const path = require("path");

const Logger = require("../Logger");
const stateAttrs = require("../entities/state/attributes");
const ValetudoMapSegment = require("../entities/core/ValetudoMapSegment");
const ValetudoRobot = require("../core/ValetudoRobot");

const CapabilitiesRouter = require("./CapabilitiesRouter");
const {SSEHub, SSEMiddleware} = require("./middlewares/sse");

const MAPS_BACKUP_DIR = "/data/maps_backup";
const MAPS_META_FILE = "/data/maps_backup/maps_meta.json";
const CURRENT_FLOOR_FILE = "/data/maps_backup/current_floor.txt";
const ROOM_CONFIGS_FILE = "/data/maps_backup/room_clean_configs.json";

const DEFAULT_GLOBAL_CONFIG = {
    mode: "vacuum_and_mop",
    fanSpeed: "medium",
    waterGrade: "medium",
    iterations: 1
};

class RobotRouter {
    /**
     *
     * @param {object} options
     * @param {import("../core/ValetudoRobot")} options.robot
     * @param {*} options.validator
     */
    constructor(options) {
        this.robot = options.robot;
        this.router = express.Router({mergeParams: true});

        this.validator = options.validator;

        this.initRoutes();
        this.initSSE();
    }

    getActiveFloorId() {
        try {
            if (fs.existsSync(CURRENT_FLOOR_FILE)) {
                const cur = fs.readFileSync(CURRENT_FLOOR_FILE, "utf8").trim();

                if (cur) {
                    return cur;
                }
            }
        } catch (err) {
            // ignore
        }

        return "etage_1";
    }

    readRoomConfigs() {
        const activeFloor = this.getActiveFloorId();
        let allConfigs = {};

        try {
            if (fs.existsSync(ROOM_CONFIGS_FILE)) {
                allConfigs = JSON.parse(fs.readFileSync(ROOM_CONFIGS_FILE, "utf8")) || {};
            }
        } catch (err) {
            Logger.warn("Failed to read room_clean_configs.json", err);
        }

        const floorData = allConfigs[activeFloor] || {};

        return {
            activeFloor: activeFloor,
            useCustomPerRoom: Boolean(floorData.useCustomPerRoom),
            globalConfig: Object.assign({}, DEFAULT_GLOBAL_CONFIG, floorData.globalConfig || {}),
            rooms: floorData.rooms || {}
        };
    }

    writeRoomConfigs(payload) {
        const activeFloor = this.getActiveFloorId();
        let allConfigs = {};

        try {
            fs.mkdirSync(MAPS_BACKUP_DIR, {recursive: true});
            if (fs.existsSync(ROOM_CONFIGS_FILE)) {
                allConfigs = JSON.parse(fs.readFileSync(ROOM_CONFIGS_FILE, "utf8")) || {};
            }
        } catch (err) {
            // ignore
        }

        const current = allConfigs[activeFloor] || {
            useCustomPerRoom: false,
            globalConfig: Object.assign({}, DEFAULT_GLOBAL_CONFIG),
            rooms: {}
        };

        if (typeof payload.useCustomPerRoom === "boolean") {
            current.useCustomPerRoom = payload.useCustomPerRoom;
        }
        if (payload.globalConfig && typeof payload.globalConfig === "object") {
            current.globalConfig = Object.assign({}, current.globalConfig, payload.globalConfig);
        }
        if (payload.rooms && typeof payload.rooms === "object") {
            current.rooms = Object.assign({}, current.rooms, payload.rooms);
        }

        allConfigs[activeFloor] = current;

        try {
            fs.writeFileSync(`${ROOM_CONFIGS_FILE}.tmp`, JSON.stringify(allConfigs, null, 2), "utf8");
            fs.renameSync(`${ROOM_CONFIGS_FILE}.tmp`, ROOM_CONFIGS_FILE);
        } catch (err) {
            Logger.error("Failed to write room_clean_configs.json", err);
        }

        return {
            activeFloor: activeFloor,
            useCustomPerRoom: current.useCustomPerRoom,
            globalConfig: current.globalConfig,
            rooms: current.rooms
        };
    }

    readMapsMeta() {
        let meta = {
            activeMapId: "etage_1",
            maps: []
        };

        try {
            if (fs.existsSync(MAPS_META_FILE)) {
                const parsed = JSON.parse(fs.readFileSync(MAPS_META_FILE, "utf8"));

                if (parsed && Array.isArray(parsed.maps)) {
                    meta = parsed;
                }
            }
        } catch (err) {
            Logger.warn("Failed to read maps_meta.json", err);
        }

        try {
            if (fs.existsSync(CURRENT_FLOOR_FILE)) {
                const cur = fs.readFileSync(CURRENT_FLOOR_FILE, "utf8").trim();

                if (cur) {
                    meta.activeMapId = cur;
                }
            }
        } catch (err) {
            // ignore
        }

        if (meta.maps.length === 0) {
            meta.maps = [
                {
                    id: "etage_1",
                    name: "Étage 1",
                    updatedAt: new Date().toISOString()
                },
                {
                    id: "etage_2",
                    name: "Étage 2",
                    updatedAt: new Date().toISOString()
                }
            ];
        }

        const enrichedMaps = meta.maps.map(m => {
            const archivePath = path.join(MAPS_BACKUP_DIR, `${m.id}.tar.gz`);
            let size = 0;
            let exists = false;

            try {
                if (fs.existsSync(archivePath)) {
                    const stat = fs.statSync(archivePath);

                    size = stat.size;
                    exists = true;
                }
            } catch (err) {
                // ignore
            }

            return {
                id: m.id,
                name: m.name,
                updatedAt: m.updatedAt,
                exists: exists,
                size: size
            };
        });

        return {
            activeMapId: meta.activeMapId,
            maps: enrichedMaps
        };
    }

    writeMapsMeta(meta) {
        try {
            fs.mkdirSync(MAPS_BACKUP_DIR, {recursive: true});
            const cleanMeta = {
                activeMapId: meta.activeMapId,
                maps: meta.maps.map(m => {
                    return {
                        id: m.id,
                        name: m.name,
                        updatedAt: m.updatedAt || new Date().toISOString()
                    };
                })
            };

            fs.writeFileSync(`${MAPS_META_FILE}.tmp`, JSON.stringify(cleanMeta, null, 2), "utf8");
            fs.renameSync(`${MAPS_META_FILE}.tmp`, MAPS_META_FILE);

            if (meta.activeMapId) {
                fs.writeFileSync(CURRENT_FLOOR_FILE, `${meta.activeMapId}\n`, "utf8");
            }
        } catch (err) {
            Logger.error("Failed to write maps_meta.json", err);
        }
    }

    execMapManager(args) {
        return new Promise((resolve, reject) => {
            child_process.execFile("/data/map_manager.sh", args, {timeout: 25000}, (err, stdout, stderr) => {
                if (err) {
                    Logger.error("map_manager.sh error", {err: err, stdout: stdout, stderr: stderr});
                    reject(new Error(stderr || err.message));
                } else {
                    resolve(stdout);
                }
            });
        });
    }

    async loadImmediateMapPreview() {
        try {
            const dat2Path = "/data/ri/1.dat2";
            if (fs.existsSync(dat2Path) && typeof this.robot.preprocessAndParseMap === "function") {
                const dat2 = JSON.parse(fs.readFileSync(dat2Path, "utf8"));
                if (dat2 && dat2.last_app_map) {
                    await this.robot.preprocessAndParseMap(dat2.last_app_map);
                }
            }
        } catch (e) {
            Logger.warn("Unable to load immediate map preview from /data/ri/1.dat2", e);
        }
    }

    scheduleMapPolls() {
        [5000, 10000, 16000, 22000].forEach(delay => {
            setTimeout(() => {
                try {
                    this.robot.pollMap();
                } catch (e) {
                    // ignore
                }
            }, delay);
        });
    }


    initRoutes() {
        this.router.get("/", (req, res) => {
            res.json({
                manufacturer: this.robot.getManufacturer(),
                modelName: this.robot.getModelName(),
                modelDetails: this.robot.getModelDetails(),
                implementation: this.robot.constructor.name
            });
        });

        this.router.get("/properties", (req, res) => {
            res.json(this.robot.getProperties());
        });

        this.router.get("/state", async (req, res) => {
            try {
                const polledState = await this.robot.pollState();

                res.json(polledState);
            } catch (err) {
                res.status(500).send(err.toString());
            }
        });

        this.router.get("/state/attributes", async (req, res) => {
            try {
                const polledState = await this.robot.pollState();

                res.json(polledState.attributes);
            } catch (err) {
                res.status(500).send(err.toString());
            }
        });

        this.router.get("/state/map", async (req, res) => {
            try {
                res.json(this.robot.state.map);
            } catch (err) {
                res.status(500).send(err.toString());
            }
        });

        this.router.get("/maps", (req, res) => {
            try {
                res.json(this.readMapsMeta());
            } catch (err) {
                res.status(500).send(err.toString());
            }
        });

        this.router.post("/maps", async (req, res) => {
            try {
                const action = req.body?.action;
                const id = req.body?.id ? String(req.body.id).trim() : "";
                const name = req.body?.name ? String(req.body.name).trim() : "";
                const meta = this.readMapsMeta();
                const statusState = this.robot.state.getFirstMatchingAttribute({
                    attributeClass: stateAttrs.StatusStateAttribute.name
                });

                switch (action) {
                    case "select":
                    case "load": {
                        if (statusState?.isActiveState) {
                            res.status(400).json({message: "Le robot doit être à l'arrêt pour changer de carte."});
                            return;
                        }
                        if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
                            res.status(400).json({message: "Identifiant de carte invalide."});
                            return;
                        }
                        await this.execMapManager(["load", id]);
                        meta.activeMapId = id;
                        this.writeMapsMeta(meta);
                        await this.loadImmediateMapPreview();
                        this.scheduleMapPolls();
                        res.json(this.readMapsMeta());
                        break;
                    }
                    case "save": {
                        const targetId = (id && /^[a-zA-Z0-9_-]+$/.test(id)) ? id : `map_${Date.now()}`;

                        await this.execMapManager(["save", targetId]);
                        const existing = meta.maps.find(m => {
                            return m.id === targetId;
                        });

                        if (existing) {
                            if (name) {
                                existing.name = name;
                            }
                            existing.updatedAt = new Date().toISOString();
                        } else {
                            meta.maps.push({
                                id: targetId,
                                name: name || `Carte ${meta.maps.length + 1}`,
                                updatedAt: new Date().toISOString(),
                                exists: true,
                                size: 0
                            });
                        }
                        meta.activeMapId = targetId;
                        this.writeMapsMeta(meta);
                        res.json(this.readMapsMeta());
                        break;
                    }
                    case "rename": {
                        if (!id || !name) {
                            res.status(400).json({message: "Identifiant et nouveau nom requis."});
                            return;
                        }
                        const target = meta.maps.find(m => {
                            return m.id === id;
                        });

                        if (!target) {
                            res.status(404).json({message: "Carte introuvable."});
                            return;
                        }
                        target.name = name;
                        target.updatedAt = new Date().toISOString();
                        this.writeMapsMeta(meta);
                        res.json(this.readMapsMeta());
                        break;
                    }
                    case "delete": {
                        if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
                            res.status(400).json({message: "Identifiant de carte invalide."});
                            return;
                        }
                        const archivePath = path.join(MAPS_BACKUP_DIR, `${id}.tar.gz`);

                        if (fs.existsSync(archivePath)) {
                            fs.unlinkSync(archivePath);
                        }
                        meta.maps = meta.maps.filter(m => {
                            return m.id !== id;
                        });
                        if (meta.activeMapId === id && meta.maps.length > 0) {
                            meta.activeMapId = meta.maps[0].id;
                        }
                        this.writeMapsMeta(meta);
                        res.json(this.readMapsMeta());
                        break;
                    }
                    case "new_blank":
                    case "mapping_pass": {
                        if (statusState?.isActiveState) {
                            res.status(400).json({message: "Le robot doit être à l'arrêt pour créer une nouvelle carte."});
                            return;
                        }
                        const newId = `map_${Date.now()}`;
                        const newName = name || `Étage ${meta.maps.length + 1}`;

                        await this.execMapManager(["load", "nouvelle_carte_vierge"]);
                        meta.maps.push({
                            id: newId,
                            name: newName,
                            updatedAt: new Date().toISOString(),
                            exists: false,
                            size: 0
                        });
                        meta.activeMapId = newId;
                        this.writeMapsMeta(meta);

                        if (typeof this.robot.clearValetudoMap === "function") {
                            this.robot.clearValetudoMap();
                        }
                        this.scheduleMapPolls();

                        if (action === "mapping_pass") {
                            setTimeout(async () => {
                                try {
                                    if (this.robot.capabilities["MappingPassCapability"]) {
                                        await this.robot.capabilities["MappingPassCapability"].startMapping();
                                    } else if (this.robot.capabilities["BasicControlCapability"]) {
                                        await this.robot.capabilities["BasicControlCapability"].start();
                                    }
                                } catch (e) {
                                    Logger.warn("Auto start mapping pass failed, trying BasicControl start", e);
                                    try {
                                        if (this.robot.capabilities["BasicControlCapability"]) {
                                            await this.robot.capabilities["BasicControlCapability"].start();
                                        }
                                    } catch (e2) {
                                        Logger.error("Fallback start failed", e2);
                                    }
                                }
                            }, 16000);
                        }

                        res.json(this.readMapsMeta());
                        break;
                    }
                    case "reset": {
                        if (statusState?.isActiveState) {
                            res.status(400).json({message: "Le robot doit être à l'arrêt pour réinitialiser la carte."});
                            return;
                        }
                        await this.execMapManager(["load", "nouvelle_carte_vierge"]);
                        this.writeMapsMeta(meta);
                        if (typeof this.robot.clearValetudoMap === "function") {
                            this.robot.clearValetudoMap();
                        }
                        this.scheduleMapPolls();
                        res.json(this.readMapsMeta());
                        break;
                    }
                    default:
                        res.status(400).json({message: `Action inconnue: ${action}`});
                }
            } catch (err) {
                Logger.error("Error in POST /maps", err);
                res.status(500).json({message: err.message || err.toString()});
            }
        });

        this.router.get("/room_configs", (req, res) => {
            try {
                res.json(this.readRoomConfigs());
            } catch (err) {
                res.status(500).json({message: err.message || err.toString()});
            }
        });

        this.router.post("/room_configs", (req, res) => {
            try {
                const updated = this.writeRoomConfigs(req.body || {});

                res.json(updated);
            } catch (err) {
                res.status(500).json({message: err.message || err.toString()});
            }
        });

        this.router.post("/clean_segments_custom", async (req, res) => {
            try {
                const body = req.body || {};

                // Save config updates if passed
                const savedCfg = this.writeRoomConfigs({
                    useCustomPerRoom: typeof body.useCustomPerRoom === "boolean" ? body.useCustomPerRoom : undefined,
                    globalConfig: body.globalConfig,
                    rooms: body.rooms
                });

                const useCustomPerRoom = typeof body.useCustomPerRoom === "boolean" ?
                    body.useCustomPerRoom :
                    savedCfg.useCustomPerRoom;
                const globalConfig = Object.assign({}, DEFAULT_GLOBAL_CONFIG, savedCfg.globalConfig, body.globalConfig || {});
                const rooms = Object.assign({}, savedCfg.rooms, body.rooms || {});

                let segmentIds = Array.isArray(body.segment_ids) ?
                    body.segment_ids.map(s => {
                        return String(s);
                    }) :
                    [];

                if (segmentIds.length === 0 && body.cleanAll) {
                    const mapLayers = this.robot?.state?.map?.layers ?? [];

                    segmentIds = mapLayers
                        .filter(l => {
                            return l.type === "segment" && l.metaData?.segmentId !== undefined;
                        })
                        .map(l => {
                            return String(l.metaData.segmentId);
                        });
                }

                if (segmentIds.length === 0) {
                    res.status(400).json({message: "Veuillez sélectionner au moins une pièce à nettoyer."});
                    return;
                }

                const OP_MODE_INT = {
                    vacuum_and_mop: 0,
                    mop: 1,
                    vacuum: 2,
                    vacuum_then_mop: 3
                };
                const FAN_SPEED_INT = {
                    low: 0,
                    medium: 1,
                    high: 2,
                    max: 3
                };
                const WATER_GRADE_INT = {
                    low: 1,
                    medium: 2,
                    high: 3
                };

                const firstSegCfg = useCustomPerRoom ? (rooms[segmentIds[0]] || {}) : {};
                const targetMode = (useCustomPerRoom && firstSegCfg.operationMode) ?
                    firstSegCfg.operationMode :
                    (globalConfig.mode || "vacuum_and_mop");
                const targetFanSpeed = (useCustomPerRoom && firstSegCfg.fanSpeed) ?
                    firstSegCfg.fanSpeed :
                    (globalConfig.fanSpeed || "medium");
                const targetWaterGrade = (useCustomPerRoom && firstSegCfg.waterGrade) ?
                    firstSegCfg.waterGrade :
                    (globalConfig.waterGrade || "medium");
                const targetIterations = typeof globalConfig.iterations === "number" ?
                    globalConfig.iterations :
                    1;

                // Apply presets via capabilities
                if (this.robot.capabilities["OperationModeControlCapability"]) {
                    try {
                        await this.robot.capabilities["OperationModeControlCapability"].selectPreset(targetMode);
                    } catch (e) {
                        Logger.warn("Failed to set OperationModeControlCapability preset", e);
                    }
                }
                if (this.robot.capabilities["FanSpeedControlCapability"] && targetMode !== "mop") {
                    try {
                        await this.robot.capabilities["FanSpeedControlCapability"].selectPreset(targetFanSpeed);
                    } catch (e) {
                        Logger.warn("Failed to set FanSpeedControlCapability preset", e);
                    }
                }
                if (this.robot.capabilities["WaterUsageControlCapability"] && targetMode !== "vacuum") {
                    try {
                        await this.robot.capabilities["WaterUsageControlCapability"].selectPreset(targetWaterGrade);
                    } catch (e) {
                        Logger.warn("Failed to set WaterUsageControlCapability preset", e);
                    }
                }

                // Sync Dreame native customeClean and CleanType when miotHelper is available
                if (this.robot.miotHelper) {
                    try {
                        if (useCustomPerRoom) {
                            const customeCleanArr = segmentIds.map((sid, idx) => {
                                const rc = rooms[sid] || {};
                                const iter = typeof rc.iterations === "number" ? rc.iterations : 1;
                                const fan = FAN_SPEED_INT[rc.fanSpeed] ?? FAN_SPEED_INT[targetFanSpeed] ?? 1;
                                const water = WATER_GRADE_INT[rc.waterGrade] ?? WATER_GRADE_INT[targetWaterGrade] ?? 2;
                                const modeInt = OP_MODE_INT[rc.operationMode] ?? OP_MODE_INT[targetMode] ?? 0;

                                return [parseInt(sid, 10), iter, fan, water, idx + 1, modeInt, 546];
                            });

                            await this.robot.miotHelper.executeAction(6, 2, [
                                {
                                    piid: 4,
                                    value: JSON.stringify({customeClean: customeCleanArr})
                                }
                            ]);
                            await this.robot.miotHelper.writeProperty(4, 50, JSON.stringify({k: "CleanType", v: 1}));
                        } else {
                            await this.robot.miotHelper.writeProperty(4, 50, JSON.stringify({k: "CleanType", v: 0}));
                        }
                    } catch (e) {
                        Logger.warn("Optional Dreame customeClean/CleanType sync failed", e);
                    }
                }

                const segments = segmentIds.map(id => {
                    return new ValetudoMapSegment({id: id});
                });

                if (!this.robot.capabilities["MapSegmentationCapability"]) {
                    res.status(501).json({message: "MapSegmentationCapability non supportée."});
                    return;
                }

                await this.robot.capabilities["MapSegmentationCapability"].executeSegmentAction(segments, {
                    iterations: targetIterations,
                    customOrder: true,
                    fanSpeed: targetFanSpeed,
                    waterGrade: targetWaterGrade,
                    perSegmentConfigs: useCustomPerRoom ? rooms : undefined
                });

                res.sendStatus(200);
            } catch (err) {
                Logger.error("Error in POST /clean_segments_custom", err);
                res.status(500).json({message: err.message || err.toString()});
            }
        });


        this.router.use("/capabilities/", new CapabilitiesRouter({
            robot: this.robot,
            validator: this.validator
        }).getRouter());
    }

    initSSE() {
        this.sseHubs = {
            state: new SSEHub({name: "State"}),
            attributes: new SSEHub({name: "Attributes"}),
            map: new SSEHub({name: "Map"})
        };

        this.robot.onStateUpdated(() => {
            this.sseHubs.state.event(
                ValetudoRobot.EVENTS.StateUpdated,
                JSON.stringify(this.robot.state)
            );
        });

        this.robot.onStateAttributesUpdated(() => {
            this.sseHubs.attributes.event(
                ValetudoRobot.EVENTS.StateAttributesUpdated,
                JSON.stringify(this.robot.state.attributes)
            );
        });

        this.robot.onMapUpdated(() => {
            this.sseHubs.map.event(
                ValetudoRobot.EVENTS.MapUpdated,
                JSON.stringify(this.robot.state.map)
            );
        });

        this.router.get(
            "/state/sse",
            SSEMiddleware({
                hub: this.sseHubs.state,
                keepAliveInterval: 5000,
                maxClients: 5
            }),
            (req, res) => {
                //Intentional, as the response will be handled by the SSEMiddleware
            }
        );

        this.router.get(
            "/state/attributes/sse",
            SSEMiddleware({
                hub: this.sseHubs.attributes,
                keepAliveInterval: 5000,
                maxClients: 5
            }),
            (req, res) => {
                //Intentional, as the response will be handled by the SSEMiddleware
            }
        );

        this.router.get(
            "/state/map/sse",
            SSEMiddleware({
                hub: this.sseHubs.map,
                keepAliveInterval: 5000,
                maxClients: 5
            }),
            (req, res) => {
                //Intentional, as the response will be handled by the SSEMiddleware
            }
        );
    }

    getRouter() {
        return this.router;
    }

    shutdown() {
        Object.values(this.sseHubs).forEach(hub => {
            hub.shutdown();
        });
    }
}

module.exports = RobotRouter;
