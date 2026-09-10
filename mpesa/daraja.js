const axios = require("axios");
require("dotenv").config();

/**
 * ============================================
 * GET DARAJA ACCESS TOKEN
 * ============================================
 */
const getAccessToken = async () => {
    try {
        const consumerKey = String(
            process.env.CONSUMER_KEY || ""
        ).trim();

        const consumerSecret = String(
            process.env.CONSUMER_SECRET || ""
        ).trim();

        if (!consumerKey || !consumerSecret) {
            throw new Error(
                "CONSUMER_KEY or CONSUMER_SECRET is missing."
            );
        }

        const baseUrl = String(
            process.env.BASE_URL || ""
        ).trim();

        if (!baseUrl) {
            throw new Error(
                "BASE_URL is missing from environment variables."
            );
        }

        const auth = Buffer.from(
            `${consumerKey}:${consumerSecret}`
        ).toString("base64");

        const response = await axios.get(
            `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
            {
                headers: {
                    Authorization: `Basic ${auth}`,
                },
                timeout: 30000,
            }
        );

        if (!response.data?.access_token) {
            throw new Error(
                "Daraja did not return an access token."
            );
        }

        return response.data.access_token;

    } catch (error) {
        console.error("====== DARAJA TOKEN ERROR ======");

        if (error.response) {
            console.error(
                "STATUS:",
                error.response.status
            );

            console.error(
                "DATA:",
                error.response.data
            );
        } else {
            console.error(
                "MESSAGE:",
                error.message
            );
        }

        throw error;
    }
};


/**
 * ============================================
 * FORMAT KENYAN PHONE NUMBER
 * ============================================
 */
const formatPhoneNumber = (phone) => {

    if (phone === undefined || phone === null) {
        throw new Error("Phone number is required.");
    }

    let formattedPhone = String(phone).trim();

    if (!formattedPhone) {
        throw new Error("Phone number is empty.");
    }

    // Remove spaces
    formattedPhone = formattedPhone.replace(/\s+/g, "");

    // +254748441330 -> 254748441330
    if (formattedPhone.startsWith("+254")) {
        formattedPhone = formattedPhone.substring(1);
    }

    // 0748441330 -> 254748441330
    else if (formattedPhone.startsWith("0")) {
        formattedPhone =
            "254" + formattedPhone.substring(1);
    }

    // Basic Kenyan number validation
    if (!/^2547\d{8}$/.test(formattedPhone)) {
        throw new Error(
            `Invalid Kenyan phone number: ${formattedPhone}`
        );
    }

    return formattedPhone;
};


/**
 * ============================================
 * GENERATE DARAJA TIMESTAMP
 * ============================================
 */
const generateTimestamp = () => {

    const now = new Date();

    return (
        now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, "0") +
        String(now.getDate()).padStart(2, "0") +
        String(now.getHours()).padStart(2, "0") +
        String(now.getMinutes()).padStart(2, "0") +
        String(now.getSeconds()).padStart(2, "0")
    );
};


/**
 * ============================================
 * STK PUSH
 * ============================================
 *
 * IMPORTANT:
 *
 * amount is REQUIRED.
 *
 * We intentionally do NOT use:
 *
 * amount = 1
 *
 * because accidentally omitting the amount could
 * result in an unintended KSh 1 STK request.
 *
 * server.js should call:
 *
 * stkPush(phone, planPrice, plan.name)
 *
 * Premium:
 *     750
 *
 * Family:
 *     1800
 */
const stkPush = async (
    phone,
    amount,
    plan
) => {

    try {

        console.log("================================");
        console.log("PREPARING STK PUSH");
        console.log("================================");

        /**
         * ========================================
         * VALIDATE AMOUNT
         * ========================================
         */

        const numericAmount = Number(amount);

        if (
            !Number.isFinite(numericAmount) ||
            numericAmount <= 0
        ) {
            throw new Error(
                `Invalid STK amount: ${amount}`
            );
        }

        /**
         * M-Pesa STK amounts should be whole KES.
         */
        const stkAmount = Math.round(numericAmount);

        if (stkAmount <= 0) {
            throw new Error(
                `Invalid STK amount after rounding: ${stkAmount}`
            );
        }

        /**
         * ========================================
         * VALIDATE PLAN
         * ========================================
         */

        const planName = String(
            plan || ""
        ).trim();

        if (!planName) {
            throw new Error(
                "Subscription plan is required for STK Push."
            );
        }

        /**
         * ========================================
         * FORMAT PHONE
         * ========================================
         */

        const formattedPhone =
            formatPhoneNumber(phone);

        /**
         * ========================================
         * GET ACCESS TOKEN
         * ========================================
         */

        const token =
            await getAccessToken();

        /**
         * ========================================
         * TIMESTAMP
         * ========================================
         */

        const timestamp =
            generateTimestamp();

        /**
         * ========================================
         * SHORTCODE + PASSKEY
         * ========================================
         */

        const shortcode = String(
            process.env.SHORTCODE || ""
        ).trim();

        const passkey = String(
            process.env.PASSKEY || ""
        ).trim();

        if (!shortcode) {
            throw new Error(
                "SHORTCODE is missing from environment variables."
            );
        }

        if (!passkey) {
            throw new Error(
                "PASSKEY is missing from environment variables."
            );
        }

        /**
         * ========================================
         * GENERATE PASSWORD
         * ========================================
         */

        const password = Buffer.from(
            shortcode +
            passkey +
            timestamp
        ).toString("base64");

        /**
         * ========================================
         * CALLBACK URL
         * ========================================
         */

        const callbackBaseUrl = String(
            process.env.CALLBACK_BASE_URL || ""
        ).trim();

        if (!callbackBaseUrl) {
            throw new Error(
                "CALLBACK_BASE_URL is missing."
            );
        }

        const callbackUrl =
            `${callbackBaseUrl}/mpesa/callback`;

        /**
         * ========================================
         * STK PAYLOAD
         * ========================================
         */

        const payload = {

            BusinessShortCode:
                shortcode,

            Password:
                password,

            Timestamp:
                timestamp,

            TransactionType:
                "CustomerPayBillOnline",

            /**
             * THIS IS NOW ALWAYS THE
             * ACTUAL PLAN AMOUNT.
             *
             * Premium = 750
             * Family  = 1800
             */
            Amount:
                stkAmount,

            PartyA:
                formattedPhone,

            PartyB:
                shortcode,

            PhoneNumber:
                formattedPhone,

            CallBackURL:
                callbackUrl,

            AccountReference:
                `ParentIQ-${planName}`,

            TransactionDesc:
                `ParentIQ ${planName} Subscription`
        };

        /**
         * ========================================
         * DEBUG LOG
         * ========================================
         */

        console.log("====== STK PAYLOAD ======");
        console.log({
            BusinessShortCode:
                payload.BusinessShortCode,

            TransactionType:
                payload.TransactionType,

            Amount:
                payload.Amount,

            PartyA:
                payload.PartyA,

            PartyB:
                payload.PartyB,

            PhoneNumber:
                payload.PhoneNumber,

            CallBackURL:
                payload.CallBackURL,

            AccountReference:
                payload.AccountReference,

            TransactionDesc:
                payload.TransactionDesc
        });

        console.log("================================");
        console.log("STK AMOUNT CHECK");
        console.log("================================");
        console.log("Original amount:", amount);
        console.log("Numeric amount:", numericAmount);
        console.log("Amount sent to Safaricom:", stkAmount);
        console.log("Plan:", planName);
        console.log("Phone:", formattedPhone);
        console.log("================================");

        /**
         * ========================================
         * SEND STK PUSH
         * ========================================
         */

        const baseUrl = String(
            process.env.BASE_URL || ""
        ).trim();

        const response = await axios.post(
            `${baseUrl}/mpesa/stkpush/v1/processrequest`,
            payload,
            {
                timeout: 30000,

                headers: {
                    Authorization:
                        `Bearer ${token}`,

                    "Content-Type":
                        "application/json"
                }
            }
        );

        /**
         * ========================================
         * DARAJA RESPONSE
         * ========================================
         */

        console.log("====== STK RESPONSE ======");

        console.log(
            response.data
        );

        console.log("================================");
        console.log("STK REQUEST ACCEPTED");
        console.log("================================");

        console.log(
            "CheckoutRequestID:",
            response.data?.CheckoutRequestID
        );

        console.log(
            "MerchantRequestID:",
            response.data?.MerchantRequestID
        );

        console.log(
            "ResponseCode:",
            response.data?.ResponseCode
        );

        console.log(
            "Amount requested:",
            stkAmount
        );

        console.log(
            "Phone:",
            formattedPhone
        );

        console.log("================================");

        return response.data;

    } catch (error) {

        console.log(
            "====== DARAJA ERROR ======"
        );

        if (error.response) {

            console.log(
                "STATUS:",
                error.response.status
            );

            console.log(
                "DATA:",
                error.response.data
            );

        } else {

            console.log(
                "MESSAGE:",
                error.message
            );
        }

        throw error;
    }
};


/**
 * ============================================
 * EXPORTS
 * ============================================
 */
module.exports = {
    stkPush,
    getAccessToken
};