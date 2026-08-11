const { db } = require("../firebase");
const ActivityManager = require("../activity/ActivityManager");

const MIN_WITHDRAWAL = 200;
const MAX_WITHDRAWAL = 50000;

const LedgerManager =
    require("../finance/LedgerManager");

const LedgerTypes =
    require("../finance/LedgerTypes");

const LedgerDirection =
    require("../finance/LedgerDirection");

const LedgerCategory =
    require("../finance/LedgerCategory");
/*const DashboardCache =
    require("../cache/DashboardCache");*/

const CacheManager =
    require("../cache/CacheManager");    

const PaymentManager =
    require("../payments/PaymentManager");    


class WithdrawalManager {

    /*
    ================================================
    REQUEST WITHDRAWAL
    ================================================
    */

    async requestWithdrawal({

        agentId,
        amount,
        phone

    }) {

        amount = Number(amount);

        if (isNaN(amount) || amount <= 0) {
            throw new Error("Invalid withdrawal amount.");
        }

        if (amount < MIN_WITHDRAWAL) {
            throw new Error(
                `Minimum withdrawal is KES ${MIN_WITHDRAWAL}.`
            );
        }

        if (amount > MAX_WITHDRAWAL) {
            throw new Error(
                `Maximum withdrawal is KES ${MAX_WITHDRAWAL}.`
            );
        }

        const agentRef = db
            .ref("agents")
            .child(agentId);

        const snapshot = await agentRef.get();

        if (!snapshot.exists()) {
            throw new Error("Agent not found.");
        }

        const agent = snapshot.val();

        const balance = Number(agent.commissionBalance || 0);
        const pending = Number(agent.pendingWithdrawals || 0);

        if (await this.pendingWithdrawalExists(agentId)) {

    throw new Error(
        "You already have a pending withdrawal."
    );

}

        if (balance < amount) {
            throw new Error(
                "Insufficient commission balance."
            );
        }

        const withdrawalRef = db
            .ref("withdrawalRequests")
            .push();

        const reference =
        await this.generateWithdrawalReference();    

        const now = Date.now();

        const withdrawal = {

    id: withdrawalRef.key,

    reference,

    agentId,

    agentName: agent.fullName || "",

    phone,

    amount,

    availableBalanceBefore: balance,

    status: "pending",

    requestedAt: now,

    approvedAt: null,

    rejectedAt: null,

    paidAt: null,

    approvedBy: "",

    approvedById: "",

    approvedByName: "",

    rejectionReason: "",

    createdAt: now,

    updatedAt: now,

    mpesaReceipt: "",

    paymentStatus: "NOT_SENT",

paymentAttemptedAt: null,

paymentCompletedAt: null,

paymentFailedAt: null,

paymentFailureReason: "",

paymentReference: ""

};
        await withdrawalRef.set(withdrawal);

        /*
==========================================
FINANCIAL LEDGER
==========================================
*/

await LedgerManager.record({

    type:
        LedgerTypes.WITHDRAWAL_REQUESTED,

    direction:
        LedgerDirection.DEBIT,

    category:
        LedgerCategory.WITHDRAWAL,

    amount,

    reference:
        reference,

    withdrawalId:
        withdrawal.id,

    agentId,

    description:
        "Withdrawal requested",

    metadata: {

        phone,

        availableBalanceBefore: balance

    }

});

        await agentRef.update({

    commissionBalance: balance - amount,

    pendingWithdrawals: pending + amount

});

await CacheManager.refreshAgent(agentId);


      await ActivityManager.createWithdrawalActivity(
    agentId,
    {
        withdrawalId: withdrawal.id,
        reference: withdrawal.reference,
        amount,
        status: "REQUESTED"
    }
);

        return {

            success: true,

            withdrawal,

            newBalance: balance - amount,

            pendingWithdrawals: pending + amount

        };

    }

