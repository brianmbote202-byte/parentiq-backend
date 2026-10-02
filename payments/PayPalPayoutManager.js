const axios = require("axios");
const { db } = require("../firebase");

class PayPalPayoutManager {

    /*
    ==================================================
    CONSTANTS
    ==================================================
    */

    PROVIDER = "PAYPAL";

    PAYMENT_STATUS = {
        PENDING: "PENDING",
        PROCESSING: "PROCESSING",
        SUCCESS: "SUCCESS",
        FAILED: "FAILED",
        RECONCILIATION_REQUIRED: "RECONCILIATION_REQUIRED"
    };


    /*
    ==================================================
    PAYPAL BASE URL
    ==================================================
    */

    getBaseUrl() {

        const environment =
            String(
                process.env.PAYPAL_ENVIRONMENT ||
                "sandbox"
            )
                .trim()
                .toLowerCase();

        if (environment === "live") {
            return "https://api-m.paypal.com";
        }

        return "https://api-m.sandbox.paypal.com";
    }


    /*
    ==================================================
    GET PAYPAL ACCESS TOKEN
    ==================================================

    This happens BEFORE the payout POST.

    Therefore an OAuth failure means the payout request
    was never submitted by this manager.

    Such failures are safe to classify as confirmed
    submission failure.

    IMPORTANT:

    getPayoutStatus() wraps token errors differently,
    because a token failure during reconciliation does
    NOT prove that an existing payout failed.
    ==================================================
    */

    async getAccessToken() {

        const clientId =
            process.env.PAYPAL_CLIENT_ID;

        const clientSecret =
            process.env.PAYPAL_CLIENT_SECRET;

        if (!clientId || !clientSecret) {

            const error =
                new Error(
                    "Missing PayPal API credentials."
                );

            error.code =
                "PAYPAL_CREDENTIALS_MISSING";

            error.unknownOutcome =
                false;

            error.reconciliationRequired =
                false;

            error.confirmedFailure =
                true;

            throw error;
        }

        const auth =
            Buffer
                .from(
                    `${clientId}:${clientSecret}`
                )
                .toString("base64");

        try {

            const response =
                await axios.post(

                    `${this.getBaseUrl()}/v1/oauth2/token`,

                    "grant_type=client_credentials",

                    {
                        timeout: 30000,

                        headers: {

                            Authorization:
                                `Basic ${auth}`,

                            "Content-Type":
                                "application/x-www-form-urlencoded",

                            Accept:
                                "application/json"
                        }
                    }
                );

            const accessToken =
                response?.data?.access_token;

            if (!accessToken) {

                const error =
                    new Error(
                        "PayPal did not return an access token."
                    );

                error.code =
                    "PAYPAL_ACCESS_TOKEN_MISSING";

                error.unknownOutcome =
                    false;

                error.reconciliationRequired =
                    false;

                error.confirmedFailure =
                    true;

                throw error;
            }

            return accessToken;

        }
        catch (error) {

            console.error(
    "[PAYPAL] ACCESS TOKEN ERROR:",
    {
        status: error.response?.status || 0,
        code: error.code || "",
        message: error.message || "",
        paypalResponse: error.response?.data || null
    }
);

            const status =
                Number(
                    error?.response?.status || 0
                );

            const networkError =
                [
                    "ECONNABORTED",
                    "ETIMEDOUT",
                    "ECONNRESET",
                    "ECONNREFUSED",
                    "EAI_AGAIN",
                    "ERR_NETWORK"
                ].includes(
                    error?.code
                );

            /*
            ==========================================
            NETWORK ERROR

            OAuth happens before payout submission.
            ==========================================
            */

            if (networkError) {

                const tokenError =
                    new Error(
                        "Unable to connect to PayPal while requesting an access token."
                    );

                tokenError.code =
                    error.code ||
                    "PAYPAL_NETWORK_ERROR";

                tokenError.httpStatus =
                    status;

                tokenError.unknownOutcome =
                    false;

                tokenError.reconciliationRequired =
                    false;

                tokenError.confirmedFailure =
                    true;

                throw tokenError;
            }

            /*
            ==========================================
            PAYPAL SERVER ERROR

            OAuth request failed before payout POST.
            ==========================================
            */

            if (status >= 500) {

                const tokenError =
                    new Error(
                        "PayPal authentication service is temporarily unavailable."
                    );

                tokenError.code =
                    `PAYPAL_HTTP_${status}`;

                tokenError.httpStatus =
                    status;

                tokenError.unknownOutcome =
                    false;

                tokenError.reconciliationRequired =
                    false;

                tokenError.confirmedFailure =
                    true;

                throw tokenError;
            }

            /*
            ==========================================
            OTHER AUTHENTICATION ERRORS
            ==========================================
            */

            error.unknownOutcome =
                false;

            error.reconciliationRequired =
                false;

            error.confirmedFailure =
                true;

            throw error;
        }
    }


    /*
    ==================================================
    GET STABLE SENDER BATCH ID
    ==================================================

    An unresolved logical payout MUST reuse the same
    sender_batch_id.

    PayPal-Request-Id also uses this same value.
    ==================================================
    */

    getSenderBatchId(withdrawal) {

        const existing =
            String(
                withdrawal?.paypalSenderBatchId ||
                ""
            ).trim();

        if (existing) {
            return existing;
        }

        return `PARENTIQ-${withdrawal.id}`;
    }


    /*
    ==================================================
    CREATE NEW SENDER BATCH ID
    ==================================================

    ONLY for an intentional retry after a DEFINITIVE
    provider failure.

    NEVER use this for:

        timeout
        connection reset
        429
        409
        5xx
        network loss
        missing response
        reconciliation_required
    ==================================================
    */

    createNewSenderBatchId(withdrawal) {

        const attemptNumber =
            Number(
                withdrawal?.paypalAttemptNumber || 0
            ) + 1;

        return (
            `PARENTIQ-${withdrawal.id}-A${attemptNumber}-${Date.now()}`
        );
    }


