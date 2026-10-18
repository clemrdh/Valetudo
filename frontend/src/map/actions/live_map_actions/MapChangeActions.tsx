import {
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Grid2,
    TextField,
    Typography
} from "@mui/material";
import {
    Add as NewMapIcon,
    CheckCircle as ActiveIcon,
    Edit as RenameIcon,
    Layers as MapIcon,
    LayersClear as ResetIcon,
    Save as SaveIcon
} from "@mui/icons-material";
import React from "react";
import {useRobotStatusQuery} from "../../../api";
import ConfirmationDialog from "../../../components/ConfirmationDialog";
import {
    useMultiFloorMapActionMutation,
    useMultiFloorMapsQuery
} from "../../../controls/MultiFloorMapControl";
import {ActionButton} from "../../Styled";

const MapChangeActions = (): React.ReactElement => {
    const {data: mapsData} = useMultiFloorMapsQuery();
    const {data: status} = useRobotStatusQuery((state) => {
        return state.value;
    });
    const {mutate: executeMapAction, isPending: isActionPending} = useMultiFloorMapActionMutation();

    const [renameDialogOpen, setRenameDialogOpen] = React.useState(false);
    const [renameValue, setRenameValue] = React.useState("");
    const [newMapDialogOpen, setNewMapDialogOpen] = React.useState(false);
    const [newMapName, setNewMapName] = React.useState("");
    const [resetDialogOpen, setResetDialogOpen] = React.useState(false);

    const canSwitch = status === "idle" || status === "docked" || status === "paused" || status === "error";
    const activeMap = mapsData?.maps.find(m => {
        return m.id === mapsData.activeMapId;
    });

    return (
        <>
            <Grid2 container spacing={1} direction="row" flexWrap="wrap" justifyContent="flex-end">
                {(mapsData?.maps ?? []).map((mapEntry) => {
                    const isSelected = mapEntry.id === mapsData?.activeMapId;

                    return (
                        <Grid2 key={mapEntry.id}>
                            <ActionButton
                                disabled={isActionPending || (!isSelected && !canSwitch)}
                                color={isSelected ? "primary" : "inherit"}
                                size="medium"
                                variant="extended"
                                onClick={() => {
                                    if (!isSelected && canSwitch) {
                                        executeMapAction({
                                            action: "select",
                                            id: mapEntry.id
                                        });
                                    }
                                }}
                            >
                                {isSelected ? (
                                    <ActiveIcon style={{marginRight: "0.35rem", marginLeft: "-0.25rem"}} />
                                ) : (
                                    <MapIcon style={{marginRight: "0.35rem", marginLeft: "-0.25rem"}} />
                                )}
                                {mapEntry.name}
                                {isActionPending && isSelected && (
                                    <CircularProgress
                                        color="inherit"
                                        size={18}
                                        style={{marginLeft: 10}}
                                    />
                                )}
                            </ActionButton>
                        </Grid2>
                    );
                })}

                <Grid2>
                    <ActionButton
                        disabled={isActionPending || !activeMap}
                        color="inherit"
                        size="medium"
                        variant="extended"
                        onClick={() => {
                            if (activeMap) {
                                setRenameValue(activeMap.name);
                                setRenameDialogOpen(true);
                            }
                        }}
                    >
                        <RenameIcon style={{marginRight: "0.25rem", marginLeft: "-0.25rem"}} />
                        Rename
                    </ActionButton>
                </Grid2>

                <Grid2>
                    <ActionButton
                        disabled={isActionPending}
                        color="inherit"
                        size="medium"
                        variant="extended"
                        onClick={() => {
                            executeMapAction({
                                action: "save",
                                id: mapsData?.activeMapId,
                                name: activeMap?.name
                            });
                        }}
                    >
                        <SaveIcon style={{marginRight: "0.25rem", marginLeft: "-0.25rem"}} />
                        Save
                    </ActionButton>
                </Grid2>

                <Grid2>
                    <ActionButton
                        disabled={isActionPending || !canSwitch}
                        color="inherit"
                        size="medium"
                        variant="extended"
                        onClick={() => {
                            setNewMapName(`Étage ${(mapsData?.maps.length ?? 0) + 1}`);
                            setNewMapDialogOpen(true);
                        }}
                    >
                        <NewMapIcon style={{marginRight: "0.25rem", marginLeft: "-0.25rem"}} />
                        New Map / Mapping Pass
                    </ActionButton>
                </Grid2>

                <Grid2>
                    <ActionButton
                        disabled={isActionPending || !canSwitch}
                        color="inherit"
                        size="medium"
                        variant="extended"
                        onClick={() => {
                            setResetDialogOpen(true);
                        }}
                    >
                        <ResetIcon style={{marginRight: "0.25rem", marginLeft: "-0.25rem"}} />
                        Reset
                    </ActionButton>
                </Grid2>

                {!canSwitch && (
                    <Grid2>
                        <Typography variant="caption" color="textSecondary">
                            Cannot switch map while robot is moving
                        </Typography>
                    </Grid2>
                )}
            </Grid2>

            <Dialog
                open={renameDialogOpen}
                onClose={() => {
                    setRenameDialogOpen(false);
                }}
                fullWidth
                maxWidth="xs"
            >
                <DialogTitle>Rename Current Map</DialogTitle>
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
                        disabled={!renameValue.trim() || !activeMap}
                        onClick={() => {
                            if (activeMap && renameValue.trim()) {
                                executeMapAction({
                                    action: "rename",
                                    id: activeMap.id,
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
                <DialogTitle>New Floor Map</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="textSecondary" sx={{mb: 1.5}}>
                        Your current map will be automatically saved before creating the new floor map.
                    </Typography>
                    <TextField
                        autoFocus
                        margin="dense"
                        label="Floor / Map Name"
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
                        variant="outlined"
                        disabled={!newMapName.trim()}
                        onClick={() => {
                            executeMapAction({
                                action: "new_blank",
                                name: newMapName.trim()
                            });
                            setNewMapDialogOpen(false);
                        }}
                    >
                        Blank Map Only
                    </Button>
                    <Button
                        variant="contained"
                        disabled={!newMapName.trim()}
                        onClick={() => {
                            executeMapAction({
                                action: "mapping_pass",
                                name: newMapName.trim()
                            });
                            setNewMapDialogOpen(false);
                        }}
                    >
                        Start Mapping Pass
                    </Button>
                </DialogActions>
            </Dialog>

            <ConfirmationDialog
                title="Reset current map?"
                text="Do you really want to reset the currently active map to a blank map?"
                open={resetDialogOpen}
                onClose={() => {
                    setResetDialogOpen(false);
                }}
                onAccept={() => {
                    executeMapAction({
                        action: "reset"
                    });
                    setResetDialogOpen(false);
                }}
            />
        </>
    );
};

export default MapChangeActions;
