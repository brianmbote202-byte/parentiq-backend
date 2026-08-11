const { db } = require("../firebase");
const engagement = require("../services/customerEngagement");

const CustomerActivityService =
    require("../services/CustomerActivityService");

const CustomersCache =
    require("../cache/CustomersCache");    

const DashboardCache =
    require("../cache/DashboardCache");    

class CustomerManager {

    /*
    ==================================================
    GET DASHBOARD SUMMARY
    ==================================================
    */

   /*
==================================================
GET DASHBOARD SUMMARY
==================================================
*/

getDashboardSummary(customers) {

    const now = Date.now();

    let premiumCustomers = 0;
    let freeCustomers = 0;
    let activeSubscriptions = 0;
    let expiredSubscriptions = 0;
    let expiringSoon = 0;

    customers.forEach(customer => {

        const subscription = customer.subscription;

        if (subscription.exists) {

            premiumCustomers++;

            if (subscription.active)
                activeSubscriptions++;

        } else {

            freeCustomers++;

        }

        if (
            subscription.expiryDate > 0 &&
            subscription.expiryDate < now
        ) {

            expiredSubscriptions++;

        }

        const sevenDays =
            7 * 24 * 60 * 60 * 1000;

        if (
            subscription.expiryDate > now &&
            subscription.expiryDate <= now + sevenDays
        ) {

            expiringSoon++;

        }

    });

    return {

        totalCustomers:
            customers.length,

        premiumCustomers,

        freeCustomers,

        activeSubscriptions,

        expiredSubscriptions,

        expiringSoon

    };

}
    /*
    ==================================================
    GET ALL CUSTOMERS
    ==================================================
    */
/*
==================================================
GET ALL CUSTOMERS
==================================================
*/

async getCustomers(agentId) {

    console.log("======================================");
    console.log("Loading customers for:", agentId);
    console.log("======================================");

    /*
    ==========================================
    MEMORY CACHE
    ==========================================
    */

    const cached =
        CustomersCache.get(agentId);

    if (cached) {

        console.log("✅ Customers Cache HIT");

        return cached;

    }

    console.log("❌ Customers Cache MISS");

    console.time("getCustomers");

    /*
    ==========================================
    FIREBASE CACHE
    ==========================================
    */

    const snapshot = await db
        .ref("agent_customers_cache")
        .child(agentId)
        .get();

 

    if (!snapshot.exists()) {

    console.log("Customer cache missing. Building...");

    const CustomerCacheBuilder =
        require("../builders/CustomerCacheBuilder");

    const customers =
        await CustomerCacheBuilder.rebuild(agentId);

    DashboardCache.clear(agentId);    

    CustomersCache.set(agentId, customers);

    console.timeEnd("getCustomers");

    return customers;

}    
    /*
    ==========================================
    LOAD CACHE
    ==========================================
    */

   const raw = snapshot.val() || {};

const customers = Array.isArray(raw)
    ? raw
    : Object.values(raw);

customers.sort(
    (a, b) => b.linkedAt - a.linkedAt
);

    /*
    ==========================================
    SAVE MEMORY CACHE
    ==========================================
    */

    CustomersCache.set(
        agentId,
        customers
    );

    console.log(
        "Parents:",
        customers.length
    );

    console.timeEnd("getCustomers");

    return customers;

}
    /*
    ==================================================
    GET SINGLE CUSTOMER
    ==================================================
    */