    /*
    ==================================================
    NORMALIZE TRANSACTION STATUS
    ==================================================
    */

    normalizeTransactionStatus(value) {

        return String(
            value || ""
        )
            .trim()
            .toUpperCase();
    }


    /*
    ==================================================
    EXTRACT PAYPAL ITEM DATA
    ==================================================

    PayPal may expose payout item fields either:

        directly

    or:

        inside payout_item
    ==================================================
    */

    extractItemData(item) {

        const payoutItem =
            item?.payout_item ||
            item ||
            {};

        const paypalItemId =
            item?.payout_item_id ||
            payoutItem?.payout_item_id ||
            item?.paypalItemId ||
            item?.payoutItemId ||
            "";

        const transactionId =
            item?.transaction_id ||
            payoutItem?.transaction_id ||
            item?.transactionId ||
            "";

        const transactionStatus =
            this.normalizeTransactionStatus(
                item?.transaction_status ||
                payoutItem?.transaction_status ||
                item?.transactionStatus
            );

        const senderItemId =
            String(
                item?.sender_item_id ||
                payoutItem?.sender_item_id ||
                ""
            ).trim();

        const errors =
            item?.errors ||
            payoutItem?.errors ||
            null;

        return {

            paypalItemId,

            transactionId,

            transactionStatus,

            senderItemId,

            errors,

            payoutItem
        };
    }


    /*
    ==================================================
    NORMALIZE PAYPAL ERROR
    ==================================================

    Determines whether a failed HTTP request means:

        CONFIRMED FAILURE

    or:

        UNKNOWN / RECONCILIATION

    Financial rule:

        Unknown != Failed
    ==================================================
    */

    normalizePayPalError(error) {

        const status =
            Number(
                error?.response?.status || 0
            );

        const responseData =
            error?.response?.data ||
            null;

        const name =
            String(
                responseData?.name ||
                ""
            )
                .trim()
                .toUpperCase();

        const message =
            String(
                responseData?.message ||
                responseData?.error_description ||
                error?.message ||
                "PayPal payout request failed."
            );

        const networkError =
            [
                "ECONNABORTED",
                "ETIMEDOUT",
                "ECONNRESET",
                "ECONNREFUSED",
                "EAI_AGAIN",
                "ERR_NETWORK"
            ].includes(
                error?.code
            );

        /*
        ==========================================
        NETWORK / TIMEOUT
        ==========================================

        The payout POST may have reached PayPal.
        ==========================================
        */

        if (networkError) {

            return {

                message:
                    "PayPal payout request outcome is uncertain because the connection failed.",

                code:
                    error.code ||
                    "PAYPAL_NETWORK_ERROR",

                httpStatus:
                    status,

                unknownOutcome:
                    true,

                reconciliationRequired:
                    true,

                confirmedFailure:
                    false,

                paypalResponse:
                    responseData
            };
        }


        /*
        ==========================================
        SERVER ERROR
        ==========================================
        */

        if (status >= 500) {

            return {

                message:
                    "PayPal payout outcome is uncertain because PayPal returned a server error.",

                code:
                    `PAYPAL_HTTP_${status}`,

                httpStatus:
                    status,

                unknownOutcome:
                    true,

                reconciliationRequired:
                    true,

                confirmedFailure:
                    false,

                paypalResponse:
                    responseData
            };
        }


        /*
        ==========================================
        RATE LIMIT
        ==========================================
        */

        if (status === 429) {

            return {

                message:
                    "PayPal rate limit reached. Payout outcome requires reconciliation.",

                code:
                    "PAYPAL_RATE_LIMIT",

                httpStatus:
                    status,

                unknownOutcome:
                    true,

                reconciliationRequired:
                    true,

                confirmedFailure:
                    false,

                paypalResponse:
                    responseData
            };
        }


        /*
        ==========================================
        DUPLICATE / IDEMPOTENCY
        ==========================================

        A duplicate response does NOT prove failure.

        PayPal may already have accepted the payout.
        ==========================================
        */

        const lowerMessage =
            message.toLowerCase();

        const duplicateError =
            (
                name.includes("DUPLICATE") ||
                name.includes("RESOURCE_ALREADY_EXISTS") ||
                name.includes("IDEMPOTENCY") ||
                lowerMessage.includes("duplicate") ||
                lowerMessage.includes("sender_batch_id")
            );

        if (
            duplicateError ||
            status === 409
        ) {

            return {

                message:
                    "PayPal indicates that this payout request may already exist. Reconciliation is required.",

                code:
                    "PAYPAL_DUPLICATE_OR_EXISTING_PAYOUT",

                httpStatus:
                    status,

                unknownOutcome:
                    true,

                reconciliationRequired:
                    true,

                confirmedFailure:
                    false,

                paypalResponse:
                    responseData
            };
        }


        /*
        ==========================================
        OTHER 4XX
        ==========================================

        These are treated as confirmed submission
        failures because the payout request was rejected
        before being accepted as a payout.
        ==========================================
        */

        if (
            status >= 400 &&
            status < 500
        ) {

            return {

                message,

                code:
                    name ||
                    `PAYPAL_HTTP_${status}`,

                httpStatus:
                    status,

                unknownOutcome:
                    false,

                reconciliationRequired:
                    false,

                confirmedFailure:
                    true,

                paypalResponse:
                    responseData
            };
        }


        /*
        ==========================================
        EXPLICIT MANAGER ERROR FLAGS
        ==========================================
        */

        if (error?.confirmedFailure === true) {

            return {

                message,

                code:
                    error.code ||
                    "PAYPAL_CONFIRMED_FAILURE",

                httpStatus:
                    status,

                unknownOutcome:
                    false,

                reconciliationRequired:
                    false,

                confirmedFailure:
                    true,

                paypalResponse:
                    responseData
            };
        }


        /*
        ==========================================
        UNKNOWN ERROR
        ==========================================
        */

        return {

            message,

            code:
                error?.code ||
                "PAYPAL_UNKNOWN_ERROR",

            httpStatus:
                status,

            unknownOutcome:
                true,

            reconciliationRequired:
                true,

            confirmedFailure:
                false,

            paypalResponse:
                responseData
        };
    }


