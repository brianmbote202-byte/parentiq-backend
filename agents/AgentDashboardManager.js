const AgentManager =
    require("./AgentManager");

const CustomerManager =
    require("../customers/CustomerManager");

const DashboardCache =
    require("../cache/DashboardCache");

class AgentDashboardManager {

    /*
    ==================================================
    GET AGENT DASHBOARD
    ==================================================
    */

    async getDashboard(agentId) {

        /*
        --------------------------------------
        Check Cache
        --------------------------------------
        */

        const cached =
            DashboardCache.get(agentId);

        if (cached) {

            console.log("Dashboard Cache: HIT");

            return cached;

        }

        console.log("Dashboard Cache: MISS");

        console.time("dashboard");

        /*
        --------------------------------------
        Load Agent + Statistics + Customers
        --------------------------------------
        */

        console.time("Load Dashboard Data");

        const [

            agent,

            statistics,

            customers

        ] = await Promise.all([

            AgentManager.getAgent(agentId),

            AgentManager.getStatistics(agentId),

            CustomerManager.getCustomers(agentId)

        ]);

        console.timeEnd("Load Dashboard Data");

        /*
        --------------------------------------
        Build Wallet
        --------------------------------------
        */

        const wallet =
            AgentManager.getWallet(statistics);

        /*
        --------------------------------------
        Recent Customers
        --------------------------------------
        */

        const recentCustomers =
            customers.slice(0, 5);

        /*
        --------------------------------------
        Build Dashboard
        --------------------------------------
        */

        const dashboard = {

            profile: {

                agentId,

                fullName:
                    agent.fullName || "",

                email:
                    agent.email || "",

                phone:
                    agent.phone || "",

                county:
                    agent.county || "",

                profileImage:
                    agent.profileImage || "",

                referralCode:
                    agent.referralCode || "",

                status:
                    agent.status || ""

            },

            wallet,

            statistics,

            recentCustomers

        };

        /*
        --------------------------------------
        Cache Dashboard
        --------------------------------------
        */

        DashboardCache.set(
            agentId,
            dashboard
        );

        console.timeEnd("dashboard");

        return dashboard;

    }

}

module.exports = new AgentDashboardManager();