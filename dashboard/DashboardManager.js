const { db } = require("../firebase");

const DashboardCache =
    require("../cache/DashboardCache");

const DashboardBuilder =
    require("../cache/DashboardBuilder");

const {
    getUsdToKesRate,
    kesToUsd
} = require("../services/CurrencyService");


class DashboardManager {


    /*
    ==========================================
    GET DASHBOARD
    ==========================================
    */

    async getDashboard(agentId) {

        /*
        --------------------------------------
        MEMORY CACHE
        --------------------------------------
        */

        let cachedDashboard =
            DashboardCache.get(agentId);


        /*
        --------------------------------------
        FIREBASE CACHE
        --------------------------------------
        */

        if (!cachedDashboard) {

            console.log(
                "❌ Dashboard Cache MISS"
            );


            const snapshot =
                await db
                    .ref("agent_dashboard_cache")
                    .child(agentId)
                    .get();


            /*
            ----------------------------------
            CACHE DOESN'T EXIST
            ----------------------------------
            */

            if (!snapshot.exists()) {

                console.log(
                    "Dashboard cache missing. Building..."
                );


                cachedDashboard =
                    await DashboardBuilder.rebuild(
                        agentId
                    );

            }

            else {

                cachedDashboard =
                    snapshot.val();


                console.log(
                    "💾 Dashboard loaded from Firebase cache"
                );

            }


            /*
            ----------------------------------
            SAVE PURE KES DASHBOARD
            ----------------------------------
            */

            DashboardCache.set(
                agentId,
                cachedDashboard
            );

        }

        else {

            console.log(
                "✅ Dashboard Cache HIT"
            );

        }


        /*
        ======================================
        CREATE RESPONSE COPY
        ======================================

        IMPORTANT:

        Never modify the cached dashboard.

        Firebase / memory cache remains KES-only.
        ======================================
        */

        const dashboard = {

            ...cachedDashboard,

            wallet: {
                ...(cachedDashboard.wallet || {})
            }

        };


        /*
        ======================================
        ADD CURRENT USD DISPLAY VALUES
        ======================================
        */

        try {

            const fx =
                await getUsdToKesRate();


            const wallet =
                dashboard.wallet;


            const available =
                Number(
                    wallet.available || 0
                );


            const pending =
                Number(
                    wallet.pending || 0
                );


            const totalWithdrawn =
                Number(
                    wallet.totalWithdrawn || 0
                );


            /*
            ----------------------------------
            KES → USD
            ----------------------------------
            */

            dashboard.wallet = {

                ...wallet,


                availableUSD:
                    kesToUsd(
                        available,
                        fx.rate
                    ),


                pendingUSD:
                    kesToUsd(
                        pending,
                        fx.rate
                    ),


                totalWithdrawnUSD:
                    kesToUsd(
                        totalWithdrawn,
                        fx.rate
                    ),


                currency:
                    "KES",


                displayCurrency:
                    "USD",


                fxRate:
                    fx.rate,


                fxDate:
                    fx.date,


                fxProvider:
                    fx.provider,


                fxUnavailable:
                    false

            };

        }


        catch (error) {

            /*
            ==================================
            FX FAILURE
            ==================================

            Never break the dashboard simply
            because the external FX provider
            is unavailable.

            KES values remain available.
            ==================================
            */

            console.error(
                "⚠️ USD conversion failed:",
                error.message
            );


            dashboard.wallet = {

                ...(dashboard.wallet || {}),


                currency:
                    "KES",


                displayCurrency:
                    "USD",


                fxUnavailable:
                    true

            };

        }


        /*
        ======================================
        RETURN RESPONSE
        ======================================
        */

        return dashboard;

    }

}


module.exports =
    new DashboardManager();