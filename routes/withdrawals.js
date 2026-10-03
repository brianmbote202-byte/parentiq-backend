const express = require("express");

const router = express.Router();

const withdrawalManager =
    require("../withdrawals/WithdrawalManager");

const PayPalPayoutManager =
    require("../payments/PayPalPayoutManager");

const MpesaB2CManager =
    require("../payments/MpesaB2CManager");

const { db } =
    require("../firebase");


/*
====================================================
HELPERS
====================================================
*/

function normalizeStatus(value) {
    return String(value || "")
        .trim()
        .toUpperCase();
}


function normalizePaymentMethod(value) {
    return normalizeStatus(value);
}


/*
====================================================
PAYPAL SUCCESS
====================================================

A PayPal batch SUCCESS does NOT prove that this
specific withdrawal was paid.

The specific payout item must report:

    transaction_status === SUCCESS
*/

function isPayPalSuccess(
    batchStatus,
    transactionStatus
) {
    return (
        normalizeStatus(transactionStatus) ===
        "SUCCESS"
    );
}


/*
====================================================
PAYPAL CONFIRMED FAILURE
====================================================

Only definitive provider failure states may cause
wallet restoration.

Ambiguous states are NOT failures.
*/

function isPayPalFailure(
    batchStatus,
    transactionStatus
) {
    const batch =
        normalizeStatus(batchStatus);

    const transaction =
        normalizeStatus(transactionStatus);

    return (
        batch === "FAILED" ||
        batch === "DENIED" ||
        batch === "CANCELED" ||
        batch === "CANCELLED" ||
        transaction === "FAILED" ||
        transaction === "DENIED" ||
        transaction === "CANCELED" ||
        transaction === "CANCELLED"
    );
}


/*
====================================================
PAYPAL RECONCILIATION STATES
====================================================
*/

function isPayPalReconciliationStatus(
    batchStatus,
    transactionStatus
) {
    const batch =
        normalizeStatus(batchStatus);

    const transaction =
        normalizeStatus(transactionStatus);

    return (
        batch === "BLOCKED" ||
        batch === "RETURNED" ||
        batch === "REFUNDED" ||
        batch === "REVERSED" ||

        transaction === "BLOCKED" ||
        transaction === "RETURNED" ||
        transaction === "REFUNDED" ||
        transaction === "REVERSED"
    );
}


/*
====================================================
PAYPAL PROCESSING STATES
====================================================
*/

function isPayPalProcessingStatus(
    batchStatus,
    transactionStatus
) {
    const batch =
        normalizeStatus(batchStatus);

    const transaction =
        normalizeStatus(transactionStatus);

    return (
        batch === "PROCESSING" ||
        batch === "PENDING" ||
        batch === "UNCLAIMED" ||
        batch === "ONHOLD" ||

        transaction === "PROCESSING" ||
        transaction === "PENDING" ||
        transaction === "UNCLAIMED" ||
        transaction === "ONHOLD"
    );
}


/*
====================================================
UNKNOWN PAYPAL OUTCOME
====================================================
*/

function isUnknownPayPalOutcome(payment) {

    if (!payment) {
        return true;
    }

    if (
        payment.reconciliationRequired === true ||
        payment.unknownOutcome === true ||
        payment.uncertain === true
    ) {
        return true;
    }

    const outcome =
        normalizeStatus(
            payment.outcome ||
            payment.status ||
            payment.paymentStatus
        );

    if (
        outcome === "UNKNOWN" ||
        outcome === "UNCERTAIN" ||
        outcome === "TIMEOUT" ||
        outcome === "RECONCILIATION_REQUIRED"
    ) {
        return true;
    }

    const code =
        normalizeStatus(
            payment.code ||
            payment.errorCode
        );

    if (
        code === "TIMEOUT" ||
        code === "ETIMEDOUT" ||
        code === "ECONNRESET" ||
        code === "ECONNABORTED" ||
        code === "ERR_NETWORK" ||
        code === "NETWORK_ERROR"
    ) {
        return true;
    }

    const message =
        String(
            payment.message ||
            payment.error ||
            ""
        ).toLowerCase();

    return (
        message.includes("timeout") ||
        message.includes("timed out") ||
        message.includes("network error") ||
        message.includes("connection reset") ||
        message.includes("connection aborted") ||
        message.includes("socket hang up") ||
        message.includes("econnreset") ||
        message.includes("etimedout")
    );
}


/*
====================================================
UNKNOWN PROVIDER ERROR
====================================================

IMPORTANT:

A thrown provider error is NOT automatically a
confirmed payment failure.

If we cannot prove the provider did not accept the
request, the withdrawal remains reserved.
*/

function isUnknownProviderError(error) {

    if (!error) {
        return true;
    }

    if (
        error.reconciliationRequired === true ||
        error.unknownOutcome === true ||
        error.uncertain === true
    ) {
        return true;
    }

    const code =
        String(
            error.code || ""
        ).toUpperCase();

    if (
        code === "ETIMEDOUT" ||
        code === "ECONNRESET" ||
        code === "ECONNABORTED" ||
        code === "ERR_NETWORK" ||
        code === "NETWORK_ERROR"
    ) {
        return true;
    }

    if (
        error.response &&
        typeof error.response.status === "number"
    ) {

        const status =
            error.response.status;

        /*
            These responses do not safely prove that
            the payout was not accepted.
        */

        if (
            status === 409 ||
            status === 429 ||
            status >= 500
        ) {
            return true;
        }
    }

    /*
        No HTTP response means we cannot safely know
        whether the provider received the request.
    */

    if (!error.response) {
        return true;
    }

    const message =
        String(
            error.message || ""
        ).toLowerCase();

    return (
        message.includes("timeout") ||
        message.includes("timed out") ||
        message.includes("socket hang up") ||
        message.includes("connection reset") ||
        message.includes("network error") ||
        message.includes("econnreset") ||
        message.includes("etimedout")
    );
}


/*
====================================================
UNKNOWN PAYMENT RESULT
====================================================

This is intentionally separate from
isUnknownProviderError().

Provider managers often return:

{
    success: false,
    message: "..."
}

That object is NOT an Error and must not automatically
be considered an unknown network outcome.
*/

function isUnknownPaymentResult(payment) {

    if (!payment) {
        return true;
    }

    if (
        payment.reconciliationRequired === true ||
        payment.unknownOutcome === true ||
        payment.uncertain === true
    ) {
        return true;
    }

    const status =
        normalizeStatus(
            payment.status ||
            payment.paymentStatus ||
            payment.outcome
        );

    if (
        status === "UNKNOWN" ||
        status === "UNCERTAIN" ||
        status === "TIMEOUT" ||
        status === "RECONCILIATION_REQUIRED"
    ) {
        return true;
    }

    const code =
        normalizeStatus(
            payment.code ||
            payment.errorCode
        );

    if (
        code === "TIMEOUT" ||
        code === "ETIMEDOUT" ||
        code === "ECONNRESET" ||
        code === "ECONNABORTED" ||
        code === "ERR_NETWORK" ||
        code === "NETWORK_ERROR"
    ) {
        return true;
    }

    const message =
        String(
            payment.message ||
            payment.error ||
            ""
        ).toLowerCase();

    return (
        message.includes("timeout") ||
        message.includes("timed out") ||
        message.includes("network error") ||
        message.includes("connection reset") ||
        message.includes("connection aborted") ||
        message.includes("socket hang up") ||
        message.includes("econnreset") ||
        message.includes("etimedout")
    );
}


/*
====================================================
SAFE ERROR MESSAGE
====================================================
*/

function getSafeErrorMessage(error) {

    if (!error) {
        return "Unknown payment error.";
    }

    if (error.safeMessage) {
        return String(
            error.safeMessage
        ).slice(0, 500);
    }

    if (
        error.response &&
        error.response.data
    ) {

        const data =
            error.response.data;

        if (typeof data === "string") {
            return data.slice(0, 500);
        }

        return String(
            data.message ||
            data.name ||
            data.error_description ||
            data.error ||
            error.message ||
            "Payment provider error."
        ).slice(0, 500);
    }

    return String(
        error.message ||
        "Payment provider error."
    ).slice(0, 500);
}


/*
====================================================
LOAD WITHDRAWAL
====================================================
*/

async function getWithdrawal(
    withdrawalId
) {

    const ref =
        db
            .ref("withdrawalRequests")
            .child(withdrawalId);

    const snapshot =
        await ref.get();

    if (!snapshot.exists()) {
        throw new Error(
            "Withdrawal request not found."
        );
    }

    return {
        ref,
        snapshot,
        withdrawal: snapshot.val()
    };
}


/*
====================================================
PREPARE PAYPAL RETRY IDENTITY
====================================================

This function is ONLY used after the withdrawal
has already been atomically claimed as PROCESSING
from a confirmed PAYMENT_FAILED state.

IMPORTANT:

It does NOT change the withdrawal back to NOT_SENT.

The withdrawal remains PROCESSING while the new
provider identity is prepared.
====================================================
*/

async function preparePayPalRetryIdentity(
    withdrawalId
) {

    const {
        ref,
        withdrawal
    } =
        await getWithdrawal(
            withdrawalId
        );

    if (
        normalizeStatus(
            withdrawal.status
        ) !== "PROCESSING"
    ) {

        throw new Error(
            `PayPal retry identity can only be prepared for a processing withdrawal. Current status: ${withdrawal.status}`
        );
    }

    if (
        normalizePaymentMethod(
            withdrawal.paymentMethod
        ) !== "PAYPAL"
    ) {

        throw new Error(
            "Withdrawal is not a PayPal withdrawal."
        );
    }

    if (
        typeof PayPalPayoutManager
            .createNewSenderBatchId !==
        "function"
    ) {

        throw new Error(
            "PayPalPayoutManager.createNewSenderBatchId() is not available."
        );
    }

    const newSenderBatchId =
        await PayPalPayoutManager
            .createNewSenderBatchId(
                withdrawal
            );

    if (!newSenderBatchId) {
        throw new Error(
            "PayPal failed to create a new sender batch identity."
        );
    }

    const currentAttemptNumber =
        Number(
            withdrawal.paypalAttemptNumber ||
            0
        );

    const newAttemptNumber =
        currentAttemptNumber + 1;

    const now =
        Date.now();

    await ref.update({

        paypalSenderBatchId:
            newSenderBatchId,

        paypalAttemptNumber:
            newAttemptNumber,

        paypalBatchId:
            "",

        paypalItemId:
            "",

        paypalTransactionId:
            "",

        paypalBatchStatus:
            "",

        paypalTransactionStatus:
            "",

        paymentReference:
            "",

        paymentStatus:
            "PROCESSING",

        paymentFailureReason:
            "",

        reconciliationRequired:
            false,

        reconciliationAt:
            null,

        retryPreparedAt:
            now,

        updatedAt:
            now
    });

    console.log(
        "[PAYPAL] RETRY IDENTITY PREPARED:",
        {
            withdrawalId,
            paypalSenderBatchId:
                newSenderBatchId,
            paypalAttemptNumber:
                newAttemptNumber
        }
    );

    return {
        senderBatchId:
            newSenderBatchId,

        attemptNumber:
            newAttemptNumber
    };
}