    /*
    ==================================================
    EVALUATE PAYOUT STATUS
    ==================================================

    ITEM-LEVEL SUCCESS IS AUTHORITATIVE.

    Batch SUCCESS by itself is NOT enough.
    ==================================================
    */

    evaluatePayoutStatus(
        batchStatus,
        transactionStatus
    ) {

        const batch =
            String(
                batchStatus || ""
            )
                .trim()
                .toUpperCase();

        const transaction =
            this.normalizeTransactionStatus(
                transactionStatus
            );

        const itemSuccess =
            transaction === "SUCCESS";

        const itemFailed =
            transaction === "FAILED";

        const itemReturned =
            transaction === "RETURNED";

        const itemRefunded =
            transaction === "REFUNDED";

        const itemReversed =
            transaction === "REVERSED";


            /*
==========================================
BLOCKED
==========================================

A BLOCKED payout is not ordinary processing.

Do not assume it will complete.
Keep funds reserved and require reconciliation.
==========================================
*/

if (
    transaction === "BLOCKED"
) {

    return {

        outcome:
            "RECONCILIATION_REQUIRED",

        paypalSuccess:
            false,

        paypalFailure:
            false,

        paypalProcessing:
            false,

        unknownOutcome:
            true,

        reconciliationRequired:
            true
    };
}

        const itemProcessing =
    (
        transaction === "PENDING" ||
        transaction === "UNCLAIMED" ||
        transaction === "ONHOLD"
    );

        const batchDenied =
            batch === "DENIED";

        const batchCanceled =
            (
                batch === "CANCELED" ||
                batch === "CANCELLED"
            );


        /*
        ==========================================
        CONTRADICTORY PROVIDER DATA
        ==========================================
        */

        const contradictory =
            (
                (
                    batch === "SUCCESS" &&
                    (
                        itemFailed ||
                        itemReturned ||
                        itemRefunded ||
                        itemReversed
                    )
                )
                ||
                (
                    (
                        batchDenied ||
                        batchCanceled
                    ) &&
                    itemSuccess
                )
            );

        if (contradictory) {

            return {

                outcome:
                    "RECONCILIATION_REQUIRED",

                paypalSuccess:
                    false,

                paypalFailure:
                    false,

                paypalProcessing:
                    false,

                unknownOutcome:
                    true,

                reconciliationRequired:
                    true
            };
        }


        /*
        ==========================================
        ITEM SUCCESS
        ==========================================
        */

        if (itemSuccess) {

            return {

                outcome:
                    "SUCCESS",

                paypalSuccess:
                    true,

                paypalFailure:
                    false,

                paypalProcessing:
                    false,

                unknownOutcome:
                    false,

                reconciliationRequired:
                    false
            };
        }


        /*
        ==========================================
        ITEM FAILED
        ==========================================
        */

        if (itemFailed) {

            return {

                outcome:
                    "FAILED",

                paypalSuccess:
                    false,

                paypalFailure:
                    true,

                paypalProcessing:
                    false,

                unknownOutcome:
                    false,

                reconciliationRequired:
                    false
            };
        }


        /*
        ==========================================
        RETURNED / REFUNDED / REVERSED
        ==========================================
        */

        if (
            itemReturned ||
            itemRefunded ||
            itemReversed
        ) {

            return {

                outcome:
                    "RECONCILIATION_REQUIRED",

                paypalSuccess:
                    false,

                paypalFailure:
                    false,

                paypalProcessing:
                    false,

                unknownOutcome:
                    false,

                reconciliationRequired:
                    true
            };
        }


        /*
        ==========================================
        BATCH DENIED / CANCELLED
        ==========================================
        */

        if (
            batchDenied ||
            batchCanceled
        ) {

            return {

                outcome:
                    "FAILED",

                paypalSuccess:
                    false,

                paypalFailure:
                    true,

                paypalProcessing:
                    false,

                unknownOutcome:
                    false,

                reconciliationRequired:
                    false
            };
        }


        /*
        ==========================================
        ITEM PROCESSING
        ==========================================
        */

        if (itemProcessing) {

            return {

                outcome:
                    "PROCESSING",

                paypalSuccess:
                    false,

                paypalFailure:
                    false,

                paypalProcessing:
                    true,

                unknownOutcome:
                    false,

                reconciliationRequired:
                    false
            };
        }


        /*
        ==========================================
        BATCH SUCCESS WITHOUT ITEM SUCCESS
        ==========================================

        NEVER mark the withdrawal paid from this alone.
        ==========================================
        */

        if (batch === "SUCCESS") {

            return {

                outcome:
                    "RECONCILIATION_REQUIRED",

                paypalSuccess:
                    false,

                paypalFailure:
                    false,

                paypalProcessing:
                    false,

                unknownOutcome:
                    true,

                reconciliationRequired:
                    true
            };
        }


        /*
        ==========================================
        UNKNOWN / STILL PROCESSING
        ==========================================
        */

        return {

            outcome:
                "PROCESSING",

            paypalSuccess:
                false,

            paypalFailure:
                false,

            paypalProcessing:
                true,

            unknownOutcome:
                false,

            reconciliationRequired:
                false
        };
    }


    /*
    ==================================================
    FIND EXISTING LOCAL PAYMENT
    ==================================================

    Searches for the exact:

        withdrawalId
        senderBatchId

    Prevents duplicate local payment records.
    ==================================================
    */

