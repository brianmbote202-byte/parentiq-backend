const { db } = require("../firebase");

const AgentManager =
    require("../agents/AgentManager");

const DashboardCache =
    require("./DashboardCache");

class DashboardBuilder {

    /*
    ==========================================
    REBUILD DASHBOARD CACHE
    ==========================================
    */

    async rebuild(agentId) {

        console.log("==============================");
        console.log("Building Dashboard Cache");
        console.log("==============================");

        /*
        ==========================================
        LOAD AGENT
        ==========================================
        */

        const agent =
            await AgentManager.getAgent(agentId);

        /*
        ==========================================
        LOAD WITHDRAWALS
        ==========================================
        */

        const withdrawalSnapshot = await db
            .ref("withdrawalRequests")
            .orderByChild("agentId")
            .equalTo(agentId)
            .get();

        const withdrawals = [];

        if (withdrawalSnapshot.exists()) {

            withdrawalSnapshot.forEach(child => {

                withdrawals.push({

                    id: child.key,

                    ...child.val()

                });

            });

        }

        withdrawals.sort(
            (a, b) =>
                (b.requestedAt || 0) -
                (a.requestedAt || 0)
        );

        /*
        ==========================================
        LOAD COMMISSIONS
        ==========================================
        */

        const commissions =
            Object.entries(agent.commissions || {})
                .map(([id, value]) => ({
                    id,
                    ...value
                }))
                .sort((a, b) =>
                    (b.createdAt || 0) -
                    (a.createdAt || 0)
                );

        /*
        ==========================================
        BUILD DASHBOARD
        ==========================================
        */

        const dashboard = {

            profile: {

                uid: agent.uid,

                fullName: agent.fullName,

                email: agent.email,

                phone: agent.phone,

                profileImage: agent.profileImage,

                county: agent.county,

                town: agent.town,

                status: agent.status

            },

            statistics: {

                commissionBalance:
                    Number(agent.commissionBalance || 0),

                pendingWithdrawals:
                    Number(agent.pendingWithdrawals || 0),

                successfulSales:
                    Number(agent.successfulSales || 0),

                activeCustomers:
                    Number(agent.activeCustomers || 0),

                totalSales:
                    Number(agent.totalSales || 0),

                totalWithdrawn:
                    Number(agent.totalWithdrawn || 0)

            },

            wallet: {

                available:
                    Number(agent.commissionBalance || 0),

                pending:
                    Number(agent.pendingWithdrawals || 0),

                totalWithdrawn:
                    Number(agent.totalWithdrawn || 0)

            },

            recentCommissions:
                commissions.slice(0, 10),

            recentWithdrawals:
                withdrawals.slice(0, 10),

            updatedAt:
                Date.now()

        };

        /*
        ==========================================
        SAVE CACHE
        ==========================================
        */

        await db
            .ref("agent_dashboard_cache")
            .child(agentId)
            .set(dashboard);

        return dashboard;

    }

    /*
    ==========================================
    REFRESH DASHBOARD
    ==========================================
    */

    async refresh(agentId) {

        const dashboard =
            await this.rebuild(agentId);

        DashboardCache.clear(agentId);

        return dashboard;

    }

}

module.exports = new DashboardBuilder();