const { db } = require("../firebase");

class PlanManager {

    async getPlan(planId) {

        const snapshot = await db
            .ref("plans")
            .child(planId)
            .get();

        if (!snapshot.exists()) {
            return null;
        }

        return snapshot.val();
    }

    async getAllPlans() {

        const snapshot = await db.ref("plans").get();

        if (!snapshot.exists()) {
            return {};
        }

        return snapshot.val();
    }

    async planExists(planId) {

        const plan = await this.getPlan(planId);

        return plan !== null;
    }

    async isPlanActive(planId) {

        const plan = await this.getPlan(planId);

        if (!plan) {
            return false;
        }

        return plan.active === true;
    }

    async getPrice(planId) {

        const plan = await this.getPlan(planId);

        return plan ? Number(plan.price) : null;
    }

    async getCommission(planId) {

        const plan = await this.getPlan(planId);

        return plan ? Number(plan.agentCommission) : null;
    }

    async getDuration(planId) {

        const plan = await this.getPlan(planId);

        return plan ? Number(plan.durationDays) : null;
    }

    async getMaxChildren(planId) {

        const plan = await this.getPlan(planId);

        return plan ? Number(plan.maxChildren) : null;
    }

    async getMaxDevicesPerChild(planId) {

        const plan = await this.getPlan(planId);

        return plan ? Number(plan.maxDevicesPerChild) : null;
    }

    // -----------------------------------------
    // PAYMENT PRICING
    // -----------------------------------------

    async getPricing(planId) {

        const plan = await this.getPlan(planId);

        if (!plan) {
            return null;
        }

        return {
            planId,
            planName: plan.name || planId,

            // Master/base price stored in Firebase
            baseAmount: Number(plan.price),
            baseCurrency: "KES",

            durationDays:
                Number(plan.durationDays || 30),

            active:
                plan.active === true,

            agentCommission:
                Number(plan.agentCommission || 0)
        };
    }
}

module.exports = new PlanManager();