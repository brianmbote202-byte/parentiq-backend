const PLANS = {

    premium: {
        id: "premium",
        name: "Premium",
        price: 750,
        durationDays: 30,
        maxChildren: 1,
        maxDevicesPerChild: 1,
        agentCommission: 150
    },

    family: {
        id: "family",
        name: "Family",
        price: 1800,
        durationDays: 30,
        maxChildren: 5,
        maxDevicesPerChild: 1,
        agentCommission: 400
    }

}

module.exports = PLANS;