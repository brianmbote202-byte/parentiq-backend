const https = require("https");

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = "api.paystack.co";

function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;

        const options = {
            hostname: PAYSTACK_BASE_URL,
            path,
            method,
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                "Content-Type": "application/json"
            }
        };

        if (data) {
            options.headers["Content-Length"] = Buffer.byteLength(data);
        }

        const req = https.request(options, (res) => {
            let responseData = "";

            res.on("data", (chunk) => {
                responseData += chunk;
            });

            res.on("end", () => {
                try {
                    const parsed = JSON.parse(responseData);

                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsed);
                    } else {
                        reject(
                            new Error(
                                parsed.message ||
                                `Paystack request failed with status ${res.statusCode}`
                            )
                        );
                    }
                } catch (error) {
                    reject(
                        new Error(
                            `Invalid response from Paystack: ${responseData}`
                        )
                    );
                }
            });
        });

        req.on("error", reject);

        if (data) {
            req.write(data);
        }

        req.end();
    });
}

async function initializeTransaction({
    email,
    amount,
    reference,
    callbackUrl,
    metadata
}) {
    if (!PAYSTACK_SECRET_KEY) {
        throw new Error("PAYSTACK_SECRET_KEY is not configured");
    }

    const payload = {
        email,
        amount: String(Math.round(Number(amount) * 100)),
        currency: "KES",
        reference,
        callback_url: callbackUrl,
        metadata: JSON.stringify(metadata || {}),
        channels: ["card"]
    };

    return request(
        "POST",
        "/transaction/initialize",
        payload
    );
}

async function verifyTransaction(reference) {
    if (!PAYSTACK_SECRET_KEY) {
        throw new Error("PAYSTACK_SECRET_KEY is not configured");
    }

    return request(
        "GET",
        `/transaction/verify/${encodeURIComponent(reference)}`
    );
}

module.exports = {
    initializeTransaction,
    verifyTransaction
};