   async getCustomer(agentId, childId) {

    

    /*
    ==========================================
    LOAD AGENT CUSTOMER (PRIMARY SOURCE)
    ==========================================
    */

    const customerSnap = await db
        .ref("agent_customers")
        .child(agentId)
        .child(childId)
        .get();

    if (!customerSnap.exists()) {
        throw new Error("Customer not found.");
    }

    const customer = customerSnap.val();

    /*
    ==========================================
    LOAD CHILD ONLY FOR EXTRA DATA
    (payments, children list, etc.)
    ==========================================
    */

    const childSnap = await db
        .ref("children")
        .child(childId)
        .get();

    const child =
        childSnap.exists()
            ? childSnap.val()
            : {};

    /*
    ==========================================
    RECENT PAYMENTS
    ==========================================
    */

    const recentPayments =
        Object.entries(child.payments || {})
            .map(([id, payment]) => ({

                id,

                amount: payment.amount || 0,

                planId: payment.planId || "",

                status: payment.status || "",

                paidAt: payment.paidAt || 0

            }))
            .sort((a, b) => b.paidAt - a.paidAt)
            .slice(0, 10);

            /*
==========================================
CUSTOMER ACTIVITIES
==========================================
*/

const history =
    await CustomerActivityService.getActivities(
        agentId,
        customer.parentId
    );

const activitySummary =
    customer.activity || {

        latest: null,

        statistics: {

            totalActivities: 0,

            totalCalls: 0,

            totalWhatsapp: 0,

            totalSMS: 0,

            totalEmails: 0,

            totalVisits: 0,

            totalNotes: 0,

            totalPayments: 0,

            totalRenewals: 0,

            lastContactType: "",

            lastContactAt: 0,

            nextFollowUp: 0

        }

    };
}

    /*
    ==================================================
    SEARCH CUSTOMERS
    ==================================================
    */

    async searchCustomers(agentId, keyword) {

    const customers =
        await this.getCustomers(agentId);

    keyword =
        (keyword || "").toLowerCase();

    return customers.filter(parent => {

        if (
            parent.profile.parentName
                .toLowerCase()
                .includes(keyword)
        ) {
            return true;
        }

        if (
            parent.profile.parentEmail
                .toLowerCase()
                .includes(keyword)
        ) {
            return true;
        }

        return parent.children.some(child =>
            child.childName
                .toLowerCase()
                .includes(keyword)
        );

    });

}

    /*
    ==================================================
    EXPIRING CUSTOMERS
    ==================================================
    */

    async getExpiringCustomers(
        agentId,
        days = 7
    ) {

        const customers =
            await this.getCustomers(agentId);

        const now = Date.now();

        const future =
            now +
            (days * 24 * 60 * 60 * 1000);

        return customers.filter(customer =>

            customer.subscription.expiryDate > now &&

            customer.subscription.expiryDate <= future

        );

    }

    /*
    ==================================================
    REVENUE
    ==================================================
    */

    async getRevenueSummary(agentId) {

        const customers =
            await this.getCustomers(agentId);

        return {

            totalCustomers:
                customers.length,

            estimatedRevenue: 0

        };

    }

    /*
==================================================
ADD CUSTOMER ACTIVITY
==================================================
*/

/*
==================================================
ADD CUSTOMER ACTIVITY
==================================================
*/

async addActivity(agentId, childId, activity) {

    console.log("=================================");
    console.log("ADD CUSTOMER ACTIVITY");
    console.log("=================================");

    console.log("Agent:", agentId);
    console.log("Child:", childId);
    console.log("Request:", activity);

    /*
    ==========================================
    VERIFY CUSTOMER EXISTS
    ==========================================
    */

    const customerSnap = await db
        .ref("agent_customers")
        .child(agentId)
        .child(childId)
        .get();

    if (!customerSnap.exists()) {
        throw new Error("Customer not found.");
    }

    const customer = customerSnap.val();

    /*
    ==========================================
    SAVE USING CUSTOMER ACTIVITY SERVICE
    ==========================================
    */

    const savedActivity =
        await CustomerActivityService.addActivity({

            agentId,

            parentId: customer.parentId,

            type: activity.type,

            title: activity.title,

            description: activity.description,

            outcome: activity.outcome,

            priority: activity.priority,

            status: activity.status,

            source: activity.source,

            nextFollowUp: activity.nextFollowUp,

            createdBy: activity.createdBy,

            createdById: activity.createdById

        });

console.log("Activity Saved");
console.log(savedActivity);

const CacheManager =
    require("../cache/CacheManager");

await CacheManager.refreshAgent(agentId);

/*
==========================================
CLEAR CUSTOMER CACHE
==========================================
*/



return {

    success: true,

    activityId: savedActivity.activityId

    

};
}

}



module.exports = new CustomerManager();