const { db } = require("../firebase");
const engagement = require("../services/customerEngagement");

const CustomersCache =
    require("../cache/CustomersCache");

class CustomerCacheBuilder {

    /*
    ==========================================
    REBUILD CUSTOMER CACHE
    ==========================================
    */

    async rebuild(agentId) {

        console.log("==================================");
        console.log("Building Customer Cache");
        console.log("Agent:", agentId);
        console.log("==================================");

        /*
        ==========================================
        LOAD CUSTOMERS
        ==========================================
        */

        const customerSnap = await db
            .ref("agent_customers")
            .child(agentId)
            .get();

        if (!customerSnap.exists()) {

            await db
                .ref("agent_customers_cache")
                .child(agentId)
                .remove();

            return [];

        }

        const rawCustomers = customerSnap.val();

        /*
        ==========================================
        LOAD PARENTS
        ==========================================
        */

        const parentSnap = await db
            .ref("agent_parents")
            .child(agentId)
            .get();

        const parentsInfo =
            parentSnap.exists()
                ? parentSnap.val()
                : {};

        /*
        ==========================================
        GROUP BY PARENT
        ==========================================
        */

        const parents = {};

        Object.entries(rawCustomers).forEach(([childId, data]) => {

            const parentId = data.parentId || "";

            if (!parents[parentId]) {

                const initials =
                    data.parentName
                        ? data.parentName
                            .split(" ")
                            .map(x => x.charAt(0))
                            .join("")
                            .substring(0, 2)
                            .toUpperCase()
                        : "NA";

                const parentInfo =
                    parentsInfo[parentId] || {};

                parents[parentId] = {

                    parentId,

                    linkedAt: data.linkedAt || 0,

                    profile: {

                        parentName:
                            parentInfo.parentName ||
                            data.parentName ||
                            "",

                        parentEmail:
                            parentInfo.parentEmail ||
                            data.parentEmail ||
                            "",

                        parentPhone:
                            parentInfo.parentPhone ||
                            "",

                        avatar: initials

                    },

                    statistics: {

                        totalChildren: 0,
                        premiumChildren: 0,
                        freeChildren: 0

                    },

                    activity: null,

                    children: []

                };

            }

            const child = {

                childId,

                childName: data.childName || "",

                subscription: {

                    exists:
                        data.subscription?.active === true,

                    active:
                        data.subscription?.active || false,

                    premium:
                        data.subscription?.premium || false,

                    planId:
                        data.subscription?.planId || "FREE",

                    status:
                        data.subscription?.status || "FREE",

                    startDate:
                        data.subscription?.startDate || 0,

                    expiryDate:
                        data.subscription?.expiryDate || 0,

                    lastRenewedAt:
                        data.subscription?.lastRenewedAt || 0

                },

                billing: {

                    lastPaymentStatus:
                        data.billing?.lastPaymentStatus || "UNKNOWN",

                    lastPaidAt:
                        data.billing?.lastPaidAt || 0

                },

                activity: data.activity || {

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

                }

            };

            const customerEngagement =
                engagement.get(
                    child,
                    parents[parentId].statistics
                );

            parents[parentId].children.push(child);

            parents[parentId].engagement =
                customerEngagement;

            parents[parentId].statistics.totalChildren++;

            if (child.subscription.active) {

                parents[parentId].statistics.premiumChildren++;

            } else {

                parents[parentId].statistics.freeChildren++;

            }

        });

        /*
        ==========================================
        FINALIZE PARENT ACTIVITY
        ==========================================
        */

        Object.values(parents).forEach(parent => {

            if (parent.children.length > 0) {

                parent.activity =
                    parent.children[0].activity;

            } else {

                parent.activity = {

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

        });

        /*
        ==========================================
        SORT CUSTOMERS
        ==========================================
        */

        const customers = Object.values(parents);

        customers.sort((a, b) => b.linkedAt - a.linkedAt);

        /*
        ==========================================
        SAVE FIREBASE CACHE
        ==========================================
        */

        const cache = {};

        customers.forEach(customer => {

            cache[customer.parentId] = customer;

        });

        await db
            .ref("agent_customers_cache")
            .child(agentId)
            .set(cache);

        console.log("Customer Cache Built:", customers.length);

        return customers;

    }

    /*
==========================================
REFRESH CUSTOMER CACHE
==========================================
*/

async refresh(agentId) {

    const customers =
        await this.rebuild(agentId);

    CustomersCache.clear(agentId);

    return customers;

}

/*
==========================================
REFRESH CUSTOMER CACHE
==========================================
*/

async refresh(agentId) {

    const customers =
        await this.rebuild(agentId);

    CustomersCache.clear(agentId);

    return customers;

}

}

module.exports = new CustomerCacheBuilder();