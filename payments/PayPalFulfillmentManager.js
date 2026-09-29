const { db } = require("../firebase");

const PayPalManager =
    require("./PayPalManager");

const PlanManager =
    require("../plans/PlanManager");

const SubscriptionManager =
    require("../subscriptions/SubscriptionManager");

const CommissionManager =
    require("../commissions/CommissionManager");

const CacheManager =
    require("../cache/CacheManager");

const LedgerManager =
    require("../finance/LedgerManager");

const LedgerTypes =
    require("../finance/LedgerTypes");

const LedgerDirection =
    require("../finance/LedgerDirection");

const LedgerCategory =
    require("../finance/LedgerCategory");


class PayPalFulfillmentManager {

    /**
     * ==========================================================
     * FULFILL PAYPAL ORDER
     * ==========================================================
     *
     * This is the single authoritative PayPal fulfillment path.
     *
     * It:
     *
     * 1. Loads our local transaction
     * 2. Gets/captures the PayPal order
     * 3. Validates amount
     * 4. Validates currency
     * 5. Validates PayPal metadata
     * 6. Activates subscription
     * 7. Activates family entitlement
     * 8. Updates billing
     * 9. Writes payment history
     * 10. Writes ledger
     * 11. Records agent commission
     * 12. Marks transaction SUCCESS
     *
     * ==========================================================
     */
    async fulfillOrder(orderId) {

        if (!orderId) {

            throw new Error(
                "PayPal order ID is required."
            );

        }


        /*
        ==========================================================
        LOCAL TRANSACTION
        ==========================================================
        */

        const transactionRef =
            db
                .ref("paypal_transactions")
                .child(orderId);


        const transactionSnap =
            await transactionRef.get();


        if (!transactionSnap.exists()) {

            throw new Error(
                "PayPal transaction not found."
            );

        }


        let transaction =
            transactionSnap.val();


        /*
        ==========================================================
        ALREADY SUCCESSFUL
        ==========================================================
        */

        if (
            transaction.status ===
            "SUCCESS"
        ) {

            return {

                success:
                    true,

                alreadyProcessed:
                    true,

                status:
                    "SUCCESS",

                orderId,

                captureId:
                    transaction.captureId ||
                    null,

                planId:
                    transaction.planId,

                premium:
                    true

            };

        }


        /*
        ==========================================================
        VALIDATE TRANSACTION DATA
        ==========================================================
        */

        if (!transaction.uid) {

            throw new Error(
                "PayPal transaction is missing uid."
            );

        }

        if (!transaction.childId) {

            throw new Error(
                "PayPal transaction is missing childId."
            );

        }

        if (!transaction.planId) {

            throw new Error(
                "PayPal transaction is missing planId."
            );

        }


        /*
        ==========================================================
        LOAD PLAN
        ==========================================================
        */

        const plan =
            await PlanManager.getPlan(
                transaction.planId
            );


        if (!plan) {

            throw new Error(
                "Subscription plan not found."
            );

        }


        if (plan.active !== true) {

            throw new Error(
                "Subscription plan is inactive."
            );

        }


        /*
        ==========================================================
        LOAD CHILD
        ==========================================================
        */

        const childRef =
            db
                .ref("children")
                .child(
                    transaction.childId
                );


        const childSnap =
            await childRef.get();


        if (!childSnap.exists()) {

            throw new Error(
                "Child not found."
            );

        }


        const child =
            childSnap.val();


        /*
        ==========================================================
        VERIFY CHILD OWNERSHIP
        ==========================================================
        */

        if (
            child.parentId &&
            child.parentId !== transaction.uid
        ) {

            throw new Error(
                "Child does not belong to this PayPal transaction owner."
            );

        }


        /*
        ==========================================================
        GET/CAPTURE PAYPAL ORDER
        ==========================================================
        */

        let paypalOrder = null;

        let capture = null;


        /*
        ----------------------------------------------------------
        FIRST CHECK CURRENT PAYPAL ORDER
        ----------------------------------------------------------
        */

        try {

            paypalOrder =
                await PayPalManager.getOrder(
                    orderId
                );

        }

        catch (error) {

            console.error(
                "Unable to retrieve PayPal order before capture:",
                error.message
            );

        }


        /*
        ----------------------------------------------------------
        IF ALREADY COMPLETED
        ----------------------------------------------------------
        */

        if (
            paypalOrder?.status ===
            "COMPLETED"
        ) {

            capture =
                paypalOrder
                    .purchase_units?.[0]
                    ?.payments
                    ?.captures?.[0];

        }


        /*
        ----------------------------------------------------------
        OTHERWISE CAPTURE
        ----------------------------------------------------------
        */

        if (!capture) {

            try {

                const captureResponse =
                    await PayPalManager
                        .captureOrder(
                            orderId
                        );


                if (
                    captureResponse.status !==
                    "COMPLETED"
                ) {

                    await transactionRef.update({

                        status:
                            "FAILED",

                        failureReason:
                            "PAYPAL_NOT_COMPLETED",

                        paypalStatus:
                            captureResponse.status,

                        updatedAt:
                            Date.now()

                    });


                    throw new Error(
                        "PayPal payment was not completed."
                    );

                }


                paypalOrder =
                    captureResponse;


                capture =
                    captureResponse
                        .purchase_units?.[0]
                        ?.payments
                        ?.captures?.[0];

            }

            catch (error) {

                /*
                --------------------------------------------------
                ORDER MAY HAVE BEEN CAPTURED ALREADY
                --------------------------------------------------
                */

                console.error(
                    "PayPal capture attempt:",
                    error.message
                );


                /*
                --------------------------------------------------
                RETRIEVE ORDER AGAIN
                --------------------------------------------------
                */

                try {

                    paypalOrder =
                        await PayPalManager.getOrder(
                            orderId
                        );

                    if (
                        paypalOrder?.status ===
                        "COMPLETED"
                    ) {

                        capture =
                            paypalOrder
                                .purchase_units?.[0]
                                ?.payments
                                ?.captures?.[0];

                    }

                }

                catch (lookupError) {

                    console.error(
                        "PayPal order lookup after capture failure:",
                        lookupError.message
                    );

                }


                if (!capture) {

                    throw error;

                }

            }

        }


        /*
        ==========================================================
        CAPTURE MUST EXIST
        ==========================================================
        */

        if (!capture) {

            throw new Error(
                "PayPal capture details were not returned."
            );

        }


        /*
        ==========================================================
        CAPTURE STATUS
        ==========================================================
        */

        if (
            capture.status &&
            capture.status !==
            "COMPLETED"
        ) {

            throw new Error(
                `PayPal capture status is ${capture.status}.`
            );

        }


        /*
        ==========================================================
        EXTRACT PAYMENT DETAILS
        ==========================================================
        */

        const receivedAmount =
            Number(
                capture
                    ?.amount
                    ?.value || 0
            );


        const receivedCurrency =
            capture
                ?.amount
                ?.currency_code ||
                "";


        const expectedAmount =
            Number(
                transaction.amount
            );


        const expectedCurrency =
            transaction.currency;


        /*
        ==========================================================
        AMOUNT VALIDATION
        ==========================================================
        */

        if (
            !Number.isFinite(
                receivedAmount
            ) ||
            receivedAmount !==
            expectedAmount
        ) {

            await transactionRef.update({

                status:
                    "FAILED",

                failureReason:
                    "AMOUNT_MISMATCH",

                expectedAmount,

                receivedAmount,

                updatedAt:
                    Date.now()

            });


            throw new Error(
                "PayPal amount mismatch."
            );

        }


        /*
        ==========================================================
        CURRENCY VALIDATION
        ==========================================================
        */

        if (
            receivedCurrency !==
            expectedCurrency
        ) {

            await transactionRef.update({

                status:
                    "FAILED",

                failureReason:
                    "CURRENCY_MISMATCH",

                expectedCurrency,

                receivedCurrency,

                updatedAt:
                    Date.now()

            });


            throw new Error(
                "PayPal currency mismatch."
            );

        }


        /*
        ==========================================================
        VALIDATE PAYPAL CUSTOM ID
        ==========================================================
        */

        const expectedCustomId =
            `${transaction.uid}|${transaction.childId}|${transaction.planId}`;


        const paypalCustomId =
            paypalOrder
                ?.purchase_units?.[0]
                ?.custom_id ||
            null;


        if (
            paypalCustomId &&
            paypalCustomId !==
            expectedCustomId
        ) {

            await transactionRef.update({

                status:
                    "FAILED",

                failureReason:
                    "CUSTOM_ID_MISMATCH",

                expectedCustomId,

                paypalCustomId,

                updatedAt:
                    Date.now()

            });


            throw new Error(
                "PayPal order metadata mismatch."
            );

        }


        const now =
            Date.now();


        /*
        ==========================================================
        MARK CAPTURED
        ==========================================================
        */

        await transactionRef.update({

            status:
                "CAPTURED",

            paypalStatus:
                paypalOrder?.status ||
                "COMPLETED",

            captureId:
                capture.id,

            receivedAmount,

            receivedCurrency,

            capturedAt:
                transaction.capturedAt ||
                now,

            updatedAt:
                now

        });


        /*
        ==========================================================
        REFRESH LOCAL TRANSACTION
        ==========================================================
        */

        const refreshedSnap =
            await transactionRef.get();


        transaction =
            refreshedSnap.val();


        /*
        ==========================================================
        SUBSCRIPTION
        ==========================================================
        */

        if (
            transaction.subscriptionActivated !==
            true
        ) {

            await SubscriptionManager.activate(

                transaction.childId,

                transaction.planId

            );


            await transactionRef.update({

                subscriptionActivated:
                    true,

                subscriptionActivatedAt:
                    Date.now(),

                updatedAt:
                    Date.now()

            });

        }


        /*
        ==========================================================
        FAMILY PLAN
        ==========================================================
        */

        if (
            transaction.planId ===
                "family" &&
            child.parentId &&
            transaction.familyActivated !==
                true
        ) {

            await SubscriptionManager
                .activateFamily(

                    child.parentId,

                    transaction.childId,

                    transaction.planId

                );


            await transactionRef.update({

                familyActivated:
                    true,

                familyActivatedAt:
                    Date.now(),

                updatedAt:
                    Date.now()

            });

        }


        /*
        ==========================================================
        BILLING
        ==========================================================
        */

        await childRef
            .child("billing")
            .update({

                lastPaymentStatus:
                    "SUCCESS",

                lastPaymentMethod:
                    "PAYPAL",

                lastPaidAt:
                    now,

                lastPlanId:
                    transaction.planId,

                lastPaypalOrderId:
                    orderId,

                lastPaypalCaptureId:
                    capture.id,

                lastAmountUsd:
                    receivedAmount,

                lastCurrency:
                    receivedCurrency

            });


        /*
        ==========================================================
        PAYMENT HISTORY
        ==========================================================
        */

        await childRef
            .child("payments")
            .child(orderId)
            .set({

                provider:
                    "PAYPAL",

                orderId,

                captureId:
                    capture.id,

                amount:
                    receivedAmount,

                currency:
                    receivedCurrency,

                planId:
                    transaction.planId,

                planName:
                    plan.name,

                status:
                    "SUCCESS",

                paymentMethod:
                    "PAYPAL",

                paidAt:
                    now

            });


        /*
        ==========================================================
        LEDGER
        ==========================================================
        */

        if (
            transaction.ledgerRecorded !==
            true
        ) {

            await LedgerManager.record({

                type:
                    LedgerTypes
                        .SUBSCRIPTION_PAYMENT,

                direction:
                    LedgerDirection.CREDIT,

                category:
                    LedgerCategory.SUBSCRIPTION,

                /*
                ----------------------------------------------
                IMPORTANT:
                ParentIQ accounting ledger is KES.
                ----------------------------------------------
                */

                amount:
                    Number(plan.price),

                parentId:
                    child.parentId ||
                    transaction.uid ||
                    "",

                childId:
                    transaction.childId,

                checkoutId:
                    orderId,

                description:
                    `${plan.name} subscription payment`,

                metadata: {

                    planId:
                        transaction.planId,

                    planName:
                        plan.name,

                    accountingAmountKes:
                        Number(plan.price),

                    paypalAmountUsd:
                        receivedAmount,

                    paypalCurrency:
                        receivedCurrency,

                    paymentMethod:
                        "PAYPAL",

                    paypalOrderId:
                        orderId,

                    paypalCaptureId:
                        capture.id

                }

            });


            await transactionRef.update({

                ledgerRecorded:
                    true,

                ledgerRecordedAt:
                    Date.now(),

                updatedAt:
                    Date.now()

            });

        }


        /*
        ==========================================================
        FIND AGENT
        ==========================================================
        */

        let agentId =
            null;


        if (child.parentId) {

            const parentSnap =
                await db
                    .ref("parents")
                    .child(
                        child.parentId
                    )
                    .get();


            if (
                parentSnap.exists()
            ) {

                agentId =
                    parentSnap
                        .val()
                        ?.referral
                        ?.agentId ||
                    null;

            }

        }


        /*
        ==========================================================
        AGENT COMMISSION
        ==========================================================
        */

        if (
            agentId &&
            transaction.commissionRecorded !==
                true
        ) {

            await CommissionManager
                .recordCommission({

                    agentId,

                    childId:
                        transaction.childId,

                    planId:
                        transaction.planId,

                    checkoutId:
                        orderId

                });


            try {

                await CacheManager
                    .refreshAgent(
                        agentId
                    );

            }

            catch (cacheError) {

                console.error(
                    "Agent cache refresh failed:",
                    cacheError.message
                );

            }


            await transactionRef.update({

                commissionRecorded:
                    true,

                commissionRecordedAt:
                    Date.now(),

                updatedAt:
                    Date.now()

            });

        }


        /*
        ==========================================================
        MARK SUCCESS
        ==========================================================
        */

        await transactionRef.update({

            status:
                "SUCCESS",

            paypalStatus:
                paypalOrder?.status ||
                "COMPLETED",

            captureId:
                capture.id,

            receivedAmount,

            receivedCurrency,

            capturedAt:
                transaction.capturedAt ||
                now,

            completedAt:
                Date.now(),

            updatedAt:
                Date.now()

        });


        /*
        ==========================================================
        FINAL RESPONSE
        ==========================================================
        */

        return {

            success:
                true,

            alreadyProcessed:
                false,

            status:
                "SUCCESS",

            orderId,

            captureId:
                capture.id,

            planId:
                transaction.planId,

            premium:
                true

        };

    }

}


module.exports =
    new PayPalFulfillmentManager();