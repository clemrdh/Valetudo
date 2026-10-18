import {Grid2} from "@mui/material";
import {
    AppRegistration as OperationModeIcon,
} from "@mui/icons-material";
import {Capability, useRobotInformationQuery} from "../api";
import {useCapabilitiesSupported} from "../CapabilitiesProvider";
import BasicControls from "./BasicControls";
import PresetSelectionControl from "./PresetSelection";
import RobotStatus from "./RobotStatus";
import Dock from "./Dock";
import CurrentStatistics from "./CurrentStatistics";
import Attachments from "./Attachments";
import DreameQuickSettings from "./DreameQuickSettings";
import MultiFloorMapControl from "./MultiFloorMapControl";
import RoomCleaningControl from "./RoomCleaningControl";
import {FanSpeedMediumIcon, WaterGradeLowIcon} from "../components/CustomIcons";
import React from "react";


const ControlsBody = (): React.ReactElement => {
    const [
        basicControls,
        fanSpeed,
        waterControl,
        operationMode,
        triggerEmptySupported,
        mopDockCleanTriggerSupported,
        mopDockDryTriggerSupported,
        currentStatistics,
    ] = useCapabilitiesSupported(
        Capability.BasicControl,
        Capability.FanSpeedControl,
        Capability.WaterUsageControl,
        Capability.OperationModeControl,
        Capability.AutoEmptyDockManualTrigger,
        Capability.MopDockCleanManualTrigger,
        Capability.MopDockDryManualTrigger,
        Capability.CurrentStatistics
    );

    const {
        data: robotInformation,
    } = useRobotInformationQuery();


    return (
        <Grid2 container spacing={1.5} direction="column" sx={{userSelect: "none"}}>
            {basicControls && <BasicControls />}

            <RoomCleaningControl />

            <RobotStatus />

            <MultiFloorMapControl />

            {operationMode && (
                <PresetSelectionControl
                    capability={Capability.OperationModeControl}
                    label="Mode"
                    icon={
                        <OperationModeIcon
                            fontSize="small"
                        />
                    }
                />
            )}

            {fanSpeed && (
                <PresetSelectionControl
                    capability={Capability.FanSpeedControl}
                    label="Fan"
                    icon={
                        <FanSpeedMediumIcon
                            fontSize="small"
                        />
                    }
                />
            )}
            {waterControl && (
                <PresetSelectionControl
                    capability={Capability.WaterUsageControl}
                    label="Water"
                    icon={<WaterGradeLowIcon fontSize="small" />}
                />
            )}

            {
                (triggerEmptySupported || mopDockCleanTriggerSupported || mopDockDryTriggerSupported) &&

                <Dock/>
            }

            <DreameQuickSettings />

            {
                robotInformation &&
                robotInformation.modelDetails.supportedAttachments.length > 0 &&

                <Attachments/>
            }

            {currentStatistics && <CurrentStatistics/>}
        </Grid2>
    );
};

export default ControlsBody;
