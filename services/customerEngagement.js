/*
==================================================
CUSTOMER SALES INTELLIGENCE ENGINE
==================================================
*/

class CustomerEngagement {

    get(customer, parentStats = {}) {

        const now = Date.now();

        const subscription = customer.subscription || {};
        const billing = customer.billing || {};
        const activity = customer.activity || {};
        const latest = activity.latest || {};
        const stats = activity.statistics || {};

        const totalChildren =
            parentStats.totalChildren || 1;

        /*
        ==================================================
        HEALTH SCORE
        ==================================================
        */

        let score = 50;

        // Subscription
        if (subscription.active) {
            score += 30;
        } else {
            score -= 30;
        }

        // Family plan
        if (subscription.planId === "family") {
            score += 25;
        }

        // Multiple children
        if (totalChildren >= 3) {
            score += 20;
        }

        const expiry =
            subscription.expiryDate || 0;

        const sevenDays =
            7 * 24 * 60 * 60 * 1000;

        // Expiring soon
        if (
            expiry > now &&
            expiry <= now + sevenDays
        ) {
            score -= 15;
        }

        // Expired
        if (
            expiry > 0 &&
            expiry < now
        ) {
            score -= 40;
        }

        // Payment history
        if (billing.lastPaidAt > 0) {
            score += 10;
        } else {
            score -= 10;
        }

        // Recently renewed
        if (
            subscription.lastRenewedAt &&
            now - subscription.lastRenewedAt <= sevenDays
        ) {
            score += 15;
        }

        /*
        ==================================================
        CUSTOMER ENGAGEMENT
        ==================================================
        */

        if (stats.totalActivities === 0) {
            score -= 20;
        }

        if (stats.totalActivities >= 3) {
            score += 15;
        }

        if (
            stats.lastContactAt > 0 &&
            now - stats.lastContactAt <= 3 * 24 * 60 * 60 * 1000
        ) {
            score += 10;
        }

        if (
            stats.nextFollowUp > 0 &&
            stats.nextFollowUp < now
        ) {
            score -= 20;
        }

        score = Math.max(0, Math.min(100, score));

        /*
        ==================================================
        DEFAULT VALUES
        ==================================================
        */

        let priority = "LOW";
        let color = "GREEN";
        let stage = "RETENTION";
        let icon = "heart";
        let urgency = "LOW";
        let recommendedPlan = "CURRENT";
        let bestChannel = "NONE";
        let conversionChance = 0;
        let estimatedValue = 0;
        let estimatedCommission = 0;
        let expectedClose = "-";
        let nextAction = "Check in with customer.";
        let reason = "Healthy customer.";
        let salesScript = "";

        /*
        ==================================================
        HIGH PRIORITY
        ==================================================
        */

        if (score <= 30) {

            priority = "HIGH";
            color = "RED";
            stage = "CONVERSION";
            icon = "phone";
            urgency = "TODAY";

            recommendedPlan = "PREMIUM";

            conversionChance = 90;
            estimatedValue = 750;
            estimatedCommission = 150;
            expectedClose = "3 DAYS";

            if (stats.totalActivities === 0) {

                bestChannel = "PHONE";

                nextAction =
                    "Introduce ParentIQ to the customer.";

                reason =
                    "Customer has never been contacted.";

                salesScript =
                    "Hello! I'm reaching out to introduce ParentIQ Premium and explain how it protects your children.";

            }
            else if (latest.type === "WHATSAPP") {

                bestChannel = "PHONE";

                nextAction =
                    "Follow up with a phone call.";

                reason =
                    "WhatsApp conversation needs escalation.";

                salesScript =
                    "I wanted to follow up on our WhatsApp conversation and answer any questions you have.";

            }
            else {

                bestChannel = "PHONE";

                nextAction =
                    "Call customer today.";

                reason =
                    "Customer is still on the Free plan.";

                salesScript =
                    "I'd like to help you activate Premium today and secure your child's protection.";

            }

        }

        /*
        ==================================================
        FOLLOW UP
        ==================================================
        */

        else if (score <= 60) {

            priority = "MEDIUM";
            color = "ORANGE";
            stage = "FOLLOW_UP";
            icon = "whatsapp";
            urgency = "THIS_WEEK";

            recommendedPlan = "PREMIUM";

            conversionChance = 75;
            estimatedValue = 750;
            estimatedCommission = 150;
            expectedClose = "7 DAYS";

            if (latest.type === "PHONE") {

                bestChannel = "WHATSAPP";

                nextAction =
                    "Send WhatsApp summary.";

                reason =
                    "Customer was already called.";

            }
            else {

                bestChannel = "PHONE";

                nextAction =
                    "Call customer this week.";

                reason =
                    "Customer needs follow-up.";

            }

            salesScript =
                "Hello! Just checking in to see if you'd like to activate ParentIQ Premium.";

        }

        /*
        ==================================================
        UPSELL
        ==================================================
        */

        else if (score <= 85) {

            priority = "MEDIUM";
            color = "PURPLE";
            stage = "UPSELL";
            icon = "family";
            urgency = "THIS_MONTH";

            recommendedPlan = "FAMILY";
            bestChannel = "WHATSAPP";

            conversionChance = 82;
            estimatedValue = 1800;
            estimatedCommission = 360;
            expectedClose = "14 DAYS";

            nextAction =
                "Recommend Family Plan.";

            reason =
                `${totalChildren} children linked. Family Plan saves money.`;

            salesScript =
                "Since you're managing several children, the Family Plan gives much better value and protection.";

        }

        /*
        ==================================================
        RETENTION
        ==================================================
        */

        else {

            priority = "LOW";
            color = "GREEN";
            stage = "RETENTION";
            icon = "heart";
            urgency = "LOW";

            recommendedPlan = "CURRENT";
            bestChannel = "NONE";

            conversionChance = 98;
            estimatedValue = 0;
            estimatedCommission = 0;
            expectedClose = "-";

            nextAction =
                "Thank customer for staying with ParentIQ.";

            reason =
                "Customer is highly engaged.";

            salesScript =
                "Thank you for choosing ParentIQ. We appreciate your continued trust.";

        }

        return {

            healthScore: score,

            priority,

            color,

            stage,

            icon,

            urgency,

            recommendedPlan,

            bestChannel,

            conversionChance,

            estimatedValue,

            estimatedCommission,

            expectedClose,

            salesOpportunity:
                Math.ceil(conversionChance / 20),

            nextAction,

            reason,

            salesScript,

            lastContactType:
                stats.lastContactType || "NONE",

            lastContactAt:
                stats.lastContactAt || 0,

            totalActivities:
                stats.totalActivities || 0

        };

    }

}

module.exports = new CustomerEngagement();