/*
====================================================
MARK PAYPAL RECONCILIATION REQUIRED
====================================================

CRITICAL:

This NEVER restores wallet funds.

Funds remain reserved until the provider outcome
is definitively established.
====================================================
*/

async function markPayPalReconciliationRequired(
    withdrawalId,
    reason = ""
) {

    const {
        ref,
        withdrawal
    } =
        await getWithdrawal(
            withdrawalId
        );

    const currentStatus =
        normalizeStatus(
            withdrawal.status
        );

    /*
        Never move PAID backwards.

        Synchronize bookkeeping only.
    */

    if (
        currentStatus === "PAID"
    ) {

        await ref.update({

            status:
                "paid",

            paymentStatus:
                "SUCCESS",

            paymentFailureReason:
                "",

            reconciliationRequired:
                false,

            reconciliationAt:
                null,

            updatedAt:
                Date.now()
        });

        return {
            success: true,
            alreadyPaid: true
        };
    }

    /*
        Never restore the wallet here.
    */

    const safeReason =
        String(
            reason ||
            "PayPal payout outcome is uncertain. Reconciliation required."
        ).slice(0, 500);

    const now =
        Date.now();

    await ref.update({

        status:
            "reconciliation_required",

        paymentStatus:
            "RECONCILIATION_REQUIRED",

        paymentFailureReason:
            safeReason,

        reconciliationRequired:
            true,

        reconciliationAt:
            now,

        updatedAt:
            now
    });

    console.warn(
        "[PAYPAL] RECONCILIATION REQUIRED:",
        {
            withdrawalId,
            previousStatus:
                withdrawal.status,
            reason:
                safeReason
        }
    );

    return {
        success: true,
        reconciliationRequired: true
    };
}


/*
====================================================
REQUEST WITHDRAWAL
====================================================
*/

