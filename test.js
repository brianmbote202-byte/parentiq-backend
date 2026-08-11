/*const PlanManager = require("./plans/PlanManager");

async function run() {

    console.log("--------------------------------");

    console.log("Premium");

    console.log(await PlanManager.getPlan("premium"));

    console.log("--------------------------------");

    console.log("Family Price");

    console.log(await PlanManager.getPrice("family"));

    console.log("--------------------------------");

    console.log("Premium Commission");

    console.log(await PlanManager.getCommission("premium"));

    console.log("--------------------------------");

    console.log("Family Max Children");

    console.log(await PlanManager.getMaxChildren("family"));

    console.log("--------------------------------");

    console.log("Premium Active");

    console.log(await PlanManager.isPlanActive("premium"));

    console.log("--------------------------------");

    console.log("Plan Exists");

    console.log(await PlanManager.planExists("gold"));

}

run();


const SubscriptionManager = require("./subscriptions/SubscriptionManager");

async function run() {

    const subscription = await SubscriptionManager.activate(
        "child_1782297272645",
        "family"
    );

    console.log(subscription);

}

run();*/

/*const ChildManager = require("./children/ChildManager");

async function run() {

    const childId = "child_1782297272645";

    console.log("--------------------------------");

    console.log(await ChildManager.getChild(childId));

    console.log("--------------------------------");

    console.log("Exists");

    console.log(await ChildManager.childExists(childId));

    console.log("--------------------------------");

    console.log("Name");

    console.log(await ChildManager.getName(childId));

    console.log("--------------------------------");

    console.log("Parent");

    console.log(await ChildManager.getParentId(childId));

    console.log("--------------------------------");

    console.log("Paired");

    console.log(await ChildManager.isPaired(childId));

    console.log("--------------------------------");

    console.log("Online");

    console.log(await ChildManager.isOnline(childId));

    console.log("--------------------------------");

    console.log("Battery");

    console.log(await ChildManager.getBattery(childId));

    console.log("--------------------------------");

    console.log("Subscription");

    console.log(await ChildManager.getSubscription(childId));

}

run();*/

/*const SubscriptionManager = require("./subscriptions/SubscriptionManager");

async function run() {

    const childId = "child_1782297272645";

    console.log("--------------------------------");

    console.log("Subscription");

    console.log(await SubscriptionManager.getSubscription(childId));

    console.log("--------------------------------");

    console.log("Is Active");

    console.log(await SubscriptionManager.isActive(childId));

    console.log("--------------------------------");

    console.log("Is Expired");

    console.log(await SubscriptionManager.isExpired(childId));

    console.log("--------------------------------");

    console.log("Days Remaining");

    console.log(await SubscriptionManager.daysRemaining(childId));

}

run();*/

/*const BillingManager = require("./billing/BillingManager");

async function run() {

    const result =
        await BillingManager.recordPayment({

            childId: "child_1782297272645",

            planId: "premium",

            amount: 750,

            checkoutId: "TEST123456789",

            phone: "254748441330"

        });

    console.log(result);

}

run();*/

/*const CommissionManager =
require("./commissions/CommissionManager");

async function run() {

    const result =
        await CommissionManager.recordCommission({

            agentId: "nPi5aaYrdObf6mp62hX8EBIWTgC3",

            childId: "child_1782297272645",

            planId: "premium",

            checkoutId: "TEST123456789"

        });

    console.log(result);

}

run();*/

/*const BillingManager = require("./billing/BillingManager");

async function run() {

    const result =
        await BillingManager.recordPayment({

            childId: "child_1782297272645",

            planId: "premium",

            amount: 750,

            checkoutId: "TEST000001",

            phone: "254748441330",

            agentId: "nPi5aaYrdObf6mp62hX8EBIWTgC3"

        });

    console.log(result);

}

run();*/

/*const BillingManager = require("./billing/BillingManager");

async function run() {

    const result = await BillingManager.recordPayment({

        childId: "child_1782297272645",

        planId: "premium",

        amount: 750,

        checkoutId: "TEST000021",

        phone: "254748441330",

        agentId: "nPi5aaYrdObf6mp62hX8EBIWTgC3"

    });

    console.log(result);

}

run();*/

/*const WithdrawalManager =
require("./withdrawals/WithdrawalManager");

async function run() {

    const result =
        await WithdrawalManager.requestWithdrawal({

            agentId: "nPi5aaYrdObf6mp62hX8EBIWTgC3",

            amount: 300,

            phone: "254748441330"

        });

    console.log(result);

}

run();*/

/*const WithdrawalManager =
require("./withdrawals/WithdrawalManager");

async function run() {

    const result =
        await WithdrawalManager.approveWithdrawal(
            "-OwNLvgXYdE-ENC8IP3q"
        );

    console.log(result);

}

run();*/

/*const WithdrawalManager =
require("./withdrawals/WithdrawalManager");

async function run() {

    const result =
        await WithdrawalManager.requestWithdrawal({

            agentId: "nPi5aaYrdObf6mp62hX8EBIWTgC3",

            amount: 200,

            phone: "254748441330"

        });

    console.log(result);

}

run();*/

/*const WithdrawalManager =
require("./withdrawals/WithdrawalManager");

async function run() {

    const result =
        await WithdrawalManager.rejectWithdrawal(

            "-OwNPcVs2iTLyyrX3sdg",

            "Incorrect bank details"

        );

    console.log(result);

}

run();*/

/*const AgentManager =
require("./agents/AgentManager");

async function run() {

    console.log("--------------------------------");
    console.log("Agent");

    console.log(
        await AgentManager.getAgent(
            "nPi5aaYrdObf6mp62hX8EBIWTgC3"
        )
    );

    console.log("--------------------------------");
    console.log("Commission");

    console.log(
        await AgentManager.getCommissionBalance(
            "nPi5aaYrdObf6mp62hX8EBIWTgC3"
        )
    );

    console.log("--------------------------------");
    console.log("Pending");

    console.log(
        await AgentManager.getPendingWithdrawals(
            "nPi5aaYrdObf6mp62hX8EBIWTgC3"
        )
    );

    console.log("--------------------------------");
    console.log("Sales");

    console.log(
        await AgentManager.getSuccessfulSales(
            "nPi5aaYrdObf6mp62hX8EBIWTgC3"
        )
    );

    console.log("--------------------------------");
    console.log("Customers");

    console.log(
        await AgentManager.getActiveCustomers(
            "nPi5aaYrdObf6mp62hX8EBIWTgC3"
        )
    );

}

run();*/

/*const DashboardManager =
require("./dashboard/DashboardManager");

async function run() {

    const dashboard =
        await DashboardManager.getDashboard(

            "nPi5aaYrdObf6mp62hX8EBIWTgC3"

        );

    console.log(JSON.stringify(dashboard, null, 2));

}

run();*/

const WithdrawalManager =
require("./withdrawals/WithdrawalManager");

async function run() {

    const withdrawals =
        await WithdrawalManager.getAgentWithdrawals(

            "nPi5aaYrdObf6mp62hX8EBIWTgC3"

        );

    console.log(JSON.stringify(withdrawals, null, 2));

}

run();