    /*
    ================================================
    APPROVE
    ================================================
    */
async approveWithdrawal(
    withdrawalId,
    adminId = ""
) {

    const withdrawalRef = db
        .ref("withdrawalRequests")
        .child(withdrawalId);

    const snapshot = await withdrawalRef.get();

    if (!snapshot.exists()) {
        throw new Error(
            "Withdrawal request not found."
        );
    }

    const withdrawal = snapshot.val();

    if (withdrawal.status !== "pending") {
        throw new Error(
            "Withdrawal has already been processed."
        );
    }

    /*
    ==========================================
    LOAD ADMIN DETAILS
    ==========================================
    */

    let adminName = "Administrator";

    if (adminId) {

        const adminSnapshot = await db
            .ref("admins")
            .child(adminId)
            .get();

        if (adminSnapshot.exists()) {

            const admin = adminSnapshot.val();

            adminName =
                admin.fullName ||
                admin.name ||
                admin.email ||
                "Administrator";
        }
    }

    /*
    ==========================================
    APPROVE WITHDRAWAL
    ==========================================
    */

    await withdrawalRef.update({

        status: "approved",

        approvedAt: Date.now(),

        approvedBy: adminName,

        approvedById: adminId,

        approvedByName: adminName,

        updatedAt: Date.now()

    });

    await LedgerManager.record({

    type:
        LedgerTypes.WITHDRAWAL_APPROVED,

    direction:
        LedgerDirection.DEBIT,

    category:
        LedgerCategory.WITHDRAWAL,

    amount:
        withdrawal.amount,

    reference:
        withdrawal.reference,

    withdrawalId,

    agentId:
        withdrawal.agentId,

    description:
        "Withdrawal approved",

    metadata: {

        approvedBy:
            adminId

    }

});

    /*
    ==========================================
    CREATE ACTIVITY
    ==========================================
    */

    await ActivityManager.createWithdrawalActivity(
    withdrawal.agentId,
    {
        withdrawalId,
        reference: withdrawal.reference,
        amount: withdrawal.amount,
        status: "APPROVED"
    }
);

    /*
    ==========================================
    REFRESH CACHE
    ==========================================
    */

    await CacheManager.refreshAgent(
        withdrawal.agentId
    );

    /*
    ==========================================
    RETURN
    ==========================================
    */

    return {

        success: true,

        message: "Withdrawal approved."

    };

}

/*
==========================================
MARK PROCESSING
==========================================
*/
/*
================================================
MARK AS PROCESSING
================================================
*/

async markProcessing(
    withdrawalId,
    conversationId,
    originatorConversationId
) {

    /*
    ==========================================
    LOAD WITHDRAWAL
    ==========================================
    */

    const withdrawalRef = db
        .ref("withdrawalRequests")
        .child(withdrawalId);

    const snapshot =
        await withdrawalRef.get();

    if (!snapshot.exists()) {

        throw new Error(
            "Withdrawal request not found."
        );

    }

    const withdrawal =
        snapshot.val();

    /*
    ==========================================
    VALIDATE STATUS
    ==========================================
    */

    if (

        withdrawal.status !== "approved" &&
        withdrawal.status !== "payment_failed"

    ) {

        throw new Error(
            "Withdrawal cannot be processed."
        );

    }

    /*
    ==========================================
    UPDATE
    ==========================================
    */

    const now = Date.now();

    await withdrawalRef.update({

        status: "processing",

        paymentStatus: "PROCESSING",

        processingAt: now,

        paymentAttemptedAt: now,

        conversationId,

        originatorConversationId,

        updatedAt: now

    });

    console.log(
        "Withdrawal marked as PROCESSING:",
        withdrawalId
    );

    return {

        success: true,

        message: "Withdrawal is processing."

    };

}
/*
==========================================
MARK PAYMENT FAILED
==========================================
*/

async markPaymentFailed(

    withdrawalId,

    reason = ""

) {

    const withdrawalRef =
        db.ref("withdrawalRequests")
            .child(withdrawalId);

    const snapshot =
        await withdrawalRef.get();

    if (!snapshot.exists()) {

        throw new Error(
            "Withdrawal request not found."
        );

    }

    const withdrawal =
        snapshot.val();

    /*
    ======================================
    UPDATE WITHDRAWAL
    ======================================
    */

    await withdrawalRef.update({

        status:"payment_failed",

        paymentFailedAt: Date.now(),

        paymentFailureReason: reason,

        updatedAt: Date.now()

    });

    /*
    ======================================
    ACTIVITY
    ======================================
    */

    await ActivityManager
        .createWithdrawalActivity(

            withdrawal.agentId,

            {

                withdrawalId,

                amount:
                    withdrawal.amount,

                status:
                    "FAILED",

                reason

            }

        );

    /*
    ======================================
    REFRESH CACHE
    ======================================
    */

    await CacheManager.refreshAgent(

        withdrawal.agentId

    );

    return {

        success: true,

        message:
            "Withdrawal marked as failed."

    };

}

    /*
    ================================================
    REJECT
    ================================================
    */

