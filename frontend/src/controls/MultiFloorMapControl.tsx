import {
    Box,
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    Grid2,
    IconButton,
    Paper,
    TextField,
    Tooltip,
    Typography
} from "@mui/material";
import {
    Add as AddMapIcon,
    CheckCircle as ActiveMapIcon,
    Dashboard as SegmentsIcon,
    Delete as DeleteIcon,
    Edit as RenameIcon,
    Explore as MappingPassIcon,
    Layers as MapsIcon,
    LayersClear as MapResetIcon,
    Save as SaveMapIcon,
} from "@mui/icons-material";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {useSnackbar} from "notistack";
import React from "react";
import {useNavigate} from "react-router-dom";
import {useRobotStatusQuery} from "../api";
import {valetudoAPI} from "../api/client";
import ConfirmationDialog from "../components/ConfirmationDialog";
import {VirtualRestrictionsIcon} from "../components/CustomIcons";
import ControlsCard from "./ControlsCard";

export interface SavedMapEntry {
    id: string;
    name: string;
    updatedAt: string;
    exists: boolean;
    size: number;
}

export interface MultiFloorMapsResponse {
    activeMapId: string;
    maps: Array<SavedMapEntry>;
}

export interface MultiFloorMapActionPayload {
    action: "select" | "load" | "save" | "rename" | "delete" | "new_blank" | "mapping_pass" | "reset";
    id?: string;
    name?: string;
}

export const useMultiFloorMapsQuery = () => {
    return useQuery<MultiFloorMapsResponse>({
        queryKey: ["multi_floor_maps"],
        queryFn: async () => {
            const {data} = await valetudoAPI.get<MultiFloorMapsResponse>("/robot/maps");

            return data;
        },
        staleTime: 5_000,
    });
};

export const useMultiFloorMapActionMutation = () => {
    const queryClient = useQueryClient();
    const {enqueueSnackbar} = useSnackbar();

    return useMutation({
        mutationFn: async (payload: MultiFloorMapActionPayload) => {
            const {data} = await valetudoAPI.post<MultiFloorMapsResponse>("/robot/maps", payload);

            return data;
        },
        onSuccess: (data, variables) => {
            queryClient.setQueryData(["multi_floor_maps"], data);
            const refreshMapQueries = () => {
                queryClient.invalidateQueries({queryKey: ["map"]}).catch(() => {
                    /* intentional */
                });
                queryClient.invalidateQueries({queryKey: ["segments"]}).catch(() => {
                    /* intentional */
                });
                queryClient.invalidateQueries({queryKey: ["room_clean_configs"]}).catch(() => {
                    /* intentional */
                });
            };

            refreshMapQueries();
            for (const delay of [1500, 6000, 12000, 20000]) {
                setTimeout(refreshMapQueries, delay);
            }

            switch (variables.action) {
                case "select":
                case "load":
                    enqueueSnackbar("Carte chargée avec succès", {variant: "success"});
                    break;
                case "save":
                    enqueueSnackbar("Carte sauvegardée", {variant: "success"});
                    break;
                case "rename":
                    enqueueSnackbar("Carte renommée", {variant: "success"});
                    break;
                case "delete":
                    enqueueSnackbar("Carte supprimée", {variant: "info"});
                    break;
                case "new_blank":
                    enqueueSnackbar("Nouvelle carte vierge initialisée", {variant: "success"});
                    break;
                case "mapping_pass":
                    enqueueSnackbar("Nouvelle carte prête — lancement du Mapping Pass…", {variant: "success"});
                    break;
                case "reset":
                    enqueueSnackbar("Carte réinitialisée", {variant: "info"});
                    break;
            }
        },
        onError: (err: any) => {
            const msg = err?.response?.data?.message || err?.message || "Erreur lors de l'opération sur la carte";

            enqueueSnackbar(msg, {variant: "error"});
        }
    });
};

