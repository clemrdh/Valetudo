import BaseMap, {MapContainer, MapProps, MapState, usePendingMapAction, useSegmentSelectionStore} from "./BaseMap";
import {Capability} from "../api";
import GoToTargetClientStructure from "./structures/client_structures/GoToTargetClientStructure";
import {ActionsContainer} from "./Styled";
import SegmentActions from "./actions/live_map_actions/SegmentActions";
import SegmentLabelMapStructure from "./structures/map_structures/SegmentLabelMapStructure";
import ZoneActions from "./actions/live_map_actions/ZoneActions";
import ZoneClientStructure from "./structures/client_structures/ZoneClientStructure";
import GoToActions from "./actions/live_map_actions/GoToActions";
import MapChangeActions from "./actions/live_map_actions/MapChangeActions";
import {TapTouchHandlerEvent} from "./utils/touch_handling/events/TapTouchHandlerEvent";
import React from "react";
import {LiveMapModeSwitcher} from "./LiveMapModeSwitcher";
import {Button, Dialog, DialogActions, DialogContent, DialogTitle} from "@mui/material";


export type LiveMapMode = "segments" | "zones" | "goto" | "maps" | "none";
const LIVE_MAP_MODE_LOCAL_STORAGE_KEY = "live-map-mode";

interface LiveMapProps extends MapProps {
    supportedCapabilities: {
        [Capability.MapSegmentation]: boolean,
        [Capability.ZoneCleaning]: boolean,
        [Capability.GoToLocation]: boolean
    }
}

interface LiveMapState extends MapState {
    mode: LiveMapMode,
    zones: Array<ZoneClientStructure>,
    goToTarget: GoToTargetClientStructure | undefined
}

class LiveMap extends BaseMap<LiveMapProps, LiveMapState> {
    private readonly supportedModes: Array<LiveMapMode>;

    constructor(props: LiveMapProps) {
        super(props);

        this.supportedModes = [];

        if (props.supportedCapabilities[Capability.MapSegmentation]) {
            this.supportedModes.push("segments");
        }
        if (props.supportedCapabilities[Capability.ZoneCleaning]) {
            this.supportedModes.push("zones");
        }
        if (props.supportedCapabilities[Capability.GoToLocation]) {
            this.supportedModes.push("goto");
        }
        this.supportedModes.push("maps");

        let modeIdxToUse = 0;
        try {
            const previousMode = window.localStorage.getItem(LIVE_MAP_MODE_LOCAL_STORAGE_KEY);

            modeIdxToUse = Math.max(
                this.supportedModes.findIndex(e => e === previousMode),
                0 //default to the first if not defined or not supported
            );
        } catch (e) {
            /* users with non-working local storage will have to live with the defaults */
        }

        this.state = {
            mode: this.supportedModes[modeIdxToUse] ?? "none",
            selectedSegmentIds: [],

            dialogOpen: false,
            dialogTitle: "Hello World",
            dialogBody: "This should never be visible",

            zones: [],
            goToTarget: undefined
        };
    }

    componentDidMount(): void {
        super.componentDidMount();

        useSegmentSelectionStore.setState({
            toggleSegment: (id: string) => {
                const segmentLabels = this.structureManager.getMapStructures().filter(s => {
                    return s.type === SegmentLabelMapStructure.TYPE;
                }) as Array<SegmentLabelMapStructure>;

                const matched = segmentLabels.find(l => {
                    return String(l.id) === String(id);
                });

                if (matched) {
                    if (this.state.mode !== "segments" && this.supportedModes.includes("segments")) {
                        this.setState({mode: "segments"});
                        try {
                            window.localStorage.setItem(LIVE_MAP_MODE_LOCAL_STORAGE_KEY, "segments");
                        } catch (e) {
                            /* ignore */
                        }
                    }
                    matched.onTap();
                    this.updateState();
                    this.redrawLayers();
                }
            },
            setSelectedSegments: (ids: Array<string>) => {
                const strIds = ids.map(i => String(i));
                const segmentLabels = this.structureManager.getMapStructures().filter(s => {
                    return s.type === SegmentLabelMapStructure.TYPE;
                }) as Array<SegmentLabelMapStructure>;

                segmentLabels.forEach(l => {
                    l.selected = strIds.includes(String(l.id));
                });

                if (strIds.length > 0 && this.state.mode !== "segments" && this.supportedModes.includes("segments")) {
                    this.setState({mode: "segments"});
                    try {
                        window.localStorage.setItem(LIVE_MAP_MODE_LOCAL_STORAGE_KEY, "segments");
                    } catch (e) {
                        /* ignore */
                    }
                }

                this.setState({selectedSegmentIds: strIds}, () => {
                    this.updateState();
                    this.redrawLayers();
                });
            },
            clearSelectedSegments: () => {
                this.structureManager.getMapStructures().forEach(s => {
                    if (s.type === SegmentLabelMapStructure.TYPE) {
                        const label = s as SegmentLabelMapStructure;

                        label.selected = false;
                    }
                });
                this.updateState();
                this.redrawLayers();
            }
        });
    }