    async rejectWithdrawal(

        withdrawalId,
        reason = ""

    ) {

        const withdrawalRef = db
            .ref("withdrawalRequests")
            .child(withdrawalId);

        const snapshot = await withdrawalRef.get();

        if (!snapshot.exists()) {
            throw new Error(
                "Withdrawal request not found."
            );
        }

        const withdrawal = snapshot.val();

        if (withdrawal.status !== "pending") {
            throw new Error(
                "Withdrawal has already been processed."
            );
        }

        const agentRef = db
            .ref("agents")
            .child(withdrawal.agentId);

        const agentSnapshot = await agentRef.get();

        if (!agentSnapshot.exists()) {
            throw new Error("Agent not found.");
        }

        const agent = agentSnapshot.val();

        const balance =
            Number(agent.commissionBalance || 0);

        const pending =
            Number(agent.pendingWithdrawals || 0);

        await withdrawalRef.update({

            status: "rejected",

            rejectedAt: Date.now(),

            rejectionReason: reason

        });

        await LedgerManager.record({

    type:
        LedgerTypes.WITHDRAWAL_REJECTED,

    direction:
        LedgerDirection.CREDIT,

    category:
        LedgerCategory.WITHDRAWAL,

    amount:
        withdrawal.amount,

    reference:
        withdrawal.reference,

    withdrawalId,

    agentId:
        withdrawal.agentId,

    description:
        "Withdrawal rejected",

    metadata: {

        reason:
            reason

    }

});

       await agentRef.update({

    commissionBalance:
        balance + withdrawal.amount,

    pendingWithdrawals:
        Math.max(
            0,
            pending - withdrawal.amount
        )

});

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

await CacheManager.refreshAgent(
    withdrawal.agentId
);

return {

    success: true,

    message: "Withdrawal rejected."

};

    }

    /*
    ================================================
    AGENT HISTORY
    ================================================
    */

    async getAgentWithdrawals(agentId) {

        const snapshot = await db
            .ref("withdrawalRequests")
            .get();

        if (!snapshot.exists()) {
            return [];
        }

        const withdrawals = [];

        snapshot.forEach(child => {

            const withdrawal = child.val();

            if (withdrawal.agentId === agentId) {

                withdrawals.push({

                    id: child.key,

                    ...withdrawal

                });

            }

        });

        withdrawals.sort(

            (a, b) =>
                b.requestedAt - a.requestedAt

        );

        return withdrawals;

    }
    /*
================================================
GET WITHDRAWAL DETAILS
================================================
*/

async getWithdrawalDetails(withdrawalId) {

    const snapshot = await db
        .ref("withdrawalRequests")
        .child(withdrawalId)
        .get();

    if (!snapshot.exists()) {
        throw new Error("Withdrawal request not found.");
    }

    const withdrawal = snapshot.val();

    /*
    ============================================
    LOAD AGENT
    ============================================
    */

    const agentSnapshot = await db
        .ref("agents")
        .child(withdrawal.agentId)
        .get();


    /*
============================================
LOAD APPROVING ADMIN
============================================
*/

let approvedByName = "";

if (withdrawal.approvedById) {

    const adminSnapshot = await db
        .ref("admins")
        .child(withdrawal.approvedById)
        .get();

    if (adminSnapshot.exists()) {

        approvedByName =
            adminSnapshot.val().fullName || "";

    }

}    

    let email = "";
    let payout = {};

    if (agentSnapshot.exists()) {

        const agent = agentSnapshot.val();

        email = agent.email || "";

        payout = agent.payout || {};
    }

    return {

    id: withdrawal.id,

    agentId: withdrawal.agentId,

    agentName: withdrawal.agentName,

    reference: withdrawal.reference,

    email,

    phone: withdrawal.phone,

    verified: payout.verified || false,

    amount: withdrawal.amount,

    availableBalanceBefore:
        withdrawal.availableBalanceBefore,

    status: withdrawal.status,

    requestedAt: withdrawal.requestedAt,

    approvedAt: withdrawal.approvedAt,

    rejectedAt: withdrawal.rejectedAt,

    paidAt: withdrawal.paidAt,

    approvedById: withdrawal.approvedById || "",

    approvedByName: approvedByName,

    rejectionReason:
        withdrawal.rejectionReason,

    mpesaReceipt:
        withdrawal.mpesaReceipt

};

}

/*
==========================================
PREVENT DUPLICATE WITHDRAWAL
==========================================
*/
async pendingWithdrawalExists(agentId) {

    const snapshot = await db
        .ref("withdrawalRequests")
        .orderByChild("agentId")
        .equalTo(agentId)
        .get();

    if (!snapshot.exists()) {
        return false;
    }

    let exists = false;

    snapshot.forEach(child => {

        const status = child.val().status;

if (

    status === "pending" ||

    status === "approved" ||

    status === "processing"

) {

    exists = true;

}
    });

    return exists;

}



/*
==========================================
GENERATE WITHDRAWAL REFERENCE
==========================================
*/

async generateWithdrawalReference() {

    const counterRef =
        db.ref("counters/withdrawals");

    const transaction =
        await counterRef.transaction(current => {

            return (current || 0) + 1;

        });

    const sequence =
        transaction.snapshot.val();

    const today = new Date();

    const year = today.getFullYear();

    const month =
        String(today.getMonth() + 1)
            .padStart(2, "0");

    const day =
        String(today.getDate())
            .padStart(2, "0");

    const number =
        String(sequence)
            .padStart(6, "0");

    return `WD-${year}${month}${day}-${number}`;

}

}

module.exports = new WithdrawalManager();