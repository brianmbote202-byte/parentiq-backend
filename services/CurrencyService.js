const https = require("https");

const FX_API =
    "https://api.frankfurter.dev/v2/rate/USD/KES?providers=cbk";


/*
==========================================
FX CACHE
==========================================
*/

const FX_CACHE_DURATION =
    15 * 60 * 1000; // 15 minutes

let cachedFx = null;


/*
==========================================
FETCH USD/KES RATE
==========================================
*/

async function fetchUsdToKesRate() {

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


                        const fx = {

                            rate,

                            date:
                                result.date ||
                                null,

                            provider:
                                "CBK",

                            fetchedAt:
                                Date.now()

                        };


                        console.log(
                            "================================"
                        );

                        console.log(
                            "USD/KES FX RATE"
                        );

                        console.log(
                            "Provider:",
                            fx.provider
                        );

                        console.log(
                            "Date:",
                            fx.date
                        );

                        console.log(
                            "Rate:",
                            fx.rate
                        );

                        console.log(
                            "================================"
                        );


                        resolve(fx);

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


/*
==========================================
GET USD/KES RATE
==========================================

Uses a 15-minute memory cache.

This prevents every dashboard request
from calling the external FX provider.
==========================================
*/

async function getUsdToKesRate() {

    const now =
        Date.now();


    /*
    --------------------------------------
    CACHE HIT
    --------------------------------------
    */

    if (
        cachedFx &&
        now - cachedFx.fetchedAt <
            FX_CACHE_DURATION
    ) {

        console.log(
            "💱 FX CACHE HIT:",
            cachedFx.rate
        );

        return cachedFx;

    }


    /*
    --------------------------------------
    CACHE MISS
    --------------------------------------
    */

    console.log(
        "💱 FX CACHE MISS - fetching rate"
    );


    try {

        const fx =
            await fetchUsdToKesRate();


        cachedFx =
            fx;


        return fx;

    }

    catch (error) {

        /*
        ----------------------------------
        FALLBACK
        ----------------------------------

        If the API fails but we have a
        previous successful rate, continue
        using it.
        ----------------------------------
        */

        if (cachedFx) {

            console.warn(
                "⚠️ FX provider failed. Using previous cached rate."
            );

            return cachedFx;

        }


        throw error;

    }

}


/*
==========================================
USD → KES
==========================================
*/

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
        usd < 0
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


/*
==========================================
KES → USD
==========================================
*/

function kesToUsd(
    kesAmount,
    rate
) {

    const kes =
        Number(kesAmount);


    const fxRate =
        Number(rate);


    if (
        !Number.isFinite(kes) ||
        kes < 0
    ) {

        throw new Error(
            "Invalid KES amount"
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


    return Number(
        (kes / fxRate).toFixed(2)
    );

}


module.exports = {

    getUsdToKesRate,

    usdToKes,

    kesToUsd

};