const MultiFloorMapControl = (): React.ReactElement => {
    const navigate = useNavigate();
    const {data: mapsData, isPending: isMapsLoading} = useMultiFloorMapsQuery();
    const {data: robotStatus} = useRobotStatusQuery();
    const {mutate: executeMapAction, isPending: isActionPending} = useMultiFloorMapActionMutation();

    const [renameDialogOpen, setRenameDialogOpen] = React.useState(false);
    const [renameTarget, setRenameTarget] = React.useState<SavedMapEntry | null>(null);
    const [renameValue, setRenameValue] = React.useState("");

    const [newMapDialogOpen, setNewMapDialogOpen] = React.useState(false);
    const [newMapName, setNewMapName] = React.useState("");
    const [newMapStartMappingPass, setNewMapStartMappingPass] = React.useState(false);

    const [deleteTarget, setDeleteTarget] = React.useState<SavedMapEntry | null>(null);
    const [resetConfirmOpen, setResetConfirmOpen] = React.useState(false);

    const isRobotBusy = robotStatus !== undefined && ["cleaning", "returning", "moving", "manual_control"].includes(robotStatus.value);
    const activeMap = mapsData?.maps.find(m => {
        return m.id === mapsData.activeMapId;
    });

    return (
        <ControlsCard
            icon={MapsIcon}
            title="Maps & Multi-Floor"
            pending={isActionPending}
            isLoading={isMapsLoading}
        >
            <Box sx={{pt: 0.5}}>
                <Grid2 container alignItems="center" justifyContent="space-between" sx={{mb: 1}}>
                    <Typography variant="caption" color="textSecondary">
                        Current map:{" "}
                        <Typography component="span" variant="caption" sx={{fontWeight: "bold", color: "text.primary"}}>
                            {activeMap ? activeMap.name : (mapsData?.activeMapId ?? "—")}
                        </Typography>
                    </Typography>
                    <Button
                        size="small"
                        variant="text"
                        startIcon={<SaveMapIcon fontSize="small" />}
                        disabled={isActionPending}
                        onClick={() => {
                            executeMapAction({
                                action: "save",
                                id: mapsData?.activeMapId,
                                name: activeMap?.name
                            });
                        }}
                    >
                        Save Current
                    </Button>
                </Grid2>

                <Grid2 container direction="column" spacing={0.75} sx={{mb: 1.5}}>
                    {(mapsData?.maps ?? []).map((mapEntry) => {
                        const isSelected = mapEntry.id === mapsData?.activeMapId;

                        return (
                            <Paper
                                key={mapEntry.id}
                                variant="outlined"
                                sx={{
                                    px: 1,
                                    py: 0.5,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    borderColor: isSelected ? "primary.main" : "divider",
                                    backgroundColor: isSelected ? "action.selected" : "transparent"
                                }}
                            >
                                <Box
                                    onClick={() => {
                                        if (!isSelected && !isRobotBusy && !isActionPending) {
                                            executeMapAction({
                                                action: "select",
                                                id: mapEntry.id
                                            });
                                        }
                                    }}
                                    sx={{
                                        display: "flex",
                                        alignItems: "center",
                                        flexGrow: 1,
                                        cursor: isSelected || isRobotBusy ? "default" : "pointer",
                                        overflow: "hidden",
                                        pr: 1
                                    }}
                                >
                                    {isSelected && (
                                        <ActiveMapIcon
                                            color="primary"
                                            fontSize="small"
                                            sx={{mr: 0.75, flexShrink: 0}}
                                        />
                                    )}
                                    <Typography
                                        variant="body2"
                                        sx={{
                                            fontWeight: isSelected ? "bold" : "normal",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap"
                                        }}
                                    >
                                        {mapEntry.name}
                                    </Typography>
                                    {isSelected && (
                                        <Chip
                                            label="Active"
                                            size="small"
                                            color="primary"
                                            variant="outlined"
                                            sx={{ml: 1, height: "1.25rem", fontSize: "0.68rem"}}
                                        />
                                    )}
                                </Box>

                                <Box sx={{display: "flex", alignItems: "center", flexShrink: 0}}>
                                    {!isSelected && (
                                        <Button
                                            size="small"
                                            variant="outlined"
                                            disabled={isRobotBusy || isActionPending}
                                            onClick={() => {
                                                executeMapAction({
                                                    action: "select",
                                                    id: mapEntry.id
                                                });
                                            }}
                                            sx={{mr: 0.5, minWidth: "auto", px: 1, py: 0.25, fontSize: "0.72rem"}}
                                        >
                                            Load
                                        </Button>
                                    )}
                                    <Tooltip title="Rename map">
                                        <IconButton
                                            size="small"
                                            onClick={() => {
                                                setRenameTarget(mapEntry);
                                                setRenameValue(mapEntry.name);
                                                setRenameDialogOpen(true);
                                            }}
                                        >
                                            <RenameIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    {(mapsData?.maps.length ?? 0) > 1 && (
                                        <Tooltip title="Delete map">
                                            <IconButton
                                                size="small"
                                                disabled={isActionPending}
                                                onClick={() => {
                                                    setDeleteTarget(mapEntry);
                                                }}
                                            >
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                </Box>
                            </Paper>
                        );
                    })}
                </Grid2>

                <Divider sx={{my: 1}} />

                <Grid2 container spacing={1}>
                    <Grid2 size={6}>
                        <Button
                            fullWidth
                            size="small"
                            variant="outlined"
                            color="inherit"
                            startIcon={<MappingPassIcon fontSize="small" />}
                            disabled={isRobotBusy || isActionPending}
                            onClick={() => {
                                setNewMapName(`Étage ${(mapsData?.maps.length ?? 0) + 1}`);
                                setNewMapStartMappingPass(true);
                                setNewMapDialogOpen(true);
                            }}
                        >
                            Mapping Pass
                        </Button>
                    </Grid2>
                    <Grid2 size={6}>
                        <Button
                            fullWidth
                            size="small"
                            variant="outlined"
                            color="inherit"
                            startIcon={<AddMapIcon fontSize="small" />}
                            disabled={isRobotBusy || isActionPending}
                            onClick={() => {
                                setNewMapName(`Étage ${(mapsData?.maps.length ?? 0) + 1}`);
                                setNewMapStartMappingPass(false);
                                setNewMapDialogOpen(true);
                            }}
                        >
                            New Map
                        </Button>
                    </Grid2>
                    <Grid2 size={4}>
                        <Button
                            fullWidth
                            size="small"
                            variant="outlined"
                            color="inherit"
                            startIcon={<SegmentsIcon fontSize="small" />}
                            onClick={() => {
                                navigate("/options/map_management/segments");
                            }}
                        >
                            Segments
                        </Button>
                    </Grid2>
                    <Grid2 size={4}>
                        <Button
                            fullWidth
                            size="small"
                            variant="outlined"
                            color="inherit"
                            startIcon={<VirtualRestrictionsIcon fontSize="small" />}
                            onClick={() => {
                                navigate("/options/map_management/virtual_restrictions");
                            }}
                        >
                            Zones No-Go
                        </Button>
                    </Grid2>
                    <Grid2 size={4}>
                        <Button
                            fullWidth
                            size="small"
                            variant="outlined"
                            color="error"
                            startIcon={<MapResetIcon fontSize="small" />}
                            disabled={isRobotBusy || isActionPending}
                            onClick={() => {
                                setResetConfirmOpen(true);
                            }}
                        >
                            Map Reset
                        </Button>
                    </Grid2>
                </Grid2>
            </Box>

            <Dialog
                open={renameDialogOpen}
                onClose={() => {
                    setRenameDialogOpen(false);
                }}
                fullWidth
                maxWidth="xs"
            >
                <DialogTitle>Rename Map</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        margin="dense"
                        label="Map Name"
                        fullWidth
                        variant="outlined"
                        value={renameValue}
                        onChange={(e) => {
                            setRenameValue(e.target.value);
                        }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => {
                            setRenameDialogOpen(false);
                        }}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        disabled={!renameValue.trim() || !renameTarget}
                        onClick={() => {
                            if (renameTarget && renameValue.trim()) {
                                executeMapAction({
                                    action: "rename",
                                    id: renameTarget.id,
                                    name: renameValue.trim()
                                });
                            }
                            setRenameDialogOpen(false);
                        }}
                    >
                        Save
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={newMapDialogOpen}
                onClose={() => {
                    setNewMapDialogOpen(false);
                }}
                fullWidth
                maxWidth="xs"
            >
                <DialogTitle>
                    {newMapStartMappingPass ? "Start Mapping Pass (New Map)" : "Create New Blank Map"}
                </DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="textSecondary" sx={{mb: 1.5}}>
                        Your current map will be automatically backed up before switching to the new blank map.
                    </Typography>
                    <TextField
                        autoFocus
                        margin="dense"
                        label="New Floor / Map Name"
                        fullWidth
                        variant="outlined"
                        value={newMapName}
                        onChange={(e) => {
                            setNewMapName(e.target.value);
                        }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => {
                            setNewMapDialogOpen(false);
                        }}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        disabled={!newMapName.trim()}
                        onClick={() => {
                            executeMapAction({
                                action: newMapStartMappingPass ? "mapping_pass" : "new_blank",
                                name: newMapName.trim()
                            });
                            setNewMapDialogOpen(false);
                        }}
                    >
                        {newMapStartMappingPass ? "Create & Start Mapping" : "Create Blank Map"}
                    </Button>
                </DialogActions>
            </Dialog>

            <ConfirmationDialog
                title="Delete saved map?"
                text={`Do you really want to delete "${deleteTarget?.name ?? ""}"?`}
                open={deleteTarget !== null}
                onClose={() => {
                    setDeleteTarget(null);
                }}
                onAccept={() => {
                    if (deleteTarget) {
                        executeMapAction({
                            action: "delete",
                            id: deleteTarget.id
                        });
                    }
                    setDeleteTarget(null);
                }}
            />

            <ConfirmationDialog
                title="Reset current map?"
                text="Do you really want to reset the currently active map to a blank map? (A backup is kept in last_autosave)."
                open={resetConfirmOpen}
                onClose={() => {
                    setResetConfirmOpen(false);
                }}
                onAccept={() => {
                    executeMapAction({
                        action: "reset"
                    });
                    setResetConfirmOpen(false);
                }}
            />
        </ControlsCard>
    );
};

export default MultiFloorMapControl;
