const { db } = require("../firebase");

class AdminDashboardManager {

    /*
    ==================================================
    ADMIN DASHBOARD
    ==================================================
    */

    async getDashboard() {

        const [
            agents,
            children,
            ledger,
            withdrawals
        ] = await Promise.all([

            db.ref("agents").get(),

            db.ref("children").get(),

            db.ref("finance/ledger").get(),

            db.ref("withdrawals").get()

        ]);

        /*
        ==================================================
        AGENTS
        ==================================================
        */

        let totalAgents = 0;
        let pendingAgents = 0;
        let approvedAgents = 0;
        let rejectedAgents = 0;

        if (agents.exists()) {

            agents.forEach(agent => {

                totalAgents++;

                const status =
                    String(agent.val().status || "")
                        .toLowerCase();

                switch (status) {

                    case "approved":
                        approvedAgents++;
                        break;

                    case "pending":
                        pendingAgents++;
                        break;

                    case "rejected":
                        rejectedAgents++;
                        break;
                }

            });

        }

        /*
        ==================================================
        CUSTOMERS
        ==================================================
        */

        let totalCustomers = 0;
        let premiumCustomers = 0;
        let freeCustomers = 0;
        let expiredCustomers = 0;

        const now = Date.now();

        if (children.exists()) {

            children.forEach(child => {

                totalCustomers++;

                const sub =
                    child.val().subscription || {};

                if (
                    sub.premium === true &&
                    Number(sub.expiryDate || 0) > now
                ) {

                    premiumCustomers++;

                }

                else if (
                    Number(sub.expiryDate || 0) > 0 &&
                    Number(sub.expiryDate || 0) <= now
                ) {

                    expiredCustomers++;

                }

                else {

                    freeCustomers++;

                }

            });

        }

        /*
        ==================================================
        FINANCE
        ==================================================
        */

        let totalRevenue = 0;
        let totalCommission = 0;

        if (ledger.exists()) {

            ledger.forEach(item => {

                const entry = item.val();

                switch (entry.type) {

                    case "SUBSCRIPTION_PAYMENT":

                        totalRevenue +=
                            Number(entry.amount || 0);

                        break;

                    case "COMMISSION_EARNED":

                        totalCommission +=
                            Number(entry.amount || 0);

                        break;

                }

            });

        }

        /*
        ==================================================
        WITHDRAWALS
        ==================================================
        */

        let pendingWithdrawals = 0;
        let approvedWithdrawals = 0;
        let paidWithdrawals = 0;
        let failedWithdrawals = 0;

        if (withdrawals.exists()) {

            withdrawals.forEach(item => {

                const status =
                    String(item.val().status || "")
                        .toLowerCase();

                switch (status) {

                    case "pending":
                        pendingWithdrawals++;
                        break;

                    case "approved":
                        approvedWithdrawals++;
                        break;

                    case "paid":
                        paidWithdrawals++;
                        break;

                    case "failed":
                        failedWithdrawals++;
                        break;

                }

            });

        }

        /*
        ==================================================
        RESPONSE
        ==================================================
        */

        return {

            generatedAt: now,

            agents: {

                total: totalAgents,

                approved: approvedAgents,

                pending: pendingAgents,

                rejected: rejectedAgents

            },

            customers: {

                total: totalCustomers,

                premium: premiumCustomers,

                free: freeCustomers,

                expired: expiredCustomers

            },

            finance: {

                revenue: totalRevenue,

                commissionPaid: totalCommission

            },

            withdrawals: {

                pending: pendingWithdrawals,

                approved: approvedWithdrawals,

                paid: paidWithdrawals,

                failed: failedWithdrawals

            }

        };

    }

}

module.exports = new AdminDashboardManager();