import {
    Box,
    Button,
    Chip,
    CircularProgress,
    Divider,
    Grid2,
    Paper,
    Tooltip,
    Typography
} from "@mui/material";
import {
    Air as VacuumIcon,
    AutoAwesome as CustomModeIcon,
    CheckBox as SelectAllIcon,
    ClearAll as ClearAllIcon,
    Layers as RoomIcon,
    PlayArrow as PlayIcon,
    Repeat as IterationsIcon,
    SyncAlt as VacThenMopIcon,
    WaterDrop as MopIcon,
} from "@mui/icons-material";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {useSnackbar} from "notistack";
import React from "react";
import {
    useRobotMapQuery,
    useRobotStatusQuery,
    useSegmentsQuery
} from "../api";
import {valetudoAPI} from "../api/client";
import {useSegmentSelectionStore} from "../map/BaseMap";

export type DreameCleaningMode = "vacuum_and_mop" | "vacuum_then_mop" | "vacuum" | "mop";
export type DreameFanSpeed = "low" | "medium" | "high" | "max";
export type DreameWaterGrade = "low" | "medium" | "high";

export interface PerRoomCleanConfig {
    operationMode: DreameCleaningMode;
    fanSpeed: DreameFanSpeed;
    waterGrade: DreameWaterGrade;
    iterations: number;
}

export interface GlobalCleanConfig {
    mode: DreameCleaningMode;
    fanSpeed: DreameFanSpeed;
    waterGrade: DreameWaterGrade;
    iterations: number;
}

export interface RoomConfigsResponse {
    activeFloor: string;
    useCustomPerRoom: boolean;
    globalConfig: GlobalCleanConfig;
    rooms: Record<string, PerRoomCleanConfig>;
}

export interface CleanSegmentsCustomPayload {
    segment_ids?: string[];
    cleanAll?: boolean;
    useCustomPerRoom?: boolean;
    globalConfig?: Partial<GlobalCleanConfig>;
    rooms?: Record<string, PerRoomCleanConfig>;
}

export const MODE_META: Array<{
    id: DreameCleaningMode | "custom";
    label: string;
    shortLabel: string;
    description: string;
}> = [
    {
        id: "vacuum_and_mop",
        label: "Vac & Mop",
        shortLabel: "Vac+Mop",
        description: "Aspirer et laver simultanément"
    },
    {
        id: "vacuum_then_mop",
        label: "Mop after Vac",
        shortLabel: "Vac→Mop",
        description: "Aspirer toute la sélection puis laver"
    },
    {
        id: "vacuum",
        label: "Vacuum",
        shortLabel: "Vac",
        description: "Aspirer uniquement"
    },
    {
        id: "mop",
        label: "Mop",
        shortLabel: "Mop",
        description: "Laver uniquement"
    },
    {
        id: "custom",
        label: "Custom Pièces",
        shortLabel: "Custom",
        description: "Réglage personnalisé mémorisé par pièce"
    }
];

export const FAN_SPEED_OPTIONS: Array<{id: DreameFanSpeed; label: string; short: string}> = [
    {id: "low", label: "Silencieux", short: "Eco"},
    {id: "medium", label: "Standard", short: "Std"},
    {id: "high", label: "Fort", short: "Fort"},
    {id: "max", label: "Turbo", short: "Max"}
];

export const WATER_GRADE_OPTIONS: Array<{id: DreameWaterGrade; label: string; short: string}> = [
    {id: "low", label: "Faible", short: "Eau -"},
    {id: "medium", label: "Moyen", short: "Eau ="},
    {id: "high", label: "Élevé", short: "Eau +"}
];

export const DEFAULT_ROOM_CONFIG: PerRoomCleanConfig = {
    operationMode: "vacuum_and_mop",
    fanSpeed: "medium",
    waterGrade: "medium",
    iterations: 1
};

export const useRoomConfigsQuery = () => {
    return useQuery<RoomConfigsResponse>({
        queryKey: ["room_clean_configs"],
        queryFn: async () => {
            const {data} = await valetudoAPI.get<RoomConfigsResponse>("/robot/room_configs");

            return data;
        },
        staleTime: 3_000,
    });
};

