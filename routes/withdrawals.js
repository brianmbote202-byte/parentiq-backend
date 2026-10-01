const express = require("express");

const router = express.Router();

const withdrawalManager =
    require("../withdrawals/WithdrawalManager");

const PayPalPayoutManager =
    require("../payments/PayPalPayoutManager");

const { db } =
    require("../firebase");


/*
====================================================
REQUEST WITHDRAWAL
====================================================
*/

router.post("/request", async (req, res) => {

    try {

        console.log(
            "WITHDRAWAL REQUEST BODY:",
            req.body
        );


        const result =
            await withdrawalManager.requestWithdrawal({

                agentId:
                    req.body.agentId,

                amount:
                    req.body.amount,

                phone:
                    req.body.phone,

                paymentMethod:
                    req.body.paymentMethod || "MPESA",

                paypalEmail:
                    req.body.paypalEmail || "",

                /*
                ==========================================
                PAYPAL PAYOUT AMOUNT

                Sandbox testing can send a small USD amount.

                Production should calculate this on the
                backend using the configured FX rate.
                ==========================================
                */

                payoutAmount:
                    req.body.payoutAmount || 0,

                payoutCurrency:
                    req.body.payoutCurrency || "USD"
            });


        return res.status(200).json({

            success: true,

            message:
                "Withdrawal request submitted successfully.",

            withdrawal:
                result.withdrawal,

            balance:
                result.newBalance,

            pendingWithdrawals:
                result.pendingWithdrawals
        });

    }

    catch (e) {

        console.error(
            "WITHDRAWAL REQUEST ERROR:",
            e
        );


        return res.status(400).json({

            success: false,

            message:
                e.message
        });
    }

});


/*
====================================================
GET AGENT WITHDRAWAL HISTORY
====================================================
*/

router.get(
    "/agent/:agentId",
    async (req, res) => {

        try {

            const history =
                await withdrawalManager
                    .getAgentWithdrawals(
                        req.params.agentId
                    );


            return res.json({

                success: true,

                withdrawals:
                    history
            });

        }

        catch (e) {

            console.error(
                "GET AGENT WITHDRAWALS ERROR:",
                e
            );


            return res.status(400).json({

                success: false,

                message:
                    e.message
            });
        }

    }
);


/*
====================================================
GET ALL WITHDRAWALS
====================================================
*/

router.get("/", async (req, res) => {

    try {

        const snapshot =
            await db
                .ref("withdrawalRequests")
                .get();


        const list = [];


        snapshot.forEach(child => {

            list.push({

                id:
                    child.key,

                ...child.val()
            });

        });


        list.sort(
            (a, b) =>
                Number(b.requestedAt || 0) -
                Number(a.requestedAt || 0)
        );


        return res.json({

            success: true,

            data:
                list
        });

    }

    catch (e) {

        console.error(
            "GET ALL WITHDRAWALS ERROR:",
            e
        );


        return res.status(500).json({

            success: false,

            message:
                e.message
        });
    }

});


/*
====================================================
GET WITHDRAWAL DETAILS
====================================================
*/

router.get(
    "/details/:withdrawalId",
    async (req, res) => {

        try {

            const data =
                await withdrawalManager
                    .getWithdrawalDetails(
                        req.params.withdrawalId
                    );


            return res.json({

                success: true,

                data
            });

        }

        catch (e) {

            console.error(
                "GET WITHDRAWAL DETAILS ERROR:",
                e
            );


            return res.status(400).json({

                success: false,

                message:
                    e.message
            });
        }

    }
);


/*
====================================================
APPROVE WITHDRAWAL
====================================================
*/

router.post("/approve", async (req, res) => {

    try {

        const result =
            await withdrawalManager
                .approveWithdrawal(

                    req.body.withdrawalId,

                    req.body.adminId
                );


        return res.json(result);

    }

    catch (e) {

        console.error(
            "APPROVE WITHDRAWAL ERROR:",
            e
        );


        return res.status(400).json({

            success: false,

            message:
                e.message
        });
    }

});


/*
====================================================
REJECT WITHDRAWAL
====================================================
*/

router.post("/reject", async (req, res) => {

    try {

        const result =
            await withdrawalManager
                .rejectWithdrawal(

                    req.body.withdrawalId,

                    req.body.reason || ""
                );


        return res.json(result);

    }

    catch (e) {

        console.error(
            "REJECT WITHDRAWAL ERROR:",
            e
        );


        return res.status(400).json({

            success: false,

            message:
                e.message
        });
    }

});


