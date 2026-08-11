/**
 * ==========================================
 * ParentIQ Backend Configuration
 * ==========================================
 */

const APP_CONFIG = {

    // ======================================
    // Application Information
    // ======================================

    appName: "ParentIQ",

    company: "ParentIQ Tech",

    currency: "KES",

    timezone: "Africa/Nairobi",

    // ======================================
    // Subscription Plans
    // ======================================

    plans: {

        premium: {

            id: "premium",

            name: "Premium",

            price: 750,

            currency: "KES",

            durationDays: 30,

            renewalGraceDays: 7,

            maxChildren: 1,

            maxDevicesPerChild: 1,

            active: true,

            agentCommission: 200

        },

        family: {

            id: "family",

            name: "Family",

            price: 1800,

            currency: "KES",

            durationDays: 30,

            renewalGraceDays: 7,

            maxChildren: 3,

            maxDevicesPerChild: 1,

            active: true,

            agentCommission: 500

        }

    }

};

module.exports = APP_CONFIG;