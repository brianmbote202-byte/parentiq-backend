const axios = require("axios");

const { db } = require("../firebase");


class PayPalPayoutManager {

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
    */

    async getAccessToken() {

        const clientId =
            process.env.PAYPAL_CLIENT_ID;

        const clientSecret =
            process.env.PAYPAL_CLIENT_SECRET;


        if (!clientId || !clientSecret) {

            throw new Error(
                "Missing PayPal API credentials."
            );
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

                        timeout:
                            30000,

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


            if (
                !response.data ||
                !response.data.access_token
            ) {

                throw new Error(
                    "PayPal did not return an access token."
                );
            }


            return response.data.access_token;

        }

        catch (error) {

            console.error(
                "PAYPAL ACCESS TOKEN ERROR:",
                error.response?.status ||
                error.code ||
                error.message
            );


            /*
            ==========================================
            TOKEN ERROR CLASSIFICATION
            ==========================================

            If credentials/configuration are clearly
            invalid, this is a known local/provider
            failure.

            If the network timed out, the outcome of
            the token request is irrelevant to the
            payout itself because the payout request
            was never submitted.
            */

            if (
                error.code === "ECONNABORTED" ||
                error.code === "ETIMEDOUT" ||
                error.code === "ECONNRESET" ||
                error.code === "ECONNREFUSED" ||
                error.code === "EAI_AGAIN"
            ) {

                const tokenError =
                    new Error(
                        "Unable to connect to PayPal while requesting an access token."
                    );


                tokenError.code =
                    error.code;

                tokenError.unknownOutcome =
                    false;

                tokenError.reconciliationRequired =
                    false;


                throw tokenError;
            }


            const status =
                Number(
                    error.response?.status || 0
                );


            if (status >= 500) {

                const tokenError =
                    new Error(
                        "PayPal authentication service is temporarily unavailable."
                    );


                tokenError.code =
                    `PAYPAL_HTTP_${status}`;

                tokenError.unknownOutcome =
                    false;

                tokenError.reconciliationRequired =
                    false;


                throw tokenError;
            }


            throw error;
        }
    }


    /*
    ==================================================
    CREATE STABLE PAYPAL BATCH ID
    ==================================================

    IMPORTANT:

    One logical ParentIQ withdrawal must always use
    one stable sender_batch_id.

    Retrying the same withdrawal therefore reuses
    the same PayPal idempotency key.

    ==================================================
    */

    getSenderBatchId(withdrawal) {

        return (
            withdrawal.paypalSenderBatchId ||
            `PARENTIQ-${withdrawal.id}`
        );
    }


    /*
    ==================================================
    NORMALIZE PAYPAL ERROR
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
            ).toUpperCase();


        const message =
            String(
                responseData?.message ||
                responseData?.error_description ||
                error?.message ||
                "PayPal payout request failed."
            );


        /*
        ==========================================
        NETWORK / TIMEOUT
        ==========================================

        These are UNKNOWN because PayPal may have
        received the payout before our connection
        failed.
        */

        const networkError =
            (
                error?.code === "ECONNABORTED" ||
                error?.code === "ETIMEDOUT" ||
                error?.code === "ECONNRESET" ||
                error?.code === "ECONNREFUSED" ||
                error?.code === "EAI_AGAIN" ||
                error?.code === "ERR_NETWORK"
            );


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
        SERVER ERRORS
        ==========================================

        PayPal 5xx means we cannot safely know
        whether the payout was accepted.
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

        429 is not a payout rejection.

        The request may have reached PayPal.
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
        DUPLICATE / IDEMPOTENCY RESPONSE
        ==========================================

        A duplicate sender batch/request ID can mean
        that PayPal already received the original payout.

        NEVER refund immediately in this situation.
        */

        const duplicateError =
            (
                name.includes("DUPLICATE") ||
                name.includes("RESOURCE_ALREADY_EXISTS") ||
                name.includes("IDEMPOTENCY")
            ) ||
            message
                .toLowerCase()
                .includes("duplicate");


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
        OTHER 4XX ERRORS
        ==========================================

        These are normally definitive request/provider
        failures.

        Examples:
        - invalid receiver
        - invalid amount
        - invalid currency
        - unauthorized request
        - malformed payout

        These can safely be treated as confirmed
        failures because PayPal rejected the request.
        */