/*
====================================================
PAYPAL PAYOUT STATUS
====================================================

GET:

/withdrawals/paypal/status/:paypalBatchId

Example:

/withdrawals/paypal/status/P2HHXKM59C2QN


This endpoint:

1. Queries PayPal.
2. Reads the batch status.
3. Reads individual payout item status.
4. Saves the latest PayPal information to Firebase.
5. If PayPal confirms COMPLETED:
       → marks withdrawal as PAID.
6. If PayPal reports a failure:
       → marks withdrawal as PAYMENT_FAILED.
7. Otherwise:
       → keeps withdrawal PROCESSING.

IMPORTANT:

PayPal API acceptance is NOT treated as payment completion.
====================================================
*/

router.get(
    "/paypal/status/:paypalBatchId",
    async (req, res) => {

        try {

            const paypalBatchId =
                req.params.paypalBatchId;


            if (!paypalBatchId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "PayPal batch ID is required."
                });
            }


            console.log(
                "Checking PayPal payout status:",
                paypalBatchId
            );


            /*
            ==========================================
            QUERY PAYPAL
            ==========================================
            */

            const paypalStatus =
                await PayPalPayoutManager
                    .getPayoutStatus(
                        paypalBatchId
                    );


            console.log(
                "PAYPAL STATUS RESULT:",
                JSON.stringify(
                    paypalStatus,
                    null,
                    2
                )
            );


            /*
            ==========================================
            FIND LOCAL WITHDRAWAL
            ==========================================
            */

            const withdrawalSnapshot =
    await db
        .ref("withdrawalRequests")
        .get();

let withdrawalId = null;
let withdrawal = null;

withdrawalSnapshot.forEach(child => {

    const data = child.val();

    if (
        data &&
        String(data.paypalBatchId || "") ===
        String(paypalBatchId)
    ) {

        withdrawalId = child.key;
        withdrawal = data;
    }

});

            /*
            ==========================================
            EXTRACT PAYPAL STATUS
            ==========================================
            */

            const batchStatus =
                String(
                    paypalStatus.batchStatus || ""
                ).toUpperCase();


            const items =
                Array.isArray(
                    paypalStatus.items
                )
                    ? paypalStatus.items
                    : [];


            const firstItem =
                items.length > 0
                    ? items[0]
                    : null;


            const transactionStatus =
                firstItem
                    ? String(
                        firstItem.transactionStatus || ""
                    ).toUpperCase()
                    : "";


            const transactionId =
                firstItem
                    ? (
                        firstItem.transactionId || ""
                    )
                    : "";


            const paypalItemId =
                firstItem
                    ? (
                        firstItem.paypalItemId || ""
                    )
                    : "";


            /*
            ==========================================
            SAVE CURRENT PAYPAL STATUS
            ==========================================
            */

            if (withdrawalId) {

                await db
                    .ref("withdrawalRequests")
                    .child(withdrawalId)
                    .update({

                        paypalBatchId:
                            paypalStatus.paypalBatchId ||
                            paypalBatchId,

                        paypalItemId:
                            paypalItemId,

                        paypalTransactionId:
                            transactionId,

                        paypalBatchStatus:
                            batchStatus,

                        paypalTransactionStatus:
                            transactionStatus,

                        paymentReference:
                            transactionId ||
                            paypalBatchId,

                        updatedAt:
                            Date.now()
                    });


                /*
                ======================================
                PAYPAL COMPLETED
                ======================================
                */

                if (
                    batchStatus === "COMPLETED" ||
                    transactionStatus === "SUCCESS" ||
                    transactionStatus === "COMPLETED"
                ) {

                    console.log(
                        "PayPal payout COMPLETED:",
                        withdrawalId
                    );


                    /*
                    Only mark paid if the local withdrawal
                    has not already been completed.
                    */

                    const currentSnapshot =
                        await db
                            .ref("withdrawalRequests")
                            .child(withdrawalId)
                            .get();


                    if (currentSnapshot.exists()) {

                        const current =
                            currentSnapshot.val();


                        if (
                            current.status !== "paid"
                        ) {

                            await withdrawalManager
                                .markAsPaid(

                                    withdrawalId,

                                    transactionId,

                                    transactionId ||
                                    paypalBatchId
                                );
                        }

                    }

                }


                /*
                ======================================
                PAYPAL FAILURE
                ======================================
                */

                else if (
                    batchStatus === "FAILED" ||
                    batchStatus === "DENIED" ||
                    batchStatus === "CANCELED" ||
                    batchStatus === "CANCELLED" ||
                    transactionStatus === "FAILED" ||
                    transactionStatus === "BLOCKED" ||
                    transactionStatus === "RETURNED" ||
                    transactionStatus === "REFUNDED"
                ) {

                    console.log(
                        "PayPal payout FAILED:",
                        withdrawalId
                    );


                    await withdrawalManager
                        .markPaymentFailed(

                            withdrawalId,

                            `PayPal payout status: ${
                                transactionStatus ||
                                batchStatus
                            }`
                        );
                }


                /*
                ======================================
                STILL PROCESSING
                ======================================
                */

                else {

                    console.log(
                        "PayPal payout still processing:",
                        withdrawalId
                    );


                    await db
                        .ref("withdrawalRequests")
                        .child(withdrawalId)
                        .update({

                            status:
                                "processing",

                            paymentStatus:
                                "PROCESSING",

                            updatedAt:
                                Date.now()
                        });
                }

            }


            /*
            ==========================================
            RETURN RESULT
            ==========================================
            */

            return res.json({

                success: true,

                message:
                    "PayPal payout status retrieved.",

                withdrawalId,

                synchronized:
                    Boolean(withdrawalId),

                data: {

                    paypalBatchId:
                        paypalStatus.paypalBatchId ||
                        paypalBatchId,

                    batchStatus,

                    paypalItemId,

                    transactionStatus,

                    transactionId,

                    items
                }
            });

        }

        catch (e) {

            console.error(
                "PAYPAL STATUS ERROR:",
                e.response?.data ||
                e.message ||
                e
            );


            return res.status(500).json({

                success: false,

                message:
                    "Failed to retrieve PayPal payout status.",

                error:
                    e.response?.data ||
                    e.message
            });
        }

    }
);


