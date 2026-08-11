const express = require("express");

const router = express.Router();

const AgentDashboardManager =
require("../agents/AgentDashboardManager");

/*
==================================================
GET DASHBOARD
==================================================

GET /agents/:agentId/dashboard

*/

router.get("/:agentId/dashboard", async (req, res) => {

    try {

        const dashboard =
            await AgentDashboardManager.getDashboard(
                req.params.agentId
            );

        res.json({

            success: true,

            dashboard

        });

    }

    catch (e) {

        console.error(e);

        res.status(500).json({

            success: false,

            message: e.message

        });

    }

});

module.exports = router;