    protected updateState() : void {
        super.updateState();

        this.setState({
            zones: this.structureManager.getClientStructures().filter(s => {
                return s.type === ZoneClientStructure.TYPE;
            }) as Array<ZoneClientStructure>,
            goToTarget: this.structureManager.getClientStructures().find(s => {
                return s.type === GoToTargetClientStructure.TYPE;
            }) as GoToTargetClientStructure | undefined
        });
    }


    protected onTap(evt: TapTouchHandlerEvent): boolean | void {
        if (super.onTap(evt)) {
            return true;
        }

        const {x, y} = this.relativeCoordinatesToCanvas(evt.x0, evt.y0);
        const tappedPointInMapSpace = this.ctxWrapper.mapPointToCurrentTransform(x, y);

        switch (this.state.mode) {
            case "segments":
            case "maps":
            case "none": {
                if (!this.supportedModes.includes("segments")) {
                    break;
                }
                const intersectingSegmentId = this.mapLayerManager.getIntersectingSegment(tappedPointInMapSpace.x, tappedPointInMapSpace.y);

                if (intersectingSegmentId) {
                    const segmentLabels = this.structureManager.getMapStructures().filter(s => {
                        return s.type === SegmentLabelMapStructure.TYPE;
                    }) as Array<SegmentLabelMapStructure>;

                    const matchedSegmentLabel = segmentLabels.find(l => {
                        return l.id === intersectingSegmentId;
                    });


                    if (matchedSegmentLabel) {
                        if (this.state.mode !== "segments") {
                            this.setState({mode: "segments"});
                            try {
                                window.localStorage.setItem(LIVE_MAP_MODE_LOCAL_STORAGE_KEY, "segments");
                            } catch (e) {
                                /* ignore */
                            }
                        }
                        matchedSegmentLabel.onTap();

                        this.updateState();
                        this.redrawLayers();

                        return true;
                    }
                }

                break;
            }

            case "goto": {
                if (
                    this.structureManager.getClientStructures().filter(s => {
                        return s.type !== GoToTargetClientStructure.TYPE;
                    }).length === 0
                ) {
                    this.structureManager.getClientStructures().forEach(s => {
                        if (s.type === GoToTargetClientStructure.TYPE) {
                            this.structureManager.removeClientStructure(s);
                        }
                    });
                    this.structureManager.addClientStructure(new GoToTargetClientStructure(tappedPointInMapSpace.x, tappedPointInMapSpace.y));


                    this.updateState();
                    this.draw();

                    return true;
                }

                break;
            }
        }
    }

    componentDidUpdate(prevProps: Readonly<MapProps>, prevState: Readonly<MapState>): void {
        super.componentDidUpdate(prevProps, prevState);

        if (
            this.state.selectedSegmentIds.length > 0 ||
            this.state.zones.length > 0 ||
            this.state.goToTarget !== undefined
        ) {
            usePendingMapAction.setState({hasPendingMapAction: true});
        } else {
            usePendingMapAction.setState({hasPendingMapAction: false});
        }
    }

