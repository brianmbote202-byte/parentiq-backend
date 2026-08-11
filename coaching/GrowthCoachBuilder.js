class GrowthCoachBuilder {

    build(statistics) {

        const coach = {

            title: "Growth Opportunity",

            headline: "",

            message: "",

            tip: "",

            action: ""

        };

        res.json({

    success: true,

    show: decision.show,

    reason: decision.reason,

    statistics: statistics.val(),

    coach

});

        coach.headline =
            `Earn up to KES ${statistics.potentialRevenue}/month`;

        /*
        ------------------------------------
        No Customers
        ------------------------------------
        */

        if (statistics.totalCustomers === 0) {

            coach.message =
                "Start by registering your first family today.";

            coach.tip =
                "Share your referral link with schools and parents.";

            coach.action =
                "Your first customer starts building recurring income.";

            return coach;

        }

        /*
        ------------------------------------
        Free Customers
        ------------------------------------
        */

        if (statistics.freeCustomers > 0) {

            coach.message =
                `You have ${statistics.freeCustomers} parents using the Free Plan.`;

            coach.tip =
                "Ask every parent how many children use phones or tablets.";

            coach.action =
                "Parents with 3 child devices save money on the Family Plan.";

            return coach;

        }

        /*
        ------------------------------------
        Expiring Soon
        ------------------------------------
        */

        if (statistics.expiringSoon > 0) {

            coach.message =
                `${statistics.expiringSoon} subscriptions expire within 7 days.`;

            coach.tip =
                "Call those parents before expiry.";

            coach.action =
                "Early renewals protect your recurring income.";

            return coach;

        }

        /*
        ------------------------------------
        Default
        ------------------------------------
        */

        coach.message =
            "Great work. Keep registering more families.";

        coach.tip =
            "Satisfied parents refer other parents.";

        coach.action =
            "Ask every customer for one referral.";

        return coach;

    }

}

module.exports = new GrowthCoachBuilder();