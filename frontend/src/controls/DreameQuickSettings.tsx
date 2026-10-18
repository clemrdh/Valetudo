import {
    Box,
    Button,
    Divider,
    FormControlLabel,
    Grid2,
    Switch,
    ToggleButton,
    ToggleButtonGroup,
    Typography
} from "@mui/material";
import {
    Crop as CoverageIcon,
    EditNote as AnnotationsIcon,
    Tune as TuneIcon,
    Videocam as SpectatorIcon,
} from "@mui/icons-material";
import React from "react";
import {useNavigate} from "react-router-dom";
import {
    Capability,
    CarpetSensorMode,
    CleanRoute,
    MopDockMopDryingDuration,
    MopDockMopWashTemperature,
    useCameraLightControlMutation,
    useCameraLightControlQuery,
    useCarpetModeStateMutation,
    useCarpetModeStateQuery,
    useCarpetSensorModeMutation,
    useCarpetSensorModePropertiesQuery,
    useCarpetSensorModeQuery,
    useCleanRouteControlPropertiesQuery,
    useCleanRouteMutation,
    useCleanRouteQuery,
    useCollisionAvoidantNavigationControlMutation,
    useCollisionAvoidantNavigationControlQuery,
    useMopDockMopDryingTimeControlPropertiesQuery,
    useMopDockMopDryingTimeMutation,
    useMopDockMopDryingTimeQuery,
    useMopDockMopWashTemperatureMutation,
    useMopDockMopWashTemperaturePropertiesQuery,
    useMopDockMopWashTemperatureQuery,
    useMopExtensionControlMutation,
    useMopExtensionControlQuery,
    useMopExtensionFurnitureLegHandlingControlMutation,
    useMopExtensionFurnitureLegHandlingControlQuery,
    useMopTwistControlMutation,
    useMopTwistControlQuery,
    useQuirksQuery,
    useSetQuirkValueMutation,
} from "../api";
import {useCapabilitiesSupported} from "../CapabilitiesProvider";
import ControlsCard from "./ControlsCard";

const SIDE_BRUSH_EXTEND_QUIRK_ID = "e560d60c-76de-4ccc-8c01-8ccbcece850e";

const ROUTE_LABELS: Record<string, string> = {
    quick: "Rapide",
    normal: "Standard",
    intensive: "Intensif",
    deep: "Profond"
};

const CARPET_LABELS: Record<string, string> = {
    lift: "Lever",
    detach: "Déposer",
    avoid: "Éviter",
    off: "Ignorer"
};

const WASH_TEMP_LABELS: Record<string, string> = {
    cold: "Froid",
    normal: "Normal",
    warm: "Tiède",
    hot: "Chaud 70°C",
    scalding: "Très chaud"
};

const DRY_TIME_LABELS: Record<string, string> = {
    "1h": "1h",
    "2h": "2h",
    "3h": "3h",
    "4h": "4h",
    "cold": "Froid"
};