    render(): React.ReactElement {
        return (
            <MapContainer style={{overflow: "hidden"}}>
                <canvas
                    ref={this.canvasRef}
                    style={{
                        width: "100%",
                        height: "100%",
                        imageRendering: "crisp-edges"
                    }}
                />
                {
                    this.supportedModes.length > 0 &&
                    <LiveMapModeSwitcher
                        supportedModes={this.supportedModes}
                        currentMode={this.state.mode}
                        setMode={(newMode) => {
                            this.structureManager.getMapStructures().forEach(s => {
                                if (s.type === SegmentLabelMapStructure.TYPE) {
                                    const label = s as SegmentLabelMapStructure;

                                    label.selected = false;
                                }
                            });

                            this.structureManager.getClientStructures().forEach(s => {
                                if (s.type === GoToTargetClientStructure.TYPE) {
                                    this.structureManager.removeClientStructure(s);
                                }

                                if (s.type === ZoneClientStructure.TYPE) {
                                    this.structureManager.removeClientStructure(s);
                                }
                            });

                            this.updateState();

                            this.redrawLayers();

                            this.setState({
                                mode: newMode
                            });

                            try {
                                window.localStorage.setItem(LIVE_MAP_MODE_LOCAL_STORAGE_KEY, newMode);
                            } catch (e) {
                                /* intentional */
                            }
                        }}
                    />
                }

                <ActionsContainer>
                    {
                        this.state.mode === "segments" &&

                        <SegmentActions
                            segments={this.state.selectedSegmentIds}
                            onClear={() => {
                                this.structureManager.getMapStructures().forEach(s => {
                                    if (s.type === SegmentLabelMapStructure.TYPE) {
                                        const label = s as SegmentLabelMapStructure;

                                        label.selected = false;
                                    }
                                });
                                this.updateState();

                                this.redrawLayers();
                            }}
                        />
                    }
                    {
                        this.state.mode === "zones" &&

                        <ZoneActions
                            zones={this.state.zones}
                            convertPixelCoordinatesToCMSpace={(coordinates => {
                                return this.structureManager.convertPixelCoordinatesToCMSpace(coordinates);
                            })}
                            onClear={() => {
                                this.structureManager.getClientStructures().forEach(s => {
                                    if (s.type === ZoneClientStructure.TYPE) {
                                        this.structureManager.removeClientStructure(s);
                                    }
                                });

                                this.updateState();

                                this.draw();
                            }}
                            onAdd={() => {
                                const currentCenter = this.getCurrentViewportCenterCoordinatesInPixelSpace();

                                const p0 = {
                                    x: currentCenter.x -15,
                                    y: currentCenter.y -15
                                };
                                const p1 = {
                                    x: currentCenter.x +15,
                                    y: currentCenter.y +15
                                };

                                this.structureManager.addClientStructure(new ZoneClientStructure(
                                    p0.x, p0.y,
                                    p1.x, p1.y,
                                    true
                                ));

                                this.updateState();

                                this.draw();
                            }}
                        />
                    }
                    {
                        this.state.mode === "goto" &&

                        <GoToActions
                            goToTarget={this.state.goToTarget}
                            convertPixelCoordinatesToCMSpace={(coordinates => {
                                return this.structureManager.convertPixelCoordinatesToCMSpace(coordinates);
                            })}
                            onClear={() => {
                                this.structureManager.getClientStructures().forEach(s => {
                                    if (s.type === GoToTargetClientStructure.TYPE) {
                                        this.structureManager.removeClientStructure(s);
                                    }
                                });
                                this.updateState();

                                this.draw();
                            }}
                        />
                    }
                    {
                        this.state.mode === "maps" &&

                        <MapChangeActions/>
                    }
                </ActionsContainer>
                <Dialog
                    open={this.state.dialogOpen}
                    onClose={() =>{
                        this.setState({dialogOpen: false});
                    }}
                >
                    <DialogTitle>
                        {this.state.dialogTitle}
                    </DialogTitle>
                    <DialogContent>
                        {this.state.dialogBody}
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => {
                            this.setState({dialogOpen: false});
                        }} autoFocus>
                            Close
                        </Button>
                    </DialogActions>
                </Dialog>
            </MapContainer>
        );
    }
}

export default LiveMap;
