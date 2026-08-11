const { db } = require("../firebase");

class PayoutManager {

    /*
    ==================================================
    REQUEST PAYOUT PHONE CHANGE
    ==================================================
    */

    async requestPhoneChange({

        agentId,

        newPhone,

        country,

        countryCode,

        countryIso

    }) {

        /*
        --------------------------------------
        Load Agent
        --------------------------------------
        */

        const agentSnapshot = await db
            .ref("agents")
            .child(agentId)
            .get();

        if (!agentSnapshot.exists()) {
            throw new Error("Agent not found.");
        }

        const agent = agentSnapshot.val();

        const payout = agent.payout || {};

        const oldPhone = payout.phone || "";

        /*
        --------------------------------------
        Same Number
        --------------------------------------
        */

        if (oldPhone === newPhone) {

            throw new Error(
                "This is already your verified payout number."
            );

        }

        /*
        --------------------------------------
        Existing Pending Request
        --------------------------------------
        */

        const pendingSnapshot = await db
            .ref("payout_change_requests")
            .orderByChild("agentId")
            .equalTo(agentId)
            .get();

        if (pendingSnapshot.exists()) {

            let hasPending = false;

            pendingSnapshot.forEach(child => {

                const request = child.val();

                if (request.status === "PENDING") {

                    hasPending = true;

                }

            });

            if (hasPending) {

                throw new Error(
                    "You already have a pending payout change request."
                );

            }

        }

        /*
        --------------------------------------
        Create Request
        --------------------------------------
        */

        const requestRef = db
            .ref("payout_change_requests")
            .push();

        const now = Date.now();

        const request = {

            id: requestRef.key,

            agentId,

            agentName:
                agent.fullName || "",

            email:
                agent.email || "",

            currentPhone:
                oldPhone,

            requestedPhone:
                newPhone,

            country,

            countryCode,

            countryIso,

            status: "PENDING",

            requestedAt: now,

            reviewedAt: 0,

            reviewedBy: "",

            rejectionReason: ""

        };

        /*
        --------------------------------------
        Save Request
        --------------------------------------
        */

        await requestRef.set(request);

        /*
        --------------------------------------
        Update Agent Payout Status
        --------------------------------------
        */

        await db
            .ref("agents")
            .child(agentId)
            .child("payout")
            .update({

                pendingPhone: newPhone,

                pendingCountry: country,

                pendingCountryCode: countryCode,

                pendingCountryIso: countryIso,

                phoneChangePending: true,

                lastRequestedAt: now

            });

        return {

            success: true,

            message:
                "Payout number change request submitted successfully.",

            request

        };

    }

    /*
    ==================================================
    APPROVE PHONE CHANGE
    ==================================================
    */

    async approvePhoneChange({

        requestId,

        adminId

    }) {

        const requestRef = db
            .ref("payout_change_requests")
            .child(requestId);

        const snapshot = await requestRef.get();

        if (!snapshot.exists()) {
            throw new Error("Request not found.");
        }

        const request = snapshot.val();

        if (request.status !== "PENDING") {

            throw new Error(
                "Request has already been processed."
            );

        }

        const now = Date.now();

        /*
        --------------------------------------
        Update Agent
        --------------------------------------
        */

        await db
            .ref("agents")
            .child(request.agentId)
            .child("payout")
            .update({

                phone:
                    request.requestedPhone,

                verified: true,

                verifiedAt: now,

                verifiedBy: adminId,

                pendingPhone: null,

                pendingCountry: null,

                pendingCountryCode: null,

                pendingCountryIso: null,

                phoneChangePending: false

            });

        /*
        --------------------------------------
        Update Main Phone
        --------------------------------------
        */

        await db
            .ref("agents")
            .child(request.agentId)
            .update({

                phone:
                    request.requestedPhone

            });

        /*
        --------------------------------------
        Update Request
        --------------------------------------
        */

        await requestRef.update({

            status: "APPROVED",

            reviewedAt: now,

            reviewedBy: adminId

        });

        return {

            success: true,

            message: "Phone number approved."

        };

    }

    /*
==================================================
GET PENDING REQUESTS
==================================================
*/

async getPendingRequests() {

    const snapshot = await db
        .ref("payout_change_requests")
        .orderByChild("status")
        .equalTo("PENDING")
        .get();

    if (!snapshot.exists()) {
        return [];
    }

    const requests = [];

    snapshot.forEach(child => {

        requests.push(child.val());

    });

    requests.sort((a, b) =>

        b.requestedAt - a.requestedAt

    );

    return requests;

}

    /*
    ==================================================
    REJECT PHONE CHANGE
    ==================================================
    */

    async rejectPhoneChange({

        requestId,

        adminId,

        reason = ""

    }) {

        const requestRef = db
            .ref("payout_change_requests")
            .child(requestId);

        const snapshot = await requestRef.get();

        if (!snapshot.exists()) {

            throw new Error("Request not found.");

        }

        const request = snapshot.val();

        if (request.status !== "PENDING") {

            throw new Error(
                "Request has already been processed."
            );

        }

        const now = Date.now();

        /*
        --------------------------------------
        Remove Pending Phone
        --------------------------------------
        */

        await db
            .ref("agents")
            .child(request.agentId)
            .child("payout")
            .update({

                pendingPhone: null,

                pendingCountry: null,

                pendingCountryCode: null,

                pendingCountryIso: null,

                phoneChangePending: false

            });

        /*
        --------------------------------------
        Update Request
        --------------------------------------
        */

        await ActivityManager.createWithdrawalActivity(
    withdrawal.agentId,
    {
        withdrawalId,
        reference: withdrawal.reference,
        amount: withdrawal.amount,
        status: "REJECTED",
        reason
    }
);

        return {

            success: true,

            message: "Phone change rejected."

        };

    }

}

module.exports = new PayoutManager();