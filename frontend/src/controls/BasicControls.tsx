import {
    Box,
    Button,
    ButtonGroup,
    DialogContentText,
    Grid2,
    Paper,
    Skeleton,
    Typography,
} from "@mui/material";
import {
    BasicControlCommand,
    StatusState,
    useBasicControlMutation,
    useRobotStatusQuery,
} from "../api";
import {
    Home as HomeIcon,
    Pause as PauseIcon,
    PlayArrow as StartIcon,
    Stop as StopIcon,
    SvgIconComponent,
} from "@mui/icons-material";
import React from "react";
import ConfirmationDialog from "../components/ConfirmationDialog";
import {usePendingMapAction, useSegmentSelectionStore} from "../map/BaseMap";
import {useCleanSegmentsCustomMutation, useRoomConfigsQuery} from "./RoomCleaningControl";

const StartStates: StatusState["value"][] = ["idle", "docked", "paused", "error"];
const PauseStates: StatusState["value"][] = ["cleaning", "returning", "moving"];

interface CommandButton {
    command: BasicControlCommand;
    enabled: boolean;
    label: string;
    Icon: SvgIconComponent;
}

const BasicControls = (): React.ReactElement => {
    const [startConfirmationDialogOpen, setStartConfirmationDialogOpen] = React.useState(false);
    const { data: status, isPending: statusPending } = useRobotStatusQuery();
    const {
        mutate: executeBasicControlCommand,
        isPending: basicControlIsExecuting
    } = useBasicControlMutation();

    const selectedSegmentIds = useSegmentSelectionStore(s => s.selectedSegmentIds);
    const clearSelectedSegments = useSegmentSelectionStore(s => s.clearSelectedSegments);
    const {data: roomConfigs} = useRoomConfigsQuery();
    const {
        mutate: startCustomClean,
        isPending: customCleanIsExecuting
    } = useCleanSegmentsCustomMutation({
        onSuccess: () => {
            clearSelectedSegments();
        }
    });

    const {
        hasPendingMapAction: hasPendingMapAction
    } = usePendingMapAction();

    const isPending = basicControlIsExecuting || customCleanIsExecuting;

    const sendCommand = (command: BasicControlCommand) => {
        if (command === "start" && status?.flag !== "resumable") {
            if (selectedSegmentIds.length > 0) {
                startCustomClean({
                    segment_ids: selectedSegmentIds,
                    useCustomPerRoom: roomConfigs?.useCustomPerRoom,
                    globalConfig: roomConfigs?.globalConfig,
                    rooms: roomConfigs?.rooms
                });
                return;
            }
            if (hasPendingMapAction) {
                setStartConfirmationDialogOpen(true);
                return;
            }
        }
        executeBasicControlCommand(command);
    };

    if (statusPending) {
        return (
            <Grid2>
                <Paper>
                    <Box p={1}>
                        <Skeleton height="4rem" />
                    </Box>
                </Paper>
            </Grid2>
        );
    }

    if (status === undefined) {
        return (
            <Grid2>
                <Paper>
                    <Box p={1}>
                        <Typography color="error">Error loading basic controls</Typography>
                    </Box>
                </Paper>
            </Grid2>
        );
    }

    const { flag, value: state } = status;

    const buttons: CommandButton[] = [
        {
            command: "start",
            enabled: StartStates.includes(state),
            label: flag === "resumable" ? "Resume" : "Start",
            Icon: StartIcon,
        },
        {
            command: "pause",
            enabled: PauseStates.includes(state),
            Icon: PauseIcon,
            label: "Pause",
        },
        {
            command: "stop",
            enabled: flag === "resumable" || (state !== "idle" && state !== "docked"),
            Icon: StopIcon,
            label: "Stop",
        },
        {
            command: "home",
            enabled: state === "idle" || state === "error" || state === "paused",
            Icon: HomeIcon,
            label: "Dock",
        },
    ];

    return (
        <>
            <Grid2>
                <Paper>
                    <Box p={1.5}>
                        <Grid2 container direction="column">
                            <Grid2>
                                <ButtonGroup
                                    fullWidth
                                    variant="outlined"
                                >
                                    {buttons.map(({ label, command, enabled, Icon }) => {
                                        return (

                                            <Button
                                                key={command}
                                                variant="outlined"
                                                size="medium"
                                                disabled={!enabled || isPending}
                                                onClick={() => {
                                                    sendCommand(command);
                                                }}
                                                color="inherit"
                                                style={{height: "3.5em", borderColor: "inherit"}}
                                            >
                                                <Icon />
                                            </Button>
                                        );
                                    })}
                                </ButtonGroup >
                            </Grid2>
                        </Grid2>
                    </Box>
                </Paper>
            </Grid2>

            <ConfirmationDialog
                title="Are you sure you want to start a full cleanup?"
                open={startConfirmationDialogOpen}
                onClose={() => {
                    setStartConfirmationDialogOpen(false);
                }}
                onAccept={() => {
                    executeBasicControlCommand("start");
                }}>
                <DialogContentText>
                    You currently have a pending MapAction.
                    <br/>
                    <br/>
                    <strong>Hint:</strong>
                    <br/>
                    You might instead be looking for the button on the bottom right of the map.
                </DialogContentText>
            </ConfirmationDialog>
        </>
    );
};

export default BasicControls;
