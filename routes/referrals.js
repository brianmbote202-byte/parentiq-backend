const express = require("express");

const router = express.Router();

const referralManager =
    require("../referrals/ReferralManager");

const ActivityManager =
    require("../activity/ActivityManager");

const DashboardCache =
    require("../cache/DashboardCache");

const { db } =
    require("../firebase");

    const AgentStatisticsManager =
    require("../statistics/AgentStatisticsManager");

    const AgentPreferenceManager =
    require("../preferences/AgentPreferenceManager");


/*
==========================================
VALIDATE REFERRAL CODE
==========================================
*/

router.post("/validate", async (req, res) => {

    try {

        const { referralCode } = req.body;

        const agent =
            await referralManager.findAgentByReferralCode(
                referralCode
            );


        res.json({

            success: true,

            valid: true,

            agentId: agent.uid,

            agentName: agent.fullName

        });


    } catch (e) {


        res.json({

            success: true,

            valid: false,

            message: e.message

        });

    }

});



/*
==========================================
CREATE REFERRAL SESSION
==========================================
*/

router.post("/session", async (req,res)=>{

    try {

        const {
            referralCode
        } = req.body;


        const session =
            await referralManager.createReferralSession(
                referralCode
            );


        res.json({

            success:true,

            session

        });


    } catch(e){


        res.status(400).json({

            success:false,

            message:e.message

        });


    }

});



/*
==========================================
RECOVER REFERRAL SESSION
==========================================
*/

router.post("/recover", async(req,res)=>{

    try {


        const {
            sessionId
        } = req.body;


        const result =
            await referralManager.recoverReferralSession(
                sessionId
            );


        res.json(result);


    } catch(e){


        res.status(404).json({

            success:false,

            message:e.message

        });


    }

});



/*
==========================================
REDEEM REFERRAL
CREATE NEW CUSTOMER ACTIVITY
==========================================
*/

router.post("/redeem", async(req,res)=>{

    console.log("🔥 REDEEM ROUTE HIT");

console.log(
    "BODY:",
    req.body
);


    try {


        const {

            sessionId,

            parentId

        } = req.body;



        if(!sessionId || !parentId){


            return res.status(400).json({

                success:false,

                message:
                "sessionId and parentId are required."

            });

        }



        /*
        --------------------------------------
        Load Parent
        --------------------------------------
        */


        const parentSnap =
            await db
            .ref("parents")
            .child(parentId)
            .get();



        if(!parentSnap.exists()){


            throw new Error(
                "Parent not found."
            );

        }



        const parent =
            parentSnap.val();



        /*
        --------------------------------------
        Find Agent
        --------------------------------------
        */


        const agentId =
            parent?.referral?.agentId;



        console.log(
            "========== REFERRAL REDEEM =========="
        );

        console.log(
            "Parent:",
            parentId
        );

        console.log(
            "Agent:",
            agentId
        );

        console.log(
            "======================================"
        );



        /*
        --------------------------------------
        Create Agent Activity
        --------------------------------------
        */


        if(agentId){


            try {

    const activityId =
        await ActivityManager.createCustomerActivity(
            agentId,
            {
                id: parentId,
                fullName: parent.name || "New Customer"
            }
        );

    console.log(
        "Customer Activity Created:",
        activityId
    );

} catch (e) {

    console.error(
        "Activity creation failed:",
        e
    );

}

try {

    await AgentStatisticsManager.refresh(agentId);

    console.log(
        "Agent statistics refreshed:",
        agentId
    );

} catch (e) {

    console.error(
        "Statistics refresh failed:",
        e
    );

}

try {

    const count =
        await AgentPreferenceManager.incrementNewCustomers(agentId);

    console.log(
        "Growth counter:",
        count
    );

} catch (e) {

    console.error(
        "Preference update failed:",
        e
    );

}

DashboardCache.clear(agentId);

console.log(
    "Dashboard cache cleared:",
    agentId
);



            /*
            ----------------------------------
            Clear Dashboard Cache
            ----------------------------------
            */


            /*
----------------------------------
Refresh Statistics
----------------------------------
*/

console.log(
    "Agent statistics refreshed:",
    agentId
);

/*
----------------------------------
Clear Dashboard Cache
----------------------------------
*/


console.log(
    "Dashboard cache cleared:",
    agentId
);

        }
        else {


            console.log(
                "No agent attached to parent."
            );


        }




        /*
        --------------------------------------
        Mark referral session redeemed
        --------------------------------------
        */


        await referralManager.redeemReferralSession(

            sessionId

        );



        res.json({

            success:true,

            message:
            "Referral redeemed successfully."

        });



    }
    catch(e){


        console.error(
            "REDEEM ERROR:",
            e
        );


        res.status(500).json({

            success:false,

            message:e.message

        });


    }


});



module.exports = router;