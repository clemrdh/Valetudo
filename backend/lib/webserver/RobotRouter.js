const child_process = require("child_process");
const express = require("express");
const fs = require("fs");
const path = require("path");

const Logger = require("../Logger");
const stateAttrs = require("../entities/state/attributes");
const ValetudoRobot = require("../core/ValetudoRobot");

const CapabilitiesRouter = require("./CapabilitiesRouter");
const {SSEHub, SSEMiddleware} = require("./middlewares/sse");

const MAPS_BACKUP_DIR = "/data/maps_backup";
const MAPS_META_FILE = "/data/maps_backup/maps_meta.json";
const CURRENT_FLOOR_FILE = "/data/maps_backup/current_floor.txt";

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
                        setTimeout(() => {
                            this.robot.pollMap().catch(() => {});
                        }, 3500);
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
                                updatedAt: new Date().toISOString()
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
                            updatedAt: new Date().toISOString()
                        });
                        meta.activeMapId = newId;
                        this.writeMapsMeta(meta);

                        setTimeout(() => {
                            this.robot.pollMap().catch(() => {});
                        }, 3500);

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
                            }, 7500);
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
                        setTimeout(() => {
                            this.robot.pollMap().catch(() => {});
                        }, 3500);
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