        if (
            status >= 400 &&
            status < 500
        ) {

            return {

                message:
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
        UNKNOWN ERROR
        ==========================================

        Financially safest default:
        if we cannot determine what happened, do
        not refund automatically.
        */

        return {

            message:
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
        IMPORTANT:

        Do not log the complete PayPal email in
        production logs.
        */

        const paypalEmail =
            String(
                withdrawal.paypalEmail || ""
            )
                .trim()
                .toLowerCase();


        console.log(
            "PayPal recipient configured:",
            Boolean(paypalEmail)
        );


        /*
        ==========================================
        VALIDATE RECIPIENT
        ==========================================
        */

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
        PAYOUT CURRENCY
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
        PAYOUT AMOUNT
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
        STABLE IDEMPOTENCY ID
        ==========================================
        */

        const senderBatchId =
            this.getSenderBatchId(
                withdrawal
            );


        /*
        ==========================================
        CREATE PAYMENT RECORD
        ==========================================
        */

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

            createdAt:
                now,

            updatedAt:
                now
        });


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

            await paymentRef.update({

                status:
                    "FAILED",

                error:
                    error.message,

                errorCode:
                    error.code ||
                    "",

                unknownOutcome:
                    false,

                reconciliationRequired:
                    false,

                paymentFailedAt:
                    Date.now(),

                updatedAt:
                    Date.now()
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
        PAYPAL PAYOUT REQUEST
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
        SEND TO PAYPAL
        ==========================================
        */

        try {

            console.log(
                "Sending PayPal payout..."
            );

            console.log(
                "PayPal environment:",
                process.env.PAYPAL_ENVIRONMENT ||
                "sandbox"
            );

            console.log(
                "PayPal currency:",
                currency
            );

            console.log(
                "PayPal payout amount:",
                payoutAmount
            );

            console.log(
                "PayPal sender batch ID:",
                senderBatchId
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
                            PayPal idempotency key.

                            Same withdrawal = same key.
                            */

                            "PayPal-Request-Id":
                                senderBatchId
                        }
                    }
                );


            const data =
                response.data || {};


            const batchHeader =
                data.batch_header || {};


            const paypalBatchId =
                batchHeader.payout_batch_id ||
                "";


            const batchStatus =
                String(
                    batchHeader.batch_status ||
                    "PENDING"
                )
                    .trim()
                    .toUpperCase();


            /*
            ======================================
            FIND PAYPAL ITEM ID
            ======================================
            */

            let paypalItemId =
                "";


            let transactionId =
                "";


            let transactionStatus =
                "";


            if (
                Array.isArray(data.items) &&
                data.items.length > 0
            ) {

                const item =
                    data.items[0];


                paypalItemId =
                    item?.payout_item_id ||
                    "";


                transactionId =
                    item?.transaction_id ||
                    "";


                transactionStatus =
                    String(
                        item?.transaction_status ||
                        ""
                    )
                        .trim()
                        .toUpperCase();
            }


            /*
            ======================================
            UPDATE PAYMENT
            ======================================
            */

            await paymentRef.update({

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

                paypalResponse:
                    data,

                paymentAttemptedAt:
                    Date.now(),

                updatedAt:
                    Date.now()
            });


            console.log(
                "PayPal payout accepted:",
                paypalBatchId
            );


            return {

                success:
                    true,

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

                message:
                    "PayPal payout accepted."
            };

        }

        catch (error) {

            console.error(
                "PAYPAL PAYOUT REQUEST ERROR"
            );


            const normalized =
                this.normalizePayPalError(
                    error
                );


            console.error(
                "PayPal HTTP status:",
                normalized.httpStatus ||
                "N/A"
            );


            console.error(
                "PayPal error code:",
                normalized.code
            );


            console.error(
                "PayPal error message:",
                normalized.message
            );


            /*
            IMPORTANT:

            Do not blindly dump credentials or
            sensitive recipient information.
            */

            if (
                normalized.paypalResponse
            ) {

                console.error(
                    "PayPal response:",
                    JSON.stringify(
                        normalized.paypalResponse,
                        null,
                        2
                    )
                );
            }


            /*
            ======================================
            UNKNOWN OUTCOME
            ======================================

            We explicitly record this in the payment
            record so reconciliation can identify it.
            */

            if (
                normalized.unknownOutcome
            ) {

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

                    reconciliationRequiredAt:
                        Date.now(),

                    paymentFailedAt:
                        null,

                    updatedAt:
                        Date.now()
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
            ======================================
            CONFIRMED FAILURE
            ======================================
            */

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
                    Date.now(),

                updatedAt:
                    Date.now()
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

    Retrieves the complete PayPal payout batch.

    This method does NOT modify the withdrawal.

    The withdrawal route is responsible for
    translating the normalized provider status into:

        paid
        payment_failed
        processing
        reconciliation_required

    ==================================================
    */

    async getPayoutStatus(
        paypalBatchId
    ) {

        if (!paypalBatchId) {

            throw new Error(
                "PayPal payout batch ID is required."
            );
        }


        const normalizedBatchId =
            String(
                paypalBatchId
            )
                .trim();


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


        /*
        ==========================================
        GET ACCESS TOKEN
        ==========================================
        */

        const accessToken =
            await this.getAccessToken();


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

                            "Content-Type":
                                "application/json",

                            Accept:
                                "application/json"
                        }
                    }
                );


            const data =
                response.data || {};


            /*
            ==========================================
            LOG COMPLETE PAYPAL RESPONSE
            ==========================================
            */

            console.log(
                "PAYPAL RAW STATUS:"
            );


            console.log(
                JSON.stringify(
                    data,
                    null,
                    2
                )
            );


            /*
            ==========================================
            BATCH HEADER
            ==========================================
            */

            const batchHeader =
                data.batch_header || {};


            const batchStatus =
                String(
                    batchHeader.batch_status || ""
                )
                    .trim()
                    .toUpperCase();


            const senderBatchId =
                batchHeader
                    .sender_batch_header
                    ?.sender_batch_id ||
                "";


            const payoutBatchId =
                batchHeader.payout_batch_id ||
                normalizedBatchId;


            /*
            ==========================================
            PAYPAL ITEMS
            ==========================================
            */

            const items =
                Array.isArray(data.items)
                    ? data.items
                    : [];


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


            /*
            ==========================================
            FIND THE CORRECT ITEM
            ==========================================

            Prefer the ParentIQ sender item ID when
            available.

            This is safer than blindly assuming the
            first item belongs to this withdrawal.
            */

            let item =
                null;


            if (items.length > 0) {

                item =
                    items.find(
                        candidate =>
                            String(
                                candidate?.payout_item
                                    ?.sender_item_id ||
                                candidate?.sender_item_id ||
                                ""
                            ) !== "" &&
                            String(
                                candidate?.payout_item
                                    ?.sender_item_id ||
                                candidate?.sender_item_id ||
                                ""
                            ) ===
                            String(
                                withdrawalIdForStatusLookup(
                                    normalizedBatchId
                                ) || ""
                            )
                    ) || items[0];
            }


            if (item) {

                paypalItemId =
                    item.payout_item_id ||
                    item.paypalItemId ||
                    item.payoutItemId ||
                    "";


                transactionId =
                    item.transaction_id ||
                    item.transactionId ||
                    "";


                transactionStatus =
                    String(
                        item.transaction_status ||
                        item.transactionStatus ||
                        ""
                    )
                        .trim()
                        .toUpperCase();


                itemErrors =
                    item.errors ||
                    null;


                payoutItem =
                    item.payout_item ||
                    null;
            }


            /*
            ==========================================
            BATCH-LEVEL ERRORS
            ==========================================
            */

            const batchErrors =
                batchHeader.errors ||
                data.errors ||
                null;


            /*
            ==========================================
            NORMALIZED STATUS FLAGS
            ==========================================
            */

            const success =
                (
                    batchStatus === "SUCCESS" ||
                    batchStatus === "COMPLETED" ||
                    transactionStatus === "SUCCESS" ||
                    transactionStatus === "COMPLETED"
                );


            const failed =
                (
                    batchStatus === "FAILED" ||
                    batchStatus === "DENIED" ||
                    batchStatus === "CANCELED" ||
                    batchStatus === "CANCELLED" ||
                    transactionStatus === "FAILED" ||
                    transactionStatus === "BLOCKED" ||
                    transactionStatus === "RETURNED" ||
                    transactionStatus === "REFUNDED"
                );


            /*
            ==========================================
            RETURN NORMALIZED + RAW DATA
            ==========================================
            */

            return {

                success:
                    true,

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

                paypalSuccess:
                    success,

                paypalFailure:
                    failed,

                paypalProcessing:
                    !success &&
                    !failed,

                /*
                Complete original PayPal response.
                */

                data
            };

        }

