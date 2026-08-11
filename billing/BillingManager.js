const { db } = require("../firebase");
const SubscriptionManager = require("../subscriptions/SubscriptionManager");
const CommissionManager = require("../commissions/CommissionManager");
const ChildManager = require("../children/ChildManager");
const DashboardCache =
    require("../dashboard/DashboardCache");

class BillingManager {

    /**
     * Returns true if transaction already exists.
     */
    async paymentExists(checkoutId) {

        const snapshot = await db
            .ref("transactions")
            .child(checkoutId)
            .get();

        return snapshot.exists();
    }

    /**
     * Process successful payment.
     */
    async recordPayment({

 
    childId,
    parentId,
    agentId,
    planId,
    amount,
    checkoutId,
    phone
}) {

        // Prevent duplicate callbacks
        if (await this.paymentExists(checkoutId)) {

            return {

                success: false,

                message: "Payment already processed."

            };

        }

        const child = await ChildManager.getChild(childId);

        if (!child) {
            throw new Error("Child not found.");
        }

        const now = Date.now();

        const transaction = {

            childId,

            parentId: child.parentId,

            agentId,

            amount,

            checkoutId,

            phone,

            planId,

            paidAt: now,

            status: "SUCCESS"

        };

        // Master transaction record
        await db
            .ref("transactions")
            .child(checkoutId)
            .set(transaction);

        // Child payment history
        await db
            .ref("children")
            .child(childId)
            .child("payments")
            .push(transaction);


// attach agent to child (THIS IS THE KEY FIX)
await db
    .ref("children")
    .child(childId)
    .update({
        agentId: agentId
    });

        // Billing summary
        await db
            .ref("children")
            .child(childId)
            .child("billing")
            .update({

                lastCheckoutId: checkoutId,

                lastPaidAt: now,

                lastPaymentStatus: "SUCCESS",

                phone

            });

// Save the agent responsible for this customer
if (agentId) {

    await db
        .ref("children")
        .child(childId)
        .update({

            agentId

        });

}

        // Activate subscription
        const subscription =
            await SubscriptionManager.activate(
                childId,
                planId
            );

      // Pay agent
let commission = null;

if (agentId) {

    commission =
        await CommissionManager.recordCommission({

            agentId,

            childId,

            planId,

            checkoutId

        });

    /*
    ==========================================
    CLEAR DASHBOARD CACHE
    ==========================================
    */

    DashboardCache.clear(agentId);

    console.log(
        "Dashboard cache cleared for:",
        agentId
    );

}

return {

    success: true,

    transaction,

    subscription,

    commission

};

    }

}

module.exports = new BillingManager();