/*
====================================================
PAY WITHDRAWAL
====================================================

M-PESA:
    → MpesaB2CManager

PAYPAL:
    → PayPalPayoutManager

IMPORTANT:

Submitting a payout to PayPal does NOT mean
the recipient has received the money.

PayPal remains PROCESSING until its status
is confirmed.
====================================================
*/

router.post(
    "/:withdrawalId/pay",
    async (req, res) => {

        try {

            const withdrawalId =
                req.params.withdrawalId;


            /*
            ==========================================
            LOAD WITHDRAWAL
            ==========================================
            */

            const snapshot =
                await db
                    .ref("withdrawalRequests")
                    .child(withdrawalId)
                    .get();


            if (!snapshot.exists()) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Withdrawal request not found."
                });
            }


            const withdrawal =
                snapshot.val();


            /*
            ==========================================
            VALIDATE STATUS
            ==========================================
            */

            if (
                withdrawal.status !== "approved" &&
                withdrawal.status !== "payment_failed"
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Withdrawal must be approved before payment."
                });
            }


            /*
            ==========================================
            PAYPAL
            ==========================================
            */

            if (
                String(
                    withdrawal.paymentMethod || ""
                ).toUpperCase() === "PAYPAL"
            ) {

                console.log(
                    "Starting PayPal payout:",
                    withdrawalId
                );


                const payment =
                    await PayPalPayoutManager
                        .sendMoney(
                            withdrawal
                        );


                /*
                ======================================
                PAYPAL REQUEST FAILED
                ======================================
                */

                if (!payment.success) {

                    await withdrawalManager
                        .markPaymentFailed(

                            withdrawalId,

                            payment.message ||
                            "PayPal payout failed."
                        );


                    return res.status(400).json({

                        success: false,

                        message:
                            payment.message ||
                            "PayPal payout failed.",

                        payment
                    });
                }


                /*
                ======================================
                PAYPAL REQUEST ACCEPTED

                DO NOT MARK PAID.

                PayPal has only accepted the payout
                request.
                ======================================
                */

                await withdrawalManager
                    .markPayPalProcessing(

                        withdrawalId,

                        payment.paypalBatchId ||
                        "",

                        payment.paypalItemId ||
                        ""
                    );


                /*
                ======================================
                SAVE PAYPAL IDs
                ======================================
                */

                await db
                    .ref("withdrawalRequests")
                    .child(withdrawalId)
                    .update({

                        paypalBatchId:
                            payment.paypalBatchId ||
                            "",

                        paypalItemId:
                            payment.paypalItemId ||
                            "",

                        paymentReference:
                            payment.paypalBatchId ||
                            "",

                        paymentStatus:
                            "PROCESSING",

                        updatedAt:
                            Date.now()
                    });


                console.log(
                    "PayPal payout marked as PROCESSING:",
                    withdrawalId
                );


                return res.json({

                    success: true,

                    message:
                        "PayPal payout submitted and is processing.",

                    payment: {

                        provider:
                            "PAYPAL",

                        status:
                            "PROCESSING",

                        paypalBatchId:
                            payment.paypalBatchId ||
                            "",

                        paypalItemId:
                            payment.paypalItemId ||
                            ""
                    }
                });
            }


            /*
            ==========================================
            M-PESA
            ==========================================
            */

            const MpesaB2CManager =
                require(
                    "../payments/MpesaB2CManager"
                );


            console.log(
                "Starting M-Pesa payout:",
                withdrawalId
            );


            const payment =
                await MpesaB2CManager
                    .sendMoney(
                        withdrawal
                    );


            /*
            ==========================================
            M-PESA FAILED
            ==========================================
            */

            if (!payment.success) {

                await withdrawalManager
                    .markPaymentFailed(

                        withdrawalId,

                        payment.message ||
                        "M-Pesa payment failed."
                    );


                return res.status(400).json({

                    success: false,

                    message:
                        payment.message ||
                        "M-Pesa payment failed.",

                    payment
                });
            }


            /*
            ==========================================
            M-PESA PROCESSING
            ==========================================
            */

            await withdrawalManager
                .markProcessing(

                    withdrawalId,

                    payment.conversationId ||
                    "",

                    payment.originatorConversationId ||
                    ""
                );


            console.log(
                "M-Pesa withdrawal marked as PROCESSING:",
                withdrawalId
            );


            return res.json({

                success: true,

                message:
                    "M-Pesa payment submitted and is processing.",

                payment: {

                    provider:
                        "MPESA",

                    status:
                        "PROCESSING",

                    conversationId:
                        payment.conversationId ||
                        "",

                    originatorConversationId:
                        payment.originatorConversationId ||
                        ""
                }
            });

        }

        catch (e) {

            console.error(
                "WITHDRAWAL PAYMENT ERROR:",
                e
            );


            return res.status(500).json({

                success: false,

                message:
                    e.message
            });
        }

    }
);