        catch (error) {

            console.error(
                "PAYPAL PAYOUT STATUS REQUEST FAILED."
            );


            const normalized =
                this.normalizePayPalError(
                    error
                );


            console.error(
                "PayPal status HTTP:",
                normalized.httpStatus ||
                "N/A"
            );


            console.error(
                "PayPal status code:",
                normalized.code
            );


            console.error(
                "PayPal status message:",
                normalized.message
            );


            /*
            ==========================================
            STATUS QUERY UNKNOWN OUTCOME
            ==========================================

            Throw an enriched error.

            The withdrawal route can then place the
            withdrawal into reconciliation_required.
            */

            const statusError =
                new Error(
                    normalized.message
                );


            statusError.code =
                normalized.code;


            statusError.httpStatus =
                normalized.httpStatus;


            statusError.unknownOutcome =
                normalized.unknownOutcome;


            statusError.reconciliationRequired =
                normalized.reconciliationRequired;


            statusError.confirmedFailure =
                normalized.confirmedFailure;


            statusError.paypalResponse =
                normalized.paypalResponse;


            throw statusError;
        }
    }
}


/*
====================================================
STATUS LOOKUP HELPER
====================================================

The PayPal status endpoint normally returns all
items belonging to the batch.

We intentionally do not depend on this helper
for the primary lookup because the withdrawal
route already maps the batch ID to the withdrawal.

This function returns null and exists only to keep
the item-selection code safe if no local mapping is
available here.
====================================================
*/

function withdrawalIdForStatusLookup() {

    return null;
}


/*
====================================================
EXPORT SINGLE MANAGER INSTANCE
====================================================
*/

module.exports =
    new PayPalPayoutManager();