const { db } = require("../firebase");
const APP_CONFIG = require("../config/AppConfig");

async function initializeDatabase() {

    console.log("====================================");
    console.log("Initializing ParentIQ Database...");
    console.log("====================================");

    try {

        await initializePlans();

        console.log("Database initialization completed.");

    } catch (error) {

        console.error("Database initialization failed.");
        console.error(error);

    }

}

async function initializePlans() {

    console.log("Synchronizing subscription plans...");

    const plansRef = db.ref("plans");

    const plans = APP_CONFIG.plans;

    for (const planId in plans) {

        console.log(`Updating plan: ${planId}`);

        await plansRef.child(planId).update(plans[planId]);

    }

    console.log("Subscription plans synchronized successfully.");

}

module.exports = initializeDatabase;