const express = require("express");

const router = express.Router();

const PayoutManager =
    require("../payout/PayoutManager");

/*
==================================================
AGENT REQUEST PHONE CHANGE
==================================================
*/

router.post("/change", async (req, res) => {

    try {

        console.log("Incoming request:");
        console.log(req.body);

        const result =
            await PayoutManager.requestPhoneChange(req.body);

        res.json(result);

    } catch (e) {

        console.error("PHONE CHANGE ERROR");
        console.error(e);

        res.status(400).json({

            success: false,

            message: e.message

        });

    }

});

/*
==================================================
GET ALL PENDING REQUESTS
==================================================
*/

router.get("/admin/requests", async (req, res) => {

    try {

        const requests =
            await PayoutManager.getPendingRequests();

        res.json({

            success: true,

            data: requests

        });

    } catch (e) {

        res.status(400).json({

            success: false,

            message: e.message

        });

    }

});

/*
==================================================
APPROVE
==================================================
*/

router.post("/admin/approve", async (req, res) => {

    try {

        const result =
            await PayoutManager.approvePhoneChange(req.body);

        res.json(result);

    } catch (e) {

        res.status(400).json({

            success: false,

            message: e.message

        });

    }

});

/*
=========================================
APPROVE PAYOUT CHANGE
=========================================
*/

router.post("/approve", async (req, res) => {

    try {

        const result =
            await PayoutManager.approvePhoneChange(req.body);

        res.json(result);

    } catch (e) {

        console.error(e);

        res.status(400).json({

            success: false,
            message: e.message

        });

    }

});

/*
=========================================
REJECT PAYOUT CHANGE
=========================================
*/

router.post("/reject", async (req, res) => {

    try {

        const result =
            await PayoutManager.rejectPhoneChange(req.body);

        res.json(result);

    } catch (e) {

        console.error(e);

        res.status(400).json({

            success: false,
            message: e.message

        });

    }

});

/*
==================================================
REJECT
==================================================
*/

router.post("/admin/reject", async (req, res) => {

    try {

        const result =
            await PayoutManager.rejectPhoneChange(req.body);

        res.json(result);

    } catch (e) {

        res.status(400).json({

            success: false,

            message: e.message

        });

    }

});

module.exports = router;