router.post(
    "/request",
    async (req, res) => {

        try {

            const result =
                await withdrawalManager
                    .requestWithdrawal({

                        agentId:
                            req.body.agentId,

                        amount:
                            req.body.amount,

                        phone:
                            req.body.phone,

                        paymentMethod:
                            req.body.paymentMethod ||
                            "MPESA",

                        paypalEmail:
                            req.body.paypalEmail ||
                            "",

                        payoutAmount:
                            req.body.payoutAmount ||
                            0,

                        payoutCurrency:
                            req.body.payoutCurrency ||
                            "USD"
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
                "[WITHDRAWAL REQUEST ERROR]",
                e.message
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
                "[GET AGENT WITHDRAWALS ERROR]",
                e.message
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

router.get(
    "/",
    async (req, res) => {

        try {

            const snapshot =
                await db
                    .ref("withdrawalRequests")
                    .get();

            const list = [];

            snapshot.forEach(
                child => {

                    list.push({

                        id:
                            child.key,

                        ...child.val()
                    });
                }
            );

            list.sort(
                (a, b) =>
                    Number(
                        b.requestedAt || 0
                    ) -
                    Number(
                        a.requestedAt || 0
                    )
            );

            return res.json({

                success: true,

                data:
                    list
            });

        }
        catch (e) {

            console.error(
                "[GET ALL WITHDRAWALS ERROR]",
                e.message
            );

            return res.status(500).json({

                success: false,

                message:
                    "Failed to retrieve withdrawals."
            });
        }
    }
);


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
                "[GET WITHDRAWAL DETAILS ERROR]",
                e.message
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

router.post(
    "/approve",
    async (req, res) => {

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
                "[APPROVE WITHDRAWAL ERROR]",
                e.message
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
REJECT WITHDRAWAL
====================================================
*/

router.post(
    "/reject",
    async (req, res) => {

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
                "[REJECT WITHDRAWAL ERROR]",
                e.message
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
PAYPAL PAYOUT STATUS
====================================================

GET:

/withdrawals/paypal/status/:paypalBatchId

Safety rules:

1. Find the local withdrawal first.
2. Obtain its expected payout item ID.
3. If an expected item ID exists, ONLY that item
   may be selected.
4. Never assume items[0] is the correct payout.
5. Item-level SUCCESS is required.
====================================================
*/

router.get(
    "/paypal/status/:paypalBatchId",
    async (req, res) => {

        const paypalBatchId =
            String(
                req.params.paypalBatchId || ""
            ).trim();

        if (!paypalBatchId) {

            return res.status(400).json({

                success: false,

                message:
                    "PayPal batch ID is required."
            });
        }

        try {

            /*
            ==========================================
            FIND LOCAL WITHDRAWAL
            ==========================================
            */

            const withdrawalSnapshot =
                await db
                    .ref("withdrawalRequests")
                    .get();

            let withdrawalId =
                null;

            let withdrawal =
                null;

            withdrawalSnapshot.forEach(
                child => {

                    const data =
                        child.val();

                    if (
                        data &&
                        String(
                            data.paypalBatchId || ""
                        ) === paypalBatchId
                    ) {

                        withdrawalId =
                            child.key;

                        withdrawal =
                            data;
                    }
                }
            );

            if (!withdrawalId) {

                return res.status(404).json({

                    success: false,

                    message:
                        "PayPal payout was found, but no matching local withdrawal was found.",

                    data: {
                        paypalBatchId
                    }
                });
            }


            /*
            ==========================================
            EXPECTED PAYPAL ITEM
            ==========================================
            */

            const expectedSenderItemId =
                String(
                    withdrawal.paypalItemId ||
                    ""
                ).trim();

            console.log(
                "[PAYPAL STATUS] Checking:",
                {
                    paypalBatchId,
                    withdrawalId,
                    expectedSenderItemId
                }
            );


            /*
            ==========================================
            QUERY PAYPAL
            ==========================================
            */

            const paypalStatus =
                await PayPalPayoutManager
                    .getPayoutStatus(
                        paypalBatchId,
                        expectedSenderItemId
                    );

            const batchStatus =
                normalizeStatus(
                    paypalStatus.batchStatus
                );

            const items =
                Array.isArray(
                    paypalStatus.items
                )
                    ? paypalStatus.items
                    : [];


            /*
            ==========================================
            SELECT CORRECT PAYPAL ITEM
            ==========================================
            */

            let payoutItem =
                null;

            if (
                expectedSenderItemId
            ) {

                payoutItem =
                    items.find(
                        item => {

                            const itemId =
                                String(
                                    item?.payout_item_id ||
                                    item?.paypalItemId ||
                                    item?.payoutItemId ||
                                    item?.payout_item?.payout_item_id ||
                                    ""
                                ).trim();

                            return (
                                itemId ===
                                expectedSenderItemId
                            );
                        }
                    ) || null;

            }
            else if (
                items.length === 1
            ) {

                payoutItem =
                    items[0];
            }


            /*
            ==========================================
            ITEM IDENTIFICATION SAFETY
            ==========================================
            */

            const itemIdentificationRequired =
                Boolean(
                    expectedSenderItemId &&
                    !payoutItem
                ) ||
                Boolean(
                    !expectedSenderItemId &&
                    items.length > 1 &&
                    !payoutItem
                );


            /*
            ==========================================
            EXTRACT ITEM DATA
            ==========================================
            */

            const payoutItemData =
                payoutItem?.payout_item ||
                payoutItem ||
                {};

            const transactionStatus =
                normalizeStatus(
                    payoutItem?.transaction_status ||
                    payoutItemData?.transaction_status ||
                    payoutItem?.transactionStatus ||
                    ""
                );

            const transactionId =
                payoutItem?.transaction_id ||
                payoutItemData?.transaction_id ||
                payoutItem?.transactionId ||
                "";

            const paypalItemId =
                payoutItem?.payout_item_id ||
                payoutItemData?.payout_item_id ||
                payoutItem?.paypalItemId ||
                payoutItem?.payoutItemId ||
                "";


            /*
            ==========================================
            EVALUATE PAYPAL RESULT
            ==========================================
            */

            const paypalSuccess =
                !itemIdentificationRequired &&
                isPayPalSuccess(
                    batchStatus,
                    transactionStatus
                );

            const paypalFailure =
                !itemIdentificationRequired &&
                isPayPalFailure(
                    batchStatus,
                    transactionStatus
                );

            const providerReconciliation =
                !itemIdentificationRequired &&
                isPayPalReconciliationStatus(
                    batchStatus,
                    transactionStatus
                );

            const reconciliationRequired =
                itemIdentificationRequired ||
                providerReconciliation ||
                normalizeStatus(
                    paypalStatus.status
                ) ===
                "RECONCILIATION_REQUIRED" ||
                paypalStatus.reconciliationRequired === true ||
                paypalStatus.unknownOutcome === true;


            console.log(
                "[PAYPAL STATUS RESULT]",
                {
                    paypalBatchId,
                    withdrawalId,
                    batchStatus,
                    transactionStatus,
                    transactionId,
                    paypalItemId,
                    itemIdentificationRequired,
                    providerReconciliation,
                    paypalSuccess,
                    paypalFailure,
                    reconciliationRequired
                }
            );


            /*
            ==========================================
            SYNCHRONIZE PROVIDER INFORMATION
            ==========================================
            */

            const withdrawalRef =
                db
                    .ref("withdrawalRequests")
                    .child(withdrawalId);

            await withdrawalRef.update({

                paypalBatchId:
                    paypalStatus.paypalBatchId ||
                    paypalBatchId,

                paypalItemId:
                    paypalItemId ||
                    withdrawal.paypalItemId ||
                    "",

                paypalTransactionId:
                    transactionId ||
                    withdrawal.paypalTransactionId ||
                    "",

                paypalBatchStatus:
                    batchStatus,

                paypalTransactionStatus:
                    transactionStatus,

                paymentReference:
                    transactionId ||
                    withdrawal.paymentReference ||
                    paypalBatchId,

                updatedAt:
                    Date.now()
            });


            /*
            ==========================================
            RELOAD LOCAL RECORD
            ==========================================
            */

            const currentSnapshot =
                await withdrawalRef.get();

            if (
                !currentSnapshot.exists()
            ) {

                throw new Error(
                    "Withdrawal disappeared during PayPal synchronization."
                );
            }

            const current =
                currentSnapshot.val();


            /*
            ==========================================
            RECONCILIATION
            ==========================================
            */

            if (
                reconciliationRequired
            ) {

                const reason =
                    itemIdentificationRequired
                        ? "PayPal payout item could not be safely matched to this withdrawal. Manual reconciliation required."
                        : (
                            paypalStatus.message ||
                            `PayPal payout state requires reconciliation: ${transactionStatus || batchStatus || "UNKNOWN"}`
                        );

                await markPayPalReconciliationRequired(
                    withdrawalId,
                    reason
                );

                return res.status(202).json({

                    success: false,

                    reconciliationRequired:
                        true,

                    message:
                        "PayPal payout outcome could not be safely confirmed. The withdrawal remains reserved for reconciliation.",

                    withdrawalId,

                    data: {

                        paypalBatchId,

                        batchStatus,

                        paypalItemId,

                        transactionStatus,

                        transactionId,

                        itemIdentificationRequired
                    }
                });
            }


            /*
            ==========================================
            CONFIRMED PAYPAL SUCCESS
            ==========================================
            */

            if (
                paypalSuccess
            ) {

                console.log(
                    "[PAYPAL] CONFIRMED ITEM SUCCESS:",
                    withdrawalId
                );


                /*
                    Already paid.

                    Synchronize only.
                    Never run accounting again.
                */

                if (
                    normalizeStatus(
                        current.status
                    ) === "PAID"
                ) {

                    await withdrawalRef.update({

                        status:
                            "paid",

                        paymentStatus:
                            "SUCCESS",

                        paymentFailureReason:
                            "",

                        reconciliationRequired:
                            false,

                        reconciliationAt:
                            null,

                        paypalBatchStatus:
                            batchStatus,

                        paypalTransactionStatus:
                            transactionStatus,

                        paypalTransactionId:
                            transactionId ||
                            current.paypalTransactionId ||
                            "",

                        paypalItemId:
                            paypalItemId ||
                            current.paypalItemId ||
                            "",

                        paypalBatchId:
                            paypalStatus.paypalBatchId ||
                            paypalBatchId,

                        paymentReference:
                            transactionId ||
                            current.paymentReference ||
                            paypalBatchId,

                        updatedAt:
                            Date.now()
                    });

                    return res.json({

                        success: true,

                        message:
                            "PayPal payout item confirmed successful. Existing paid withdrawal synchronized.",

                        withdrawalId,

                        synchronized:
                            true,

                        alreadyPaid:
                            true,

                        data: {

                            paypalBatchId:
                                paypalStatus.paypalBatchId ||
                                paypalBatchId,

                            batchStatus,

                            paypalItemId,

                            transactionStatus,

                            transactionId
                        }
                    });
                }


                /*
                    Local wallet was already restored.

                    PayPal SUCCESS now conflicts with
                    payment_failed.

                    Do NOT restore again.
                */

                if (
                    normalizeStatus(
                        current.status
                    ) ===
                    "PAYMENT_FAILED"
                ) {

                    await markPayPalReconciliationRequired(
                        withdrawalId,
                        "PayPal reports SUCCESS while the local withdrawal is payment_failed. Manual reconciliation required."
                    );

                    return res.status(409).json({

                        success: false,

                        reconciliationRequired:
                            true,

                        message:
                            "PayPal reports a successful payout but the local withdrawal was already marked failed. Manual reconciliation is required.",

                        withdrawalId
                    });
                }


                /*
                    Never automatically convert a
                    reconciliation_required withdrawal
                    into paid.
                */

                if (
                    normalizeStatus(
                        current.status
                    ) ===
                    "RECONCILIATION_REQUIRED"
                ) {

                    return res.status(409).json({

                        success: false,

                        reconciliationRequired:
                            true,

                        message:
                            "PayPal reports SUCCESS, but this withdrawal is already in reconciliation. Manual reconciliation is required before changing the final state.",

                        withdrawalId
                    });
                }


                /*
                    Normal:

                    processing â†’ paid
                */

                await withdrawalManager
                    .markAsPaid(
                        withdrawalId,
                        transactionId,
                        transactionId ||
                        paypalBatchId
                    );

                await withdrawalRef.update({

                    status:
                        "paid",

                    paymentStatus:
                        "SUCCESS",

                    paymentFailureReason:
                        "",

                    reconciliationRequired:
                        false,

                    reconciliationAt:
                        null,

                    paypalBatchStatus:
                        batchStatus,

                    paypalTransactionStatus:
                        transactionStatus,

                    paypalTransactionId:
                        transactionId,

                    paypalItemId:
                        paypalItemId,

                    paypalBatchId:
                        paypalStatus.paypalBatchId ||
                        paypalBatchId,

                    paymentReference:
                        transactionId ||
                        paypalBatchId,

                    updatedAt:
                        Date.now()
                });

                return res.json({

                    success: true,

                    message:
                        "PayPal payout item confirmed successful and withdrawal marked paid.",

                    withdrawalId,

                    data: {

                        paypalBatchId:
                            paypalStatus.paypalBatchId ||
                            paypalBatchId,

                        batchStatus,

                        paypalItemId,

                        transactionStatus,

                        transactionId
                    }
                });
            }


            /*
            ==========================================
            CONFIRMED PAYPAL FAILURE
            ==========================================
            */

            if (
                paypalFailure
            ) {

                console.log(
                    "[PAYPAL] CONFIRMED FAILURE:",
                    {
                        withdrawalId,
                        batchStatus,
                        transactionStatus
                    }
                );


                /*
                    Never move PAID backwards.
                */

                if (
                    normalizeStatus(
                        current.status
                    ) === "PAID"
                ) {

                    await withdrawalRef.update({

                        paymentStatus:
                            "SUCCESS",

                        paymentFailureReason:
                            "",

                        reconciliationRequired:
                            false,

                        reconciliationAt:
                            null,

                        updatedAt:
                            Date.now()
                    });

                    return res.status(409).json({

                        success: false,

                        message:
                            "PayPal reports failure, but the local withdrawal is already paid. No rollback was performed.",

                        withdrawalId
                    });
                }


                /*
                    A reconciliation_required record must
                    not silently become payment_failed.
                */

                if (
                    normalizeStatus(
                        current.status
                    ) ===
                    "RECONCILIATION_REQUIRED"
                ) {

                    return res.status(409).json({

                        success: false,

                        reconciliationRequired:
                            true,

                        message:
                            "PayPal reports failure, but this withdrawal is already in reconciliation. Manual reconciliation is required.",

                        withdrawalId
                    });
                }


                await withdrawalManager
                    .markPaymentFailed(
                        withdrawalId,
                        `PayPal payout status: ${
                            transactionStatus ||
                            batchStatus
                        }`
                    );

                return res.json({

                    success: false,

                    paymentFailed:
                        true,

                    message:
                        "PayPal confirmed that the payout failed. The withdrawal was marked payment_failed and wallet funds were restored according to the withdrawal manager.",

                    withdrawalId,

                    data: {

                        paypalBatchId,

                        batchStatus,

                        paypalItemId,

                        transactionStatus,

                        transactionId
                    }
                });
            }


            /*
            ==========================================
            STILL PROCESSING
            ==========================================
            */

            console.log(
                "[PAYPAL] STILL PROCESSING / UNRESOLVED:",
                {
                    withdrawalId,
                    batchStatus,
                    transactionStatus
                }
            );

            const latestSnapshot =
                await withdrawalRef.get();

            if (
                latestSnapshot.exists()
            ) {

                const latest =
                    latestSnapshot.val();

                const latestStatus =
                    normalizeStatus(
                        latest.status
                    );

                /*
                    Never move terminal/reconciliation
                    states backwards.
                */

                if (
                    latestStatus !== "PAID" &&
                    latestStatus !== "PAYMENT_FAILED" &&
                    latestStatus !== "RECONCILIATION_REQUIRED"
                ) {

                    await withdrawalRef.update({

                        status:
                            "processing",

                        paymentStatus:
                            "PROCESSING",

                        reconciliationRequired:
                            false,

                        paymentFailureReason:
                            "",

                        updatedAt:
                            Date.now()
                    });
                }
            }

            return res.json({

                success: true,

                message:
                    "PayPal payout status retrieved and synchronized.",

                withdrawalId,

                synchronized:
                    true,

                data: {

                    paypalBatchId:
                        paypalStatus.paypalBatchId ||
                        paypalBatchId,

                    batchStatus,

                    paypalItemId,

                    transactionStatus,

                    transactionId
                }
            });

        }
        catch (e) {

            console.error(
                "[PAYPAL STATUS ERROR]",
                {
                    message:
                        getSafeErrorMessage(e)
                }
            );

            /*
                We cannot prove that PayPal failed.

                Therefore:
                - no wallet restoration
                - no automatic retry
                - unresolved payout remains reserved
            */

            const unknown =
                isUnknownProviderError(e);

            if (unknown) {

                try {

                    const local =
                        await getWithdrawal(
                            req.params.paypalBatchId
                        );

                    void local;

                }
                catch (_) {
                    /*
                        Ignore lookup failure here.
                        The primary response below is enough.
                    */
                }
            }

            return res.status(
                unknown
                    ? 202
                    : 500
            ).json({

                success: false,

                reconciliationRequired:
                    unknown,

                message:
                    unknown
                        ? "PayPal status could not be confirmed. The payout outcome remains unresolved."
                        : "Failed to retrieve PayPal payout status.",

                error:
                    getSafeErrorMessage(e)
            });
        }
    }
);


/*
====================================================
PAY WITHDRAWAL
====================================================

PAYPAL:

approved
    â†“
atomic claim
    â†“
processing
    â†“
submit to PayPal
    â†“
processing
    â†“
status reconciliation

SUCCESS
    â†“
paid

CONFIRMED FAILURE
    â†“
payment_failed
    â†“
wallet restored

UNKNOWN
    â†“
reconciliation_required
    â†“
funds remain reserved

RETRY AFTER CONFIRMED FAILURE:

payment_failed
    â†“
atomic claim
    â†“
NEW sender batch identity
    â†“
processing
    â†“
new PayPal attempt
====================================================
*/
/*
====================================================
PAY WITHDRAWAL
====================================================

PAYPAL:

approved
    ↓
atomic claim
    ↓
processing
    ↓
submit to PayPal
    ↓
processing
    ↓
status reconciliation

SUCCESS
    ↓
paid

CONFIRMED FAILURE
    ↓
payment_failed
    ↓
wallet restored

UNKNOWN
    ↓
reconciliation_required
    ↓
funds remain reserved

RETRY AFTER CONFIRMED FAILURE:

payment_failed
    ↓
atomic claim
    ↓
NEW sender batch identity
    ↓
processing
    ↓
new PayPal attempt


M-PESA:

approved
    ↓
atomic claim
    ↓
processing
    ↓
submit B2C
    ↓
provider response

CONFIRMED FAILURE
    ↓
payment_failed
    ↓
wallet restored

UNKNOWN / TIMEOUT / EXCEPTION
    ↓
reconciliation_required
    ↓
funds remain reserved

SUCCESS / ACCEPTED
    ↓
processing
    ↓
callback / reconciliation
    ↓
paid
====================================================
*/

router.post(
    "/:withdrawalId/pay",
    async (req, res) => {

        const withdrawalId =
            String(
                req.params.withdrawalId || ""
            ).trim();

        if (!withdrawalId) {

            return res.status(400).json({

                success: false,

                message:
                    "Withdrawal ID is required."
            });
        }

        let paymentMethod = "";
        let initialStatus = "";

        try {

            /*
            ==========================================
            LOAD WITHDRAWAL
            ==========================================
            */

            const withdrawalRef =
                db
                    .ref("withdrawalRequests")
                    .child(withdrawalId);

            const snapshot =
                await withdrawalRef.get();

            if (!snapshot.exists()) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Withdrawal request not found."
                });
            }

            let withdrawal =
                snapshot.val();

            paymentMethod =
                normalizePaymentMethod(
                    withdrawal.paymentMethod
                );

            initialStatus =
                normalizeStatus(
                    withdrawal.status
                );


            /*
            ==========================================
            VALIDATE STATUS
            ==========================================
            */

            const reconciliationRequired =
                initialStatus ===
                "RECONCILIATION_REQUIRED";


            if (
                initialStatus !== "APPROVED" &&
                initialStatus !== "PAYMENT_FAILED" &&
                !reconciliationRequired
            ) {

                let message =
                    "Withdrawal must be approved before payment.";

                if (
                    initialStatus ===
                    "PROCESSING"
                ) {

                    message =
                        "This withdrawal is already being processed.";
                }

                if (
                    initialStatus ===
                    "PAID"
                ) {

                    message =
                        "This withdrawal has already been paid.";
                }

                if (
                    initialStatus ===
                    "REJECTED"
                ) {

                    message =
                        "This withdrawal has been rejected.";
                }

                return res.status(400).json({

                    success: false,

                    message,

                    status:
                        withdrawal.status
                });
            }


            /*
            ==========================================
            PAYPAL
            ==========================================
            */

            if (
                paymentMethod ===
                "PAYPAL"
            ) {

                console.log(
                    "[PAYPAL] PAYMENT REQUEST RECEIVED:",
                    {
                        withdrawalId,
                        initialStatus,
                        paypalSenderBatchId:
                            withdrawal.paypalSenderBatchId ||
                            "",
                        paypalAttemptNumber:
                            withdrawal.paypalAttemptNumber ||
                            0
                    }
                );


                /*
                ======================================
                ATOMIC CLAIM
                ======================================
                */

                console.log(
                    "[PAYPAL] BEFORE CLAIM:",
                    {
                        withdrawalId,
                        initialStatus,
                        firebaseStatus:
                            withdrawal.status,
                        paymentStatus:
                            withdrawal.paymentStatus
                    }
                );


                /*
                ======================================
                REFRESH FIREBASE STATE BEFORE
                TRANSACTION
                ======================================
                */

                const claimPreflightSnapshot =
                    await withdrawalRef.get();

                if (
                    !claimPreflightSnapshot.exists()
                ) {

                    console.error(
                        "[PAYPAL] CLAIM PREFLIGHT FAILED:",
                        {
                            withdrawalId
                        }
                    );

                    return res.status(404).json({

                        success: false,

                        message:
                            "Withdrawal request no longer exists."
                    });
                }

                const claimPreflight =
                    claimPreflightSnapshot.val();

                console.log(
                    "[PAYPAL] CLAIM PREFLIGHT:",
                    {
                        withdrawalId,
                        exists:
                            claimPreflightSnapshot.exists(),
                        status:
                            claimPreflight?.status || "",
                        paymentStatus:
                            claimPreflight?.paymentStatus || ""
                    }
                );

                let usedPreflightFallback = false;

                const claimResult =
                    await withdrawalRef.transaction(
                        current => {

                            console.log(
                                "[PAYPAL] CLAIM TRANSACTION CALLBACK:",
                                {
                                    withdrawalId,

                                    currentExists:
                                        !!current,

                                    currentStatus:
                                        current?.status || "",

                                    normalizedStatus:
                                        normalizeStatus(
                                            current?.status
                                        ),

                                    usedPreflightFallback
                                }
                            );


                            /*
                            ==================================
                            FIREBASE INITIAL NULL HANDLING
                            ==================================
                            */

                            if (
                                current == null &&
                                !usedPreflightFallback
                            ) {

                                usedPreflightFallback =
                                    true;

                                console.log(
                                    "[PAYPAL] TRANSACTION INITIAL NULL - USING PREFLIGHT:",
                                    {
                                        withdrawalId
                                    }
                                );

                                current =
                                    claimPreflight;
                            }


                            /*
                            ==================================
                            REAL MISSING RECORD
                            ==================================
                            */

                            if (!current) {

                                console.warn(
                                    "[PAYPAL] CLAIM ABORTED: RECORD DOES NOT EXIST",
                                    withdrawalId
                                );

                                return;
                            }

                            const currentStatus =
                                normalizeStatus(
                                    current.status
                                );


                            /*
                            ==================================
                            CLAIMABLE STATUS
                            ==================================
                            */

                            if (
                                currentStatus !==
                                    "APPROVED" &&
                                currentStatus !==
                                    "PAYMENT_FAILED" &&
                                currentStatus !==
                                    "RECONCILIATION_REQUIRED"
                            ) {

                                console.warn(
                                    "[PAYPAL] CLAIM ABORTED: STATUS NOT CLAIMABLE:",
                                    {
                                        withdrawalId,
                                        currentStatus
                                    }
                                );

                                return;
                            }

                            const now =
                                Date.now();

                            console.log(
                                "[PAYPAL] CLAIMING WITH STATUS:",
                                {
                                    withdrawalId,
                                    currentStatus,
                                    newStatus:
                                        "processing"
                                }
                            );

                            return {

                                ...current,

                                status:
                                    "processing",

                                paymentStatus:
                                    "PROCESSING",

                                processingAt:
                                    now,

                                paymentAttemptedAt:
                                    now,

                                paymentFailureReason:
                                    "",

                                reconciliationRequired:
                                    false,

                                reconciliationAt:
                                    null,

                                updatedAt:
                                    now
                            };
                        }
                    );


                console.log(
                    "[PAYPAL] CLAIM RESULT:",
                    JSON.stringify(
                        {
                            withdrawalId,

                            committed:
                                claimResult.committed,

                            snapshotExists:
                                claimResult.snapshot.exists(),

                            snapshotStatus:
                                claimResult.snapshot.val()?.status ||
                                "",

                            snapshotPaymentStatus:
                                claimResult.snapshot.val()?.paymentStatus ||
                                ""
                        },
                        null,
                        2
                    )
                );


                /*
                ======================================
                CLAIM FAILED
                ======================================
                */

                if (
                    !claimResult.committed
                ) {

                    const latestSnapshot =
                        await withdrawalRef.get();

                    const latest =
                        latestSnapshot.exists()
                            ? latestSnapshot.val()
                            : null;

                    const latestStatus =
                        normalizeStatus(
                            latest?.status
                        );

                    let message =
                        "Withdrawal cannot be paid in its current state.";

                    if (
                        latestStatus ===
                        "PROCESSING"
                    ) {

                        message =
                            "This withdrawal is already being processed.";
                    }
                    else if (
                        latestStatus ===
                        "PAID"
                    ) {

                        message =
                            "This withdrawal has already been paid.";
                    }
                    else if (
                        latestStatus ===
                        "RECONCILIATION_REQUIRED"
                    ) {

                        message =
                            "This withdrawal requires reconciliation before another payment attempt.";
                    }
                    else if (
                        latestStatus ===
                            "APPROVED" ||
                        latestStatus ===
                            "PAYMENT_FAILED"
                    ) {

                        message =
                            "The payment claim could not be completed. Please retry once.";
                    }

                    return res.status(409).json({

                        success: false,

                        message,

                        status:
                            latest?.status || ""
                    });
                }


                console.log(
                    "[PAYPAL] PAYMENT CLAIMED:",
                    {
                        withdrawalId,
                        previousStatus:
                            initialStatus
                    }
                );


                /*
                ======================================
                RELOAD AFTER CLAIM
                ======================================
                */

                const claimedSnapshot =
                    await withdrawalRef.get();

                if (
                    !claimedSnapshot.exists()
                ) {

                    throw new Error(
                        "Withdrawal disappeared after payment claim."
                    );
                }

                withdrawal =
                    claimedSnapshot.val();


                /*
                ======================================
                CONFIRMED FAILURE RETRY
                ======================================
                */

                if (
                    initialStatus ===
                    "PAYMENT_FAILED"
                ) {

                    console.log(
                        "[PAYPAL] CONFIRMED FAILURE RETRY DETECTED:",
                        {
                            withdrawalId,

                            oldSenderBatchId:
                                withdrawal.paypalSenderBatchId ||
                                "",

                            oldAttemptNumber:
                                withdrawal.paypalAttemptNumber ||
                                0
                        }
                    );

                    await preparePayPalRetryIdentity(
                        withdrawalId
                    );

                    const retrySnapshot =
                        await withdrawalRef.get();

                    if (
                        !retrySnapshot.exists()
                    ) {

                        throw new Error(
                            "Withdrawal disappeared after creating PayPal retry identity."
                        );
                    }

                    withdrawal =
                        retrySnapshot.val();

                    console.log(
                        "[PAYPAL] RETRY IDENTITY READY:",
                        {
                            withdrawalId,

                            paypalSenderBatchId:
                                withdrawal.paypalSenderBatchId,

                            paypalAttemptNumber:
                                withdrawal.paypalAttemptNumber
                        }
                    );
                }


                /*
                ======================================
                FIRST ATTEMPT
                ======================================
                */

                if (
                    initialStatus ===
                    "APPROVED"
                ) {

                    console.log(
                        "[PAYPAL] INITIAL PAYMENT ATTEMPT:",
                        {
                            withdrawalId,

                            paypalSenderBatchId:
                                withdrawal.paypalSenderBatchId ||
                                ""
                        }
                    );
                }


                /*
                ======================================
                SUBMIT PAYPAL PAYOUT
                ======================================
                */

                console.log(
                    "[PAYPAL] SUBMITTING TO PAYPAL:",
                    {
                        withdrawalId,

                        paypalSenderBatchId:
                            withdrawal.paypalSenderBatchId ||
                            "",

                        paypalAttemptNumber:
                            withdrawal.paypalAttemptNumber ||
                            0,

                        paypalEmail:
                            withdrawal.paypalEmail ||
                            ""
                    }
                );

                let payment;

                try {

                    payment =
                        await PayPalPayoutManager
                            .sendMoney(
                                withdrawal
                            );

                }
                catch (paypalError) {

                    console.error(
                        "[PAYPAL SEND ERROR]",
                        {
                            withdrawalId,

                            message:
                                getSafeErrorMessage(
                                    paypalError
                                ),

                            code:
                                paypalError?.code ||
                                "",

                            httpStatus:
                                paypalError?.response?.status ||
                                "",

                            unknownOutcome:
                                paypalError?.unknownOutcome ===
                                true,

                            reconciliationRequired:
                                paypalError?.reconciliationRequired ===
                                true,

                            confirmedFailure:
                                paypalError?.confirmedFailure ===
                                true
                        }
                    );


                    const isConfirmedFailure =
                        paypalError?.confirmedFailure ===
                        true;

                    const isUnknownOutcome =
                        paypalError?.unknownOutcome ===
                            true ||
                        paypalError?.reconciliationRequired ===
                            true;


                    /*
                    ==================================
                    CONFIRMED FAILURE
                    ==================================
                    */

                    if (
                        isConfirmedFailure &&
                        !isUnknownOutcome
                    ) {

                        await withdrawalManager
                            .markPaymentFailed(
                                withdrawalId,

                                getSafeErrorMessage(
                                    paypalError
                                )
                            );

                        return res.status(400).json({

                            success: false,

                            paymentFailed:
                                true,

                            processing:
                                false,

                            reconciliationRequired:
                                false,

                            message:
                                "PayPal payment could not be submitted. The withdrawal was marked payment_failed and wallet funds were restored.",

                            withdrawalId
                        });
                    }


                    /*
                    ==================================
                    UNKNOWN OUTCOME
                    ==================================
                    */

                    await markPayPalReconciliationRequired(
                        withdrawalId,

                        getSafeErrorMessage(
                            paypalError
                        )
                    );

                    return res.status(202).json({

                        success: false,

                        paymentFailed:
                            false,

                        processing:
                            false,

                        reconciliationRequired:
                            true,

                        message:
                            "PayPal payout outcome is uncertain. The withdrawal has been placed into reconciliation.",

                        withdrawalId
                    });
                }


                /*
                ======================================
                PAYPAL PROVIDER RESPONSE
                ======================================
                */

                console.log(
                    "[PAYPAL] PROVIDER RESPONSE:",
                    {
                        withdrawalId,

                        success:
                            payment?.success,

                        status:
                            payment?.status,

                        paypalBatchId:
                            payment?.paypalBatchId ||
                            "",

                        paypalItemId:
                            payment?.paypalItemId ||
                            "",

                        paypalTransactionId:
                            payment?.paypalTransactionId ||
                            payment?.transactionId ||
                            "",

                        paypalBatchStatus:
                            payment?.paypalBatchStatus ||
                            "",

                        paypalTransactionStatus:
                            payment?.paypalTransactionStatus ||
                            payment?.transactionStatus ||
                            "",

                        reconciliationRequired:
                            payment?.reconciliationRequired ||
                            false
                    }
                );


                const providerStatus =
                    normalizeStatus(
                        payment?.status
                    );

                const providerBatchStatus =
                    normalizeStatus(
                        payment?.paypalBatchStatus ||
                        payment?.batchStatus ||
                        ""
                    );

                const providerTransactionStatus =
                    normalizeStatus(
                        payment?.paypalTransactionStatus ||
                        payment?.transactionStatus ||
                        ""
                    );

                const providerBatchId =
                    payment?.paypalBatchId ||
                    payment?.providerReference ||
                    "";

                const providerItemId =
                    payment?.paypalItemId ||
                    "";

                const providerTransactionId =
                    payment?.paypalTransactionId ||
                    payment?.transactionId ||
                    "";


                /*
                ======================================
                UNKNOWN / RECONCILIATION
                ======================================
                */

                if (
                    isUnknownPayPalOutcome(
                        payment
                    )
                ) {

                    await markPayPalReconciliationRequired(
                        withdrawalId,

                        payment?.message ||
                        "PayPal payout outcome is uncertain. Reconciliation required."
                    );

                    return res.status(202).json({

                        success: false,

                        reconciliationRequired:
                            true,

                        processing:
                            false,

                        paymentFailed:
                            false,

                        message:
                            "PayPal payout outcome is uncertain. The withdrawal has been placed into reconciliation."
                    });
                }


                /*
                ======================================
                EXPLICIT RECONCILIATION
                ======================================
                */

                if (
                    payment?.reconciliationRequired ===
                        true ||
                    payment?.unknownOutcome ===
                        true ||
                    payment?.uncertain ===
                        true ||
                    isPayPalReconciliationStatus(
                        providerBatchStatus,
                        providerTransactionStatus
                    )
                ) {

                    await markPayPalReconciliationRequired(
                        withdrawalId,

                        payment?.message ||
                        `PayPal payout requires reconciliation: ${
                            providerTransactionStatus ||
                            providerBatchStatus ||
                            "UNKNOWN"
                        }`
                    );

                    return res.status(202).json({

                        success: false,

                        reconciliationRequired:
                            true,

                        processing:
                            false,

                        paymentFailed:
                            false,

                        message:
                            "PayPal payout requires reconciliation. The withdrawal remains reserved."
                    });
                }


                /*
                ======================================
                CONFIRMED ITEM SUCCESS
                ======================================
                */

                const confirmedProviderSuccess =
                    providerTransactionStatus ===
                    "SUCCESS";


                if (
                    confirmedProviderSuccess
                ) {

                    if (
                        !providerBatchId
                    ) {

                        await markPayPalReconciliationRequired(
                            withdrawalId,

                            "PayPal reported item-level SUCCESS but no payout batch ID was returned."
                        );

                        return res.status(202).json({

                            success: false,

                            reconciliationRequired:
                                true,

                            message:
                                "PayPal reported success but the payout batch ID was missing. Manual reconciliation is required."
                        });
                    }


                    const currentSnapshot =
                        await withdrawalRef.get();

                    const current =
                        currentSnapshot.exists
                            ? currentSnapshot.val()
                            : null;

                    const currentStatus =
                        normalizeStatus(
                            current?.status
                        );


                    if (
                        currentStatus ===
                        "RECONCILIATION_REQUIRED"
                    ) {

                        return res.status(409).json({

                            success: false,

                            reconciliationRequired:
                                true,

                            message:
                                "PayPal reports SUCCESS, but the withdrawal is already in reconciliation. Manual reconciliation is required before marking it paid."
                        });
                    }


                    if (
                        currentStatus ===
                        "PAYMENT_FAILED"
                    ) {

                        await markPayPalReconciliationRequired(
                            withdrawalId,

                            "PayPal reports SUCCESS while the local withdrawal is payment_failed. Manual reconciliation required."
                        );

                        return res.status(409).json({

                            success: false,

                            reconciliationRequired:
                                true,

                            message:
                                "PayPal reports SUCCESS while the local withdrawal is payment_failed. Manual reconciliation is required."
                        });
                    }


                    await withdrawalManager
                        .markAsPaid(
                            withdrawalId,

                            providerTransactionId,

                            providerTransactionId ||
                            providerBatchId
                        );

                    await withdrawalRef.update({

                        status:
                            "paid",

                        paymentStatus:
                            "SUCCESS",

                        paypalBatchId:
                            providerBatchId,

                        paypalItemId:
                            providerItemId ||
                            withdrawal.paypalItemId ||
                            "",

                        paypalBatchStatus:
                            providerBatchStatus ||
                            "SUCCESS",

                        paypalTransactionStatus:
                            providerTransactionStatus,

                        paypalTransactionId:
                            providerTransactionId,

                        paymentReference:
                            providerTransactionId ||
                            providerBatchId,

                        paymentFailureReason:
                            "",

                        reconciliationRequired:
                            false,

                        reconciliationAt:
                            null,

                        updatedAt:
                            Date.now()
                    });

                    console.log(
                        "[PAYPAL] PAYMENT CONFIRMED SUCCESS:",
                        {
                            withdrawalId,

                            paypalBatchId:
                                providerBatchId,

                            paypalItemId:
                                providerItemId,

                            paypalTransactionId:
                                providerTransactionId
                        }
                    );

                    return res.json({

                        success:
                            true,

                        message:
                            "PayPal payout was confirmed successful.",

                        payment: {

                            provider:
                                "PAYPAL",

                            status:
                                "SUCCESS",

                            paypalBatchId:
                                providerBatchId,

                            paypalItemId:
                                providerItemId,

                            paypalTransactionId:
                                providerTransactionId,

                            paypalTransactionStatus:
                                providerTransactionStatus
                        }
                    });
                }


                /*
                ======================================
                CONFIRMED FAILURE
                ======================================
                */

                const managerConfirmedFailure =
                    payment?.confirmedFailure ===
                    true;

                const providerConfirmedFailure =
                    isPayPalFailure(
                        providerBatchStatus,
                        providerTransactionStatus
                    );

                const confirmedPayPalFailure =
                    managerConfirmedFailure ||
                    providerConfirmedFailure;


                if (
                    confirmedPayPalFailure
                ) {

                    const currentSnapshot =
                        await withdrawalRef.get();

                    const current =
                        currentSnapshot.exists
                            ? currentSnapshot.val()
                            : null;

                    const currentStatus =
                        normalizeStatus(
                            current?.status
                        );


                    if (
                        currentStatus ===
                        "PAID"
                    ) {

                        return res.status(409).json({

                            success:
                                false,

                            paymentFailed:
                                false,

                            reconciliationRequired:
                                true,

                            message:
                                "PayPal reported a failure, but the local withdrawal is already paid. No wallet rollback was performed.",

                            withdrawalId
                        });
                    }


                    if (
                        currentStatus ===
                        "RECONCILIATION_REQUIRED"
                    ) {

                        return res.status(409).json({

                            success:
                                false,

                            paymentFailed:
                                false,

                            reconciliationRequired:
                                true,

                            message:
                                "PayPal reported a failure, but this withdrawal is already in reconciliation. Manual reconciliation is required.",

                            withdrawalId
                        });
                    }


                    const failureReason =
                        payment?.message ||
                        payment?.paymentFailureReason ||
                        (
                            providerTransactionStatus
                                ? `PayPal payout transaction status: ${providerTransactionStatus}`
                                : providerBatchStatus
                                    ? `PayPal payout batch status: ${providerBatchStatus}`
                                    : "PayPal payout failed before submission."
                        );


                    await withdrawalManager
                        .markPaymentFailed(
                            withdrawalId,
                            failureReason
                        );


                    await withdrawalRef.update({

                        status:
                            "payment_failed",

                        paymentStatus:
                            "FAILED",

                        paymentFailureReason:
                            failureReason,

                        reconciliationRequired:
                            false,

                        reconciliationAt:
                            null,

                        paypalBatchId:
                            providerBatchId ||
                            withdrawal.paypalBatchId ||
                            "",

                        paypalItemId:
                            providerItemId ||
                            withdrawal.paypalItemId ||
                            "",

                        paypalTransactionId:
                            providerTransactionId ||
                            withdrawal.paypalTransactionId ||
                            "",

                        paypalBatchStatus:
                            providerBatchStatus ||
                            "",

                        paypalTransactionStatus:
                            providerTransactionStatus ||
                            "",

                        updatedAt:
                            Date.now()
                    });


                    return res.status(400).json({

                        success:
                            false,

                        paymentFailed:
                            true,

                        processing:
                            false,

                        reconciliationRequired:
                            false,

                        message:
                            "PayPal confirmed that the payout failed. The withdrawal was marked payment_failed and wallet funds were restored.",

                        withdrawalId
                    });
                }


                /*
                ======================================
                PAYPAL PROCESSING
                ======================================
                */

                const paypalIsProcessing =
                    providerStatus === "PROCESSING" ||
                    providerBatchStatus === "PROCESSING" ||
                    providerBatchStatus === "PENDING" ||
                    providerBatchStatus === "UNCLAIMED" ||
                    providerBatchStatus === "ONHOLD" ||
                    providerTransactionStatus === "PROCESSING" ||
                    providerTransactionStatus === "PENDING" ||
                    providerTransactionStatus === "UNCLAIMED" ||
                    providerTransactionStatus === "ONHOLD";


                if (
                    paypalIsProcessing
                ) {

                    await withdrawalRef.update({

                        status:
                            "processing",

                        paymentStatus:
                            "PROCESSING",

                        paypalBatchId:
                            providerBatchId ||
                            withdrawal.paypalBatchId ||
                            "",

                        paypalItemId:
                            providerItemId ||
                            withdrawal.paypalItemId ||
                            "",

                        paypalBatchStatus:
                            providerBatchStatus ||
                            "PROCESSING",

                        paypalTransactionStatus:
                            providerTransactionStatus ||
                            "PENDING",

                        paypalTransactionId:
                            providerTransactionId ||
                            withdrawal.paypalTransactionId ||
                            "",

                        paymentReference:
                            providerTransactionId ||
                            providerBatchId ||
                            withdrawal.paymentReference ||
                            "",

                        reconciliationRequired:
                            false,

                        reconciliationAt:
                            null,

                        paymentFailureReason:
                            "",

                        updatedAt:
                            Date.now()
                    });

                    return res.status(202).json({

                        success:
                            false,

                        processing:
                            true,

                        reconciliationRequired:
                            false,

                        paymentFailed:
                            false,

                        message:
                            "PayPal payout was accepted and is still processing. The withdrawal remains reserved.",

                        payment: {

                            provider:
                                "PAYPAL",

                            status:
                                "PROCESSING",

                            paypalBatchId:
                                providerBatchId,

                            paypalItemId:
                                providerItemId,

                            paypalTransactionId:
                                providerTransactionId,

                            paypalBatchStatus:
                                providerBatchStatus,

                            paypalTransactionStatus:
                                providerTransactionStatus ||
                                "PENDING"
                        }
                    });
                }


                /*
                ======================================
                PAYPAL UNRESOLVED
                ======================================
                */

                if (
                    !payment ||
                    payment.success !== true
                ) {

                    await markPayPalReconciliationRequired(
                        withdrawalId,

                        payment?.message ||
                        "PayPal returned an unresolved payment result."
                    );

                    return res.status(202).json({

                        success:
                            false,

                        reconciliationRequired:
                            true,

                        processing:
                            false,

                        paymentFailed:
                            false,

                        message:
                            "PayPal returned an unresolved payment result. The withdrawal remains reserved for reconciliation."
                    });
                }


                /*
                ======================================
                PAYPAL SUCCESS WITHOUT ITEM SUCCESS
                ======================================
                */

                await markPayPalReconciliationRequired(
                    withdrawalId,

                    "PayPal returned a successful response without a confirmed recipient-level SUCCESS status."
                );

                return res.status(202).json({

                    success:
                        false,

                    reconciliationRequired:
                        true,

                    processing:
                        false,

                    paymentFailed:
                        false,

                    message:
                        "PayPal returned an incomplete success response. The withdrawal remains reserved for reconciliation."
                });
            }


            /*
            ==========================================
            M-PESA
            ==========================================
            */

            if (
                paymentMethod !==
                "MPESA"
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        `Unsupported payment method: ${
                            paymentMethod ||
                            "UNKNOWN"
                        }`
                });
            }


            console.log(
                "[MPESA] Starting payout:",
                withdrawalId
            );


            /*
            ==========================================
            M-PESA ATOMIC CLAIM PREFLIGHT
            ==========================================

            IMPORTANT:

            Do NOT immediately start the transaction.

            First perform a fresh GET.

            Firebase transactions can invoke their callback
            with null during initial local-state resolution.

            We use this verified Firebase state as the
            transaction's initial fallback.

            The transaction still performs the actual
            atomic conflict detection.
            ==========================================
            */

            console.log(
                "[MPESA CLAIM] BEFORE TRANSACTION:",
                {
                    withdrawalId,

                    initialStatus,

                    firebaseStatus:
                        withdrawal.status,

                    paymentStatus:
                        withdrawal.paymentStatus,

                    paymentAttemptCount:
                        withdrawal.paymentAttemptCount ||
                        0
                }
            );


            const mpesaClaimPreflightSnapshot =
                await withdrawalRef.get();

            if (
                !mpesaClaimPreflightSnapshot.exists()
            ) {

                console.error(
                    "[MPESA CLAIM] PREFLIGHT FAILED:",
                    {
                        withdrawalId
                    }
                );

                return res.status(404).json({

                    success: false,

                    message:
                        "Withdrawal request no longer exists."
                });
            }


            const mpesaClaimPreflight =
                mpesaClaimPreflightSnapshot.val();


            console.log(
                "[MPESA CLAIM] PREFLIGHT:",
                JSON.stringify(
                    {
                        withdrawalId,

                        exists:
                            mpesaClaimPreflightSnapshot.exists(),

                        status:
                            mpesaClaimPreflight?.status ||
                            "",

                        normalizedStatus:
                            normalizeStatus(
                                mpesaClaimPreflight?.status
                            ),

                        paymentStatus:
                            mpesaClaimPreflight?.paymentStatus ||
                            "",

                        paymentAttemptCount:
                            mpesaClaimPreflight?.paymentAttemptCount ||
                            0
                    },
                    null,
                    2
                )
            );


            /*
            ==========================================
            VERIFY PREFLIGHT STATUS
            ==========================================
            */

            const preflightStatus =
                normalizeStatus(
                    mpesaClaimPreflight?.status
                );


            if (
                preflightStatus !== "APPROVED" &&
                preflightStatus !== "PAYMENT_FAILED"
            ) {

                console.warn(
                    "[MPESA CLAIM] PREFLIGHT NOT CLAIMABLE:",
                    {
                        withdrawalId,
                        preflightStatus
                    }
                );

                if (
                    preflightStatus ===
                    "PROCESSING"
                ) {

                    return res.status(409).json({

                        success: false,

                        message:
                            "This withdrawal is already being processed.",

                        status:
                            mpesaClaimPreflight?.status ||
                            ""
                    });
                }

                if (
                    preflightStatus ===
                    "PAID"
                ) {

                    return res.status(409).json({

                        success: false,

                        message:
                            "This withdrawal has already been paid.",

                        status:
                            mpesaClaimPreflight?.status ||
                            ""
                    });
                }

                if (
                    preflightStatus ===
                    "RECONCILIATION_REQUIRED"
                ) {

                    return res.status(409).json({

                        success: false,

                        message:
                            "This withdrawal requires reconciliation before another payment attempt.",

                        status:
                            mpesaClaimPreflight?.status ||
                            ""
                    });
                }

                return res.status(409).json({

                    success: false,

                    message:
                        "Withdrawal payment claim could not be completed.",

                    status:
                        mpesaClaimPreflight?.status ||
                        ""
                });
            }


            /*
            ==========================================
            ATOMIC M-PESA CLAIM
            ==========================================
            */

            let usedMpesaPreflightFallback =
                false;


            const mpesaClaimResult =
                await withdrawalRef.transaction(
                    current => {

                        console.log(
                            "[MPESA CLAIM] TRANSACTION CALLBACK:",
                            JSON.stringify(
                                {
                                    withdrawalId,

                                    currentExists:
                                        !!current,

                                    currentStatus:
                                        current?.status ||
                                        "",

                                    normalizedStatus:
                                        normalizeStatus(
                                            current?.status
                                        ),

                                    paymentStatus:
                                        current?.paymentStatus ||
                                        "",

                                    paymentAttemptCount:
                                        current?.paymentAttemptCount ||
                                        0,

                                    usedPreflightFallback:
                                        usedMpesaPreflightFallback
                                },
                                null,
                                2
                            )
                        );


                        /*
                        ==================================
                        INITIAL NULL CALLBACK
                        ==================================

                        Use the freshly verified Firebase
                        state.

                        IMPORTANT:

                        We do NOT perform an update outside
                        the transaction.

                        Firebase still controls the final
                        atomic commit.
                        ==================================
                        */

                        if (
                            current == null &&
                            !usedMpesaPreflightFallback
                        ) {

                            usedMpesaPreflightFallback =
                                true;

                            console.log(
                                "[MPESA CLAIM] INITIAL NULL - USING PREFLIGHT:",
                                {
                                    withdrawalId
                                }
                            );

                            current =
                                mpesaClaimPreflight;
                        }


                        /*
                        ==================================
                        REAL MISSING RECORD
                        ==================================
                        */

                        if (!current) {

                            console.warn(
                                "[MPESA CLAIM] ABORT: RECORD DOES NOT EXIST:",
                                withdrawalId
                            );

                            return;
                        }


                        const currentStatus =
                            normalizeStatus(
                                current.status
                            );


                        console.log(
                            "[MPESA CLAIM] NORMALIZED STATUS:",
                            {
                                withdrawalId,
                                currentStatus
                            }
                        );


                        /*
                        ==================================
                        CLAIMABLE STATUS
                        ==================================
                        */

                        if (
                            currentStatus !==
                                "APPROVED" &&
                            currentStatus !==
                                "PAYMENT_FAILED"
                        ) {

                            console.warn(
                                "[MPESA CLAIM] ABORT: STATUS NOT CLAIMABLE:",
                                {
                                    withdrawalId,
                                    currentStatus
                                }
                            );

                            return;
                        }


                        const now =
                            Date.now();


                        const nextAttemptCount =
                            Number(
                                current.paymentAttemptCount ||
                                0
                            ) + 1;


                        console.log(
                            "[MPESA CLAIM] CLAIMING:",
                            {
                                withdrawalId,

                                previousStatus:
                                    currentStatus,

                                newStatus:
                                    "processing",

                                nextAttemptCount
                            }
                        );


                        return {

                            ...current,

                            status:
                                "processing",

                            paymentStatus:
                                "PROCESSING",

                            processingAt:
                                now,

                            paymentAttemptedAt:
                                now,

                            paymentAttemptCount:
                                nextAttemptCount,

                            paymentFailureReason:
                                "",

                            reconciliationRequired:
                                false,

                            reconciliationAt:
                                null,

                            updatedAt:
                                now
                        };
                    }
                );


            /*
            ==========================================
            M-PESA CLAIM RESULT
            ==========================================
            */

            console.log(
                "[MPESA CLAIM] RESULT:",
                JSON.stringify(
                    {
                        withdrawalId,

                        committed:
                            mpesaClaimResult.committed,

                        snapshotExists:
                            mpesaClaimResult.snapshot.exists(),

                        snapshotStatus:
                            mpesaClaimResult.snapshot.val()?.status ||
                            "",

                        snapshotPaymentStatus:
                            mpesaClaimResult.snapshot.val()?.paymentStatus ||
                            "",

                        snapshotAttemptCount:
                            mpesaClaimResult.snapshot.val()?.paymentAttemptCount ||
                            0
                    },
                    null,
                    2
                )
            );


            /*
            ==========================================
            VERIFY M-PESA CLAIM
            ==========================================
            */

            if (
                !mpesaClaimResult.committed
            ) {

                console.warn(
                    "[MPESA CLAIM] NOT COMMITTED - PAYMENT WILL NOT BE SENT:",
                    {
                        withdrawalId,

                        committed:
                            mpesaClaimResult.committed
                    }
                );


                const latestSnapshot =
                    await withdrawalRef.get();

                const latest =
                    latestSnapshot.exists()
                        ? latestSnapshot.val()
                        : null;

                const latestStatus =
                    normalizeStatus(
                        latest?.status
                    );


                console.log(
                    "[MPESA CLAIM] LATEST FIREBASE STATE:",
                    JSON.stringify(
                        {
                            withdrawalId,

                            exists:
                                latestSnapshot.exists(),

                            latestStatus,

                            rawStatus:
                                latest?.status ||
                                "",

                            paymentStatus:
                                latest?.paymentStatus ||
                                "",

                            paymentAttemptCount:
                                latest?.paymentAttemptCount ||
                                0
                        },
                        null,
                        2
                    )
                );


                let message =
                    "Withdrawal payment claim could not be completed. No payment was sent.";


                if (
                    latestStatus ===
                    "PROCESSING"
                ) {

                    message =
                        "This withdrawal is already being processed.";
                }
                else if (
                    latestStatus ===
                    "PAID"
                ) {

                    message =
                        "This withdrawal has already been paid.";
                }
                else if (
                    latestStatus ===
                    "RECONCILIATION_REQUIRED"
                ) {

                    message =
                        "This withdrawal requires reconciliation before another payment attempt.";
                }


                return res.status(409).json({

                    success: false,

                    message,

                    status:
                        latest?.status || ""
                });
            }


            /*
            ==========================================
            CLAIM SUCCESSFUL
            ==========================================
            */

            console.log(
                "[MPESA CLAIM] PAYMENT CLAIMED:",
                {
                    withdrawalId,

                    previousStatus:
                        initialStatus
                }
            );


            /*
            ==========================================
            RELOAD AFTER CLAIM
            ==========================================
            */

            const claimedMpesaSnapshot =
                await withdrawalRef.get();

            if (
                !claimedMpesaSnapshot.exists()
            ) {

                throw new Error(
                    "Withdrawal disappeared after M-Pesa payment claim."
                );
            }


            const claimedWithdrawal =
                claimedMpesaSnapshot.val();


            console.log(
                "[MPESA] CLAIMED WITHDRAWAL READY FOR B2C:",
                {
                    withdrawalId,

                    status:
                        claimedWithdrawal.status,

                    paymentStatus:
                        claimedWithdrawal.paymentStatus,

                    paymentAttemptCount:
                        claimedWithdrawal.paymentAttemptCount ||
                        0
                }
            );


            /*
            ==========================================
            SUBMIT M-PESA B2C
            ==========================================
            */

            let payment;


            try {

                console.log(
                    "[MPESA] CALLING MpesaB2CManager.sendMoney:",
                    {
                        withdrawalId
                    }
                );


                payment =
                    await MpesaB2CManager
                        .sendMoney(
                            claimedWithdrawal
                        );


                console.log(
                    "[MPESA] B2C MANAGER RESPONSE:",
                    JSON.stringify(
                        {
                            withdrawalId,

                            success:
                                payment?.success,

                            status:
                                payment?.status ||
                                "",

                            paymentStatus:
                                payment?.paymentStatus ||
                                "",

                            conversationId:
                                payment?.conversationId ||
                                "",

                            originatorConversationId:
                                payment?.originatorConversationId ||
                                "",

                            confirmedFailure:
                                payment?.confirmedFailure ===
                                true,

                            unknownOutcome:
                                payment?.unknownOutcome ===
                                true,

                            reconciliationRequired:
                                payment?.reconciliationRequired ===
                                true
                        },
                        null,
                        2
                    )
                );

            }
            catch (mpesaError) {

                console.error(
                    "[MPESA SEND ERROR]",
                    {
                        withdrawalId,

                        message:
                            getSafeErrorMessage(
                                mpesaError
                            ),

                        code:
                            mpesaError?.code ||
                            "",

                        httpStatus:
                            mpesaError?.response?.status ||
                            "",

                        unknownOutcome:
                            mpesaError?.unknownOutcome ===
                            true,

                        reconciliationRequired:
                            mpesaError?.reconciliationRequired ===
                            true,

                        confirmedFailure:
                            mpesaError?.confirmedFailure ===
                            true
                    }
                );


                /*
                ======================================
                CONFIRMED FAILURE
                ======================================

                Only trust this if the manager explicitly
                confirms that the payment could not have
                been submitted successfully.
                */

                const confirmedFailure =
                    mpesaError?.confirmedFailure ===
                    true;


                const unknownOutcome =
                    mpesaError?.unknownOutcome ===
                        true ||
                    mpesaError?.reconciliationRequired ===
                        true;


                if (
                    confirmedFailure &&
                    !unknownOutcome
                ) {

                    await withdrawalManager
                        .markPaymentFailed(
                            withdrawalId,

                            getSafeErrorMessage(
                                mpesaError
                            )
                        );

                    await withdrawalRef.update({

                        status:
                            "payment_failed",

                        paymentStatus:
                            "FAILED",

                        paymentFailureReason:
                            getSafeErrorMessage(
                                mpesaError
                            ),

                        reconciliationRequired:
                            false,

                        reconciliationAt:
                            null,

                        updatedAt:
                            Date.now()
                    });


                    return res.status(400).json({

                        success: false,

                        paymentFailed:
                            true,

                        processing:
                            false,

                        reconciliationRequired:
                            false,

                        message:
                            "M-Pesa payment failed. The withdrawal was marked payment_failed and wallet funds were restored.",

                        withdrawalId
                    });
                }


                /*
                ======================================
                UNKNOWN OUTCOME
                ======================================

                Any unclassified exception after the atomic
                claim is treated as uncertain.

                We must NOT restore funds because the B2C
                provider may have received the request.
                */

                await withdrawalRef.update({

                    status:
                        "reconciliation_required",

                    paymentStatus:
                        "RECONCILIATION_REQUIRED",

                    paymentFailureReason:
                        getSafeErrorMessage(
                            mpesaError
                        ),

                    reconciliationRequired:
                        true,

                    reconciliationAt:
                        Date.now(),

                    updatedAt:
                        Date.now()
                });


                return res.status(202).json({

                    success: false,

                    paymentFailed:
                        false,

                    processing:
                        false,

                    reconciliationRequired:
                        true,

                    message:
                        "M-Pesa payout outcome is uncertain. The withdrawal has been placed into reconciliation.",

                    withdrawalId
                });
            }


            /*
            ==========================================
            M-PESA PROVIDER RESULT
            ==========================================
            */

            if (
                !payment ||
                !payment.success
            ) {

                /*
                ======================================
                UNKNOWN PAYMENT RESULT
                ======================================
                */

                if (
                    isUnknownPaymentResult(
                        payment
                    )
                ) {

                    await withdrawalRef.update({

                        status:
                            "reconciliation_required",

                        paymentStatus:
                            "RECONCILIATION_REQUIRED",

                        paymentFailureReason:
                            payment?.message ||
                            "M-Pesa payment outcome is uncertain.",

                        reconciliationRequired:
                            true,

                        reconciliationAt:
                            Date.now(),

                        updatedAt:
                            Date.now()
                    });


                    return res.status(202).json({

                        success: false,

                        paymentFailed:
                            false,

                        processing:
                            false,

                        reconciliationRequired:
                            true,

                        message:
                            "M-Pesa payment outcome is uncertain. The withdrawal has been placed into reconciliation.",

                        withdrawalId
                    });
                }


                /*
                ======================================
                CONFIRMED M-PESA FAILURE
                ======================================
                */

                const mpesaStatus =
                    normalizeStatus(
                        payment?.status ||
                        payment?.paymentStatus ||
                        payment?.resultStatus
                    );


                const confirmedMpesaFailure =
                    mpesaStatus === "FAILED" ||
                    mpesaStatus === "FAILURE" ||
                    mpesaStatus === "REJECTED" ||
                    payment?.confirmedFailure ===
                    true;


                if (
                    !confirmedMpesaFailure
                ) {

                    await withdrawalRef.update({

                        status:
                            "reconciliation_required",

                        paymentStatus:
                            "RECONCILIATION_REQUIRED",

                        paymentFailureReason:
                            payment?.message ||
                            "M-Pesa returned an unsuccessful response without a definitive failure state.",

                        reconciliationRequired:
                            true,

                        reconciliationAt:
                            Date.now(),

                        updatedAt:
                            Date.now()
                    });


                    return res.status(202).json({

                        success: false,

                        paymentFailed:
                            false,

                        processing:
                            false,

                        reconciliationRequired:
                            true,

                        message:
                            "M-Pesa returned an unresolved payment result. The withdrawal remains reserved for reconciliation.",

                        withdrawalId
                    });
                }


                /*
                ======================================
                CONFIRMED FAILURE
                ======================================
                */

                await withdrawalManager
                    .markPaymentFailed(
                        withdrawalId,

                        payment?.message ||
                        "M-Pesa payment failed."
                    );


                await withdrawalRef.update({

                    status:
                        "payment_failed",

                    paymentStatus:
                        "FAILED",

                    paymentFailureReason:
                        payment?.message ||
                        "M-Pesa payment failed.",

                    reconciliationRequired:
                        false,

                    reconciliationAt:
                        null,

                    updatedAt:
                        Date.now()
                });


                console.log(
                    "[MPESA] WITHDRAWAL MARKED PAYMENT_FAILED:",
                    {
                        withdrawalId,

                        status:
                            mpesaStatus,

                        reason:
                            payment?.message ||
                            "M-Pesa payment failed."
                    }
                );


                return res.status(400).json({

                    success: false,

                    paymentFailed:
                        true,

                    processing:
                        false,

                    reconciliationRequired:
                        false,

                    message:
                        payment?.message ||
                        "M-Pesa payment failed.",

                    withdrawalId,

                    payment
                });
            }


            /*
            ==========================================
            M-PESA ACCEPTED / PROCESSING
            ==========================================

            IMPORTANT:

            A successful B2C submission does NOT necessarily
            mean the beneficiary has received the money.

            Keep the withdrawal PROCESSING until the M-Pesa
            result callback/reconciliation confirms the final
            outcome.
            ==========================================
            */

            await withdrawalRef.update({

                status:
                    "processing",

                paymentStatus:
                    "PROCESSING",

                conversationId:
                    payment.conversationId ||
                    claimedWithdrawal.conversationId ||
                    "",

                originatorConversationId:
                    payment.originatorConversationId ||
                    claimedWithdrawal.originatorConversationId ||
                    "",

                paymentReference:
                    payment.conversationId ||
                    payment.originatorConversationId ||
                    claimedWithdrawal.paymentReference ||
                    "",

                paymentFailureReason:
                    "",

                reconciliationRequired:
                    false,

                reconciliationAt:
                    null,

                updatedAt:
                    Date.now()
            });


            console.log(
                "[MPESA] B2C SUBMISSION ACCEPTED:",
                {
                    withdrawalId,

                    conversationId:
                        payment.conversationId ||
                        "",

                    originatorConversationId:
                        payment.originatorConversationId ||
                        ""
                }
            );


            return res.json({

                success:
                    true,

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
                },

                withdrawalId
            });
        }
        catch (e) {

            console.error(
                "[WITHDRAWAL PAYMENT ERROR]",
                {
                    withdrawalId,

                    paymentMethod,

                    initialStatus,

                    message:
                        getSafeErrorMessage(
                            e
                        )
                }
            );


            /*
            ==========================================
            PAYPAL SAFETY
            ==========================================
            */

            if (
                paymentMethod ===
                "PAYPAL"
            ) {

                try {

                    const currentSnapshot =
                        await db
                            .ref("withdrawalRequests")
                            .child(withdrawalId)
                            .get();

                    if (
                        currentSnapshot.exists()
                    ) {

                        const current =
                            currentSnapshot.val();

                        const currentStatus =
                            normalizeStatus(
                                current.status
                            );

                        if (
                            currentStatus ===
                            "PROCESSING"
                        ) {

                            await markPayPalReconciliationRequired(
                                withdrawalId,

                                getSafeErrorMessage(
                                    e
                                )
                            );

                            return res.status(202).json({

                                success: false,

                                reconciliationRequired:
                                    true,

                                message:
                                    "PayPal payout outcome is uncertain. The withdrawal has been placed into reconciliation."
                            });
                        }
                    }

                }
                catch (
                    reconciliationError
                ) {

                    console.error(
                        "[PAYPAL RECONCILIATION ERROR]",
                        reconciliationError.message
                    );
                }
            }


            /*
            ==========================================
            M-PESA SAFETY
            ==========================================

            If an unexpected exception happens after the
            M-Pesa claim, do not leave the withdrawal in
            PROCESSING indefinitely.

            Do not restore the wallet here.

            The provider may already have received the
            request.
            ==========================================
            */

            if (
                paymentMethod ===
                "MPESA"
            ) {

                try {

                    const currentSnapshot =
                        await withdrawalRef.get();

                    if (
                        currentSnapshot.exists()
                    ) {

                        const current =
                            currentSnapshot.val();

                        const currentStatus =
                            normalizeStatus(
                                current.status
                            );


                        if (
                            currentStatus ===
                                "PROCESSING"
                        ) {

                            await withdrawalRef.update({

                                status:
                                    "reconciliation_required",

                                paymentStatus:
                                    "RECONCILIATION_REQUIRED",

                                paymentFailureReason:
                                    getSafeErrorMessage(
                                        e
                                    ),

                                reconciliationRequired:
                                    true,

                                reconciliationAt:
                                    Date.now(),

                                updatedAt:
                                    Date.now()
                            });


                            console.warn(
                                "[MPESA] UNEXPECTED ERROR - MOVED TO RECONCILIATION:",
                                {
                                    withdrawalId
                                }
                            );


                            return res.status(202).json({

                                success:
                                    false,

                                paymentFailed:
                                    false,

                                processing:
                                    false,

                                reconciliationRequired:
                                    true,

                                message:
                                    "M-Pesa payout outcome is uncertain. The withdrawal has been placed into reconciliation.",

                                withdrawalId
                            });
                        }
                    }

                }
                catch (
                    reconciliationError
                ) {

                    console.error(
                        "[MPESA RECONCILIATION ERROR]",
                        {
                            withdrawalId,

                            message:
                                getSafeErrorMessage(
                                    reconciliationError
                                )
                        }
                    );
                }
            }


            return res.status(500).json({

                success: false,

                message:
                    "Payment processing failed."
            });
        }
    }
);


/*
====================================================
MARK WITHDRAWAL AS PAID
====================================================

PayPal:

The specific payout item MUST be SUCCESS.

Batch SUCCESS alone is insufficient.

A reconciliation_required withdrawal cannot be
manually converted to paid through this endpoint.
====================================================
*/

router.post(
    "/paid",
    async (req, res) => {

        try {

            const withdrawalId =
                String(
                    req.body.withdrawalId || ""
                ).trim();

            if (!withdrawalId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "withdrawalId is required."
                });
            }


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

            const currentStatus =
                normalizeStatus(
                    withdrawal.status
                );

            /*
                Reconciliation requires an explicit
                reconciliation workflow.

                Do not use /paid as a bypass.
            */

            if (
                currentStatus ===
                "RECONCILIATION_REQUIRED"
            ) {

                return res.status(409).json({

                    success: false,

                    reconciliationRequired:
                        true,

                    message:
                        "This withdrawal is in reconciliation and cannot be manually marked paid until the reconciliation is completed."
                });
            }


            const method =
                normalizePaymentMethod(
                    withdrawal.paymentMethod
                );


            /*
            ==========================================
            PAYPAL VERIFICATION
            ==========================================
            */

            if (
                method ===
                "PAYPAL"
            ) {

                const transactionStatus =
                    normalizeStatus(
                        withdrawal.paypalTransactionStatus
                    );

                if (
                    transactionStatus !==
                    "SUCCESS"
                ) {

                    return res.status(400).json({

                        success: false,

                        message:
                            "A PayPal withdrawal cannot be manually marked paid until the specific PayPal payout item confirms SUCCESS.",

                        paypalBatchStatus:
                            withdrawal.paypalBatchStatus ||
                            "",

                        paypalTransactionStatus:
                            withdrawal.paypalTransactionStatus ||
                            ""
                    });
                }
            }


            const result =
                await withdrawalManager
                    .markAsPaid(
                        withdrawalId,

                        req.body.mpesaReceipt ||
                        withdrawal.mpesaReceipt ||
                        "",

                        req.body.providerReference ||
                        withdrawal.paymentReference ||
                        ""
                    );


            /*
                Clear stale failure/reconciliation state.
            */

            if (
                result &&
                (
                    result.status ===
                    "paid" ||

                    result.success ===
                    true
                )
            ) {

                await db
                    .ref("withdrawalRequests")
                    .child(withdrawalId)
                    .update({

                        status:
                            "paid",

                        paymentStatus:
                            "SUCCESS",

                        paymentFailureReason:
                            "",

                        reconciliationRequired:
                            false,

                        reconciliationAt:
                            null,

                        updatedAt:
                            Date.now()
                    });
            }

            return res.json(
                result
            );

        }
        catch (e) {

            console.error(
                "[MARK WITHDRAWAL PAID ERROR]",
                e.message
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
UPDATE PAYPAL RECEIVER
====================================================

ONLY permitted for:

    payment_failed

NOT permitted for:

    reconciliation_required
    processing
    paid

Changing the receiver creates a NEW payout
attempt identity.
====================================================
*/

router.patch(
    "/:withdrawalId/paypal-receiver",
    async (req, res) => {

        try {

            const withdrawalId =
                String(
                    req.params.withdrawalId || ""
                ).trim();

            const normalizedEmail =
                String(
                    req.body.paypalEmail || ""
                )
                    .trim()
                    .toLowerCase();

            if (!normalizedEmail) {

                return res.status(400).json({

                    success: false,

                    error:
                        "paypalEmail is required."
                });
            }


            /*
                Correct PayPal email validation.
            */

            const emailValid =
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/
                    .test(
                        normalizedEmail
                    );

            if (!emailValid) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Invalid PayPal email address."
                });
            }


            const withdrawalRef =
                db
                    .ref("withdrawalRequests")
                    .child(withdrawalId);

            const snapshot =
                await withdrawalRef.get();

            if (!snapshot.exists()) {

                return res.status(404).json({

                    success: false,

                    error:
                        "Withdrawal not found."
                });
            }

            const withdrawal =
                snapshot.val();


            /*
            ==========================================
            ONLY CONFIRMED FAILURE CAN CHANGE RECEIVER
            ==========================================
            */

            if (
                normalizeStatus(
                    withdrawal.status
                ) !==
                "PAYMENT_FAILED"
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        `Withdrawal must be payment_failed. Current status: ${withdrawal.status}`
                });
            }


            if (
                normalizePaymentMethod(
                    withdrawal.paymentMethod
                ) !==
                "PAYPAL"
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Withdrawal is not a PayPal withdrawal."
                });
            }


            if (
                typeof PayPalPayoutManager
                    .createNewSenderBatchId !==
                "function"
            ) {

                return res.status(500).json({

                    success: false,

                    error:
                        "PayPal retry identity generator is not available."
                });
            }


            /*
            ==========================================
            CREATE NEW PAYPAL ATTEMPT
            ==========================================
            */

            const newSenderBatchId =
                await PayPalPayoutManager
                    .createNewSenderBatchId(
                        {
                            ...withdrawal,

                            paypalEmail:
                                normalizedEmail
                        }
                    );

            if (!newSenderBatchId) {

                return res.status(500).json({

                    success: false,

                    error:
                        "Failed to create a new PayPal payout identity."
                });
            }


            const currentAttemptNumber =
                Number(
                    withdrawal.paypalAttemptNumber ||
                    0
                );

            const newAttemptNumber =
                currentAttemptNumber + 1;

            const now =
                Date.now();


            await withdrawalRef.update({

                paypalEmail:
                    normalizedEmail,

                paypalBatchId:
                    "",

                paypalSenderBatchId:
                    newSenderBatchId,

                paypalAttemptNumber:
                    newAttemptNumber,

                paypalItemId:
                    "",

                paypalTransactionId:
                    "",

                paypalBatchStatus:
                    "",

                paypalTransactionStatus:
                    "",

                paymentReference:
                    "",

                paymentStatus:
                    "NOT_SENT",

                paymentFailureReason:
                    "",

                reconciliationRequired:
                    false,

                reconciliationAt:
                    null,

                receiverUpdatedAt:
                    now,

                updatedAt:
                    now
            });


            console.log(
                "[PAYPAL RECEIVER UPDATED]:",
                {
                    withdrawalId,

                    paypalEmail:
                        normalizedEmail,

                    paypalSenderBatchId:
                        newSenderBatchId,

                    paypalAttemptNumber:
                        newAttemptNumber
                }
            );


            return res.json({

                success: true,

                withdrawalId,

                paypalSenderBatchId:
                    newSenderBatchId,

                paypalAttemptNumber:
                    newAttemptNumber,

                message:
                    "PayPal receiver updated successfully. A new PayPal payout identity has been created for the next payment attempt."
            });

        }
        catch (error) {

            console.error(
                "[UPDATE PAYPAL RECEIVER ERROR]",
                {
                    message:
                        getSafeErrorMessage(
                            error
                        )
                }
            );

            return res.status(500).json({

                success: false,

                error:
                    "Failed to update PayPal receiver."
            });
        }
    }
);


module.exports = router;
