const EventBus = require("./EventBus");
const CacheManager = require("../cache/CacheManager");

/*
==================================================
SUBSCRIPTION ACTIVATED
==================================================
*/

EventBus.on("subscriptionActivated", async ({ agentId }) => {

    try {

        console.log(
            "EVENT -> subscriptionActivated"
        );

        await CacheManager.refreshAgent(agentId);

    } catch (err) {

        console.error(err);

    }

});

/*
==================================================
COMMISSION RECORDED
==================================================
*/

EventBus.on("commissionRecorded", async ({ agentId }) => {

    try {

        console.log(
            "EVENT -> commissionRecorded"
        );

        await CacheManager.refreshAgent(agentId);

    } catch (err) {

        console.error(err);

    }

});

/*
==================================================
WITHDRAWAL CREATED
==================================================
*/

EventBus.on("withdrawalCreated", async ({ agentId }) => {

    try {

        console.log(
            "EVENT -> withdrawalCreated"
        );

        await CacheManager.refreshAgent(agentId);

    } catch (err) {

        console.error(err);

    }

});

/*
==================================================
CUSTOMER REGISTERED
==================================================
*/

EventBus.on("customerRegistered", async ({ agentId }) => {

    try {

        console.log(
            "EVENT -> customerRegistered"
        );

        await CacheManager.refreshAgent(agentId);

    } catch (err) {

        console.error(err);

    }

});