/*
====================================================
MARK WITHDRAWAL AS PAID
====================================================

Manual/admin endpoint.

Automatic providers should only call
markAsPaid() after confirmed provider success.
====================================================
*/

router.post(
    "/paid",
    async (req, res) => {

        try {

            const result =
                await withdrawalManager
                    .markAsPaid(

                        req.body.withdrawalId,

                        req.body.mpesaReceipt ||
                        "",

                        req.body.providerReference ||
                        ""
                    );


            return res.json(result);

        }

        catch (e) {

            console.error(
                "MARK WITHDRAWAL PAID ERROR:",
                e
            );


            return res.status(400).json({

                success: false,

                message:
                    e.message
            });
        }

    }
);

router.patch("/:withdrawalId/paypal-receiver", async (req, res) => {
    try {
        const { withdrawalId } = req.params;
        const { paypalEmail } = req.body;

        if (!paypalEmail) {
            return res.status(400).json({
                success: false,
                error: "paypalEmail is required"
            });
        }

        const withdrawalRef = db.ref(`withdrawalRequests/${withdrawalId}`);
        const snapshot = await withdrawalRef.once("value");

        if (!snapshot.exists()) {
            return res.status(404).json({
                success: false,
                error: "Withdrawal not found"
            });
        }

        const withdrawal = snapshot.val();

        if (withdrawal.status !== "payment_failed") {
            return res.status(400).json({
                success: false,
                error: `Withdrawal must be payment_failed. Current status: ${withdrawal.status}`
            });
        }

        await withdrawalRef.update({
            paypalEmail: paypalEmail.trim(),
            updatedAt: Date.now()
        });

        console.log(
            `[PAYPAL RECEIVER UPDATED] ${withdrawalId} -> ${paypalEmail.trim()}`
        );

        return res.json({
            success: true,
            withdrawalId,
            paypalEmail: paypalEmail.trim()
        });

    } catch (error) {
        console.error("Error updating PayPal receiver:", error);

        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


module.exports = router;