    async findExistingPayment(
        withdrawalId,
        senderBatchId
    ) {

        try {

            const snapshot =
                await db
                    .ref("payments")
                    .orderByChild("withdrawalId")
                    .equalTo(withdrawalId)
                    .once("value");

            const payments =
                snapshot.val() || {};

            const candidates =
                Object.values(payments)
                    .filter(payment => {

                        if (!payment) {
                            return false;
                        }

                        if (
                            String(
                                payment.provider ||
                                ""
                            ).toUpperCase() !==
                            "PAYPAL"
                        ) {
                            return false;
                        }

                        if (
                            String(
                                payment.senderBatchId ||
                                ""
                            ) !==
                            String(
                                senderBatchId
                            )
                        ) {
                            return false;
                        }

                        const status =
                            String(
                                payment.status ||
                                ""
                            )
                                .trim()
                                .toUpperCase();

                        return (
                            status === "PENDING" ||
                            status === "PROCESSING" ||
                            status === "RECONCILIATION_REQUIRED" ||
                            status === "SUCCESS"
                        );
                    })
                    .sort(
                        (a, b) =>
                            Number(
                                b.updatedAt || 0
                            ) -
                            Number(
                                a.updatedAt || 0
                            )
                    );

            return candidates[0] || null;

        }
        catch (error) {

    console.error(
        "[PAYPAL] PAYMENT LOOKUP ERROR:",
        error.message
    );

    /*
    ==========================================
    FAIL CLOSED
    ==========================================

    A Firebase lookup failure does NOT mean
    that no payment exists.

    Never continue to PayPal when we cannot
    verify the existing local payment record.

    This prevents:

        Firebase read failure
            â†“
        "no payment found"
            â†“
        create duplicate payment
            â†“
        submit another payout
    ==========================================
    */

    const lookupError =
        new Error(
            "Unable to verify the existing PayPal payment record."
        );

    lookupError.code =
        "PAYPAL_PAYMENT_LOOKUP_FAILED";

    lookupError.unknownOutcome =
        true;

    lookupError.reconciliationRequired =
        true;

    lookupError.confirmedFailure =
        false;

    lookupError.cause =
        error;

    throw lookupError;
}
    }


    /*
    ==================================================
    CREATE LOCAL PAYMENT RECORD
    ==================================================
    */

    async createPaymentRecord(
        withdrawal,
        senderBatchId,
        paypalEmail,
        payoutAmount,
        currency
    ) {

        const paymentRef =
            db
                .ref("payments")
                .push();

        const paymentId =
            paymentRef.key;

        const now =
            Date.now();

        await paymentRef.set({

            id:
                paymentId,

            withdrawalId:
                withdrawal.id,

            withdrawalReference:
                withdrawal.reference,

            agentId:
                withdrawal.agentId,

            provider:
                "PAYPAL",

            type:
                "PAYOUT",

            status:
                "PENDING",

            recipient:
                paypalEmail,

            amount:
                payoutAmount,

            currency,

            senderBatchId,

            providerReference:
                "",

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

            unknownOutcome:
                false,

            reconciliationRequired:
                false,

            confirmedFailure:
                false,

            createdAt:
                now,

            updatedAt:
                now
        });

        return {
            paymentRef,
            paymentId
        };
    }


    /*
    ==================================================
    SEND PAYPAL PAYOUT
    ==================================================
    */

    async sendMoney(withdrawal) {

        console.log(
            "======================================"
        );

        console.log(
            "PAYPAL PAYOUT"
        );

        console.log(
            "======================================"
        );

        console.log(
            "Withdrawal:",
            withdrawal.id
        );

        console.log(
            "Reference:",
            withdrawal.reference
        );

        console.log(
            "Agent:",
            withdrawal.agentId
        );


        /*
        ==========================================
        VALIDATE PAYPAL EMAIL
        ==========================================
        */

        const paypalEmail =
            String(
                withdrawal.paypalEmail ||
                ""
            )
                .trim()
                .toLowerCase();

        if (!paypalEmail) {

            return {

                success:
                    false,

                provider:
                    "PAYPAL",

                status:
                    "FAILED",

                confirmedFailure:
                    true,

                unknownOutcome:
                    false,

                reconciliationRequired:
                    false,

                code:
                    "PAYPAL_EMAIL_REQUIRED",

                message:
                    "PayPal email is required."
            };
        }


        const emailRegex =
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(paypalEmail)) {

            return {

                success:
                    false,

                provider:
                    "PAYPAL",

                status:
                    "FAILED",

                confirmedFailure:
                    true,

                unknownOutcome:
                    false,

                reconciliationRequired:
                    false,

                code:
                    "PAYPAL_INVALID_EMAIL",

                message:
                    "Invalid PayPal email address."
            };
        }


        /*
        ==========================================
        CURRENCY
        ==========================================
        */

        const currency =
            String(
                withdrawal.payoutCurrency ||
                process.env.PAYPAL_PAYOUT_CURRENCY ||
                "USD"
            )
                .trim()
                .toUpperCase();

        if (!currency) {

            return {

                success:
                    false,

                provider:
                    "PAYPAL",

                status:
                    "FAILED",

                confirmedFailure:
                    true,

                unknownOutcome:
                    false,

                reconciliationRequired:
                    false,

                code:
                    "PAYPAL_CURRENCY_REQUIRED",

                message:
                    "PayPal payout currency is required."
            };
        }


        /*
        ==========================================
        AMOUNT
        ==========================================
        */

        const payoutAmount =
            Number(
                withdrawal.payoutAmount || 0
            );

        if (
            !Number.isFinite(payoutAmount) ||
            payoutAmount <= 0
        ) {

            return {

                success:
                    false,

                provider:
                    "PAYPAL",

                status:
                    "FAILED",

                confirmedFailure:
                    true,

                unknownOutcome:
                    false,

                reconciliationRequired:
                    false,

                code:
                    "PAYPAL_INVALID_AMOUNT",

                message:
                    "Invalid PayPal payout amount."
            };
        }


        /*
        ==========================================
        STABLE SENDER BATCH ID
        ==========================================
        */

        const senderBatchId =
            this.getSenderBatchId(
                withdrawal
            );


        /*
        ==========================================
        FIND EXISTING LOCAL PAYMENT
        ==========================================
        */

        let payment =
            await this.findExistingPayment(
                withdrawal.id,
                senderBatchId
            );

        let paymentRef;
        let paymentId;


