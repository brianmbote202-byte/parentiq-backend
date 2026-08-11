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

        return plan ? plan.price : null;
    }

    async getCommission(planId) {

        const plan = await this.getPlan(planId);

        return plan ? plan.agentCommission : null;
    }

    async getDuration(planId) {

        const plan = await this.getPlan(planId);

        return plan ? plan.durationDays : null;
    }

    async getMaxChildren(planId) {

        const plan = await this.getPlan(planId);

        return plan ? plan.maxChildren : null;
    }

    async getMaxDevicesPerChild(planId) {

        const plan = await this.getPlan(planId);

        return plan ? plan.maxDevicesPerChild : null;
    }

}

module.exports = new PlanManager();