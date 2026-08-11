const express = require("express");

const router = express.Router();

const withdrawalManager =
    require("../withdrawals/WithdrawalManager");


/*
====================================================
REQUEST WITHDRAWAL
====================================================
*/

router.post("/request", async (req, res) => {

    try {

        const result =
    await withdrawalManager.requestWithdrawal({

        agentId: req.body.agentId,

        amount: req.body.amount,

        phone: req.body.phone

    });

res.status(200).json({

    success: true,

    message: "Withdrawal request submitted successfully.",

    withdrawal: result.withdrawal,

    balance: result.newBalance,

    pendingWithdrawals: result.pendingWithdrawals

});

    } catch (e) {

        res.status(400).json({

            success: false,

            message: e.message

        });

    }

});


/*
====================================================
GET AGENT WITHDRAWAL HISTORY
====================================================
*/

router.get("/agent/:agentId", async (req, res) => {

    try {

        const history =
            await withdrawalManager.getAgentWithdrawals(

                req.params.agentId

            );

        res.json({

            success: true,

            withdrawals: history

        });

    } catch (e) {

        res.status(400).json({

            success: false,

            message: e.message

        });

    }

});


/*
====================================================
GET ALL PENDING REQUESTS
====================================================
*/

/*
====================================================
GET ALL WITHDRAWALS
====================================================
*/

router.get("/", async (req, res) => {

    try {

        const snapshot = await require("../firebase")
            .db
            .ref("withdrawalRequests")
            .get();

        const list = [];

        snapshot.forEach(child => {

            list.push({

                id: child.key,
                ...child.val()

            });

        });

        list.sort(
            (a, b) => b.requestedAt - a.requestedAt
        );

        res.json({

            success: true,
            data: list

        });

    } catch (e) {

        res.status(500).json({

            success: false,
            message: e.message

        });

    }

});


/*
====================================================
APPROVE
====================================================
*/

router.post("/approve", async (req, res) => {

    try {

        const result =
            await withdrawalManager.approveWithdrawal(

                req.body.withdrawalId,
                req.body.adminId

            );

        res.json(result);

    }

    catch (e) {

        res.status(400).json({

            success:false,
            message:e.message

        });

    }

});


/*
====================================================
REJECT
====================================================
*/

router.post("/reject", async (req, res) => {

    try {

        const result =
            await withdrawalManager.rejectWithdrawal(

                req.body.withdrawalId,
                req.body.reason

            );

        res.json(result);

    }

    catch(e){

        res.status(400).json({

            success:false,
            message:e.message

        });

    }

});

/*
====================================================
MARK AS PAID
====================================================
*/

router.post("/paid", async (req, res) => {

    try {

        const result =
            await withdrawalManager.markAsPaid(

                req.body.withdrawalId,
                req.body.mpesaReceipt

            );

        res.json(result);

    }

    catch(e){

        res.status(400).json({

            success:false,
            message:e.message

        });

    }

});

/*
================================================
WITHDRAWAL DETAILS
================================================
*/

router.get(
    "/details/:withdrawalId",

    async (req, res) => {

        try {

        
            const data =
    await withdrawalManager.getWithdrawalDetails(
        req.params.withdrawalId
    );        

            res.json({

                success: true,

                data

            });

        }

        catch (e) {

            res.status(400).json({

                success: false,

                message: e.message

            });

        }

    }

);


module.exports = router;