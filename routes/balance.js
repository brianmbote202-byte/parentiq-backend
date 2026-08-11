const express = require("express");
const router = express.Router();

const AccountBalanceManager =
    require("../mpesa/AccountBalanceManager");

router.post("/", async (req, res) => {

    try {

        const result =
            await AccountBalanceManager.getBalance();

        res.json({
            success: true,
            result
        });

    } catch (e) {

        res.status(500).json({
            success: false,
            message: e.message
        });

    }

});

module.exports = router;