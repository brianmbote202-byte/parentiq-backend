const { db } = require("../firebase");
const PlanManager = require("../plans/PlanManager");
const ActivityManager = require("../activity/ActivityManager");

const EventBus =
    require("../events/EventBus");

    
const CacheManager =
    require("../cache/CacheManager");    

const AgentStatisticsManager =
    require("../statistics/AgentStatisticsManager");

const LedgerManager =
    require("../finance/LedgerManager");

const LedgerTypes =
    require("../finance/LedgerTypes");

const LedgerDirection =
    require("../finance/LedgerDirection");

const LedgerCategory =
    require("../finance/LedgerCategory");    

/*const DashboardCache =
    require("../dashboard/DashboardCache");*/

/*const engagement =
    require("../services/customerEngagement");*/

/*const DashboardCache =
    require("../cache/DashboardCache"); */   

class CommissionManager {

    /*
    ==========================================
    RECORD COMMISSION
    ==========================================
    */

    async recordCommission({

        agentId,

        childId,

        planId,

        checkoutId

    }) {

        /*
        --------------------------------------
        Verify plan
        --------------------------------------
        */

        const exists =
            await PlanManager.planExists(planId);

        if (!exists) {
            throw new Error("Plan does not exist.");
        }

        const plan =
            await PlanManager.getPlan(planId);

        const commission =
        Number(plan.agentCommission);

        const now = Date.now();

  /*
--------------------------------------
Atomic Duplicate Protection
--------------------------------------
*/

const indexRef = db
    .ref("commission_index")
    .child(checkoutId);

const result = await indexRef.transaction(current => {

    if (current) {

        return;

    }

    return {

        commissionId: checkoutId,

        agentId,

        childId,

        createdAt: Date.now()

    };

});

if (!result.committed) {

    console.log(
        "Commission already processed:",
        checkoutId
    );

    return {

        success: true,

        duplicate: true

    };

}

        /*
        --------------------------------------
        Get child information
        --------------------------------------
        */

        let childName = "Customer";

        const childSnapshot = await db
            .ref("children")
            .child(childId)
            .get();

        if (childSnapshot.exists()) {

            const child = childSnapshot.val();

            childName =
                child.name ||
                child.childName ||
                "Customer";

        }

        /*
        --------------------------------------
        Get agent
        --------------------------------------
        */

        const agentRef =
            db.ref("agents").child(agentId);

        const snapshot =
            await agentRef.get();

        if (!snapshot.exists()) {
            throw new Error("Agent not found.");
        }

        const agent =
            snapshot.val();

        const currentBalance =
            Number(agent.commissionBalance || 0);

        const successfulSales =
            Number(agent.successfulSales || 0);

        const activeCustomers =
            Number(agent.activeCustomers || 0);

            const totalSales =
    Number(agent.totalSales || 0);

        /*
        --------------------------------------
        Save commission history
        --------------------------------------
        */

        const commissionRef =
        agentRef
        .child("commissions")
        .child(checkoutId);

        try {

    await commissionRef.set({

        id: checkoutId,

        checkoutId,

        agentId,

        childId,

        childName,

        planId,

        planName: plan.name,

        amount: commission,

        status: "AVAILABLE",

        createdAt: now

    });

} catch (error) {

    await indexRef.remove();

    throw error;

}



       /*
--------------------------------------
Financial Ledger
--------------------------------------
*/

await LedgerManager.record({

    type:
        LedgerTypes.COMMISSION_EARNED,

    direction:
        LedgerDirection.CREDIT,

    category:
        LedgerCategory.AGENT,

    amount:
        commission,

    reference:
    checkoutId,

    agentId,

    childId,

    checkoutId,

    description:
    `Commission earned from ${childName}'s ${plan.name} subscription`,

    metadata: {


        commissionId: checkoutId,

        checkoutId,

        childId,

        childName,

        planId,

        planName: plan.name,

        balanceBefore:
            currentBalance,

        balanceAfter:
            currentBalance + commission

    }

});
console.log(
    "Commission ledger recorded:",
    checkoutId
);
console.log(
    "Commission:",
    commission,
    "Agent:",
    agentId
);

/*
--------------------------------------
Update Wallet
--------------------------------------
*/

const walletTransaction =
    await agentRef.transaction(agent => {

        if (!agent) {
            return agent;
        }

        agent.commissionBalance =
            Number(agent.commissionBalance || 0) +
            commission;

        agent.successfulSales =
            Number(agent.successfulSales || 0) + 1;

        agent.totalSales =
            Number(agent.totalSales || 0) + 1;

        agent.activeCustomers =
            Number(agent.activeCustomers || 0) + 1;

        return agent;

    });

if (!walletTransaction.committed) {

    throw new Error(
        "Failed to update wallet."
    );

}
console.log(
    "Wallet updated:",
    currentBalance,
    "->",
    currentBalance + commission
);

        /*
        --------------------------------------
        Create activity
        --------------------------------------
        */

        await ActivityManager.createCommissionActivity(

            agentId,

            {

                amount: commission,

                childId,

                childName,

                planName: plan.name,

                checkoutId

            }

        );
/*
--------------------------------------
Notify System
--------------------------------------
*/

EventBus.emit("commissionRecorded", {

    agentId,

    childId,

    checkoutId,

    amount: commission,

    planId,

    planName: plan.name

});

return {

    success: true,

    duplicate: false,

    commission,

    childId,

    checkoutId,

    agentId,

    planId

};
    }

/*
==========================================
CHECK IF COMMISSION EXISTS
==========================================
*/

/*async commissionExists(checkoutId) {

    const snapshot = await db
        .ref("commission_index")
        .child(checkoutId)
        .get();

    return snapshot.exists();

}*/

/*
==========================================
CREATE COMMISSION INDEX
==========================================
*/

/*async createCommissionIndex({

    checkoutId,

    commissionId,

    agentId,

    childId

}) {

    await db
        .ref("commission_index")
        .child(checkoutId)
        .set({

            commissionId,

            agentId,

            childId,

            createdAt: Date.now()

        });

}*/

/*
==========================================
GET COMMISSION ID
==========================================
*/

async getCommissionId(checkoutId) {

    const snapshot = await db
        .ref("commission_index")
        .child(checkoutId)
        .get();

    if (!snapshot.exists()) {
        return null;
    }

    return snapshot.val().commissionId;

}





}



module.exports = new CommissionManager();