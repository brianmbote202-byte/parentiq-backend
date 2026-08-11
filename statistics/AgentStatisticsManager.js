const { db } = require("../firebase");





const PlanManager = require("../plans/PlanManager");



class AgentStatisticsManager {

    /*
    ==================================================
    REFRESH AGENT STATISTICS
    ==================================================
    */

    async refresh(agentId) {

        console.log("========================================");
        console.log("Refreshing Agent Statistics");
        console.log("Agent:", agentId);
        console.log("========================================");

        /*
        ------------------------------------
        Load Agent Customers
        ------------------------------------
        */

        const customersSnapshot = await db
            .ref("agent_customers")
            .child(agentId)
            .get();

        const customers = customersSnapshot.exists()
            ? customersSnapshot.val()
            : {};

        /*
        ------------------------------------
        Default Statistics
        ------------------------------------
        */
const statistics = {

    totalCustomers: 0,

    premiumCustomers: 0,

    familyCustomers: 0,

    freeCustomers: 0,

    activeSubscriptions: 0,

    expiredSubscriptions: 0,

    expiringSoon: 0,

    premiumRevenue: 0,

    familyRevenue: 0,

    currentMonthlyValue: 0,

    potentialMonthlyValue: 0,

    upgradeOpportunity: 0,

    totalSales: 0,

    successfulSales: 0,

    commissionBalance: 0,

    totalWithdrawn: 0,

    pendingWithdrawals: 0,

    updatedAt: Date.now()

};

        const now = Date.now();
        const sevenDays = 7 * 24 * 60 * 60 * 1000;




        /*
------------------------------------
Load Subscription Plans
------------------------------------
*/

const premiumPlan =
    await PlanManager.getPlan("premium");

const familyPlan =
    await PlanManager.getPlan("family");

const premiumPrice =
    Number(premiumPlan?.price || 750);

const familyPrice =
    Number(familyPlan?.price || 1800);

        /*
        ------------------------------------
        Calculate Customer Statistics
        ------------------------------------
        */

        Object.values(customers).forEach(customer => {

    statistics.totalCustomers++;

    const subscription = customer.subscription || {};

    /*
    -----------------------------
    Free Customer
    -----------------------------
    */

    if (!subscription.active) {

        statistics.freeCustomers++;

        return;

    }

    statistics.activeSubscriptions++;

    /*
    -----------------------------
    Premium Plan
    -----------------------------
    */

    if (subscription.planId === "premium") {

        statistics.premiumCustomers++;

        statistics.premiumRevenue += premiumPrice;

    }

    /*
    -----------------------------
    Family Plan
    -----------------------------
    */

    else if (subscription.planId === "family") {

        statistics.familyCustomers++;

        statistics.familyRevenue += familyPrice;
    }

    /*
    -----------------------------
    Unknown active plan
    -----------------------------
    */

    else {

        statistics.freeCustomers++;

    }

    /*
    -----------------------------
    Expired
    -----------------------------
    */

    if (
        subscription.expiryDate > 0 &&
        subscription.expiryDate < now
    ) {

        statistics.expiredSubscriptions++;

    }

    /*
    -----------------------------
    Expiring Soon
    -----------------------------
    */

    if (
        subscription.expiryDate > now &&
        subscription.expiryDate <= now + sevenDays
    ) {

        statistics.expiringSoon++;

    }

});



/*
------------------------------------
Revenue Calculations
------------------------------------
*/
/*
------------------------------------
Current Monthly Subscription Value
------------------------------------
*/

statistics.currentMonthlyValue =
    statistics.premiumRevenue +
    statistics.familyRevenue;

/*
------------------------------------
Potential Monthly Subscription Value
------------------------------------

Assume every customer could at least
be on Premium.
*/

statistics.potentialMonthlyValue =
    statistics.totalCustomers * premiumPrice;

/*
------------------------------------
Extra Monthly Value Available
------------------------------------
*/

statistics.upgradeOpportunity =
    statistics.potentialMonthlyValue -
    statistics.currentMonthlyValue;

        /*
        ------------------------------------
        Load Wallet Statistics
        ------------------------------------
        */

        const agentSnapshot = await db
            .ref("agents")
            .child(agentId)
            .get();

        if (agentSnapshot.exists()) {

            const agent = agentSnapshot.val();

            statistics.totalSales =
                agent.totalSales || 0;

            statistics.successfulSales =
                agent.successfulSales || 0;

            statistics.commissionBalance =
                agent.commissionBalance || 0;

            statistics.totalWithdrawn =
                agent.totalWithdrawn || 0;

            statistics.pendingWithdrawals =
                agent.pendingWithdrawals || 0;

        }

        /*
        ------------------------------------
        Save Cached Statistics
        ------------------------------------
        */

        await db
            .ref("agent_statistics")
            .child(agentId)
            .set(statistics);

        console.log("Statistics updated successfully.");

        return statistics;

    }

}

module.exports = new AgentStatisticsManager();