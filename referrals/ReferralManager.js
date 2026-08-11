const { db } = require("../firebase");
const ActivityManager = require("../activity/ActivityManager");


/*CACHE DATA*/
const DashboardCache =
    require("../cache/DashboardCache");

/*GET AGENT PREFERENCES*/
const AgentPreferenceManager =
    require("../preferences/AgentPreferenceManager");
 



class ReferralManager {
 

    /*
    ==========================================
    VALIDATE REFERRAL CODE
    ==========================================
    */

    async validateReferralCode(referralCode) {

        referralCode = (referralCode || "")
            .trim()
            .toUpperCase();

        if (!referralCode) {

            return {

                success: true,

                valid: false,

                message: "Referral code is required."

            };

        }

        const snapshot = await db
            .ref("agents")
            .orderByChild("referralCode")
            .equalTo(referralCode)
            .get();

        if (!snapshot.exists()) {

            return {

                success: true,

                valid: false,

                message: "Referral code not found."

            };

        }

        let agent = null;

        snapshot.forEach(child => {

            agent = {

                agentId: child.key,

                ...child.val()

            };



        });

        /*
--------------------------------------
Agent approved?
--------------------------------------
*/

if (agent.status !== "approved") {

    return {

        success: true,

        valid: false,

        message: "Agent is not active."

    };

}

/*
--------------------------------------
Referral code exists?
--------------------------------------
*/

if (!agent.referralCode) {

    return {

        success: true,

        valid: false,

        message: "Agent has no referral code."

    };

}

return {

    success: true,

    valid: true,

    agentId: agent.agentId,

    agentName: agent.fullName,

    referralCode: agent.referralCode

};

    }

    /*
    ==========================================
    FIND AGENT
    (Internal helper)
    ==========================================
    */

    async findAgentByReferralCode(referralCode) {

        const result =
            await this.validateReferralCode(
                referralCode
            );

        if (!result.valid) {

            throw new Error(result.message);

        }

        return {

            uid: result.agentId,

            fullName: result.agentName,

            referralCode: result.referralCode

        };

    }

    