export const useSaveRoomConfigsMutation = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (payload: Partial<RoomConfigsResponse>) => {
            const {data} = await valetudoAPI.post<RoomConfigsResponse>("/robot/room_configs", payload);

            return data;
        },
        onSuccess: (data) => {
            queryClient.setQueryData(["room_clean_configs"], data);
        }
    });
};

export const useCleanSegmentsCustomMutation = (options?: {onSuccess?: () => void}) => {
    const queryClient = useQueryClient();
    const {enqueueSnackbar} = useSnackbar();

    return useMutation({
        mutationFn: async (payload: CleanSegmentsCustomPayload) => {
            await valetudoAPI.post("/robot/clean_segments_custom", payload);
        },
        onSuccess: () => {
            enqueueSnackbar("Nettoyage des pièces lancé !", {variant: "success"});
            queryClient.invalidateQueries({queryKey: ["attributes"]}).catch(() => {
                /* ignore */
            });
            options?.onSuccess?.();
        },
        onError: (err: any) => {
            const msg = err?.response?.data?.message || err?.message || "Erreur lors du lancement du nettoyage";

            enqueueSnackbar(msg, {variant: "error"});
        }
    });
};

const RoomCleaningControl = (): React.ReactElement => {
    const {data: roomConfigs} = useRoomConfigsQuery();
    const {mutate: saveRoomConfigs} = useSaveRoomConfigsMutation();
    const {data: segmentsData} = useSegmentsQuery();
    const {data: mapData} = useRobotMapQuery();
    const {data: status} = useRobotStatusQuery();

    const selectedSegmentIds = useSegmentSelectionStore(s => s.selectedSegmentIds);
    const toggleSegment = useSegmentSelectionStore(s => s.toggleSegment);
    const setSelectedSegments = useSegmentSelectionStore(s => s.setSelectedSegments);
    const clearSelectedSegments = useSegmentSelectionStore(s => s.clearSelectedSegments);

    const {
        mutate: startCustomClean,
        isPending: isStartingClean
    } = useCleanSegmentsCustomMutation({
        onSuccess: () => {
            clearSelectedSegments();
        }
    });

    // Extract available rooms from map layers + segments query
    const roomsList = React.useMemo(() => {
        const byId = new Map<string, {id: string; name: string}>();

        if (Array.isArray(segmentsData)) {
            segmentsData.forEach(seg => {
                if (seg && seg.id !== undefined) {
                    byId.set(String(seg.id), {
                        id: String(seg.id),
                        name: seg.name || `Pièce ${seg.id}`
                    });
                }
            });
        }

        if (mapData?.layers) {
            mapData.layers.forEach(l => {
                if (l.type === "segment" && l.metaData?.segmentId !== undefined) {
                    const sid = String(l.metaData.segmentId);
                    const existing = byId.get(sid);

                    byId.set(sid, {
                        id: sid,
                        name: l.metaData.name || existing?.name || `Pièce ${sid}`
                    });
                }
            });
        }

        return Array.from(byId.values()).sort((a, b) => {
            return a.name.localeCompare(b.name, "fr", {numeric: true});
        });
    }, [segmentsData, mapData]);

    const useCustomPerRoom = Boolean(roomConfigs?.useCustomPerRoom);
    const globalConfig: GlobalCleanConfig = roomConfigs?.globalConfig || {
        mode: "vacuum_and_mop",
        fanSpeed: "medium",
        waterGrade: "medium",
        iterations: 1
    };
    const perRoomMap: Record<string, PerRoomCleanConfig> = roomConfigs?.rooms || {};

    const activeTab: DreameCleaningMode | "custom" = useCustomPerRoom ? "custom" : globalConfig.mode;

    const canClean = !status || ["idle", "docked", "paused", "returning", "error"].includes(status.value);

    const handleSelectTab = (tabId: DreameCleaningMode | "custom") => {
        if (tabId === "custom") {
            saveRoomConfigs({
                useCustomPerRoom: true
            });
        } else {
            saveRoomConfigs({
                useCustomPerRoom: false,
                globalConfig: {
                    ...globalConfig,
                    mode: tabId
                }
            });
        }
    };

    const handleGlobalParamChange = (patch: Partial<GlobalCleanConfig>) => {
        saveRoomConfigs({
            useCustomPerRoom: false,
            globalConfig: {
                ...globalConfig,
                ...patch
            }
        });
    };

    const getRoomConfig = (roomId: string): PerRoomCleanConfig => {
        return {
            ...DEFAULT_ROOM_CONFIG,
            ...(perRoomMap[roomId] || {})
        };
    };

    const updateSingleRoomConfig = (roomId: string, patch: Partial<PerRoomCleanConfig>) => {
        const current = getRoomConfig(roomId);
        const nextRooms = {
            ...perRoomMap,
            [roomId]: {
                ...current,
                ...patch
            }
        };

        saveRoomConfigs({
            useCustomPerRoom: true,
            rooms: nextRooms
        });
    };

    const cycleRoomMode = (roomId: string) => {
        const modes: DreameCleaningMode[] = ["vacuum_and_mop", "vacuum_then_mop", "vacuum", "mop"];
        const current = getRoomConfig(roomId);
        const nextMode = modes[(modes.indexOf(current.operationMode) + 1) % modes.length];

        updateSingleRoomConfig(roomId, {operationMode: nextMode});
    };

    const cycleRoomFan = (roomId: string) => {
        const fans: DreameFanSpeed[] = ["low", "medium", "high", "max"];
        const current = getRoomConfig(roomId);
        const nextFan = fans[(fans.indexOf(current.fanSpeed) + 1) % fans.length];

        updateSingleRoomConfig(roomId, {fanSpeed: nextFan});
    };

    const cycleRoomWater = (roomId: string) => {
        const waters: DreameWaterGrade[] = ["low", "medium", "high"];
        const current = getRoomConfig(roomId);
        const nextWater = waters[(waters.indexOf(current.waterGrade) + 1) % waters.length];

        updateSingleRoomConfig(roomId, {waterGrade: nextWater});
    };

    const cycleRoomIterations = (roomId: string) => {
        const current = getRoomConfig(roomId);
        const nextIter = (current.iterations % 3) + 1;

        updateSingleRoomConfig(roomId, {iterations: nextIter});
    };

    const handleStartSelectedRooms = () => {
        if (selectedSegmentIds.length === 0) {
            return;
        }
        startCustomClean({
            segment_ids: selectedSegmentIds,
            useCustomPerRoom: useCustomPerRoom,
            globalConfig: globalConfig,
            rooms: perRoomMap
        });
    };

    const handleStartAllRooms = () => {
        const allIds = roomsList.map(r => r.id);

        startCustomClean({
            segment_ids: allIds,
            cleanAll: true,
            useCustomPerRoom: useCustomPerRoom,
            globalConfig: globalConfig,
            rooms: perRoomMap
        });
    };

    const activeModeObj = MODE_META.find(m => m.id === activeTab) || MODE_META[0];
    const showFanControl = !useCustomPerRoom && globalConfig.mode !== "mop";
    const showWaterControl = !useCustomPerRoom && globalConfig.mode !== "vacuum";

    return (
        <Grid2>
            <Paper elevation={2} sx={{borderRadius: 2, overflow: "hidden"}}>
                <Box p={1.5}>
                    {/* Header */}
                    <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                        <Box display="flex" alignItems="center" gap={0.75}>
                            <RoomIcon fontSize="small" color="primary"/>
                            <Typography variant="subtitle2" fontWeight={700}>
                                Nettoyage par Pièces & Modes
                            </Typography>
                        </Box>
                        <Chip
                            size="small"
                            color={selectedSegmentIds.length > 0 ? "primary" : "default"}
                            label={
                                selectedSegmentIds.length > 0 ?
                                    `${selectedSegmentIds.length} pièce${selectedSegmentIds.length > 1 ? "s" : ""} choisie${selectedSegmentIds.length > 1 ? "s" : ""}` :
                                    "Cliquez sur les pièces"
                            }
                        />
                    </Box>

                    {/* 5 Mode Tabs: Vac & Mop | Mop after Vac | Vacuum | Mop | Custom */}
                    <Box
                        sx={{
                            display: "grid",
                            gridTemplateColumns: "repeat(5, 1fr)",
                            gap: 0.5,
                            mb: 1
                        }}
                    >
                        {MODE_META.map(m => {
                            const isSelected = activeTab === m.id;

                            return (
                                <Tooltip key={m.id} title={m.description} arrow>
                                    <Button
                                        size="small"
                                        variant={isSelected ? "contained" : "outlined"}
                                        color={m.id === "custom" ? "secondary" : "primary"}
                                        onClick={() => handleSelectTab(m.id)}
                                        sx={{
                                            minWidth: 0,
                                            px: 0.5,
                                            py: 0.6,
                                            fontSize: "0.7rem",
                                            fontWeight: isSelected ? 700 : 500,
                                            textTransform: "none",
                                            lineHeight: 1.15
                                        }}
                                    >
                                        {m.shortLabel}
                                    </Button>
                                </Tooltip>
                            );
                        })}
                    </Box>

                    <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                        Mode actif : <strong>{activeModeObj.label}</strong> — {activeModeObj.description}
                    </Typography>

                    <Divider sx={{my: 1}}/>

                    {/* Room selection section */}
                    <Box display="flex" alignItems="center" justifyContent="space-between" mb={0.75}>
                        <Typography variant="caption" fontWeight={600} color="text.secondary">
                            1. SÉLECTIONNER LES PIÈCES ({selectedSegmentIds.length}/{roomsList.length})
                        </Typography>
                        <Box display="flex" gap={0.5}>
                            <Button
                                size="small"
                                variant="text"
                                startIcon={<SelectAllIcon sx={{fontSize: "0.9rem !important"}}/>}
                                onClick={() => setSelectedSegments(roomsList.map(r => r.id))}
                                sx={{py: 0, px: 0.75, minWidth: 0, fontSize: "0.7rem", textTransform: "none"}}
                            >
                                Tout
                            </Button>
                            <Button
                                size="small"
                                variant="text"
                                color="inherit"
                                startIcon={<ClearAllIcon sx={{fontSize: "0.9rem !important"}}/>}
                                disabled={selectedSegmentIds.length === 0}
                                onClick={() => clearSelectedSegments()}
                                sx={{py: 0, px: 0.75, minWidth: 0, fontSize: "0.7rem", textTransform: "none"}}
                            >
                                Aucune
                            </Button>
                        </Box>
                    </Box>

                    {roomsList.length === 0 ? (
                        <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                            Aucune pièce détectée sur cette carte.
                        </Typography>
                    ) : (
                        <Box display="flex" flexWrap="wrap" gap={0.6} mb={1.25}>
                            {roomsList.map(room => {
                                const orderIdx = selectedSegmentIds.indexOf(room.id);
                                const isSelected = orderIdx >= 0;

                                return (
                                    <Chip
                                        key={room.id}
                                        label={
                                            isSelected ?
                                                `${orderIdx + 1}. ${room.name}` :
                                                room.name
                                        }
                                        size="small"
                                        color={isSelected ? "primary" : "default"}
                                        variant={isSelected ? "filled" : "outlined"}
                                        onClick={() => toggleSegment(room.id)}
                                        sx={{
                                            fontWeight: isSelected ? 700 : 500,
                                            cursor: "pointer"
                                        }}
                                    />
                                );
                            })}
                        </Box>
                    )}

                    {/* Global Mode Controls OR Custom Per-Room Controls */}
                    {!useCustomPerRoom ? (
                        <Box sx={{bgcolor: "action.hover", borderRadius: 1.5, p: 1, mb: 1.25}}>
                            <Typography variant="caption" fontWeight={600} color="text.secondary" display="block" mb={0.75}>
                                2. PARAMÈTRES ({activeModeObj.label.toUpperCase()})
                            </Typography>

                            {showFanControl && (
                                <Box display="flex" alignItems="center" justifyContent="space-between" mb={0.75} gap={1}>
                                    <Box display="flex" alignItems="center" gap={0.5} minWidth={80}>
                                        <VacuumIcon sx={{fontSize: 15}} color="action"/>
                                        <Typography variant="caption">Aspiration</Typography>
                                    </Box>
                                    <Box display="flex" gap={0.5} flex={1} justifyContent="flex-end">
                                        {FAN_SPEED_OPTIONS.map(opt => (
                                            <Button
                                                key={opt.id}
                                                size="small"
                                                variant={globalConfig.fanSpeed === opt.id ? "contained" : "outlined"}
                                                onClick={() => handleGlobalParamChange({fanSpeed: opt.id})}
                                                sx={{
                                                    minWidth: 0,
                                                    px: 0.9,
                                                    py: 0.25,
                                                    fontSize: "0.68rem",
                                                    textTransform: "none"
                                                }}
                                            >
                                                {opt.short}
                                            </Button>
                                        ))}
                                    </Box>
                                </Box>
                            )}

                            {showWaterControl && (
                                <Box display="flex" alignItems="center" justifyContent="space-between" mb={0.75} gap={1}>
                                    <Box display="flex" alignItems="center" gap={0.5} minWidth={80}>
                                        <MopIcon sx={{fontSize: 15}} color="action"/>
                                        <Typography variant="caption">Humidité</Typography>
                                    </Box>
                                    <Box display="flex" gap={0.5} flex={1} justifyContent="flex-end">
                                        {WATER_GRADE_OPTIONS.map(opt => (
                                            <Button
                                                key={opt.id}
                                                size="small"
                                                variant={globalConfig.waterGrade === opt.id ? "contained" : "outlined"}
                                                onClick={() => handleGlobalParamChange({waterGrade: opt.id})}
                                                sx={{
                                                    minWidth: 0,
                                                    px: 0.9,
                                                    py: 0.25,
                                                    fontSize: "0.68rem",
                                                    textTransform: "none"
                                                }}
                                            >
                                                {opt.label}
                                            </Button>
                                        ))}
                                    </Box>
                                </Box>
                            )}

                            <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
                                <Box display="flex" alignItems="center" gap={0.5} minWidth={80}>
                                    <IterationsIcon sx={{fontSize: 15}} color="action"/>
                                    <Typography variant="caption">Passages</Typography>
                                </Box>
                                <Box display="flex" gap={0.5} flex={1} justifyContent="flex-end">
                                    {[1, 2, 3].map(iter => (
                                        <Button
                                            key={iter}
                                            size="small"
                                            variant={globalConfig.iterations === iter ? "contained" : "outlined"}
                                            onClick={() => handleGlobalParamChange({iterations: iter})}
                                            sx={{
                                                minWidth: 34,
                                                px: 1,
                                                py: 0.25,
                                                fontSize: "0.7rem",
                                                textTransform: "none"
                                            }}
                                        >
                                            {iter}×
                                        </Button>
                                    ))}
                                </Box>
                            </Box>
                        </Box>
                    ) : (
                        <Box sx={{bgcolor: "action.hover", borderRadius: 1.5, p: 1, mb: 1.25}}>
                            <Box display="flex" alignItems="center" justifyContent="space-between" mb={0.75}>
                                <Box display="flex" alignItems="center" gap={0.5}>
                                    <CustomModeIcon sx={{fontSize: 15}} color="secondary"/>
                                    <Typography variant="caption" fontWeight={700} color="secondary.main">
                                        2. RÉGLAGES PAR PIÈCE (CLIQUEZ POUR MODIFIER)
                                    </Typography>
                                </Box>
                            </Box>

                            <Box display="flex" flexDirection="column" gap={0.6} sx={{maxHeight: 240, overflowY: "auto", pr: 0.5}}>
                                {roomsList.map(room => {
                                    const rCfg = getRoomConfig(room.id);
                                    const orderIdx = selectedSegmentIds.indexOf(room.id);
                                    const isSelected = orderIdx >= 0;
                                    const modeEntry = MODE_META.find(m => m.id === rCfg.operationMode) || MODE_META[0];
                                    const fanEntry = FAN_SPEED_OPTIONS.find(f => f.id === rCfg.fanSpeed) || FAN_SPEED_OPTIONS[1];
                                    const waterEntry = WATER_GRADE_OPTIONS.find(w => w.id === rCfg.waterGrade) || WATER_GRADE_OPTIONS[1];

                                    return (
                                        <Box
                                            key={room.id}
                                            display="flex"
                                            alignItems="center"
                                            justifyContent="space-between"
                                            gap={0.5}
                                            sx={{
                                                p: 0.6,
                                                borderRadius: 1,
                                                bgcolor: isSelected ? "action.selected" : "background.paper",
                                                border: "1px solid",
                                                borderColor: isSelected ? "primary.main" : "divider"
                                            }}
                                        >
                                            <Box
                                                onClick={() => toggleSegment(room.id)}
                                                sx={{
                                                    cursor: "pointer",
                                                    minWidth: 78,
                                                    flex: 1,
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                    whiteSpace: "nowrap"
                                                }}
                                            >
                                                <Typography
                                                    variant="caption"
                                                    fontWeight={isSelected ? 700 : 500}
                                                    color={isSelected ? "primary.main" : "text.primary"}
                                                >
                                                    {isSelected ? `${orderIdx + 1}. ` : ""}{room.name}
                                                </Typography>
                                            </Box>

                                            <Box display="flex" gap={0.4} alignItems="center">
                                                <Tooltip title="Changer le mode de cette pièce (Vac+Mop / Vac→Mop / Vac / Mop)">
                                                    <Button
                                                        size="small"
                                                        variant="contained"
                                                        color="secondary"
                                                        onClick={() => cycleRoomMode(room.id)}
                                                        sx={{
                                                            minWidth: 58,
                                                            px: 0.6,
                                                            py: 0.2,
                                                            fontSize: "0.65rem",
                                                            textTransform: "none"
                                                        }}
                                                    >
                                                        {modeEntry.shortLabel}
                                                    </Button>
                                                </Tooltip>

                                                <Tooltip title="Puissance d'aspiration">
                                                    <span>
                                                        <Button
                                                            size="small"
                                                            variant="outlined"
                                                            disabled={rCfg.operationMode === "mop"}
                                                            onClick={() => cycleRoomFan(room.id)}
                                                            sx={{
                                                                minWidth: 38,
                                                                px: 0.5,
                                                                py: 0.2,
                                                                fontSize: "0.65rem",
                                                                textTransform: "none"
                                                            }}
                                                        >
                                                            {fanEntry.short}
                                                        </Button>
                                                    </span>
                                                </Tooltip>

                                                <Tooltip title="Niveau d'eau Mop">
                                                    <span>
                                                        <Button
                                                            size="small"
                                                            variant="outlined"
                                                            disabled={rCfg.operationMode === "vacuum"}
                                                            onClick={() => cycleRoomWater(room.id)}
                                                            sx={{
                                                                minWidth: 42,
                                                                px: 0.5,
                                                                py: 0.2,
                                                                fontSize: "0.65rem",
                                                                textTransform: "none"
                                                            }}
                                                        >
                                                            {waterEntry.short}
                                                        </Button>
                                                    </span>
                                                </Tooltip>

                                                <Tooltip title="Nombre de passages">
                                                    <Button
                                                        size="small"
                                                        variant="outlined"
                                                        onClick={() => cycleRoomIterations(room.id)}
                                                        sx={{
                                                            minWidth: 28,
                                                            px: 0.4,
                                                            py: 0.2,
                                                            fontSize: "0.65rem",
                                                            textTransform: "none"
                                                        }}
                                                    >
                                                        {rCfg.iterations}×
                                                    </Button>
                                                </Tooltip>
                                            </Box>
                                        </Box>
                                    );
                                })}
                            </Box>
                        </Box>
                    )}

                    {/* Launch Buttons */}
                    <Box display="flex" gap={1}>
                        <Button
                            fullWidth
                            variant="contained"
                            color={useCustomPerRoom ? "secondary" : "primary"}
                            disabled={selectedSegmentIds.length === 0 || !canClean || isStartingClean}
                            startIcon={isStartingClean ? <CircularProgress size={16} color="inherit"/> : <PlayIcon/>}
                            onClick={handleStartSelectedRooms}
                            sx={{
                                fontWeight: 700,
                                textTransform: "none",
                                py: 0.9
                            }}
                        >
                            {selectedSegmentIds.length > 0 ?
                                `Nettoyer ${selectedSegmentIds.length} pièce${selectedSegmentIds.length > 1 ? "s" : ""} (${activeModeObj.shortLabel})` :
                                "Sélectionnez 1+ pièce(s)"}
                        </Button>

                        <Tooltip title="Lancer le nettoyage de toutes les pièces de l'étage avec ce mode">
                            <span>
                                <Button
                                    variant="outlined"
                                    color="inherit"
                                    disabled={roomsList.length === 0 || !canClean || isStartingClean}
                                    onClick={handleStartAllRooms}
                                    sx={{
                                        whiteSpace: "nowrap",
                                        textTransform: "none",
                                        py: 0.9,
                                        px: 1.5,
                                        fontSize: "0.75rem"
                                    }}
                                >
                                    Tout l&apos;étage
                                </Button>
                            </span>
                        </Tooltip>
                    </Box>
                </Box>
            </Paper>
        </Grid2>
    );
};

export default RoomCleaningControl;