const DreameQuickSettings = (): React.ReactElement | null => {
    const navigate = useNavigate();

    const [
        cleanRouteSupported,
        carpetSensorSupported,
        carpetBoostSupported,
        washTempSupported,
        dryingTimeSupported,
        mopExtensionSupported,
        mopTwistSupported,
        legHandlingSupported,
        collisionAvoidantSupported,
        quirksSupported,
        cameraLightSupported,
        annotationsSupported,
        duststreamingSupported
    ] = useCapabilitiesSupported(
        Capability.CleanRouteControl,
        Capability.CarpetSensorModeControl,
        Capability.CarpetModeControl,
        Capability.MopDockMopWashTemperatureControl,
        Capability.MopDockMopDryingTimeControl,
        Capability.MopExtensionControl,
        Capability.MopTwistControl,
        Capability.MopExtensionFurnitureLegHandlingControl,
        Capability.CollisionAvoidantNavigation,
        Capability.Quirks,
        Capability.CameraLightControl,
        Capability.MapAnnotations,
        Capability.Duststreaming
    );

    const {data: cleanRoute} = useCleanRouteQuery();
    const {data: cleanRouteProps} = useCleanRouteControlPropertiesQuery();
    const {mutate: setCleanRoute, isPending: cleanRoutePending} = useCleanRouteMutation();

    const {data: carpetSensorMode} = useCarpetSensorModeQuery();
    const {data: carpetSensorProps} = useCarpetSensorModePropertiesQuery();
    const {mutate: setCarpetSensorMode, isPending: carpetSensorPending} = useCarpetSensorModeMutation();

    const {data: carpetBoost} = useCarpetModeStateQuery();
    const {mutate: setCarpetBoost, isPending: carpetBoostPending} = useCarpetModeStateMutation();

    const {data: washTemp} = useMopDockMopWashTemperatureQuery();
    const {data: washTempProps} = useMopDockMopWashTemperaturePropertiesQuery();
    const {mutate: setWashTemp, isPending: washTempPending} = useMopDockMopWashTemperatureMutation();

    const {data: dryingTime} = useMopDockMopDryingTimeQuery();
    const {data: dryingTimeProps} = useMopDockMopDryingTimeControlPropertiesQuery();
    const {mutate: setDryingTime, isPending: dryingTimePending} = useDryingTimeMutationWrapper();

    function useDryingTimeMutationWrapper() {
        return useMopDockMopDryingTimeMutation();
    }

    const {data: mopExtension} = useMopExtensionControlQuery();
    const {mutate: setMopExtension, isPending: mopExtensionPending} = useMopExtensionControlMutation();

    const {data: mopTwist} = useMopTwistControlQuery();
    const {mutate: setMopTwist, isPending: mopTwistPending} = useMopTwistControlMutation();

    const {data: legHandling} = useMopExtensionFurnitureLegHandlingControlQuery();
    const {mutate: setLegHandling, isPending: legHandlingPending} = useMopExtensionFurnitureLegHandlingControlMutation();

    const {data: collisionAvoidant} = useCollisionAvoidantNavigationControlQuery();
    const {mutate: setCollisionAvoidant, isPending: collisionAvoidantPending} = useCollisionAvoidantNavigationControlMutation();

    const {data: quirks} = useQuirksQuery();
    const {mutate: setQuirkValue, isPending: quirkPending} = useSetQuirkValueMutation();
    const sideBrushQuirk = React.useMemo(() => {
        return quirks?.find(q => q.id === SIDE_BRUSH_EXTEND_QUIRK_ID);
    }, [quirks]);

    const {data: cameraLight} = useCameraLightControlQuery();
    const {mutate: setCameraLight, isPending: cameraLightPending} = useCameraLightControlMutation();

    const anyPending =
        cleanRoutePending ||
        carpetSensorPending ||
        carpetBoostPending ||
        washTempPending ||
        dryingTimePending ||
        mopExtensionPending ||
        mopTwistPending ||
        legHandlingPending ||
        collisionAvoidantPending ||
        quirkPending ||
        cameraLightPending;

    return (
        <ControlsCard
            icon={TuneIcon}
            title="Dreame X40 Quick Settings"
            pending={anyPending}
        >
            <Box sx={{pt: 0.5}}>
                {cleanRouteSupported && cleanRouteProps?.supportedRoutes && (
                    <Box sx={{mb: 1.25}}>
                        <Typography variant="caption" color="textSecondary" sx={{display: "block", mb: 0.5}}>
                            Trajectoire (Intensif/Profond = mode Laver)
                        </Typography>
                        <ToggleButtonGroup
                            size="small"
                            fullWidth
                            exclusive
                            value={cleanRoute ?? null}
                            onChange={(_e, val) => {
                                if (val) {
                                    setCleanRoute(val as CleanRoute);
                                }
                            }}
                        >
                            {cleanRouteProps.supportedRoutes.map((r) => {
                                return (
                                    <ToggleButton key={r} value={r} sx={{py: 0.35, fontSize: "0.72rem"}}>
                                        {ROUTE_LABELS[r] ?? r}
                                    </ToggleButton>
                                );
                            })}
                        </ToggleButtonGroup>
                    </Box>
                )}

                {carpetSensorSupported && carpetSensorProps?.supportedModes && (
                    <Box sx={{mb: 1.25}}>
                        <Typography variant="caption" color="textSecondary" sx={{display: "block", mb: 0.5}}>
                            Serpillières sur Tapis
                        </Typography>
                        <ToggleButtonGroup
                            size="small"
                            fullWidth
                            exclusive
                            value={carpetSensorMode ?? null}
                            onChange={(_e, val) => {
                                if (val) {
                                    setCarpetSensorMode(val as CarpetSensorMode);
                                }
                            }}
                        >
                            {carpetSensorProps.supportedModes.map((m) => {
                                return (
                                    <ToggleButton key={m} value={m} sx={{py: 0.35, fontSize: "0.72rem"}}>
                                        {CARPET_LABELS[m] ?? m}
                                    </ToggleButton>
                                );
                            })}
                        </ToggleButtonGroup>
                    </Box>
                )}

                {washTempSupported && washTempProps?.supportedTemperatures && (
                    <Box sx={{mb: 1.25}}>
                        <Typography variant="caption" color="textSecondary" sx={{display: "block", mb: 0.5}}>
                            Température lavage serpillières
                        </Typography>
                        <ToggleButtonGroup
                            size="small"
                            fullWidth
                            exclusive
                            value={washTemp ?? null}
                            onChange={(_e, val) => {
                                if (val) {
                                    setWashTemp(val as MopDockMopWashTemperature);
                                }
                            }}
                        >
                            {washTempProps.supportedTemperatures.map((t) => {
                                return (
                                    <ToggleButton key={t} value={t} sx={{py: 0.35, fontSize: "0.72rem"}}>
                                        {WASH_TEMP_LABELS[t] ?? t}
                                    </ToggleButton>
                                );
                            })}
                        </ToggleButtonGroup>
                    </Box>
                )}

                {dryingTimeSupported && dryingTimeProps?.supportedDurations && (
                    <Box sx={{mb: 1.25}}>
                        <Typography variant="caption" color="textSecondary" sx={{display: "block", mb: 0.5}}>
                            Durée séchage air chaud
                        </Typography>
                        <ToggleButtonGroup
                            size="small"
                            fullWidth
                            exclusive
                            value={dryingTime ?? null}
                            onChange={(_e, val) => {
                                if (val) {
                                    setDryingTime(val as MopDockMopDryingDuration);
                                }
                            }}
                        >
                            {dryingTimeProps.supportedDurations.map((d) => {
                                return (
                                    <ToggleButton key={d} value={d} sx={{py: 0.35, fontSize: "0.72rem"}}>
                                        {DRY_TIME_LABELS[d] ?? d}
                                    </ToggleButton>
                                );
                            })}
                        </ToggleButtonGroup>
                    </Box>
                )}

                <Grid2 container spacing={0.5} sx={{mb: 1}}>
                    {mopExtensionSupported && (
                        <Grid2 size={6}>
                            <FormControlLabel
                                control={
                                    <Switch
                                        size="small"
                                        checked={mopExtension?.enabled ?? false}
                                        onChange={(e) => {
                                            setMopExtension(e.target.checked);
                                        }}
                                    />
                                }
                                label={<Typography variant="caption">MopExtend™ (plinthes)</Typography>}
                            />
                        </Grid2>
                    )}
                    {mopTwistSupported && (
                        <Grid2 size={6}>
                            <FormControlLabel
                                control={
                                    <Switch
                                        size="small"
                                        checked={mopTwist?.enabled ?? false}
                                        onChange={(e) => {
                                            setMopTwist(e.target.checked);
                                        }}
                                    />
                                }
                                label={<Typography variant="caption">Twist sous plinthes</Typography>}
                            />
                        </Grid2>
                    )}
                    {quirksSupported && sideBrushQuirk && (
                        <Grid2 size={6}>
                            <FormControlLabel
                                control={
                                    <Switch
                                        size="small"
                                        checked={sideBrushQuirk.value === "on"}
                                        onChange={(e) => {
                                            setQuirkValue({
                                                id: SIDE_BRUSH_EXTEND_QUIRK_ID,
                                                value: e.target.checked ? "on" : "off"
                                            });
                                        }}
                                    />
                                }
                                label={<Typography variant="caption">Brosse avant (coins)</Typography>}
                            />
                        </Grid2>
                    )}
                    {collisionAvoidantSupported && (
                        <Grid2 size={6}>
                            <FormControlLabel
                                control={
                                    <Switch
                                        size="small"
                                        checked={collisionAvoidant ? !collisionAvoidant.enabled : true}
                                        onChange={(e) => {
                                            // Ras des plinthes ON => LessColl = 0 (disable collision buffer)
                                            setCollisionAvoidant(!e.target.checked);
                                        }}
                                    />
                                }
                                label={<Typography variant="caption">Ras des plinthes</Typography>}
                            />
                        </Grid2>
                    )}
                    {legHandlingSupported && (
                        <Grid2 size={6}>
                            <FormControlLabel
                                control={
                                    <Switch
                                        size="small"
                                        checked={legHandling?.enabled ?? false}
                                        onChange={(e) => {
                                            setLegHandling(e.target.checked);
                                        }}
                                    />
                                }
                                label={<Typography variant="caption">Pieds de meubles</Typography>}
                            />
                        </Grid2>
                    )}
                    {carpetBoostSupported && (
                        <Grid2 size={6}>
                            <FormControlLabel
                                control={
                                    <Switch
                                        size="small"
                                        checked={carpetBoost?.enabled ?? false}
                                        onChange={(e) => {
                                            setCarpetBoost(e.target.checked);
                                        }}
                                    />
                                }
                                label={<Typography variant="caption">Boost Tapis</Typography>}
                            />
                        </Grid2>
                    )}
                    {cameraLightSupported && (
                        <Grid2 size={6}>
                            <FormControlLabel
                                control={
                                    <Switch
                                        size="small"
                                        checked={cameraLight?.enabled ?? false}
                                        onChange={(e) => {
                                            setCameraLight(e.target.checked);
                                        }}
                                    />
                                }
                                label={<Typography variant="caption">LED Caméra</Typography>}
                            />
                        </Grid2>
                    )}
                </Grid2>

                <Divider sx={{my: 1}} />

                <Grid2 container spacing={1}>
                    {annotationsSupported && (
                        <Grid2 size={4}>
                            <Button
                                fullWidth
                                size="small"
                                variant="outlined"
                                color="inherit"
                                startIcon={<AnnotationsIcon fontSize="small" />}
                                onClick={() => {
                                    navigate("/options/map_management/annotations");
                                }}
                                sx={{fontSize: "0.7rem"}}
                            >
                                Seuils/Rampes
                            </Button>
                        </Grid2>
                    )}
                    <Grid2 size={4}>
                        <Button
                            fullWidth
                            size="small"
                            variant="outlined"
                            color="inherit"
                            startIcon={<CoverageIcon fontSize="small" />}
                            onClick={() => {
                                navigate("/options/map_management/robot_coverage");
                            }}
                            sx={{fontSize: "0.7rem"}}
                        >
                            Couverture
                        </Button>
                    </Grid2>
                    {duststreamingSupported && (
                        <Grid2 size={4}>
                            <Button
                                fullWidth
                                size="small"
                                variant="outlined"
                                color="inherit"
                                startIcon={<SpectatorIcon fontSize="small" />}
                                onClick={() => {
                                    navigate("/options/map_management/spectator");
                                }}
                                sx={{fontSize: "0.7rem"}}
                            >
                                Caméra Live
                            </Button>
                        </Grid2>
                    )}
                </Grid2>
            </Box>
        </ControlsCard>
    );
};

export default DreameQuickSettings;
