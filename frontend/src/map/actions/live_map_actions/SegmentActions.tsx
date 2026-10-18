import {Capability, useMapSegmentationPropertiesQuery, useRobotStatusQuery} from "../../../api";
import React from "react";
import {Box, Button, CircularProgress, Container, Grid2, Typography} from "@mui/material";
import {ActionButton} from "../../Styled";
import IntegrationHelpDialog from "../../../components/IntegrationHelpDialog";
import {useLongPress} from "use-long-press";
import {IterationsIcon} from "../../../assets/icon_components/IterationsIcon";
import {
    Clear as ClearIcon,
    PlayArrow as GoIcon,
    Tune as ModeIcon
} from "@mui/icons-material";
import {
    DreameCleaningMode,
    MODE_META,
    useCleanSegmentsCustomMutation,
    useRoomConfigsQuery,
    useSaveRoomConfigsMutation
} from "../../../controls/RoomCleaningControl";

interface SegmentActionsProperties {
    segments: string[];

    onClear(): void;
}

const SegmentActions = (
    props: SegmentActionsProperties
): React.ReactElement => {
    const {segments, onClear} = props;
    const [integrationHelpDialogOpen, setIntegrationHelpDialogOpen] = React.useState(false);
    const [integrationHelpDialogPayload, setIntegrationHelpDialogPayload] = React.useState("");

    const {data: roomConfigs} = useRoomConfigsQuery();
    const {mutate: saveRoomConfigs} = useSaveRoomConfigsMutation();

    const useCustomPerRoom = Boolean(roomConfigs?.useCustomPerRoom);
    const globalConfig = roomConfigs?.globalConfig || {
        mode: "vacuum_and_mop" as DreameCleaningMode,
        fanSpeed: "medium" as const,
        waterGrade: "medium" as const,
        iterations: 1
    };
    const iterationCount = globalConfig.iterations || 1;
    const activeTab: DreameCleaningMode | "custom" = useCustomPerRoom ? "custom" : globalConfig.mode;
    const activeModeMeta = MODE_META.find(m => m.id === activeTab) || MODE_META[0];

    const {
        data: mapSegmentationProperties,
        isPending: mapSegmentationPropertiesPending,
        isError: mapSegmentationPropertiesLoadError,
        refetch: refetchMapSegmentationProperties,
    } = useMapSegmentationPropertiesQuery();
    const {data: status} = useRobotStatusQuery((state) => {
        return state.value;
    });
    const {
        mutate: executeSegmentAction,
        isPending: segmentActionExecuting
    } = useCleanSegmentsCustomMutation({
        onSuccess: onClear,
    });

    const canClean = status === "idle" || status === "docked" || status === "paused" || status === "returning" || status === "error";
    const didSelectSegments = segments.length > 0;

    const handleClick = React.useCallback(() => {
        if (!didSelectSegments || !canClean) {
            return;
        }

        executeSegmentAction({
            segment_ids: segments,
            useCustomPerRoom: useCustomPerRoom,
            globalConfig: globalConfig,
            rooms: roomConfigs?.rooms
        });
    }, [canClean, didSelectSegments, executeSegmentAction, segments, useCustomPerRoom, globalConfig, roomConfigs?.rooms]);

    const handleLongClick = React.useCallback(() => {
        setIntegrationHelpDialogPayload(JSON.stringify({
            action: "start_segment_action",
            segment_ids: segments,
            iterations: iterationCount ?? 1,
            customOrder: mapSegmentationProperties?.customOrderSupport ?? false
        }, null, 2));

        setIntegrationHelpDialogOpen(true);
    }, [segments, iterationCount, mapSegmentationProperties]);

    const setupClickHandlers = useLongPress(
        handleLongClick,
        {
            onCancel: () => {
                handleClick();
            },
            threshold: 500,
            captureEvent: true,
            cancelOnMovement: true,
        }
    );

    const handleIterationToggle = React.useCallback(() => {
        if (mapSegmentationProperties) {
            const nextIter = (iterationCount % mapSegmentationProperties.iterationCount.max) + 1;

            saveRoomConfigs({
                globalConfig: {
                    ...globalConfig,
                    iterations: nextIter
                }
            });
        }
    }, [iterationCount, mapSegmentationProperties, saveRoomConfigs, globalConfig]);

    const handleModeCycle = React.useCallback(() => {
        const idx = MODE_META.findIndex(m => m.id === activeTab);
        const next = MODE_META[(idx + 1) % MODE_META.length];

        if (next.id === "custom") {
            saveRoomConfigs({useCustomPerRoom: true});
        } else {
            saveRoomConfigs({
                useCustomPerRoom: false,
                globalConfig: {
                    ...globalConfig,
                    mode: next.id
                }
            });
        }
    }, [activeTab, saveRoomConfigs, globalConfig]);

    if (mapSegmentationPropertiesLoadError) {
        return (
            <Container>
                <Typography color="error">
                    Error loading {Capability.MapSegmentation} properties
                </Typography>
                <Box m={1}/>
                <Button color="primary" variant="contained" onClick={() => {
                    return refetchMapSegmentationProperties();
                }}>
                    Retry
                </Button>
            </Container>
        );
    }

    if (mapSegmentationProperties === undefined && mapSegmentationPropertiesPending) {
        return (
            <Container>
                <CircularProgress/>
            </Container>
        );
    }

    if (mapSegmentationProperties === undefined) {
        return (
            <Container>
                <Typography align="center">
                    No {Capability.MapSegmentation} properties
                </Typography>
                ;
            </Container>
        );
    }



    return (
        <>
            <Grid2 container spacing={1} direction="row-reverse" flexWrap="wrap-reverse">
                <Grid2>
                    <ActionButton
                        disabled={!didSelectSegments || segmentActionExecuting || !canClean}
                        color="inherit"
                        size="medium"
                        variant="extended"
                        {...setupClickHandlers()}
                    >
                        <GoIcon style={{marginRight: "0.25rem", marginLeft: "-0.25rem"}}/>
                        Nettoyer ({segments.length}) · {activeModeMeta.shortLabel}
                        {segmentActionExecuting && (
                            <CircularProgress
                                color="inherit"
                                size={18}
                                style={{marginLeft: 10}}
                            />
                        )}
                    </ActionButton>
                </Grid2>
                <Grid2>
                    <ActionButton
                        color="inherit"
                        size="medium"
                        variant="extended"
                        style={{
                            textTransform: "initial"
                        }}
                        onClick={handleModeCycle}
                        title="Changer le mode (Vac+Mop / Vac→Mop / Vac / Mop / Custom)"
                    >
                        <ModeIcon style={{marginRight: "0.25rem", fontSize: "1.1rem"}}/>
                        {activeModeMeta.shortLabel}
                    </ActionButton>
                </Grid2>
                {
                    !useCustomPerRoom && mapSegmentationProperties.iterationCount.max > 1 &&
                    <Grid2>
                        <ActionButton
                            color="inherit"
                            size="medium"
                            variant="extended"
                            style={{
                                textTransform: "initial"
                            }}
                            onClick={handleIterationToggle}
                            title="Nombre de passages"
                        >
                            <IterationsIcon iterationCount={iterationCount}/>
                        </ActionButton>
                    </Grid2>
                }
                {
                    didSelectSegments &&
                    <Grid2>
                        <ActionButton
                            color="inherit"
                            size="medium"
                            variant="extended"
                            onClick={onClear}
                        >
                            <ClearIcon style={{marginRight: "0.25rem", marginLeft: "-0.25rem"}}/>
                            Aucune
                        </ActionButton>
                    </Grid2>
                }
                {
                    (didSelectSegments && !canClean) &&
                    <Grid2>
                        <Typography variant="caption" color="textSecondary">
                            Robot en cours d&apos;activité
                        </Typography>
                    </Grid2>
                }
            </Grid2>
            <IntegrationHelpDialog
                dialogOpen={integrationHelpDialogOpen}
                setDialogOpen={(open: boolean) => {
                    setIntegrationHelpDialogOpen(open);
                }}
                coordinatesWarning={false}
                helperText={"To start a cleanup of the currently selected segments with the currently configured parameters via MQTT or REST, simply use this payload."}
                payload={integrationHelpDialogPayload}
            />
        </>
    );
};

export default SegmentActions;
