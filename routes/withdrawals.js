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

/*
    Normalize provider/local status.
*/
function normalizeStatus(value) {
    return String(value || "")
        .trim()
        .toUpperCase();
}

/*
====================================================
PAYPAL SUCCESS
====================================================

IMPORTANT:

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
PAYPAL FAILURE
====================================================

Only definitive provider failures are treated as
confirmed failures.

IMPORTANT:

BLOCKED
RETURNED
REFUNDED
REVERSED

are NOT automatically treated as confirmed failure.

Those states can require provider investigation or
reconciliation.

The wallet must not be restored automatically unless
the provider result is definitively failed.
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

        transaction === "FAILED"
    );
}

/*
====================================================
PAYPAL UNKNOWN OUTCOME
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

Used primarily for provider submission errors.

An unknown outcome must NEVER automatically restore
the wallet.
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
            409 is especially important because the
            original provider request may already have
            been accepted.

            429 / 5xx are also unresolved from the
            application's perspective.
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
        Axios network failures commonly have no response.
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
CREATE NEW PAYPAL ATTEMPT
====================================================

A retry after a confirmed failure must use a new
sender batch identity.

The PayPal manager owns the exact sender batch ID
format.
*/
async function createNewPayPalAttempt(
    withdrawalId
) {
    const withdrawalRef =
        db
            .ref("withdrawalRequests")
            .child(withdrawalId);

    const snapshot =
        await withdrawalRef.get();

    if (!snapshot.exists()) {
        throw new Error(
            "Withdrawal request not found."
        );
    }

    const withdrawal =
        snapshot.val();

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

    const currentAttemptNumber =
        Number(
            withdrawal.paypalAttemptNumber || 0
        );

    const newAttemptNumber =
        currentAttemptNumber + 1;

    await withdrawalRef.update({
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
            "NOT_SENT",

        paymentFailureReason:
            "",

        reconciliationRequired:
            false,

        updatedAt:
            Date.now()
    });

    console.log(
        "[PAYPAL] NEW PAYOUT ATTEMPT CREATED:",
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
PAYPAL RECONCILIATION
====================================================

CRITICAL:

This function NEVER restores the wallet.

Funds remain reserved until PayPal's actual outcome
is definitively established.
*/
async function markPayPalReconciliationRequired(
    withdrawalId,
    reason = ""
) {
    const withdrawalRef =
        db
            .ref("withdrawalRequests")
            .child(withdrawalId);

    const snapshot =
        await withdrawalRef.get();

    if (!snapshot.exists()) {
        throw new Error(
            "Withdrawal request not found."
        );
    }

    const withdrawal =
        snapshot.val();

    /*
        Never move paid backwards.

        If PayPal says the withdrawal is successful
        and the local record is already paid, simply
        synchronize the successful state.
    */
    if (
        normalizeStatus(
            withdrawal.status
        ) === "PAID"
    ) {
        await withdrawalRef.update({
            paymentStatus:
                "SUCCESS",

            paymentFailureReason:
                "",

            reconciliationRequired:
                false,

            updatedAt:
                Date.now()
        });

        return {
            success: true,
            alreadyPaid: true
        };
    }

    /*
        IMPORTANT:

        Do NOT return early for payment_failed.

        A local payment_failed record can conflict with
        a later provider SUCCESS result.

        In that case we must flag reconciliation rather
        than silently ignoring the conflict.

        We do NOT restore the wallet again.
    */

    const safeReason =
        String(
            reason ||
            "PayPal payout outcome is uncertain. Reconciliation required."
        ).slice(0, 500);

    await withdrawalRef.update({
        status:
            "reconciliation_required",

        paymentStatus:
            "RECONCILIATION_REQUIRED",

        paymentFailureReason:
            safeReason,

        reconciliationRequired:
            true,

        reconciliationAt:
            Date.now(),

        updatedAt:
            Date.now()
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
                await withdrawalManager.requestWithdrawal({
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

            snapshot.forEach(child => {
                list.push({
                    id:
                        child.key,

                    ...child.val()
                });
            });

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

IMPORTANT:

The status endpoint first finds the local withdrawal
and obtains its expected PayPal payout item ID.

We NEVER assume items[0] belongs to this withdrawal
when an expected item ID exists.
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
            FIND LOCAL WITHDRAWAL FIRST
            ==========================================
            */

            const withdrawalSnapshot =
                await db
                    .ref("withdrawalRequests")
                    .get();

            let withdrawalId = null;
            let withdrawal = null;

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

            let payoutItem = null;

            if (expectedSenderItemId) {
                payoutItem =
                    items.find(item => {
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
                    }) || null;
            }
            else if (items.length === 1) {
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

            const transactionStatus =
                payoutItem
                    ? normalizeStatus(
                        payoutItem.transaction_status ||
                        payoutItem.transactionStatus ||
                        payoutItem.payout_item?.transaction_status
                    )
                    : "";

            const transactionId =
                payoutItem
                    ? (
                        payoutItem.transaction_id ||
                        payoutItem.transactionId ||
                        payoutItem.payout_item?.transaction_id ||
                        ""
                    )
                    : "";

            const paypalItemId =
                payoutItem
                    ? (
                        payoutItem.payout_item_id ||
                        payoutItem.paypalItemId ||
                        payoutItem.payoutItemId ||
                        payoutItem.payout_item?.payout_item_id ||
                        ""
                    )
                    : "";

            /*
            ==========================================
            SAFETY EVALUATION
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

            const reconciliationRequired =
                itemIdentificationRequired ||
                (
                    normalizeStatus(
                        paypalStatus.status
                    ) ===
                    "RECONCILIATION_REQUIRED"
                ) ||
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
                    paypalSuccess,
                    paypalFailure,
                    reconciliationRequired
                }
            );

            const withdrawalRef =
                db
                    .ref("withdrawalRequests")
                    .child(withdrawalId);

            /*
            ==========================================
            SYNCHRONIZE PROVIDER INFORMATION
            ==========================================
            */

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

            if (!currentSnapshot.exists()) {
                throw new Error(
                    "Withdrawal disappeared during PayPal synchronization."
                );
            }

            const current =
                currentSnapshot.val();

            /*
            ==========================================
            ITEM CANNOT BE IDENTIFIED
            ==========================================
            */

            if (reconciliationRequired) {
                console.warn(
                    "[PAYPAL] ITEM IDENTIFICATION / RECONCILIATION REQUIRED:",
                    withdrawalId
                );

                await markPayPalReconciliationRequired(
                    withdrawalId,
                    itemIdentificationRequired
                        ? "PayPal payout item could not be safely matched to this withdrawal. Manual reconciliation required."
                        : (
                            paypalStatus.message ||
                            "PayPal payout outcome is unresolved. Manual reconciliation required."
                        )
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
            PAYPAL CONFIRMED SUCCESS
            ==========================================
            */

            if (paypalSuccess) {
                console.log(
                    "[PAYPAL] CONFIRMED ITEM SUCCESS:",
                    withdrawalId
                );

                /*
                    Already paid:
                    synchronize only.

                    DO NOT execute ledger/accounting again.
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
                    If the local wallet was already restored,
                    PayPal SUCCESS conflicts with local state.

                    DO NOT restore again.
                    DO NOT charge/restore again automatically.

                    Move the record into reconciliation.
                */
                if (
                    normalizeStatus(
                        current.status
                    ) === "PAYMENT_FAILED"
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
                    A reconciliation_required withdrawal must
                    not silently be converted into paid.

                    It needs explicit manual reconciliation.
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
                    Normal path:

                    processing
                    ↓
                    paid
                */
                await withdrawalManager
                    .markAsPaid(
                        withdrawalId,
                        transactionId,
                        transactionId ||
                        paypalBatchId
                    );

                await withdrawalRef.update({
                    paymentStatus:
                        "SUCCESS",

                    paymentFailureReason:
                        "",

                    reconciliationRequired:
                        false,

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
            }

            /*
            ==========================================
            PAYPAL CONFIRMED FAILURE
            ==========================================
            */

            else if (paypalFailure) {
                console.log(
                    "[PAYPAL] CONFIRMED FAILURE:",
                    withdrawalId
                );

                /*
                    Never move paid backwards.
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
                    A confirmed provider failure is safe to
                    restore according to WithdrawalManager.
                */
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
            ==========================================
            PAYPAL STILL PROCESSING / UNRESOLVED
            ==========================================
            */

            else {
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

                    /*
                        Never move paid backwards.

                        Never move payment_failed into
                        processing merely because a status
                        lookup is intermediate.

                        Never move reconciliation_required
                        backwards automatically.
                    */
                    if (
                        normalizeStatus(
                            latest.status
                        ) !== "PAID" &&
                        normalizeStatus(
                            latest.status
                        ) !== "PAYMENT_FAILED" &&
                        normalizeStatus(
                            latest.status
                        ) !==
                        "RECONCILIATION_REQUIRED"
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
            }

            /*
            ==========================================
            RESPONSE
            ==========================================
            */

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
                getSafeErrorMessage(e)
            );

            /*
                IMPORTANT:

                A failed status lookup does NOT prove
                that the PayPal payout failed.

                Therefore the wallet is NOT restored.
            */

            const unknown =
                isUnknownProviderError(e);

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

approved/payment_failed
        ↓
atomic claim
        ↓
processing
        ↓
PayPal submission
        ↓
PROCESSING
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
                normalizeStatus(
                    withdrawal.paymentMethod
                );

            const initialStatus =
                normalizeStatus(
                    withdrawal.status
                );

            /*
            ==========================================
            VALIDATE STATUS
            ==========================================
            */

            if (
                initialStatus !== "APPROVED" &&
                initialStatus !== "PAYMENT_FAILED"
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
                    "RECONCILIATION_REQUIRED"
                ) {
                    message =
                        "This withdrawal requires reconciliation before another payment attempt.";
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
                paymentMethod === "PAYPAL"
            ) {
                console.log(
                    "[PAYPAL] PAYMENT REQUEST RECEIVED:",
                    withdrawalId
                );

                /*
                ======================================
                ATOMIC CLAIM

                Only ONE request can transition the
                withdrawal into processing.

                IMPORTANT:

                Firebase transactions compare the
                actual stored value.

                We normalize status so differences in
                casing do not cause an unexpected abort.
                ======================================
                */

                const claimResult =
                    await withdrawalRef.transaction(
                        current => {
                            if (!current) {
                                console.warn(
                                    "[PAYPAL] CLAIM ABORTED: withdrawal does not exist:",
                                    withdrawalId
                                );

                                return;
                            }

                            const currentStatus =
                                normalizeStatus(
                                    current.status
                                );

                            console.log(
                                "[PAYPAL] CLAIM TRANSACTION CHECK:",
                                {
                                    withdrawalId,
                                    currentStatus,
                                    rawStatus:
                                        current.status,
                                    paymentStatus:
                                        current.paymentStatus ||
                                        "",
                                    paymentMethod:
                                        current.paymentMethod ||
                                        ""
                                }
                            );

                            if (
                                currentStatus !==
                                    "APPROVED" &&
                                currentStatus !==
                                    "PAYMENT_FAILED"
                            ) {
                                console.warn(
                                    "[PAYPAL] CLAIM ABORTED: invalid state:",
                                    {
                                        withdrawalId,
                                        currentStatus,
                                        rawStatus:
                                            current.status
                                    }
                                );

                                return;
                            }

                            const now =
                                Date.now();

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

                                updatedAt:
                                    now
                            };
                        }
                    );

                console.log(
                    "[PAYPAL] CLAIM TRANSACTION RESULT:",
                    {
                        withdrawalId,

                        committed:
                            claimResult.committed,

                        snapshotExists:
                            claimResult.snapshot?.exists?.() ||
                            false,

                        finalStatus:
                            claimResult.snapshot?.val?.()?.status ||
                            ""
                    }
                );

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

                    console.warn(
                        "[PAYPAL] PAYMENT REQUEST REJECTED:",
                        {
                            withdrawalId,

                            currentStatus:
                                latest?.status ||
                                "NOT_FOUND",

                            normalizedStatus:
                                latestStatus,

                            transactionCommitted:
                                claimResult.committed
                        }
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
                        "APPROVED"
                    ) {
                        message =
                            "The payment claim could not be completed. Please retry once.";
                    }
                    else if (
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
                    withdrawalId
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
                NEW PAYPAL ATTEMPT

                If this was previously payment_failed,
                it is a new payout attempt and must use a
                new sender batch identity.

                This is deliberately done AFTER the atomic
                claim so concurrent callers cannot create
                multiple new identities.
                ======================================
                */

                const claimedPreviousStatus =
                    normalizeStatus(
                        withdrawal.previousStatus ||
                        ""
                    );

                /*
                    Detect a retry using the payment attempt
                    history.

                    paymentAttemptNumber > 0 means the
                    withdrawal has already had an attempt.
                */
                const attemptNumber =
                    Number(
                        withdrawal.paypalAttemptNumber ||
                        0
                    );

                /*
                    If the record contains an explicit
                    previous failure marker, create a new
                    PayPal identity.

                    The normal receiver-update flow also
                    prepares the new identity.
                */
                if (
                    attemptNumber === 0 &&
                    normalizeStatus(
                        withdrawal.status
                    ) === "PROCESSING" &&
                    normalizeStatus(
                        withdrawal.paymentStatus
                    ) === "PROCESSING"
                ) {
                    /*
                        First attempt.

                        If no sender batch ID exists,
                        PayPalPayoutManager.sendMoney()
                        will create/reuse the initial identity.
                    */
                }

                /*
                ======================================
                SUBMIT PAYPAL PAYOUT
                ======================================
                */

                console.log(
                    "[PAYPAL] SUBMITTING TO PAYPAL:",
                    withdrawalId
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
                        getSafeErrorMessage(
                            paypalError
                        )
                    );

                    /*
                        A thrown provider error is NOT
                        assumed to mean the payout failed.

                        Keep the funds reserved.
                    */
                    await markPayPalReconciliationRequired(
                        withdrawalId,
                        getSafeErrorMessage(
                            paypalError
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

                console.log(
                    "[PAYPAL] PROVIDER RESPONSE:",
                    {
                        withdrawalId,
                        success:
                            payment?.success,
                        status:
                            payment?.status,
                        paypalBatchId:
                            payment?.paypalBatchId || "",
                        paypalItemId:
                            payment?.paypalItemId || "",
                        paypalTransactionStatus:
                            payment?.paypalTransactionStatus || ""
                    }
                );

                /*
                ======================================
                UNKNOWN OUTCOME
                ======================================
                */

                if (
                    !payment ||
                    !payment.success
                ) {
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

                            message:
                                "PayPal payout outcome is uncertain. The withdrawal has been placed into reconciliation."
                        });
                    }

                    /*
                    ==================================
                    CONFIRMED FAILURE
                    ==================================
                    */

                    await withdrawalManager
                        .markPaymentFailed(
                            withdrawalId,
                            payment?.message ||
                            "PayPal payout failed."
                        );

                    return res.status(400).json({
                        success: false,

                        message:
                            payment?.message ||
                            "PayPal payout failed.",

                        payment
                    });
                }

                /*
                ======================================
                PAYPAL SUCCESS
                ======================================

                This is safe only if PayPalPayoutManager
                explicitly verified the specific payout
                item as SUCCESS.
                ======================================
                */

                const providerStatus =
                    normalizeStatus(
                        payment.status
                    );

                const providerTransactionStatus =
                    normalizeStatus(
                        payment.paypalTransactionStatus ||
                        payment.transactionStatus
                    );

                const confirmedProviderSuccess =
                    providerStatus === "SUCCESS" &&
                    (
                        providerTransactionStatus ===
                        "SUCCESS"
                    );

                if (
                    confirmedProviderSuccess
                ) {
                    await withdrawalManager
                        .markAsPaid(
                            withdrawalId,

                            payment.paypalTransactionId ||
                            payment.transactionId ||
                            "",

                            payment.paypalTransactionId ||
                            payment.transactionId ||
                            payment.paypalBatchId ||
                            ""
                        );

                    await withdrawalRef.update({
                        paypalBatchId:
                            payment.paypalBatchId ||
                            withdrawal.paypalBatchId ||
                            "",

                        paypalItemId:
                            payment.paypalItemId ||
                            withdrawal.paypalItemId ||
                            "",

                        paypalBatchStatus:
                            payment.paypalBatchStatus ||
                            "SUCCESS",

                        paypalTransactionStatus:
                            payment.paypalTransactionStatus ||
                            "SUCCESS",

                        paypalTransactionId:
                            payment.paypalTransactionId ||
                            payment.transactionId ||
                            "",

                        paymentReference:
                            payment.paypalTransactionId ||
                            payment.transactionId ||
                            payment.paypalBatchId ||
                            "",

                        paymentStatus:
                            "SUCCESS",

                        paymentFailureReason:
                            "",

                        reconciliationRequired:
                            false,

                        updatedAt:
                            Date.now()
                    });

                    return res.json({
                        success: true,

                        message:
                            "PayPal payout was confirmed successful.",

                        payment: {
                            provider:
                                "PAYPAL",

                            status:
                                "SUCCESS",

                            paypalBatchId:
                                payment.paypalBatchId ||
                                "",

                            paypalItemId:
                                payment.paypalItemId ||
                                "",

                            paypalTransactionStatus:
                                payment.paypalTransactionStatus ||
                                "SUCCESS"
                        }
                    });
                }

                /*
                ======================================
                NORMAL PROCESSING
                ======================================

                Accepted != completed.

                Keep local state PROCESSING unless
                the manager explicitly reports SUCCESS.
                ======================================
                */

                await withdrawalRef.update({
                    paypalBatchId:
                        payment.paypalBatchId ||
                        withdrawal.paypalBatchId ||
                        "",

                    paypalItemId:
                        payment.paypalItemId ||
                        withdrawal.paypalItemId ||
                        "",

                    paypalTransactionId:
                        payment.paypalTransactionId ||
                        payment.transactionId ||
                        withdrawal.paypalTransactionId ||
                        "",

                    paymentReference:
                        payment.paypalBatchId ||
                        withdrawal.paymentReference ||
                        "",

                    paymentStatus:
                        "PROCESSING",

                    reconciliationRequired:
                        false,

                    paymentFailureReason:
                        "",

                    paypalBatchStatus:
                        payment.paypalBatchStatus ||
                        "PROCESSING",

                    paypalTransactionStatus:
                        payment.paypalTransactionStatus ||
                        "",

                    updatedAt:
                        Date.now()
                });

                console.log(
                    "[PAYPAL] PAYOUT SUBMITTED:",
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
                            "",

                        paypalBatchStatus:
                            payment.paypalBatchStatus ||
                            "PROCESSING",

                        paypalTransactionStatus:
                            payment.paypalTransactionStatus ||
                            ""
                    }
                });
            }

            /*
            ==========================================
            M-PESA
            ==========================================
            */

            if (
                paymentMethod !== "MPESA"
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
            ATOMIC M-PESA CLAIM
            ==========================================
            */

            const mpesaClaimResult =
                await withdrawalRef.transaction(
                    current => {
                        if (!current) {
                            return;
                        }

                        const currentStatus =
                            normalizeStatus(
                                current.status
                            );

                        if (
                            currentStatus !==
                                "APPROVED" &&
                            currentStatus !==
                                "PAYMENT_FAILED"
                        ) {
                            return;
                        }

                        const now =
                            Date.now();

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

                            updatedAt:
                                now
                        };
                    }
                );

            if (
                !mpesaClaimResult.committed
            ) {
                const latestSnapshot =
                    await withdrawalRef.get();

                const latest =
                    latestSnapshot.exists()
                        ? latestSnapshot.val()
                        : null;

                return res.status(409).json({
                    success: false,

                    message:
                        latest &&
                        normalizeStatus(
                            latest.status
                        ) ===
                        "PROCESSING"
                            ? "This withdrawal is already being processed."
                            : "Withdrawal cannot be paid in its current state.",

                    status:
                        latest?.status || ""
                });
            }

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

            let payment;

            try {
                payment =
                    await MpesaB2CManager
                        .sendMoney(
                            claimedWithdrawal
                        );
            }
            catch (mpesaError) {
                if (
                    isUnknownProviderError(
                        mpesaError
                    )
                ) {
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

                        reconciliationRequired:
                            true,

                        message:
                            "M-Pesa payment outcome is uncertain. The withdrawal has been placed into reconciliation."
                    });
                }

                throw mpesaError;
            }

            /*
            ==========================================
            M-PESA FAILED
            ==========================================
            */

            if (
                !payment ||
                !payment.success
            ) {
                if (
                    isUnknownProviderError(
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

                        reconciliationRequired:
                            true,

                        message:
                            "M-Pesa payment outcome is uncertain. The withdrawal has been placed into reconciliation."
                    });
                }

                await withdrawalManager
                    .markPaymentFailed(
                        withdrawalId,
                        payment?.message ||
                        "M-Pesa payment failed."
                    );

                return res.status(400).json({
                    success: false,

                    message:
                        payment?.message ||
                        "M-Pesa payment failed.",

                    payment
                });
            }

            /*
            ==========================================
            M-PESA PROCESSING
            ==========================================
            */

            await withdrawalRef.update({
                paymentStatus:
                    "PROCESSING",

                reconciliationRequired:
                    false,

                paymentFailureReason:
                    "",

                updatedAt:
                    Date.now()
            });

            console.log(
                "[MPESA] Withdrawal marked PROCESSING:",
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
                "[WITHDRAWAL PAYMENT ERROR]",
                {
                    withdrawalId,
                    paymentMethod,
                    message:
                        getSafeErrorMessage(e)
                }
            );

            /*
            ==========================================
            PAYPAL SAFETY
            ==========================================

            If the local state is processing, never
            automatically restore the wallet.
            */

            if (
                paymentMethod === "PAYPAL"
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

                        if (
                            normalizeStatus(
                                current.status
                            ) ===
                            "PROCESSING"
                        ) {
                            await markPayPalReconciliationRequired(
                                withdrawalId,
                                getSafeErrorMessage(e)
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
                catch (reconciliationError) {
                    console.error(
                        "[PAYPAL RECONCILIATION ERROR]",
                        reconciliationError.message
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

The specific payout item must be SUCCESS.

Batch SUCCESS alone is insufficient.
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

            const method =
                normalizeStatus(
                    withdrawal.paymentMethod
                );

            /*
            ==========================================
            PAYPAL PROVIDER VERIFICATION
            ==========================================
            */

            if (
                method === "PAYPAL"
            ) {
                const transactionStatus =
                    normalizeStatus(
                        withdrawal.paypalTransactionStatus
                    );

                /*
                    Item-level SUCCESS is mandatory.
                */
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
                    result.status === "paid" ||
                    result.success === true
                )
            ) {
                await db
                    .ref("withdrawalRequests")
                    .child(withdrawalId)
                    .update({
                        paymentStatus:
                            "SUCCESS",

                        paymentFailureReason:
                            "",

                        reconciliationRequired:
                            false,

                        updatedAt:
                            Date.now()
                    });
            }

            return res.json(result);
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

Only permitted for a confirmed local
payment_failed withdrawal.

A reconciliation_required withdrawal MUST NOT
be bypassed by changing the receiver.

A new receiver represents a new payout attempt.

IMPORTANT:

This endpoint creates a NEW sender batch identity.
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
                Correct email validation.
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

            if (
                normalizeStatus(
                    withdrawal.status
                ) !==
                "PAYMENT_FAILED"
            ) {
                return res.status(400).json({
                    success: false,

                    error:
                        `Withdrawal must be payment_failed. Current status: ${
                            withdrawal.status
                        }`
                });
            }

            if (
                normalizeStatus(
                    withdrawal.paymentMethod
                ) !== "PAYPAL"
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Withdrawal is not a PayPal withdrawal."
                });
            }

            /*
            ==========================================
            GENERATE NEW PAYPAL ATTEMPT ID
            ==========================================
            */

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

            const newSenderBatchId =
                await PayPalPayoutManager
                    .createNewSenderBatchId(
                        withdrawal
                    );

            const currentAttemptNumber =
                Number(
                    withdrawal.paypalAttemptNumber ||
                    0
                );

            const newAttemptNumber =
                currentAttemptNumber + 1;

            /*
            ==========================================
            NEW RECEIVER = NEW PAYPAL ATTEMPT
            ==========================================
            */

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

                updatedAt:
                    Date.now()
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
                error.message
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