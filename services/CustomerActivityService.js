const { db } = require("../firebase");

const CustomersCache =
    require("../cache/CustomersCache");

const CustomerCacheBuilder =
    require("../builders/CustomerCacheBuilder");    

class CustomerActivityService {

    /*
    ==================================================
    ACTIVITY APPEARANCE
    ==================================================
    */

    getActivityAppearance(type) {

        switch ((type || "").toUpperCase()) {

            case "PHONE":
                return {
                    icon: "phone",
                    color: "#2196F3"
                };

            case "WHATSAPP":
                return {
                    icon: "whatsapp",
                    color: "#25D366"
                };

            case "SMS":
                return {
                    icon: "sms",
                    color: "#FF9800"
                };

            case "EMAIL":
                return {
                    icon: "email",
                    color: "#9C27B0"
                };

            case "PAYMENT":
                return {
                    icon: "payments",
                    color: "#4CAF50"
                };

            case "RENEWAL":
                return {
                    icon: "autorenew",
                    color: "#4CAF50"
                };

            case "VISIT":
                return {
                    icon: "location_on",
                    color: "#F44336"
                };

            case "NOTE":
                return {
                    icon: "note",
                    color: "#607D8B"
                };

            default:
                return {
                    icon: "history",
                    color: "#9E9E9E"
                };
        }
    }

    /*
    ==================================================
    ADD CUSTOMER ACTIVITY
    ==================================================
    */

    async addActivity({

        agentId,
        parentId,

        type,
        title,

        description = "",

        outcome = "UNKNOWN",

        priority = "NORMAL",

        status = "COMPLETED",

        source = "ANDROID_APP",

        nextFollowUp = 0,

        createdBy = ""

    }) {

        if (!agentId)
            throw new Error("agentId is required.");

        if (!parentId)
            throw new Error("parentId is required.");

        if (!type)
            throw new Error("Activity type is required.");

        if (!title)
            throw new Error("Activity title is required.");

        const normalizedType = type.toUpperCase();

        const appearance =
            this.getActivityAppearance(normalizedType);

        const activityRef = db
            .ref("agent_customer_activity")
            .child(agentId)
            .child(parentId)
            .push();

        const now = Date.now();

        const activity = {

            activityId: activityRef.key,

            type: normalizedType,

            title,

            description,

            outcome,

            priority,

            status,

            source,

            createdBy,

            createdById: agentId,

            icon: appearance.icon,

            color: appearance.color,

            createdAt: now,

            updatedAt: now,

            nextFollowUp

        };

await activityRef.set(activity);

console.log("Activity saved successfully");

await this.updateActivitySummary(

    agentId,
    parentId,
    activity

);

console.log("Activity summary updated");

return activity;
    }

    /*
    ==================================================
    GET ALL ACTIVITIES
    ==================================================
    */

    async getActivities(agentId, parentId, limit = 100) {

        const snapshot = await db
            .ref("agent_customer_activity")
            .child(agentId)
            .child(parentId)
            .get();

        if (!snapshot.exists())
            return [];

        return Object.values(snapshot.val())
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, limit);


        
}

  /*
    ==================================================
    GET ACTIVITY STATISTICS
    ==================================================
    */

  async getStatistics(agentId, parentId) {

    const summary =
        await this.getActivitySummary(
            agentId,
            parentId
        );

    return summary.statistics;

}



/*
==================================================
GET LATEST ACTIVITY
==================================================
*/

async getLatestActivity(agentId, parentId) {

    const snapshot = await db
        .ref("agent_customer_activity_summary")
        .child(agentId)
        .child(parentId)
        .child("latestActivity")
        .get();

    if (!snapshot.exists()) {
        return null;
    }

    return snapshot.val();

}

    /*
==================================================
UPDATE ACTIVITY SUMMARY
==================================================
*/



async updateActivitySummary(agentId, parentId, activity) {

    const summaryRef = db
        .ref("agent_customer_activity_summary")
        .child(agentId)
        .child(parentId);

    const snapshot = await summaryRef.get();

    const summary = snapshot.exists()
        ? snapshot.val()
        : {

            statistics: {

                calls: 0,
                sms: 0,
                whatsapp: 0,
                notes: 0,

                emails: 0,
                visits: 0,
                payments: 0,
                renewals: 0,

                totalActivities: 0

            }

        };

    /*
    ==========================================
    UPDATE COUNTERS
    ==========================================
    */

    switch (activity.type) {

        case "PHONE":
            summary.statistics.calls++;
            break;

        case "SMS":
            summary.statistics.sms++;
            break;

        case "WHATSAPP":
            summary.statistics.whatsapp++;
            break;

        case "EMAIL":
            summary.statistics.emails++;
            break;

        case "VISIT":
            summary.statistics.visits++;
            break;

        case "NOTE":
            summary.statistics.notes++;
            break;

        case "PAYMENT":
            summary.statistics.payments++;
            break;

        case "RENEWAL":
            summary.statistics.renewals++;
            break;

    }

    summary.statistics.totalActivities++;

    /*
    ==========================================
    UPDATE LATEST ACTIVITY
    ==========================================
    */

    summary.latestActivity = activity;

    summary.lastContactType = activity.type;

    summary.lastOutcome = activity.outcome;

    summary.lastActivityTime = activity.createdAt;

    summary.updatedAt = Date.now();

    await summaryRef.set(summary);

    /*
    ==========================================
    UPDATE CUSTOMERS CACHE
    ==========================================
    */

await CustomerCacheBuilder.rebuild(agentId);

CustomersCache.clear(agentId);

console.log("Customer cache rebuilt.");

}

/*
==================================================
UPDATE CUSTOMER CACHE
==================================================
*/



 

  

  async getActivitySummary(agentId, parentId) {

    const snapshot = await db
        .ref("agent_customer_activity_summary")
        .child(agentId)
        .child(parentId)
        .get();

    if (!snapshot.exists()) {

        return {

            latest: null,

            statistics: {

                totalActivities:0,

                totalCalls:0,
                totalWhatsapp:0,
                totalSMS:0,
                totalEmails:0,
                totalVisits:0,
                totalNotes:0,
                totalPayments:0,
                totalRenewals:0,

                lastContactType:"",
                lastContactAt:0,
                nextFollowUp:0

            }

        };

    }

    const summary = snapshot.val();

    const s = summary.statistics || {};

    return {

        latest: summary.latestActivity || null,

        statistics: {

            totalActivities:s.totalActivities || 0,

            totalCalls:s.calls || 0,

            totalWhatsapp:s.whatsapp || 0,

            totalSMS:s.sms || 0,

            totalEmails:s.emails || 0,

            totalVisits:s.visits || 0,

            totalNotes:s.notes || 0,

            totalPayments:s.payments || 0,

            totalRenewals:s.renewals || 0,

            lastContactType:summary.lastContactType || "",

            lastContactAt:summary.lastActivityTime || 0,

            nextFollowUp:
                summary.latestActivity?.nextFollowUp || 0

        }

    };

}

}
module.exports = new CustomerActivityService();