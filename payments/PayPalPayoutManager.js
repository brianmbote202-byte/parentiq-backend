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
                            "application/x-www-form-urlencoded"

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


    /*
    ==================================================
    CREATE STABLE PAYPAL BATCH ID
    ==================================================

    IMPORTANT:

    This ID remains stable when retrying the same
    logical withdrawal.

    PayPal uses sender_batch_id to prevent duplicate
    payouts.
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

        console.log(
            "PayPal email:",
            withdrawal.paypalEmail
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


        if (!paypalEmail) {

            throw new Error(
                "PayPal email is required."
            );
        }


        const emailRegex =
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


        if (!emailRegex.test(paypalEmail)) {

            throw new Error(
                "Invalid PayPal email address."
            );
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

            throw new Error(
                "Invalid PayPal payout amount."
            );
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
                    "Your ParentIQ commission payout has been sent."
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
                batchHeader.payout_batch_id || "";


            const batchStatus =
                batchHeader.batch_status ||
                "PENDING";


            /*
            ======================================
            FIND PAYPAL ITEM ID
            ======================================
            */

            let paypalItemId =
                "";


            if (
                Array.isArray(data.items) &&
                data.items.length > 0
            ) {

                paypalItemId =
                    data.items[0]
                        ?.payout_item_id ||
                    "";
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

                paypalBatchStatus:
                    batchStatus,

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

                paypalBatchStatus:
                    batchStatus,

                message:
                    "PayPal payout accepted."
            };

        }

        catch (error) {

            console.error(
                "PayPal payout failed."
            );


            let message =
                error.message;


            let paypalResponse =
                null;


            if (error.response) {

                paypalResponse =
                    error.response.data;


                console.error(
                    "PayPal HTTP:",
                    error.response.status
                );


                console.error(
                    "PayPal response:",
                    JSON.stringify(
                        paypalResponse,
                        null,
                        2
                    )
                );


                message =
                    paypalResponse?.message ||
                    paypalResponse?.name ||
                    JSON.stringify(
                        paypalResponse
                    );
            }


            await paymentRef.update({

                status:
                    "FAILED",

                error:
                    message,

                paypalResponse,

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

                message
            };
        }
    }


    /*
    ==================================================
    GET PAYPAL PAYOUT STATUS
    ==================================================

    This retrieves the complete PayPal payout batch.

    We intentionally return the raw PayPal response
    as well as normalized fields so that:

        DENIED
        FAILED
        SUCCESS
        COMPLETED
        PROCESSING

    can be diagnosed correctly.
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
            paypalBatchId
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

                    `${this.getBaseUrl()}/v1/payments/payouts/${encodeURIComponent(paypalBatchId)}`,

                    {

                        timeout:
                            30000,

                        headers: {

                            Authorization:
                                `Bearer ${accessToken}`,

                            "Content-Type":
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


            if (items.length > 0) {

                const item =
                    items[0];


                paypalItemId =
                    item.payout_item_id ||
                    "";


                transactionId =
                    item.transaction_id ||
                    "";


                transactionStatus =
                    String(
                        item.transaction_status || ""
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
            RETURN NORMALIZED + RAW DATA
            ==========================================
            */

            return {

                success:
                    true,

                paypalBatchId:
                    batchHeader.payout_batch_id ||
                    paypalBatchId,

                batchStatus,

                senderBatchId,

                paypalItemId,

                transactionId,

                transactionStatus,

                batchErrors,

                itemErrors,

                payoutItem,

                items,

                /*
                Complete original PayPal response.
                */

                data
            };

        }

        catch (error) {

            console.error(
                "PayPal payout status request failed."
            );


            if (error.response) {

                console.error(
                    "PayPal status HTTP:",
                    error.response.status
                );


                console.error(
                    "PayPal status response:",
                    JSON.stringify(
                        error.response.data,
                        null,
                        2
                    )
                );
            }


            throw error;
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