    /*
==========================================
CREATE REFERRAL SESSION
==========================================
*/

/*
==========================================
CREATE REFERRAL SESSION
(Compatibility Wrapper)
==========================================
*/

async createReferralSession(referralCode) {

    const result =
        await this.createOrRecoverSession(
            referralCode
        );

    return result.session;

}

/*
==========================================
RECOVER REFERRAL SESSION
==========================================
*/

/*
==========================================
RECOVER REFERRAL SESSION
==========================================
*/

async recoverReferralSession(sessionId) {

    if (!sessionId) {

        throw new Error("Session ID is required.");

    }

    const snapshot = await db
        .ref("referral_sessions")
        .child(sessionId)
        .get();

    if (!snapshot.exists()) {

        throw new Error(
            "Referral session not found."
        );

    }

    const session = snapshot.val();

    if (session.redeemed) {

        throw new Error(
            "Referral session already redeemed."
        );

    }

    const sevenDays =
        7 * 24 * 60 * 60 * 1000;

    if (
        Date.now() - session.createdAt >
        sevenDays
    ) {

        throw new Error(
            "Referral session expired."
        );

    }

    const validation =
        await this.validateReferralCode(
            session.referralCode
        );

    if (!validation.valid) {

        throw new Error(
            "Referral code is no longer valid."
        );

    }

    return {

        success: true,

        session: {

            sessionId,

            referralCode: validation.referralCode,

            agentId: validation.agentId,

            agentName: validation.agentName,

            redeemed: false,

            createdAt: session.createdAt

        }

    };

}

/*
==========================================
MARK SESSION AS REDEEMED
==========================================
*/

async redeemReferralSession(sessionId) {

    await db
        .ref("referral_sessions")
        .child(sessionId)
        .update({

            redeemed: true,

            redeemedAt: Date.now()

        });

}

/*
==========================================
REDEEM REFERRAL
==========================================
*/

async redeemReferral(sessionId, parentId) {

    /*
    --------------------------------------
    Redeem Session
    --------------------------------------
    */

    await this.redeemReferralSession(sessionId);

    /*
    --------------------------------------
    Load Parent
    --------------------------------------
    */

    const parentSnap = await db
        .ref("parents")
        .child(parentId)
        .get();

    if (!parentSnap.exists()) {

        throw new Error("Parent not found.");

    }

    const parent = parentSnap.val();

    /*
    --------------------------------------
    Find Agent
    --------------------------------------
    */

    const agentId =
        parent?.referral?.agentId;

    if (!agentId) {

        return {

            success: true,

            message:
                "Parent has no referring agent."

        };

    }

    /*
    --------------------------------------
    Create Activity
    --------------------------------------
    */

    await ActivityManager.createCustomerActivity(

        agentId,

        {

            id: parentId,

            fullName:
                parent.name || "Customer"

        }

    );

        await AgentPreferenceManager.incrementNewCustomers(agentId);

    /*
    --------------------------------------
    Dashboard Cache
    --------------------------------------
    */

    DashboardCache.clear(agentId);

    console.log(
        "Dashboard cache cleared:",
        agentId
    );

    return {

        success: true

    };

}

/*
==========================================
DELETE EXPIRED SESSIONS
==========================================
*/

/*
==========================================
DELETE EXPIRED SESSIONS
==========================================
*/

async deleteExpiredSessions() {

    const snapshot =
        await db.ref("referral_sessions").get();

    if (!snapshot.exists()) {

        return {

            success: true,

            deleted: 0

        };

    }

    const now = Date.now();

    const sevenDays =
        7 * 24 * 60 * 60 * 1000;

    let deleted = 0;

    const promises = [];

    snapshot.forEach(child => {

        const session = child.val();

        if (!session.createdAt)
            return;

        const age =
            now - session.createdAt;

        if (

            session.redeemed === false &&

            age > sevenDays

        ) {

            promises.push(

                child.ref.remove()
                    .then(() => {

                        deleted++;

                    })

            );

        }

    });

    await Promise.all(promises);

    return {

        success: true,

        deleted

    };

}
/*
==========================================
CREATE OR RECOVER REFERRAL SESSION
==========================================
*/

/*
==========================================
CREATE OR RECOVER REFERRAL SESSION
==========================================
*/

async createOrRecoverSession(referralCode) {

    console.log("========================================");
    console.log("CREATE OR RECOVER REFERRAL SESSION");
    console.log("Referral Code:", referralCode);
    console.log("========================================");

    const result =
        await this.validateReferralCode(referralCode);

    if (!result.valid) {

        console.log("Referral validation failed:", result.message);

        throw new Error(result.message);
    }

    console.log("Referral code is valid.");
    console.log("Agent ID:", result.agentId);
    console.log("Agent Name:", result.agentName);

    const sessionsRef =
        db.ref("referral_sessions");

    console.log("Searching for existing sessions...");

    const snapshot =
        await sessionsRef
            .orderByChild("referralCode")
            .equalTo(result.referralCode)
            .get();

    const now = Date.now();

    const sevenDays =
        7 * 24 * 60 * 60 * 1000;

    let reusableSession = null;

    let totalSessions = 0;

    snapshot.forEach(child => {

        totalSessions++;

        const session = child.val();

        const age =
            now - session.createdAt;

        console.log("----------------------------------------");
        console.log("Found Session:", child.key);
        console.log("Redeemed:", session.redeemed);
        console.log("Age (hours):", (age / (1000 * 60 * 60)).toFixed(2));

        if (

            session.redeemed === false &&

            age < sevenDays

        ) {

            console.log("Reusable session found:", child.key);

            reusableSession = {

                sessionId: child.key,

                ...session

            };

        } else {

            console.log("Session cannot be reused.");

        }

    });

    console.log("Existing sessions found:", totalSessions);

    /*
    --------------------------------------
    Reuse existing session
    --------------------------------------
    */

    if (reusableSession) {

        console.log("Returning existing session:");
        console.log(reusableSession.sessionId);
        console.log("========================================");

        return {

            success: true,

            session: reusableSession

        };

    }

    /*
    --------------------------------------
    Create new session
    --------------------------------------
    */

    console.log("No reusable session found.");
    console.log("Creating a new referral session...");

    const newSessionRef =
        sessionsRef.push();

    const session = {

        referralCode: result.referralCode,

        agentId: result.agentId,

        agentName: result.agentName,

        redeemed: false,

        createdAt: now

    };

    await newSessionRef.set(session);

    try {

    await ActivityManager.createReferralActivity(
        result.agentId,
        {
            referralCode: result.referralCode,
            sessionId: newSessionRef.key
        }
    );

} catch (error) {

    console.error("Activity logging failed:", error);

}

    console.log("New session created successfully.");
    console.log("Session ID:", newSessionRef.key);
    console.log("========================================");

    return {

        success: true,

        session: {

            sessionId: newSessionRef.key,

            ...session

        }

    };

}

}


module.exports = new ReferralManager();
