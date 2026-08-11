const express = require("express");

const router = express.Router();

const CustomerManager =
    require("../customers/CustomerManager");

/*
==================================================
GET DASHBOARD SUMMARY
==================================================
GET /customers/:agentId/summary
*/

router.get("/:agentId/summary", async (req, res) => {

    try {

        const data =
            await CustomerManager.getDashboardSummary(
                req.params.agentId
            );

        res.json({

            success: true,

            data

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
GET ALL CUSTOMERS
==================================================
GET /customers/:agentId
*/

router.get("/:agentId", async (req, res) => {

    try {

        const customers =
            await CustomerManager.getCustomers(
                req.params.agentId
            );

        res.json({

            success: true,

            count: customers.length,

            customers

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
SEARCH CUSTOMERS
==================================================
GET /customers/:agentId/search?q=john
*/

router.get("/:agentId/search", async (req, res) => {

    try {

        const keyword =
            req.query.q || "";

        const customers =
            await CustomerManager.searchCustomers(

                req.params.agentId,

                keyword

            );

        res.json({

            success: true,

            count: customers.length,

            customers

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
GET EXPIRING SUBSCRIPTIONS
==================================================
GET /customers/:agentId/expiring
GET /customers/:agentId/expiring?days=14
*/

router.get("/:agentId/expiring", async (req, res) => {

    try {

        const days =
            Number(req.query.days || 7);

        const customers =
            await CustomerManager.getExpiringCustomers(

                req.params.agentId,

                days

            );

        res.json({

            success: true,

            count: customers.length,

            customers

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
GET CUSTOMER DETAILS
==================================================
GET /customers/details/:childId
*/

router.get("/details/:childId", async (req, res) => {

    try {

        const customer =
            await CustomerManager.getCustomer(

                req.params.childId

            );

        res.json({

            success: true,

            customer

        });

    } catch (e) {

        console.error(e);

        res.status(404).json({

            success: false,

            message: e.message

        });

    }

});

/*
==================================================
GET REVENUE SUMMARY
==================================================
GET /customers/:agentId/revenue
*/

router.get("/:agentId/revenue", async (req, res) => {

    try {

        const revenue =
            await CustomerManager.getRevenueSummary(

                req.params.agentId

            );

        res.json({

            success: true,

            revenue

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
GET DASHBOARD SUMMARY
==================================================
GET /customers/:agentId/summary
*/

router.get("/:agentId/summary", async (req, res) => {

    try {

        const data =
            await CustomerManager.getDashboardSummary(
                req.params.agentId
            );

        res.json({

            success: true,

            data

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
GET ALL CUSTOMERS
==================================================
GET /customers/:agentId
*/

router.get("/:agentId", async (req, res) => {

    try {

        const customers =
            await CustomerManager.getCustomers(
                req.params.agentId
            );

        res.json({

            success: true,

            count: customers.length,

            customers

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
SEARCH CUSTOMERS
==================================================
GET /customers/:agentId/search?q=john
*/

router.get("/:agentId/search", async (req, res) => {

    try {

        const keyword =
            req.query.q || "";

        const customers =
            await CustomerManager.searchCustomers(

                req.params.agentId,

                keyword

            );

        res.json({

            success: true,

            count: customers.length,

            customers

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
GET EXPIRING SUBSCRIPTIONS
==================================================
GET /customers/:agentId/expiring
GET /customers/:agentId/expiring?days=14
*/

router.get("/:agentId/expiring", async (req, res) => {

    try {

        const days =
            Number(req.query.days || 7);

        const customers =
            await CustomerManager.getExpiringCustomers(

                req.params.agentId,

                days

            );

        res.json({

            success: true,

            count: customers.length,

            customers

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
GET CUSTOMER DETAILS
==================================================
GET /customers/details/:childId
*/

router.get("/details/:childId", async (req, res) => {

    try {

        const customer =
            await CustomerManager.getCustomer(

                req.params.childId

            );

        res.json({

            success: true,

            customer

        });

    } catch (e) {

        console.error(e);

        res.status(404).json({

            success: false,

            message: e.message

        });

    }

});

/*
==================================================
GET REVENUE SUMMARY
==================================================
GET /customers/:agentId/revenue
*/

router.get("/:agentId/revenue", async (req, res) => {

    try {

        const revenue =
            await CustomerManager.getRevenueSummary(

                req.params.agentId

            );

        res.json({

            success: true,

            revenue

        });

    } catch (e) {

        console.error(e);

        res.status(500).json({

            success: false,

            message: e.message

        });

    }

});

router.post("/:agentId/:childId/activity", async (req, res) => {

    console.log("POST /activity route reached");

    try {

        console.log(req.params);
        console.log(req.body);

        const result =
            await CustomerManager.addActivity(
                req.params.agentId,
                req.params.childId,
                req.body
            );

        res.json({
            success: true,
            data: result
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