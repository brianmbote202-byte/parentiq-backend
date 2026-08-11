const express = require("express");

const router = express.Router();

const AgentPreferenceManager =
    require("../preferences/AgentPreferenceManager");

const AgentStatisticsManager =
    require("../statistics/AgentStatisticsManager");

router.get("/:agentId", async (req, res) => {

    try {

        const agentId = req.params.agentId.trim();

        const preferences =
            await AgentPreferenceManager.shouldShowGrowthSheet(agentId);

        const statistics =
            await AgentStatisticsManager.refresh(agentId);

        res.json({

            success: true,

            show: preferences.show,

            reason: preferences.reason,

            statistics

        });

    } catch (e) {

        res.status(500).json({

            success: false,

            message: e.message

        });

    }

});

module.exports = router;