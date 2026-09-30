const https = require("https");

const FX_API =
    "https://api.frankfurter.dev/v2/rate/USD/KES?providers=cbk";

async function getUsdToKesRate() {

    return new Promise((resolve, reject) => {

        const request = https.get(
            FX_API,
            { timeout: 10000 },

            response => {

                let data = "";

                response.on("data", chunk => {
                    data += chunk;
                });

                response.on("end", () => {

                    try {

                        if (
                            response.statusCode < 200 ||
                            response.statusCode >= 300
                        ) {

                            return reject(
                                new Error(
                                    `FX API returned HTTP ${response.statusCode}`
                                )
                            );

                        }

                        const result =
                            JSON.parse(data);

                        const rate =
                            Number(result.rate);

                        if (
                            !Number.isFinite(rate) ||
                            rate <= 0
                        ) {

                            return reject(
                                new Error(
                                    "Invalid USD/KES exchange rate"
                                )
                            );

                        }

                        console.log(
                            "================================"
                        );

                        console.log(
                            "USD/KES FX RATE"
                        );

                        console.log(
                            "Provider:",
                            "CBK"
                        );

                        console.log(
                            "Date:",
                            result.date
                        );

                        console.log(
                            "Rate:",
                            rate
                        );

                        console.log(
                            "================================"
                        );

                        resolve({

                            rate,

                            date:
                                result.date ||
                                null,

                            provider:
                                "CBK"

                        });

                    }

                    catch (error) {

                        reject(error);

                    }

                });

            }

        );

        request.on(
            "timeout",
            () => {

                request.destroy(
                    new Error(
                        "FX API request timed out"
                    )
                );

            }
        );

        request.on(
            "error",
            error => {

                reject(error);

            }
        );

    });

}


function usdToKes(
    usdAmount,
    rate
) {

    const usd =
        Number(usdAmount);

    const fxRate =
        Number(rate);

    if (
        !Number.isFinite(usd) ||
        usd <= 0
    ) {

        throw new Error(
            "Invalid USD amount"
        );

    }

    if (
        !Number.isFinite(fxRate) ||
        fxRate <= 0
    ) {

        throw new Error(
            "Invalid USD/KES exchange rate"
        );

    }

    return Math.round(
        usd * fxRate
    );

}


module.exports = {

    getUsdToKesRate,

    usdToKes

};