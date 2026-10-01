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

            if (
                !response.data ||
                !response.data.access_token
            ) {

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
            TOKEN REQUEST FAILED

            IMPORTANT:

            No payout POST has been sent yet.

            Therefore a failure while obtaining the
            OAuth token does NOT create an unknown
            payout outcome.

            The payout itself has not been submitted.
            ==========================================
            */

            if (
                error.code === "ECONNABORTED" ||
                error.code === "ETIMEDOUT" ||
                error.code === "ECONNRESET" ||
                error.code === "ECONNREFUSED" ||
                error.code === "EAI_AGAIN" ||
                error.code === "ERR_NETWORK"
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

                tokenError.confirmedFailure =
                    true;

                throw tokenError;
            }

            const status =
                Number(
                    error.response?.status || 0
                );

            /*
            ==========================================
            PAYPAL AUTH SERVER ERROR

            The OAuth request happens before the payout
            POST, therefore it does not create an
            unknown payout outcome.
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
            NORMAL AUTH ERROR
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
    GET STABLE PAYPAL BATCH ID
    ==================================================

    One unresolved ParentIQ payout must keep the same
    sender_batch_id.

    This is important for safe retries.
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
    CREATE NEW PAYPAL ATTEMPT ID
    ==================================================

    ONLY use this after a payout has been definitively
    failed and ParentIQ intentionally wants a NEW
    payout attempt.

    Never use this after:
      - timeout
      - network reset
      - 409
      - 429
      - 5xx
      - connection loss
      - ambiguous provider response
    ==================================================
    */

    createNewSenderBatchId(withdrawal) {

        const attemptNumber =
            Number(
                withdrawal.paypalAttemptNumber || 0
            ) + 1;

        const timestamp =
            Date.now();

        return (
            `PARENTIQ-${withdrawal.id}-A${attemptNumber}-${timestamp}`
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


        /*
        ==========================================
        NETWORK / TIMEOUT

        The payout may have reached PayPal before
        our connection failed.

        Therefore:
          UNKNOWN
          RECONCILIATION REQUIRED
        ==========================================
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
        OTHER 4XX ERRORS

        These indicate PayPal rejected the payout
        request before accepting it.
        ==========================================
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

        Financially safest default:
        do not automatically restore wallet funds.
        ==========================================
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
    EVALUATE PAYOUT STATUS
    ==================================================

    IMPORTANT:

    Batch SUCCESS does NOT automatically mean that
    this particular recipient received the money.

    The payout item transaction status is authoritative
    for the specific withdrawal.
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


        /*
        ==========================================
        ITEM STATES
        ==========================================
        */

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

        const itemProcessing =
            (
                transaction === "PENDING" ||
                transaction === "UNCLAIMED" ||
                transaction === "ONHOLD" ||
                transaction === "BLOCKED"
            );


        /*
        ==========================================
        BATCH STATES
        ==========================================
        */

        const batchDenied =
            batch === "DENIED";

        const batchCanceled =
            (
                batch === "CANCELED" ||
                batch === "CANCELLED"
            );


        /*
        ==========================================
        CONTRADICTORY STATES
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
        SUCCESS

        Item SUCCESS is the only normal PayPal success
        condition.
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
        CONFIRMED ITEM FAILURE
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

        Do not silently turn these into an ordinary
        failed submission because money may already
        have moved and then returned.
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
        BATCH SUCCESS BUT NO CONFIRMED ITEM SUCCESS

        Never mark the withdrawal paid here.
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
        UNKNOWN / ORDINARY PROCESSING
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

    Prevents repeated HTTP requests from creating
    unnecessary local payment records for the same
    unresolved payout.
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
                            payment.provider !==
                            "PAYPAL"
                        ) {
                            return false;
                        }

                        if (
                            payment.senderBatchId !==
                            senderBatchId
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
                            Number(b.updatedAt || 0) -
                            Number(a.updatedAt || 0)
                    );

            return candidates[0] || null;

        }
        catch (error) {

            console.error(
                "PAYPAL PAYMENT LOOKUP ERROR:",
                error.message
            );

            /*
            Do not block the payout solely because
            the local payment-history lookup failed.

            The withdrawal transaction itself is already
            protected by the route-level processing claim.
            */

            return null;
        }
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
        VALIDATE RECIPIENT
        ==========================================
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


        /*
        ==========================================
        VALIDATE EMAIL
        ==========================================
        */

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
        FIND EXISTING PAYMENT

        If the same unresolved payout already has a
        local payment record, reuse it.
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

            console.log(
                "[PAYPAL] Reusing existing local payment:",
                paymentId
            );

        }
        else {

            paymentRef =
                db
                    .ref("payments")
                    .push();

            paymentId =
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
            No payout POST was sent.

            Therefore the payout itself has not entered
            an unknown state.
            */

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
        PAYOUT PAYLOAD
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
                "[PAYPAL] Sending payout to PayPal..."
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
                            ==================================
                            PAYPAL IDEMPOTENCY KEY
                            ==================================
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


            /*
            ==========================================
            PAYPAL BATCH ID
            ==========================================
            */

            const paypalBatchId =
                batchHeader.payout_batch_id ||
                "";


            /*
            ==========================================
            MISSING BATCH ID

            A successful HTTP response without a payout
            batch ID cannot safely be considered a valid
            payout submission.
            ==========================================
            */

            if (!paypalBatchId) {

                const missingBatchError =
                    new Error(
                        "PayPal accepted the request but did not return a payout batch ID."
                    );

                missingBatchError.code =
                    "PAYPAL_BATCH_ID_MISSING";

                missingBatchError.unknownOutcome =
                    true;

                missingBatchError.reconciliationRequired =
                    true;

                missingBatchError.confirmedFailure =
                    false;

                throw missingBatchError;
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
            FIND PAYPAL ITEM
            ==========================================

            Prefer sender_item_id matching ParentIQ's
            withdrawal ID.
            ==========================================
            */

            let paypalItemId =
                "";

            let transactionId =
                "";

            let transactionStatus =
                "";

            let payoutItem =
                null;

            let selectedItem =
                null;


            if (
                Array.isArray(data.items) &&
                data.items.length > 0
            ) {

                selectedItem =
                    data.items.find(
                        candidate => {

                            const senderItemId =
                                String(
                                    candidate
                                        ?.payout_item
                                        ?.sender_item_id ||
                                    candidate
                                        ?.sender_item_id ||
                                    ""
                                );

                            return (
                                senderItemId &&
                                senderItemId ===
                                String(
                                    withdrawal.id
                                )
                            );
                        }
                    ) || null;


                /*
                If PayPal returned exactly one item and
                it contains no sender_item_id, it is safe
                to use it because this request contains
                exactly one payout item.
                */

                if (
                    !selectedItem &&
                    data.items.length === 1
                ) {

                    selectedItem =
                        data.items[0];
                }
            }


            if (selectedItem) {

                paypalItemId =
                    selectedItem.payout_item_id ||
                    "";

                transactionId =
                    selectedItem.transaction_id ||
                    "";

                transactionStatus =
                    this.normalizeTransactionStatus(
                        selectedItem.transaction_status
                    );

                payoutItem =
                    selectedItem.payout_item ||
                    null;
            }


            /*
            ==========================================
            ITEM IDENTIFICATION SAFETY
            ==========================================
            */

            const itemIdentificationRequired =
                (
                    Array.isArray(data.items) &&
                    data.items.length > 1 &&
                    !selectedItem
                );


            let evaluation;


            if (itemIdentificationRequired) {

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


            /*
            ==========================================
            UPDATE LOCAL PAYMENT
            ==========================================
            */

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
                    Date.now(),

                reconciliationRequiredAt:
                    evaluation.reconciliationRequired
                        ? Date.now()
                        : null,

                paymentFailedAt:
                    evaluation.paypalFailure
                        ? Date.now()
                        : null,

                updatedAt:
                    Date.now()
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
                    "[PAYPAL] Payout immediately completed:",
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
                    "[PAYPAL] Payout requires reconciliation:",
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
                    "[PAYPAL] Payout failed:",
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
            NORMAL PROCESSING
            ==========================================
            */

            console.log(
                "[PAYPAL] Payout accepted and processing:",
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

                confirmedFailure:
                    false,

                message:
                    "PayPal payout accepted."
            };
        }


        /*
        ==========================================
        PAYPAL REQUEST ERROR
        ==========================================
        */

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


            /*
            ==========================================
            OPTIONAL DEBUG LOGGING
            ==========================================
            */

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
            UNKNOWN OUTCOME
            ==========================================
            */

            if (
                normalized.unknownOutcome ||
                normalized.reconciliationRequired
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

                    confirmedFailure:
                        false,

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
            ==========================================
            CONFIRMED FAILURE
            ==========================================
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

    Retrieves the latest PayPal payout batch.

    IMPORTANT:

    This method NEVER modifies the withdrawal.

    The withdrawal route decides whether the result
    changes wallet state.
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
            )
                .trim();

        const normalizedExpectedItemId =
            String(
                expectedSenderItemId || ""
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

        if (normalizedExpectedItemId) {

            console.log(
                "Expected sender item ID:",
                normalizedExpectedItemId
            );
        }


        /*
        ==========================================
        GET ACCESS TOKEN
        ==========================================

        IMPORTANT:

        Failure to obtain an access token while checking
        an existing payout does NOT prove that the payout
        failed.

        Therefore status verification errors are treated
        as UNKNOWN / RECONCILIATION REQUIRED.
        ==========================================
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
                error.httpStatus || 0;

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
                response.data || {};


            /*
            ==========================================
            BATCH HEADER
            ==========================================
            */

            const batchHeader =
                data.batch_header || {};

            const batchStatus =
                String(
                    batchHeader.batch_status ||
                    ""
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

            let item =
                null;


            /*
            ==========================================
            FIND EXPECTED ITEM
            ==========================================

            If ParentIQ supplies an expected sender item
            ID, we MUST match it.

            We do NOT fall back to another item.

            Only when no expected ID is supplied and
            exactly one item exists may we safely use
            that item.
            ==========================================
            */

            if (
                normalizedExpectedItemId &&
                items.length > 0
            ) {

                item =
                    items.find(
                        candidate => {

                            const senderItemId =
                                String(
                                    candidate
                                        ?.payout_item
                                        ?.sender_item_id ||
                                    candidate
                                        ?.sender_item_id ||
                                    ""
                                )
                                    .trim();

                            return (
                                senderItemId ===
                                normalizedExpectedItemId
                            );
                        }
                    ) || null;
            }
            else if (
                !normalizedExpectedItemId &&
                items.length === 1
            ) {

                item =
                    items[0];
            }


            /*
            ==========================================
            EXTRACT ITEM DATA
            ==========================================
            */

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
                    this.normalizeTransactionStatus(

                        item.transaction_status ||
                        item.transactionStatus
                    );

                itemErrors =
                    item.errors ||
                    null;

                payoutItem =
                    item.payout_item ||
                    null;
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

            If ParentIQ knows the expected item but
            PayPal does not return that item, we cannot
            safely assign another recipient's payout to
            this withdrawal.
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


            /*
            ==========================================
            LOG RESULT
            ==========================================
            */

            console.log(
                "[PAYPAL] Status result:",
                {
                    batchId:
                        payoutBatchId,

                    batchStatus,

                    itemId:
                        paypalItemId,

                    transactionId,

                    transactionStatus,

                    itemFound:
                        Boolean(item),

                    outcome:
                        evaluation.outcome
                }
            );


            /*
            ==========================================
            RETURN NORMALIZED RESULT
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
            STATUS LOOKUP FAILURE

            CRITICAL:

            A failed GET request does not mean that the
            original payout failed.

            Therefore network/5xx/429/409/unknown
            status lookup failures remain unresolved.
            ==========================================
            */

            const statusError =
                new Error(
                    normalized.message
                );

            statusError.code =
                normalized.code;

            statusError.httpStatus =
                normalized.httpStatus || 0;

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