        if (payment?.id) {

            paymentId =
                payment.id;

            paymentRef =
                db.ref(
                    `payments/${paymentId}`
                );

            const existingStatus =
                String(
                    payment.status ||
                    ""
                )
                    .trim()
                    .toUpperCase();


            /*
            ==========================================
            EXISTING SUCCESS

            Never submit again.
            ==========================================
            */

            if (
                existingStatus ===
                "SUCCESS"
            ) {

                console.log(
                    "[PAYPAL] Existing successful payment found:",
                    paymentId
                );

                return {

                    success:
                        true,

                    paymentId,

                    provider:
                        "PAYPAL",

                    status:
                        "SUCCESS",

                    providerReference:
                        payment.providerReference ||
                        payment.paypalBatchId ||
                        "",

                    paypalBatchId:
                        payment.paypalBatchId ||
                        "",

                    paypalItemId:
                        payment.paypalItemId ||
                        "",

                    paypalTransactionId:
                        payment.paypalTransactionId ||
                        "",

                    paypalBatchStatus:
                        payment.paypalBatchStatus ||
                        "",

                    paypalTransactionStatus:
                        payment.paypalTransactionStatus ||
                        "SUCCESS",

                    unknownOutcome:
                        false,

                    reconciliationRequired:
                        false,

                    confirmedFailure:
                        false,

                    message:
                        "PayPal payout already completed."
                };
            }


            /*
            ==========================================
            EXISTING RECONCILIATION

            Never submit another payout.
            ==========================================
            */

            if (
                existingStatus ===
                "RECONCILIATION_REQUIRED"
            ) {

                console.warn(
                    "[PAYPAL] Existing payout requires reconciliation:",
                    paymentId
                );

                return {

                    success:
                        false,

                    paymentId,

                    provider:
                        "PAYPAL",

                    status:
                        "RECONCILIATION_REQUIRED",

                    providerReference:
                        payment.providerReference ||
                        payment.paypalBatchId ||
                        "",

                    paypalBatchId:
                        payment.paypalBatchId ||
                        "",

                    paypalItemId:
                        payment.paypalItemId ||
                        "",

                    paypalTransactionId:
                        payment.paypalTransactionId ||
                        "",

                    paypalBatchStatus:
                        payment.paypalBatchStatus ||
                        "",

                    paypalTransactionStatus:
                        payment.paypalTransactionStatus ||
                        "",

                    unknownOutcome:
                        true,

                    reconciliationRequired:
                        true,

                    confirmedFailure:
                        false,

                    message:
                        "Existing PayPal payout requires reconciliation."
                };
            }

            console.log(
                "[PAYPAL] Reusing local payment:",
                paymentId
            );

        }
        else {

            const created =
                await this.createPaymentRecord(
                    withdrawal,
                    senderBatchId,
                    paypalEmail,
                    payoutAmount,
                    currency
                );

            paymentRef =
                created.paymentRef;

            paymentId =
                created.paymentId;
        }


        /*
        ==========================================
        GET ACCESS TOKEN
        ==========================================
        */

        let accessToken;

        try {

            accessToken =
                await this.getAccessToken();

        }
        catch (error) {

            /*
            OAuth happens before payout submission.

            Therefore the payout was NOT submitted.
            This is a confirmed submission failure.
            */

            const now =
                Date.now();

            await paymentRef.update({

                status:
                    "FAILED",

                error:
                    error.message,

                errorCode:
                    error.code || "",

                httpStatus:
                    error.httpStatus || 0,

                unknownOutcome:
                    false,

                reconciliationRequired:
                    false,

                confirmedFailure:
                    true,

                paymentFailedAt:
                    now,

                updatedAt:
                    now
            });

            return {

                success:
                    false,

                paymentId,

                provider:
                    "PAYPAL",

                status:
                    "FAILED",

                confirmedFailure:
                    true,

                unknownOutcome:
                    false,

                reconciliationRequired:
                    false,

                code:
                    error.code ||
                    "PAYPAL_AUTH_ERROR",

                message:
                    error.message
            };
        }


        /*
        ==========================================
        PAYLOAD
        ==========================================
        */

        const payload = {

            sender_batch_header: {

                sender_batch_id:
                    senderBatchId,

                email_subject:
                    "Your ParentIQ commission payout",

                email_message:
                    "Your ParentIQ commission payout has been submitted."
            },

            items: [

                {

                    recipient_type:
                        "EMAIL",

                    amount: {

                        value:
                            payoutAmount.toFixed(2),

                        currency
                    },

                    receiver:
                        paypalEmail,

                    note:
                        `ParentIQ commission ${withdrawal.reference}`,

                    sender_item_id:
                        withdrawal.id
                }
            ]
        };


        /*
        ==========================================
        SUBMIT PAYOUT
        ==========================================
        */

