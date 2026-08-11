const AgentStatisticsManager =
    require("../statistics/AgentStatisticsManager");

const DashboardBuilder =
    require("./DashboardBuilder");

const CustomerCacheBuilder =
    require("../builders/CustomerCacheBuilder");

class CacheManager {

    /*
    ==========================================
    REFRESH EVERYTHING
    ==========================================
    */

    async refreshAgent(agentId) {

        console.log("==================================");
        console.log("Refreshing Agent");
        console.log("Agent:", agentId);
        console.log("==================================");

        console.time("refreshAgent");

        await AgentStatisticsManager.refresh(agentId);

        await Promise.all([
            DashboardBuilder.refresh(agentId),
            CustomerCacheBuilder.refresh(agentId)
        ]);

        console.timeEnd("refreshAgent");

        console.log("✅ Agent refreshed");
    }

    /*
    ==========================================
    DASHBOARD ONLY
    ==========================================
    */

    async refreshDashboard(agentId) {
        await DashboardBuilder.refresh(agentId);
    }

    /*
    ==========================================
    CUSTOMERS ONLY
    ==========================================
    */

    async refreshCustomers(agentId) {
        await CustomerCacheBuilder.refresh(agentId);
    }

    /*
    ==========================================
    EVENT HELPERS
    ==========================================
    */

    async activityAdded(agentId) {
        return this.refreshAgent(agentId);
    }

    async commissionAdded(agentId) {
        return this.refreshAgent(agentId);
    }

    async customerUpdated(agentId) {
        return this.refreshAgent(agentId);
    }

    async subscriptionChanged(agentId) {
        return this.refreshAgent(agentId);
    }

    async withdrawalCreated(agentId) {
        return this.refreshAgent(agentId);
    }
}

module.exports = new CacheManager();