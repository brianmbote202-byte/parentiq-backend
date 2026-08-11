const { db } = require("../firebase");

class AgentPreferenceManager {

    /*
    ==========================================
    GET PREFERENCES
    ==========================================
    */

    async get(agentId) {

    const ref = db
        .ref("agent_preferences")
        .child(agentId);

    const snapshot = await ref.get();

    if (snapshot.exists()) {

        return snapshot.val();

    }

    const defaults = {

        growthSheetLastShown: 0,

        newCustomersSinceGrowthSheet: 0,

        expiryReminderLastShown: 0,

        updatedAt: Date.now()

    };

    await ref.set(defaults);

    return defaults;

}

    /*
    ==========================================
    UPDATE
    ==========================================
    */

    async update(agentId, values) {

        await db
            .ref("agent_preferences")
            .child(agentId)
            .update({

                ...values,

                updatedAt: Date.now()

            });

    }

    /*
==========================================
NEW CUSTOMER REGISTERED
==========================================
*/

async incrementNewCustomers(agentId) {

    const preferences =
        await this.get(agentId);

    const count =
        Number(preferences.newCustomersSinceGrowthSheet || 0) + 1;

    await this.update(agentId, {

        growthSheetLastShown:
            preferences.growthSheetLastShown || 0,

        expiryReminderLastShown:
            preferences.expiryReminderLastShown || 0,

        newCustomersSinceGrowthSheet: count

    });

    return count;

}
/*
==========================================
BOTTOM SHEET SHOWN
==========================================
*/

async markGrowthSheetShown(agentId) {

    await this.update(agentId, {

        growthSheetLastShown: Date.now(),

        newCustomersSinceGrowthSheet: 0

    });

}

/*
==========================================
SHOULD SHOW?
==========================================
*/

async shouldShowGrowthSheet(agentId) {

    const preferences =
        await this.get(agentId);

    const now =
        Date.now();

    /*
    First dashboard visit
    */

    if (!preferences.growthSheetLastShown) {

        return {

            show: true,

            reason: "FIRST_TIME"

        };

    }

    /*
    Weekly reminder
    */

    const sevenDays =
        7 * 24 * 60 * 60 * 1000;

    if (

        now -
        preferences.growthSheetLastShown

        >= sevenDays

    ) {

        return {

            show: true,

            reason: "WEEKLY"

        };

    }

    /*
    Five new customers
    */

    if (

        preferences.newCustomersSinceGrowthSheet >= 5

    ) {

        return {

            show: true,

            reason: "NEW_CUSTOMERS"

        };

    }

    return {

        show: false,

        reason: null

    };

}

}


module.exports = new AgentPreferenceManager();