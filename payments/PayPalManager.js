const crypto = require("crypto");

const PAYPAL_BASE_URL =
    process.env.PAYPAL_BASE_URL ||
    "https://api-m.sandbox.paypal.com";

const PAYPAL_CLIENT_ID =
    process.env.PAYPAL_CLIENT_ID;

const PAYPAL_CLIENT_SECRET =
    process.env.PAYPAL_CLIENT_SECRET;

const PAYPAL_RETURN_URL =
    process.env.PAYPAL_RETURN_URL;

const PAYPAL_CANCEL_URL =
    process.env.PAYPAL_CANCEL_URL;

const PREMIUM_PRICE_USD =
    process.env.PAYPAL_PREMIUM_PRICE_USD || "9.99";

const FAMILY_PRICE_USD =
    process.env.PAYPAL_FAMILY_PRICE_USD || "19.99";


class PayPalManager {

    /**
     * ==========================================================
     * VALIDATE CONFIGURATION
     * ==========================================================
     */
    validateConfig() {

        if (!PAYPAL_CLIENT_ID) {
            throw new Error(
                "PAYPAL_CLIENT_ID is missing."
            );
        }

        if (!PAYPAL_CLIENT_SECRET) {
            throw new Error(
                "PAYPAL_CLIENT_SECRET is missing."
            );
        }

        if (!PAYPAL_RETURN_URL) {
            throw new Error(
                "PAYPAL_RETURN_URL is missing."
            );
        }

        if (!PAYPAL_CANCEL_URL) {
            throw new Error(
                "PAYPAL_CANCEL_URL is missing."
            );
        }

    }


    /**
     * ==========================================================
     * GET ACCESS TOKEN
     * ==========================================================
     */
    async getAccessToken() {

        this.validateConfig();

        const auth =
            Buffer
                .from(
                    `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`
                )
                .toString("base64");

        const response =
            await fetch(
                `${PAYPAL_BASE_URL}/v1/oauth2/token`,
                {
                    method: "POST",

                    headers: {

                        Authorization:
                            `Basic ${auth}`,

                        "Content-Type":
                            "application/x-www-form-urlencoded"

                    },

                    body:
                        "grant_type=client_credentials"
                }
            );

        const data =
            await response.json();

        if (!response.ok) {

            console.error(
                "PayPal OAuth error:",
                data
            );

            throw new Error(
                data.error_description ||
                "Unable to obtain PayPal access token."
            );

        }

        return data.access_token;

    }


    /**
     * ==========================================================
     * GENERIC REQUEST
     * ==========================================================
     */
    async request(
        endpoint,
        {
            method = "GET",
            body = null,
            headers = {}
        } = {}
    ) {

        const accessToken =
            await this.getAccessToken();

        const requestHeaders = {

            Authorization:
                `Bearer ${accessToken}`,

            Accept:
                "application/json",

            ...headers

        };

        if (body !== null) {

            requestHeaders["Content-Type"] =
                "application/json";

        }

        const response =
            await fetch(
                `${PAYPAL_BASE_URL}${endpoint}`,
                {
                    method,

                    headers:
                        requestHeaders,

                    body:
                        body === null
                            ? undefined
                            : JSON.stringify(body)
                }
            );

        const data =
            await response.json();

        if (!response.ok) {

            console.error(
                "PayPal API error:",
                JSON.stringify(
                    data,
                    null,
                    2
                )
            );

            const error =
                new Error(
                    data?.message ||
                    data?.name ||
                    "PayPal API request failed."
                );

            error.paypal =
                data;

            throw error;
        }

        return data;

    }


    /**
     * ==========================================================
     * GET PRICE
     * ==========================================================
     */
    getPlanPrice(planId) {

        if (planId === "premium") {

            return {
                amount:
                    Number(
                        PREMIUM_PRICE_USD
                    ).toFixed(2),

                currency:
                    "USD"
            };

        }

        if (planId === "family") {

            return {
                amount:
                    Number(
                        FAMILY_PRICE_USD
                    ).toFixed(2),

                currency:
                    "USD"
            };

        }

        throw new Error(
            "PayPal plan is not supported."
        );

    }


    /**
     * ==========================================================
     * CREATE ORDER
     * ==========================================================
     */
    async createOrder({
        uid,
        childId,
        planId
    }) {

        if (!uid) {
            throw new Error(
                "uid is required."
            );
        }

        if (!childId) {
            throw new Error(
                "childId is required."
            );
        }

        if (!planId) {
            throw new Error(
                "planId is required."
            );
        }

        const price =
            this.getPlanPrice(
                planId
            );

        const localReference =
            `PIQ-${Date.now()}-${crypto
                .randomBytes(6)
                .toString("hex")
                .toUpperCase()}`;


        const order =
            await this.request(
                "/v2/checkout/orders",
                {
                    method: "POST",

                    headers: {

                        "PayPal-Request-Id":
                            localReference

                    },

                    body: {

                        intent:
                            "CAPTURE",

                        purchase_units: [

                            {

                                reference_id:
                                    localReference,

                                custom_id:
                                    `${uid}|${childId}|${planId}`,

                                description:
                                    `ParentIQ ${planId} subscription`,

                                amount: {

                                    currency_code:
                                        price.currency,

                                    value:
                                        price.amount

                                }

                            }

                        ],

                        application_context: {

                            brand_name:
                                "ParentIQ",

                            landing_page:
                                "LOGIN",

                            user_action:
                                "PAY_NOW",

                            return_url:
                                PAYPAL_RETURN_URL,

                            cancel_url:
                                PAYPAL_CANCEL_URL

                        }

                    }

                }
            );


        return {

            orderId:
                order.id,

            status:
                order.status,

            localReference,

            amount:
                price.amount,

            currency:
                price.currency,

            approvalUrl:
                order.links?.find(
                    link =>
                        link.rel === "approve"
                )?.href || null

        };

    }


    /**
     * ==========================================================
     * CAPTURE ORDER
     * ==========================================================
     */
    async captureOrder(orderId) {

        if (!orderId) {

            throw new Error(
                "PayPal order ID is required."
            );

        }

        return await this.request(
            `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
            {
                method: "POST",

                body: {}
            }
        );

    }


    /**
     * ==========================================================
     * SHOW ORDER
     * ==========================================================
     */
    async getOrder(orderId) {

        if (!orderId) {

            throw new Error(
                "PayPal order ID is required."
            );

        }

        return await this.request(
            `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
            {
                method:
                    "GET"
            }
        );

    }

}


module.exports =
    new PayPalManager();