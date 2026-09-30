const express = require("express");

const router = express.Router();

const withdrawalManager =
    require("../withdrawals/WithdrawalManager");

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
                PayPal payout amount.

                For Sandbox testing we can send
                a small USD amount.

                Production should calculate this
                using the configured FX rate.
                */

                payoutAmount:
                    req.body.payoutAmount || 0,

                payoutCurrency:
                    req.body.payoutCurrency || "USD"
            });


        res.status(200).json({

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

        res.status(400).json({

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


            res.json({

                success: true,

                withdrawals:
                    history
            });

        }

        catch (e) {

            res.status(400).json({

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


        res.json({

            success: true,

            data:
                list
        });

    }

    catch (e) {

        res.status(500).json({

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


            res.json({

                success: true,

                data
            });

        }

        catch (e) {

            res.status(400).json({

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


        res.json(result);

    }

    catch (e) {

        res.status(400).json({

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


        res.json(result);

    }

    catch (e) {

        res.status(400).json({

            success: false,

            message:
                e.message
        });
    }

});


/*
====================================================
PAY WITHDRAWAL
====================================================

M-PESA:
    → MpesaB2CManager

PAYPAL:
    → PayPalPayoutManager

IMPORTANT:

A successful PayPal API request means the
payout was accepted/created.

It does NOT automatically mean the recipient
has received the money.

Therefore PayPal remains PROCESSING until
PayPal confirms completion.
====================================================
*/

router.post(
    "/:withdrawalId/pay",
    async (req, res) => {

        try {

            const withdrawalId =
                req.params.withdrawalId;


            /*
            ============================================
            LOAD WITHDRAWAL
            ============================================
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
            ============================================
            VALIDATE STATUS
            ============================================
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
            ============================================
            PAYPAL
            ============================================
            */

            if (
                withdrawal.paymentMethod === "PAYPAL"
            ) {

                const PayPalPayoutManager =
                    require(
                        "../payments/PayPalPayoutManager"
                    );


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
                ========================================
                PAYPAL REQUEST FAILED
                ========================================
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
                ========================================
                PAYPAL REQUEST ACCEPTED
                ========================================

                Do NOT mark as PAID yet.

                PayPal has accepted the payout request
                and returned a payout batch.

                We mark it PROCESSING.
                ========================================
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
                ========================================
                SAVE PAYPAL IDs
                ========================================
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
            ============================================
            M-PESA
            ============================================
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
            ============================================
            M-PESA FAILED
            ============================================
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
            ============================================
            M-PESA PROCESSING
            ============================================
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


            res.status(500).json({

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

This remains available for admin/manual
completion.

For automatic payment providers, their confirmed
successful callback/status should eventually call
WithdrawalManager.markAsPaid().
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


            res.json(result);

        }

        catch (e) {

            res.status(400).json({

                success: false,

                message:
                    e.message
            });
        }
    }
);


module.exports = router;