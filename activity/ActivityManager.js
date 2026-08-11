const { db } = require("../firebase");
const ActivityTypes = require("./ActivityTypes");

class ActivityManager {

    constructor() {

        // keeps track of inserts before cleanup
        this.cleanupCounter = {};

        this.MAX_ACTIVITIES = 100;

    }

    /*
    ==================================================
    ADD ACTIVITY
    ==================================================
    */

    async add(agentId, activity) {

        if (!agentId || !activity?.type) {
            return null;
        }

        const ref = db
            .ref("agent_activity")
            .child(agentId)
            .push();

        await ref.set({

            ...activity,

            createdAt: Date.now()

        });

        // cleanup every 10 inserts
        this.cleanupCounter[agentId] =
            (this.cleanupCounter[agentId] || 0) + 1;

        if (this.cleanupCounter[agentId] % 10 === 0) {

            await this.cleanup(agentId);

        }

        return ref.key;

    }

    /*
    ==================================================
    LATEST ACTIVITY
    ==================================================
    */

    async getLatest(agentId) {

        const list =
            await this.getRecent(agentId, 1);

        return list.length ? list[0] : null;

    }

    /*
    ==================================================
    RECENT ACTIVITIES
    ==================================================
    */

    async getRecent(agentId, limit = 10) {

        if (!agentId) return [];

        const snap = await db
            .ref("agent_activity")
            .child(agentId)
            .orderByChild("createdAt")
            .limitToLast(limit)
            .get();

        if (!snap.exists()) {
            return [];
        }

        const activities = [];

        snap.forEach(child => {

            activities.push({

                id: child.key,

                ...child.val()

            });

        });

        return activities.reverse();

    }

    /*
    ==================================================
    CLEANUP
    ==================================================
    */

    async cleanup(agentId) {

        const snap = await db
            .ref("agent_activity")
            .child(agentId)
            .orderByChild("createdAt")
            .get();

        if (!snap.exists()) {
            return;
        }

        const activities = [];

        snap.forEach(child => {

            activities.push({

                key: child.key,

                createdAt: child.val()?.createdAt || 0

            });

        });

        if (activities.length <= this.MAX_ACTIVITIES) {
            return;
        }

        activities.sort(

            (a, b) => a.createdAt - b.createdAt

        );

        const removeCount =
            activities.length - this.MAX_ACTIVITIES;

        const updates = {};

        for (let i = 0; i < removeCount; i++) {

            updates[activities[i].key] = null;

        }

        await db
            .ref("agent_activity")
            .child(agentId)
            .update(updates);

    }

    /*
    ==================================================
    CUSTOMER
    ==================================================
    */

    async createCustomerActivity(agentId, parent) {

        return this.add(agentId, {

            type: ActivityTypes.CUSTOMER,

            title: "New Customer",

            description:
                `${parent.fullName || parent.name} registered.`,

            icon: "person",

            color: "#4CAF50",

            entity: {

                type: "CUSTOMER",

                id: parent.id

            }

        });

    }

    /*
    ==================================================
    COMMISSION
    ==================================================
    */

    async createCommissionActivity(agentId, data) {

        return this.add(agentId, {

            type: ActivityTypes.COMMISSION,

            title: "Commission Earned",

            description:
                this.formatCommissionDescription(data),

            icon: "money",

            color: "#4CAF50",

            entity: {

                type: "CHILD",

                id: data.childId

            }

        });

    }

    /*
    ==================================================
    COMMISSION DESCRIPTION
    ==================================================
    */

    formatCommissionDescription(data) {

        if (data.childName) {

            return `You earned KES ${data.amount} from ${data.childName}`;

        }

        if (data.planName) {

            return `Commission earned from ${data.planName}`;

        }

        return `Commission earned`;

    }

    /*
    ==================================================
    SUBSCRIPTION
    ==================================================
    */

    async createSubscriptionActivity(agentId, data) {

        return this.add(agentId, {

            type: ActivityTypes.SUBSCRIPTION,

            title: "Subscription Activated",

            description:
                `${data.childName} subscribed to ${data.planName}`,

            icon: "star",

            color: "#2196F3",

            entity: {

                type: "CHILD",

                id: data.childId

            }

        });

    }

    /*
    ==================================================
    WITHDRAWAL
    ==================================================
    */

    async createWithdrawalActivity(agentId, data) {

        let title = "";
        let description = "";

        switch (data.status) {

            case "REQUESTED":

                title = "Withdrawal Requested";

                description =
                    `You requested KES ${data.amount}`;

                break;

            case "APPROVED":

                title = "Withdrawal Approved";

                description =
                    `Your withdrawal of KES ${data.amount} was approved`;

                break;

            case "PAID":

                title = "Withdrawal Paid";

                description =
                    `KES ${data.amount} has been sent to your M-Pesa account`;

                break;

            case "REJECTED":

                title = "Withdrawal Rejected";

                description =
                    data.reason
                        ? `Reason: ${data.reason}`
                        : "Your withdrawal request was rejected.";

                break;

        }

        return this.add(agentId, {

    type: ActivityTypes.WITHDRAWAL,

    title,

    description,

    icon: "wallet",

    color:
        data.status === "REJECTED"
            ? "#F44336"
            : "#2196F3",

    entity: {

        type: "WITHDRAWAL",

        id: data.withdrawalId || "",

        reference: data.reference || "",

        amount: Number(data.amount || 0)

    },

    status: data.status,

    withdrawalId: data.withdrawalId || "",

    reference: data.reference || "",

    amount: Number(data.amount || 0),

    receipt: data.mpesaReceipt || ""

});

 }

    async createReferralActivity(agentId, data) {

    return this.add(agentId, {

        type: ActivityTypes.REFERRAL,

        title: "Referral Link Opened",

        description:
            `Referral code ${data.referralCode} was used.`,

        icon: "link",

        color: "#9C27B0",

        entity: {

            type: "REFERRAL",

            id: data.sessionId

        }

    });

}

}

/*module.exports = new ActivityManager();const { db } = require("../firebase");*/
module.exports = new ActivityManager();
