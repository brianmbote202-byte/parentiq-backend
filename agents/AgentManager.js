const { db } = require("../firebase");

class AgentManager {

    /*
    ==================================================
    GET AGENT PROFILE
    ==================================================
    */

    async getAgent(agentId) {

        const snapshot = await db
            .ref("agents")
            .child(agentId)
            .get();

        if (!snapshot.exists()) {

            throw new Error("Agent not found.");

        }

        return snapshot.val();

    }

    /*
    ==================================================
    GET AGENT STATISTICS
    ==================================================
    */

    async getAgentStatistics(agentId) {

        const snapshot = await db
            .ref("agent_statistics")
            .child(agentId)
            .get();

        if (!snapshot.exists()) {

            return {

                totalCustomers: 0,
                premiumCustomers: 0,
                freeCustomers: 0,

                activeSubscriptions: 0,
                expiredSubscriptions: 0,
                expiringSoon: 0,

                totalSales: 0,
                successfulSales: 0,

                commissionBalance: 0,
                totalWithdrawn: 0,
                pendingWithdrawals: 0,

                updatedAt: 0

            };

        }

        return snapshot.val();

    }

    /*
    ==================================================
    CHECK WHETHER AGENT EXISTS
    ==================================================
    */

    async agentExists(agentId) {

        const snapshot = await db
            .ref("agents")
            .child(agentId)
            .get();

        return snapshot.exists();

    }

    /*
    ==================================================
    CHECK IF AGENT IS APPROVED
    ==================================================
    */

    async isApproved(agentId) {

        const agent = await this.getAgent(agentId);

        return agent.status === "approved";

    }

    /*
    ==================================================
    UPDATE LAST LOGIN
    ==================================================
    */

    async updateLastLogin(agentId) {

        await db
            .ref("agents")
            .child(agentId)
            .update({

                lastLogin: Date.now()

            });

    }

    /*
    ==================================================
    GET WALLET
    ==================================================
    */

    getWallet(statistics) {

        return {

            available:
                statistics.commissionBalance || 0,

            pending:
                statistics.pendingWithdrawals || 0,

            withdrawn:
                statistics.totalWithdrawn || 0

        };

    }

    /*
    ==================================================
    GET DASHBOARD STATISTICS
    ==================================================
    */

    async getStatistics(agentId) {

        return await this.getAgentStatistics(agentId);

    }

}

module.exports = new AgentManager();