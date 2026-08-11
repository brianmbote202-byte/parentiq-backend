const express = require("express");

const router = express.Router();

const CustomerActivityService =
    require("../services/CustomerActivityService");

  router.use((req, res, next) => {

    console.log("========================");
    console.log("METHOD:", req.method);
    console.log("URL:", req.originalUrl);
    console.log("BODY:", req.body);
    console.log("========================");

    next();

});

/*
==================================================
ADD ACTIVITY
POST /activities
==================================================
*/

/*router.post("/", async (req, res) => {

    try {

        const activity =
            await CustomerActivityService.addActivity(req.body);

        res.json({

            success: true,

            activity

        });

    } catch (e) {

        console.error(e);

        res.status(500).json({

            success: false,

            message: e.message

        });

    }

});*/
router.post("/", async (req, res) => {

    try {

        console.log("Incoming Activity:", req.body);

        const activity =
            await CustomerActivityService.addActivity(req.body);

        res.json({

            success: true,

            activity

        });

    } catch (e) {

        console.error("ADD ACTIVITY ERROR:", e);

        res.status(500).json({

            success: false,

            message: e.message

        });

    }

});

/*
==================================================
GET ALL ACTIVITIES
GET /activities/:agentId/:parentId
==================================================
*/

router.get("/:agentId/:parentId", async (req, res) => {

      console.log(">>> ENTERED GET HANDLER");

    try {

        const activities =
            await CustomerActivityService.getActivities(

                req.params.agentId,

                req.params.parentId

            );

        res.json({

            success: true,

            activities

        });

    } catch (e) {

        console.error(e);

        res.status(500).json({

            success: false,

            message: e.message

        });

    }

});



/*
==================================================
ACTIVITY SUMMARY
GET /activities/:agentId/:parentId/summary
==================================================
*/

router.get("/:agentId/:parentId/summary", async (req, res) => {

    try {

        const summary =
            await CustomerActivityService.getActivitySummary(

                req.params.agentId,

                req.params.parentId

            );

        res.json({

            success: true,

            summary

        });

    } catch (e) {

        console.error(e);

        res.status(500).json({

            success: false,

            message: e.message

        });

    }

});

/*
==================================================
ACTIVITY STATISTICS
GET /activities/:agentId/:parentId/statistics
==================================================
*/

router.get("/:agentId/:parentId/statistics", async (req, res) => {

    try {

        const statistics =
            await CustomerActivityService.getStatistics(

                req.params.agentId,

                req.params.parentId

            );

        res.json({

            success: true,

            statistics

        });

    } catch (e) {

        console.error(e);

        res.status(500).json({

            success: false,

            message: e.message

        });

    }

});

module.exports = router;