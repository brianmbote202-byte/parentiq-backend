const { db } = require("../firebase");

const DashboardCache =
    require("../cache/DashboardCache");

const DashboardBuilder =
    require("../cache/DashboardBuilder");

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

        const cached =
            DashboardCache.get(agentId);

        if (cached) {

            console.log("✅ Dashboard Cache HIT");

            return cached;

        }

        console.log("❌ Dashboard Cache MISS");

        console.time("dashboard");

        /*
        --------------------------------------
        FIREBASE CACHE
        --------------------------------------
        */

        const snapshot = await db
            .ref("agent_dashboard_cache")
            .child(agentId)
            .get();

        /*
        --------------------------------------
        CACHE DOESN'T EXIST
        --------------------------------------
        */

        if (!snapshot.exists()) {

            console.log(
                "Dashboard cache missing. Building..."
            );

            const dashboard =
                await DashboardBuilder.rebuild(agentId);

            DashboardCache.set(
                agentId,
                dashboard
            );

            console.timeEnd("dashboard");

            return dashboard;

        }

        /*
        --------------------------------------
        LOAD CACHE
        --------------------------------------
        */

        const dashboard =
            snapshot.val();

        /*
        --------------------------------------
        SAVE MEMORY CACHE
        --------------------------------------
        */

        DashboardCache.set(
            agentId,
            dashboard
        );

        console.log("💾 Dashboard loaded from Firebase cache");

        console.timeEnd("dashboard");

        return dashboard;

    }

}

module.exports = new DashboardManager();