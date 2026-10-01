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
    Normalize a provider status.
*/
function normalizeStatus(value) {
    return String(value || "")
        .trim()
        .toUpperCase();
}

/*
    PayPal statuses representing confirmed success.
*/
function isPayPalSuccess(
    batchStatus,
    transactionStatus
) {
    const batch =
        normalizeStatus(batchStatus);

    const transaction =
        normalizeStatus(transactionStatus);

    return (
        batch === "SUCCESS" ||
        batch === "COMPLETED" ||
        transaction === "SUCCESS" ||
        transaction === "COMPLETED"
    );
}

/*
    PayPal statuses representing confirmed failure.

    IMPORTANT:
    TIMEOUT / NETWORK / UNKNOWN are deliberately
    NOT included here.
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
        transaction === "BLOCKED" ||
        transaction === "RETURNED" ||
        transaction === "REFUNDED"
    );
}

/*
    Determine whether a PayPal result represents an
    unknown provider outcome.
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
    Determine whether an error should be treated as an
    unknown provider outcome.

    This is especially important for:

    - timeout
    - ECONNRESET
    - socket hang up
    - 429
    - 5xx
    - connection failures

    We must NEVER refund the wallet merely because our
    server failed to receive PayPal's response.
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
            error.code ||
            ""
        ).toUpperCase();

    if (
        code === "ETIMEDOUT" ||
        code === "ECONNRESET" ||
        code === "ECONNABORTED" ||
        code === "ERR_NETWORK"
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
            These responses can mean PayPal did not give
            us a definitive outcome.

            409 is particularly important because the
            request may already have been accepted and the
            request ID reused.
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
        Axios network errors commonly have no response.
    */
    if (!error.response) {
        return true;
    }

    const message =
        String(
            error.message ||
            ""
        ).toLowerCase();

    return (
        message.includes("timeout") ||
        message.includes("timed out") ||
        message.includes("socket hang up") ||
        message.includes("connection reset") ||
        message.includes("network error")
    );
}