        try {

            console.log(
                "[PAYPAL] Sending payout..."
            );

            console.log(
                "[PAYPAL] Environment:",
                process.env.PAYPAL_ENVIRONMENT ||
                "sandbox"
            );

            console.log(
                "[PAYPAL] Currency:",
                currency
            );

            console.log(
                "[PAYPAL] Amount:",
                payoutAmount
            );

            console.log(
                "[PAYPAL] Sender batch ID:",
                senderBatchId
            );

            console.log(
                "[PAYPAL] Sender item ID:",
                withdrawal.id
            );


            const response =
                await axios.post(

                    `${this.getBaseUrl()}/v1/payments/payouts`,

                    payload,

                    {

                        timeout:
                            30000,

                        headers: {

                            Authorization:
                                `Bearer ${accessToken}`,

                            "Content-Type":
                                "application/json",

                            Accept:
                                "application/json",

                            /*
                            Same idempotency key for this
                            logical payout attempt.
                            */

                            "PayPal-Request-Id":
                                senderBatchId
                        }
                    }
                );


            const data =
                response?.data ||
                {};

            const batchHeader =
                data.batch_header ||
                {};

            const paypalBatchId =
                batchHeader.payout_batch_id ||
                "";


            /*
            ==========================================
            MISSING BATCH ID
            ==========================================

            HTTP success without batch ID is unknown.
            ==========================================
            */

            if (!paypalBatchId) {

                const error =
                    new Error(
                        "PayPal accepted the request but did not return a payout batch ID."
                    );

                error.code =
                    "PAYPAL_BATCH_ID_MISSING";

                error.unknownOutcome =
                    true;

                error.reconciliationRequired =
                    true;

                error.confirmedFailure =
                    false;

                error.paypalResponse =
                    data;

                throw error;
            }


            const batchStatus =
                String(
                    batchHeader.batch_status ||
                    "PENDING"
                )
                    .trim()
                    .toUpperCase();


            /*
            ==========================================
            FIND EXACT PAYPAL ITEM
            ==========================================
            */

            const items =
                Array.isArray(data.items)
                    ? data.items
                    : [];

            let selectedItem =
                null;

            if (items.length > 0) {

                selectedItem =
                    items.find(
                        candidate => {

                            const itemData =
                                this.extractItemData(
                                    candidate
                                );

                            return (
                                itemData.senderItemId ===
                                String(
                                    withdrawal.id
                                )
                            );
                        }
                    ) || null;


                /*
                There is exactly one item in our
                submission payload.

                It is therefore safe to use it if PayPal
                omitted sender_item_id.
                */

                if (
                    !selectedItem &&
                    items.length === 1
                ) {

                    selectedItem =
                        items[0];
                }
            }


            let paypalItemId =
                "";

            let transactionId =
                "";

            let transactionStatus =
                "";

            let payoutItem =
                null;

            let itemErrors =
                null;


            if (selectedItem) {

                const itemData =
                    this.extractItemData(
                        selectedItem
                    );

                paypalItemId =
                    itemData.paypalItemId;

                transactionId =
                    itemData.transactionId;

                transactionStatus =
                    itemData.transactionStatus;

                payoutItem =
                    itemData.payoutItem;

                itemErrors =
                    itemData.errors;
            }


            /*
            ==========================================
            ITEM IDENTIFICATION SAFETY
            ==========================================

            For submission we sent exactly ONE item.

            If PayPal returns multiple items and we cannot
            identify our item, reconciliation is required.
            ==========================================
            */

            const itemIdentificationRequired =
                (
                    items.length > 1 &&
                    !selectedItem
                );


            let evaluation;

            if (
                itemIdentificationRequired
            ) {

                evaluation = {

                    outcome:
                        "RECONCILIATION_REQUIRED",

                    paypalSuccess:
                        false,

                    paypalFailure:
                        false,

                    paypalProcessing:
                        false,

                    unknownOutcome:
                        true,

                    reconciliationRequired:
                        true
                };

            }
            else {

                evaluation =
                    this.evaluatePayoutStatus(
                        batchStatus,
                        transactionStatus
                    );
            }


            const now =
                Date.now();

            const paymentStatus =
                evaluation.paypalSuccess
                    ? "SUCCESS"
                    : evaluation.reconciliationRequired
                        ? "RECONCILIATION_REQUIRED"
                        : evaluation.paypalFailure
                            ? "FAILED"
                            : "PROCESSING";


            await paymentRef.update({

                status:
                    paymentStatus,

                providerReference:
                    paypalBatchId,

                paypalBatchId,

                paypalItemId,

                paypalTransactionId:
                    transactionId,

                paypalBatchStatus:
                    batchStatus,

                paypalTransactionStatus:
                    transactionStatus,

                unknownOutcome:
                    Boolean(
                        evaluation.unknownOutcome
                    ),

                reconciliationRequired:
                    Boolean(
                        evaluation.reconciliationRequired
                    ),

                confirmedFailure:
                    Boolean(
                        evaluation.paypalFailure
                    ),

                paypalResponse:
                    data,

                paymentAttemptedAt:
                    now,

                reconciliationRequiredAt:
                    evaluation.reconciliationRequired
                        ? now
                        : null,

                paymentFailedAt:
                    evaluation.paypalFailure
                        ? now
                        : null,

                paymentCompletedAt:
                    evaluation.paypalSuccess
                        ? now
                        : null,

                updatedAt:
                    now
            });


            /*
            ==========================================
            IMMEDIATE SUCCESS
            ==========================================
            */

            if (
                evaluation.paypalSuccess
            ) {

                console.log(
                    "[PAYPAL] IMMEDIATE SUCCESS:",
                    paypalBatchId
                );

                return {

                    success:
                        true,

                    paymentId,

                    provider:
                        "PAYPAL",

                    status:
                        "SUCCESS",

                    providerReference:
                        paypalBatchId,

                    paypalBatchId,

                    paypalItemId,

                    paypalTransactionId:
                        transactionId,

                    paypalBatchStatus:
                        batchStatus,

                    paypalTransactionStatus:
                        transactionStatus,

                    unknownOutcome:
                        false,

                    reconciliationRequired:
                        false,

                    confirmedFailure:
                        false,

                    message:
                        "PayPal payout completed."
                };
            }


            /*
            ==========================================
            RECONCILIATION REQUIRED
            ==========================================
            */

            if (
                evaluation.reconciliationRequired
            ) {

                console.warn(
                    "[PAYPAL] RECONCILIATION REQUIRED:",
                    paypalBatchId
                );

                return {

                    success:
                        false,

                    paymentId,

                    provider:
                        "PAYPAL",

                    status:
                        "RECONCILIATION_REQUIRED",

                    providerReference:
                        paypalBatchId,

                    paypalBatchId,

                    paypalItemId,

                    paypalTransactionId:
                        transactionId,

                    paypalBatchStatus:
                        batchStatus,

                    paypalTransactionStatus:
                        transactionStatus,

                    unknownOutcome:
                        Boolean(
                            evaluation.unknownOutcome
                        ),

                    reconciliationRequired:
                        true,

                    confirmedFailure:
                        false,

                    message:
                        "PayPal payout requires reconciliation."
                };
            }


            /*
            ==========================================
            CONFIRMED FAILURE
            ==========================================
            */

            if (
                evaluation.paypalFailure
            ) {

                console.warn(
                    "[PAYPAL] CONFIRMED FAILURE:",
                    paypalBatchId
                );

                return {

                    success:
                        false,

                    paymentId,

                    provider:
                        "PAYPAL",

                    status:
                        "FAILED",

                    providerReference:
                        paypalBatchId,

                    paypalBatchId,

                    paypalItemId,

                    paypalTransactionId:
                        transactionId,

                    paypalBatchStatus:
                        batchStatus,

                    paypalTransactionStatus:
                        transactionStatus,

                    unknownOutcome:
                        false,

                    reconciliationRequired:
                        false,

                    confirmedFailure:
                        true,

                    message:
                        "PayPal payout was rejected."
                };
            }


            /*
            ==========================================
            PROCESSING
            ==========================================
            */

            console.log(
                "[PAYPAL] Payout accepted and processing:",
                paypalBatchId
            );

            return {

                success:
                    false,

                paymentId,

                provider:
                    "PAYPAL",

                status:
                    "PROCESSING",

                providerReference:
                    paypalBatchId,

                paypalBatchId,

                paypalItemId,

                paypalTransactionId:
                    transactionId,

                paypalBatchStatus:
                    batchStatus,

                paypalTransactionStatus:
                    transactionStatus,

                unknownOutcome:
                    false,

                reconciliationRequired:
                    false,

                confirmedFailure:
                    false,

                message:
                    "PayPal payout accepted and is still processing."
            };

        }
        catch (error) {

            console.error(
                "[PAYPAL] PAYOUT REQUEST ERROR"
            );

            const normalized =
                this.normalizePayPalError(
                    error
                );

            console.error(
                "[PAYPAL] HTTP status:",
                normalized.httpStatus ||
                "N/A"
            );

            console.error(
                "[PAYPAL] Error code:",
                normalized.code
            );

            console.error(
                "[PAYPAL] Error message:",
                normalized.message
            );


            if (
                process.env.PAYPAL_DEBUG === "true" &&
                normalized.paypalResponse
            ) {

                console.error(
                    "[PAYPAL] Response:",
                    JSON.stringify(
                        normalized.paypalResponse,
                        null,
                        2
                    )
                );
            }


            /*
            ==========================================
            UNKNOWN / RECONCILIATION
            ==========================================
            */

            if (
                normalized.unknownOutcome ||
                normalized.reconciliationRequired
            ) {

                const now =
                    Date.now();

                await paymentRef.update({

                    status:
                        "RECONCILIATION_REQUIRED",

                    error:
                        normalized.message,

                    errorCode:
                        normalized.code,

                    httpStatus:
                        normalized.httpStatus ||
                        0,

                    paypalResponse:
                        normalized.paypalResponse,

                    unknownOutcome:
                        true,

                    reconciliationRequired:
                        true,

                    confirmedFailure:
                        false,

                    reconciliationRequiredAt:
                        now,

                    paymentFailedAt:
                        null,

                    updatedAt:
                        now
                });

                return {

                    success:
                        false,

                    paymentId,

                    provider:
                        "PAYPAL",

                    status:
                        "RECONCILIATION_REQUIRED",

                    code:
                        normalized.code,

                    message:
                        normalized.message,

                    httpStatus:
                        normalized.httpStatus,

                    unknownOutcome:
                        true,

                    reconciliationRequired:
                        true,

                    confirmedFailure:
                        false
                };
            }


            /*
            ==========================================
            CONFIRMED FAILURE
            ==========================================
            */

            const now =
                Date.now();

            await paymentRef.update({

                status:
                    "FAILED",

                error:
                    normalized.message,

                errorCode:
                    normalized.code,

                httpStatus:
                    normalized.httpStatus ||
                    0,

                paypalResponse:
                    normalized.paypalResponse,

                unknownOutcome:
                    false,

                reconciliationRequired:
                    false,

                confirmedFailure:
                    true,

                paymentFailedAt:
                    now,

                updatedAt:
                    now
            });

            return {

                success:
                    false,

                paymentId,

                provider:
                    "PAYPAL",

                status:
                    "FAILED",

                code:
                    normalized.code,

                message:
                    normalized.message,

                httpStatus:
                    normalized.httpStatus,

                unknownOutcome:
                    false,

                reconciliationRequired:
                    false,

                confirmedFailure:
                    true
            };
        }
    }


    /*
    ==================================================
    GET PAYPAL PAYOUT STATUS
    ==================================================

    IMPORTANT:

    This method NEVER modifies Firebase withdrawal
    state.

    routes/withdrawals.js owns wallet state changes.

    Also:

    If expectedSenderItemId is supplied and PayPal does
    not return that exact item, we NEVER select another
    item.
    ==================================================
    */

    async getPayoutStatus(
        paypalBatchId,
        expectedSenderItemId = ""
    ) {

        if (!paypalBatchId) {

            const error =
                new Error(
                    "PayPal payout batch ID is required."
                );

            error.code =
                "PAYPAL_BATCH_ID_REQUIRED";

            error.unknownOutcome =
                false;

            error.reconciliationRequired =
                false;

            error.confirmedFailure =
                true;

            throw error;
        }


        const normalizedBatchId =
            String(
                paypalBatchId
            ).trim();

        const normalizedExpectedItemId =
            String(
                expectedSenderItemId ||
                ""
            ).trim();


        console.log(
            "======================================"
        );

        console.log(
            "PAYPAL PAYOUT STATUS"
        );

        console.log(
            "======================================"
        );

        console.log(
            "Batch ID:",
            normalizedBatchId
        );

        if (
            normalizedExpectedItemId
        ) {

            console.log(
                "Expected sender item ID:",
                normalizedExpectedItemId
            );
        }


        /*
        ==========================================
        ACCESS TOKEN
        ==========================================

        Token failure during reconciliation does NOT
        prove payout failure.
        */

        let accessToken;

        try {

            accessToken =
                await this.getAccessToken();

        }
        catch (error) {

            const statusError =
                new Error(
                    "Unable to verify PayPal payout status: " +
                    error.message
                );

            statusError.code =
                error.code ||
                "PAYPAL_STATUS_AUTH_ERROR";

            statusError.httpStatus =
                error.httpStatus ||
                0;

            statusError.unknownOutcome =
                true;

            statusError.reconciliationRequired =
                true;

            statusError.confirmedFailure =
                false;

            throw statusError;
        }


        /*
        ==========================================
        QUERY PAYPAL
        ==========================================
        */

        try {

            const response =
                await axios.get(

                    `${this.getBaseUrl()}/v1/payments/payouts/${encodeURIComponent(normalizedBatchId)}`,

                    {

                        timeout:
                            30000,

                        headers: {

                            Authorization:
                                `Bearer ${accessToken}`,

                            Accept:
                                "application/json"
                        }
                    }
                );


            const data =
                response?.data ||
                {};

            const batchHeader =
                data.batch_header ||
                {};

            const batchStatus =
                String(
                    batchHeader.batch_status ||
                    ""
                )
                    .trim()
                    .toUpperCase();

            const senderBatchId =
                batchHeader
                    ?.sender_batch_header
                    ?.sender_batch_id ||
                batchHeader
                    ?.sender_batch_id ||
                "";

            const payoutBatchId =
                batchHeader.payout_batch_id ||
                normalizedBatchId;


            /*
            ==========================================
            ITEMS
            ==========================================
            */

            const items =
                Array.isArray(data.items)
                    ? data.items
                    : [];

            let item =
                null;


            /*
            ==========================================
            EXACT ITEM MATCH
            ==========================================

            Expected item supplied:

                exact match ONLY

            No fallback.

            No items[0].

            This prevents one withdrawal from being
            incorrectly credited using another payout item.
            ==========================================
            */

            if (
                normalizedExpectedItemId
            ) {

                item =
                    items.find(
                        candidate => {

                            const itemData =
                                this.extractItemData(
                                    candidate
                                );

                            return (
                                itemData.senderItemId ===
                                normalizedExpectedItemId
                            );
                        }
                    ) || null;
            }
            else if (
                items.length === 1
            ) {

                item =
                    items[0];
            }


            let paypalItemId =
                "";

            let transactionId =
                "";

            let transactionStatus =
                "";

            let itemErrors =
                null;

            let payoutItem =
                null;


            if (item) {

                const itemData =
                    this.extractItemData(
                        item
                    );

                paypalItemId =
                    itemData.paypalItemId;

                transactionId =
                    itemData.transactionId;

                transactionStatus =
                    itemData.transactionStatus;

                itemErrors =
                    itemData.errors;

                payoutItem =
                    itemData.payoutItem;
            }


            /*
            ==========================================
            BATCH ERRORS
            ==========================================
            */

            const batchErrors =
                batchHeader.errors ||
                data.errors ||
                null;


            /*
            ==========================================
            ITEM IDENTIFICATION SAFETY
            ==========================================
            */

            const itemIdentificationRequired =
                Boolean(
                    normalizedExpectedItemId &&
                    !item
                );


            let evaluation;


            if (
                itemIdentificationRequired
            ) {

                evaluation = {

                    outcome:
                        "RECONCILIATION_REQUIRED",

                    paypalSuccess:
                        false,

                    paypalFailure:
                        false,

                    paypalProcessing:
                        false,

                    unknownOutcome:
                        true,

                    reconciliationRequired:
                        true
                };

            }
            else {

                evaluation =
                    this.evaluatePayoutStatus(
                        batchStatus,
                        transactionStatus
                    );
            }


            console.log(
                "[PAYPAL] STATUS RESULT:",
                {

                    batchId:
                        payoutBatchId,

                    batchStatus,

                    senderBatchId,

                    itemId:
                        paypalItemId,

                    transactionId,

                    transactionStatus,

                    itemFound:
                        Boolean(item),

                    itemIdentificationRequired,

                    outcome:
                        evaluation.outcome
                }
            );


            return {

    paypalBatchId:
        payoutBatchId,

    batchStatus,

    senderBatchId,

    paypalItemId,

    transactionId,

    transactionStatus,

    batchErrors,

    itemErrors,

    payoutItem,

    items,

    itemFound:
        Boolean(item),

    itemIdentificationRequired,

    paypalSuccess:
        evaluation.paypalSuccess,

    paypalFailure:
        evaluation.paypalFailure,

    paypalProcessing:
        evaluation.paypalProcessing,

    unknownOutcome:
        evaluation.unknownOutcome,

    reconciliationRequired:
        evaluation.reconciliationRequired,

    outcome:
        evaluation.outcome,

    data
};

        }
        catch (error) {

            console.error(
                "[PAYPAL] PAYOUT STATUS REQUEST FAILED"
            );

            const normalized =
                this.normalizePayPalError(
                    error
                );

            console.error(
                "[PAYPAL] Status HTTP:",
                normalized.httpStatus ||
                "N/A"
            );

            console.error(
                "[PAYPAL] Status code:",
                normalized.code
            );

            console.error(
                "[PAYPAL] Status message:",
                normalized.message
            );


            /*
            ==========================================
            CRITICAL

            GET failure does NOT prove payout failure.

            Always return unknown/reconciliation.
            ==========================================
            */

            const statusError =
                new Error(
                    normalized.message
                );

            statusError.code =
                normalized.code;

            statusError.httpStatus =
                normalized.httpStatus ||
                0;

            statusError.unknownOutcome =
                true;

            statusError.reconciliationRequired =
                true;

            statusError.confirmedFailure =
                false;

            statusError.paypalResponse =
                normalized.paypalResponse;

            throw statusError;
        }
    }
}


/*
====================================================
EXPORT SINGLE MANAGER INSTANCE
====================================================
*/

module.exports =
    new PayPalPayoutManager();