/*
    Safely extract an error message without exposing
    secrets or an entire provider response.
*/
function getSafeErrorMessage(error) {
    if (!error) {
        return "Unknown payment error.";
    }

    if (error.safeMessage) {
        return String(error.safeMessage);
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
PAYPAL RECONCILIATION
====================================================
*/

/*
    Move a PayPal withdrawal into reconciliation_required.

    IMPORTANT:
    This function NEVER restores the wallet.

    Funds remain reserved until the provider outcome is
    definitively established.
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
        Never move a paid withdrawal backwards.
    */
    if (
        withdrawal.status === "paid"
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
        A previously confirmed failed withdrawal is
        allowed to remain failed.

        We do not turn an already-restored withdrawal
        into a reconciliation record unless it is
        currently processing.
    */
    if (
        withdrawal.status === "payment_failed" &&
        withdrawal.reconciliationRequired !== true
    ) {
        return {
            success: true,
            alreadyFailed: true
        };
    }

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
        withdrawalId
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

Flow:

PayPal SUCCESS
        ↓
PAID

PayPal CONFIRMED FAILURE
        ↓
PAYMENT_FAILED
        ↓
wallet restored

PayPal PROCESSING
        ↓
PROCESSING

PayPal UNKNOWN
        ↓
RECONCILIATION_REQUIRED
        ↓
funds remain reserved

IMPORTANT:

An already-paid withdrawal is NEVER moved backwards.
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
            console.log(
                "[PAYPAL STATUS] Checking:",
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

            /*
            ==========================================
            NORMALIZE RESPONSE
            ==========================================
            */

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

            const firstItem =
                items.length > 0
                    ? items[0]
                    : null;

            const transactionStatus =
                firstItem
                    ? normalizeStatus(
                        firstItem.transaction_status ||
                        firstItem.transactionStatus
                    )
                    : "";

            const transactionId =
                firstItem
                    ? (
                        firstItem.transaction_id ||
                        firstItem.transactionId ||
                        ""
                    )
                    : "";

            const paypalItemId =
                firstItem
                    ? (
                        firstItem.payout_item_id ||
                        firstItem.paypalItemId ||
                        firstItem.payoutItemId ||
                        ""
                    )
                    : "";

            const paypalSuccess =
                isPayPalSuccess(
                    batchStatus,
                    transactionStatus
                );

            const paypalFailure =
                isPayPalFailure(
                    batchStatus,
                    transactionStatus
                );

            console.log(
                "[PAYPAL STATUS RESULT]",
                {
                    paypalBatchId,
                    batchStatus,
                    transactionStatus,
                    transactionId,
                    paypalItemId
                }
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

            /*
            ==========================================
            NO LOCAL WITHDRAWAL
            ==========================================
            */

            if (!withdrawalId) {
                return res.status(404).json({
                    success: false,

                    message:
                        "PayPal payout was found, but no matching local withdrawal was found.",

                    data: {
                        paypalBatchId,
                        batchStatus,
                        transactionStatus,
                        transactionId,
                        paypalItemId
                    }
                });
            }

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
            PAYPAL SUCCESS
            ==========================================
            */

            if (paypalSuccess) {
                console.log(
                    "[PAYPAL] CONFIRMED SUCCESS:",
                    withdrawalId
                );

                /*
                    If already paid, ONLY synchronize the
                    provider fields.

                    DO NOT execute ledger/accounting again.
                */
                if (
                    current.status === "paid"
                ) {
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
                            "PayPal payout confirmed successful. Existing paid withdrawal synchronized.",

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
                    If already restored/failed, do not silently
                    execute accounting again.

                    This situation requires investigation because
                    the provider says SUCCESS while local state
                    says payment_failed.
                */
                if (
                    current.status === "payment_failed"
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
                    Normal path:
                    processing → paid
                */
                await withdrawalManager
                    .markAsPaid(
                        withdrawalId,
                        transactionId,
                        transactionId ||
                        paypalBatchId
                    );

                /*
                    Ensure stale provider failure state is gone.
                */
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
                    Never move a paid withdrawal backwards.
                */
                if (
                    current.status === "paid"
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
                    restore.
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
            PAYPAL STILL PROCESSING
            ==========================================
            */

            else {
                console.log(
                    "[PAYPAL] STILL PROCESSING:",
                    withdrawalId
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

                        Never move payment_failed into processing
                        just because an unrelated status lookup
                        returned an intermediate state.
                    */
                    if (
                        latest.status !== "paid" &&
                        latest.status !== "payment_failed"
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
                A status lookup failure does NOT itself prove
                that the payout failed.

                Therefore we do not restore the wallet here.
            */
            return res.status(
                isUnknownProviderError(e)
                    ? 202
                    : 500
            ).json({
                success: false,

                reconciliationRequired:
                    isUnknownProviderError(e),

                message:
                    isUnknownProviderError(e)
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
        ↓
SUCCESS → PAID
FAILURE → PAYMENT_FAILED
UNKNOWN → RECONCILIATION_REQUIRED

M-PESA:

approved/payment_failed
        ↓
atomic claim
        ↓
processing
        ↓
M-Pesa submission
        ↓
PROCESSING
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
                String(
                    withdrawal.paymentMethod || ""
                ).toUpperCase();

            /*
            ==========================================
            VALIDATE STATUS
            ==========================================
            */

            if (
                withdrawal.status !== "approved" &&
                withdrawal.status !== "payment_failed"
            ) {
                let message =
                    "Withdrawal must be approved before payment.";

                if (
                    withdrawal.status ===
                    "processing"
                ) {
                    message =
                        "This withdrawal is already being processed.";
                }

                if (
                    withdrawal.status ===
                    "paid"
                ) {
                    message =
                        "This withdrawal has already been paid.";
                }

                if (
                    withdrawal.status ===
                    "reconciliation_required"
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
                    "[PAYPAL] Starting payout:",
                    withdrawalId
                );

                /*
                ======================================
                ATOMIC CLAIM
                ======================================

                This is critical.

                Two administrators cannot simultaneously
                turn the same approved withdrawal into
                two PayPal submissions.
                */

                const claimResult =
                    await withdrawalRef.transaction(
                        current => {
                            if (!current) {
                                return;
                            }

                            if (
                                current.status !==
                                    "approved" &&
                                current.status !==
                                    "payment_failed"
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
                    !claimResult.committed
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
                            latest.status ===
                                "processing"
                                ? "This withdrawal is already being processed."
                                : "Withdrawal cannot be paid in its current state.",

                        status:
                            latest?.status || ""
                    });
                }

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
                SUBMIT PAYPAL PAYOUT
                ======================================
                */

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
                        An exception during PayPal submission
                        is not automatically a confirmed failure.

                        Preserve funds and reconcile.
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

                /*
                ======================================
                PAYPAL UNKNOWN OUTCOME
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

                    Only a definitive provider rejection
                    can restore the wallet.
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
                PAYPAL ACCEPTED
                ======================================

                Accepted != completed.

                Keep withdrawal PROCESSING.
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

                    updatedAt:
                        Date.now()
                });

                console.log(
                    "[PAYPAL] Payout submitted:",
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
                            withdrawal.paypalBatchId ||
                            "",

                        paypalItemId:
                            payment.paypalItemId ||
                            withdrawal.paypalItemId ||
                            "",

                        paypalBatchStatus:
                            payment.paypalBatchStatus ||
                            "PROCESSING"
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
                        `Unsupported payment method: ${paymentMethod || "UNKNOWN"}`
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

                        if (
                            current.status !==
                                "approved" &&
                            current.status !==
                                "payment_failed"
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
                        latest.status ===
                            "processing"
                            ? "This withdrawal is already being processed."
                            : "Withdrawal cannot be paid in its current state.",

                    status:
                        latest?.status || ""
                });
            }

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

            /*
            ==========================================
            SEND M-PESA
            ==========================================
            */

            let payment;

            try {
                payment =
                    await MpesaB2CManager
                        .sendMoney(
                            claimedWithdrawal
                        );
            }
            catch (mpesaError) {
                /*
                    M-Pesa has its own provider semantics.
                    Do not blindly assume an exception means
                    the provider definitely did not accept it.

                    If the M-Pesa manager exposes an unknown
                    outcome, preserve the reserved funds.
                */
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
            SAFETY RULE
            ==========================================

            If PayPal is currently processing, never
            automatically restore the wallet here.

            The provider outcome must be reconciled.
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
                            current.status ===
                                "processing"
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

IMPORTANT:

This endpoint should eventually be protected by
admin authentication.

For PayPal, automatic completion should normally
happen through the PayPal status/reconciliation flow.
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

            /*
                Load withdrawal first so we can prevent
                arbitrary PayPal manual completion.
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

            const method =
                normalizeStatus(
                    withdrawal.paymentMethod
                );

            /*
                PayPal must have provider confirmation.
            */
            if (
                method === "PAYPAL"
            ) {
                const paypalSuccess =
                    isPayPalSuccess(
                        withdrawal.paypalBatchStatus,
                        withdrawal.paypalTransactionStatus
                    );

                if (!paypalSuccess) {
                    return res.status(400).json({
                        success: false,

                        message:
                            "A PayPal withdrawal cannot be manually marked paid until PayPal confirms SUCCESS or COMPLETED.",

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
                Always clear stale failure information when
                the final state is paid.
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

Temporary recovery endpoint.

Only available for a confirmed local
payment_failed state.

IMPORTANT:

Protect this endpoint with admin authentication
before production.
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
                Basic email validation.
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
                withdrawal.status !==
                "payment_failed"
            ) {
                return res.status(400).json({
                    success: false,

                    error:
                        `Withdrawal must be payment_failed. Current status: ${withdrawal.status}`
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
                New receiver = new payment attempt.

                Clear old provider IDs so the next attempt
                does not accidentally look like the previous
                PayPal payout.
            */
            await withdrawalRef.update({
                paypalEmail:
                    normalizedEmail,

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

                paymentFailureReason:
                    "",

                reconciliationRequired:
                    false,

                updatedAt:
                    Date.now()
            });

            console.log(
                "[PAYPAL RECEIVER UPDATED]:",
                withdrawalId
            );

            return res.json({
                success: true,

                withdrawalId,

                message:
                    "PayPal receiver updated successfully."
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