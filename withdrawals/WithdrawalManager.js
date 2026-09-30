const { db } = require("../firebase");

const ActivityManager =
    require("../activity/ActivityManager");

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

const CacheManager =
    require("../cache/CacheManager");

const PaymentManager =
    require("../payments/PaymentManager");


class WithdrawalManager {

    /*
    ==================================================
    REQUEST WITHDRAWAL
    ==================================================
    */

    async requestWithdrawal({
        agentId,
        amount,
        phone,
        paymentMethod = "MPESA",
        paypalEmail = "",
        payoutAmount = 0,
        payoutCurrency = "USD"
    }) {

        amount = Number(amount);

        paymentMethod =
            String(paymentMethod || "MPESA")
                .trim()
                .toUpperCase();

        paypalEmail =
            String(paypalEmail || "")
                .trim()
                .toLowerCase();

        payoutAmount =
            Number(payoutAmount || 0);

        payoutCurrency =
            String(payoutCurrency || "USD")
                .trim()
                .toUpperCase();


        /*
        ==================================================
        VALIDATION
        ==================================================
        */

        if (
            paymentMethod !== "MPESA" &&
            paymentMethod !== "PAYPAL"
        ) {
            throw new Error(
                "Unsupported payment method."
            );
        }


        /*
        ==================================================
        M-PESA VALIDATION
        ==================================================
        */

        if (
            paymentMethod === "MPESA" &&
            !phone
        ) {
            throw new Error(
                "M-Pesa phone number is required."
            );
        }


        /*
        ==================================================
        PAYPAL VALIDATION
        ==================================================
        */

        if (
            paymentMethod === "PAYPAL"
        ) {

            if (!paypalEmail) {
                throw new Error(
                    "PayPal email is required."
                );
            }

            const paypalEmailRegex =
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

            if (
                !paypalEmailRegex.test(
                    paypalEmail
                )
            ) {
                throw new Error(
                    "Invalid PayPal email address."
                );
            }

            /*
            PayPal payout amount must be
            provided before the payment is sent.
            */

            if (
                isNaN(payoutAmount) ||
                payoutAmount <= 0
            ) {
                throw new Error(
                    "PayPal payout amount is required."
                );
            }

            if (!payoutCurrency) {
                throw new Error(
                    "PayPal payout currency is required."
                );
            }
        }


        /*
        ==================================================
        AMOUNT VALIDATION
        ==================================================
        */

        if (
            isNaN(amount) ||
            amount <= 0
        ) {
            throw new Error(
                "Invalid withdrawal amount."
            );
        }


        if (
            amount < MIN_WITHDRAWAL
        ) {
            throw new Error(
                `Minimum withdrawal is KES ${MIN_WITHDRAWAL}.`
            );
        }


        if (
            amount > MAX_WITHDRAWAL
        ) {
            throw new Error(
                `Maximum withdrawal is KES ${MAX_WITHDRAWAL}.`
            );
        }


        /*
        ==================================================
        LOAD AGENT
        ==================================================
        */

        const agentRef =
            db
                .ref("agents")
                .child(agentId);

        const snapshot =
            await agentRef.get();

        if (!snapshot.exists()) {
            throw new Error(
                "Agent not found."
            );
        }

        const agent =
            snapshot.val();


        const balance =
            Number(
                agent.commissionBalance || 0
            );

        const pending =
            Number(
                agent.pendingWithdrawals || 0
            );


        /*
        ==================================================
        PREVENT DUPLICATE WITHDRAWAL
        ==================================================
        */

        if (
            await this.pendingWithdrawalExists(
                agentId
            )
        ) {
            throw new Error(
                "You already have a pending withdrawal."
            );
        }


        /*
        ==================================================
        BALANCE VALIDATION
        ==================================================
        */

        if (
            balance < amount
        ) {
            throw new Error(
                "Insufficient commission balance."
            );
        }


        /*
        ==================================================
        CREATE WITHDRAWAL
        ==================================================
        */

        const withdrawalRef =
            db
                .ref("withdrawalRequests")
                .push();


        const reference =
            await this.generateWithdrawalReference();


        const now =
            Date.now();


        /*
        Stable PayPal sender batch ID.

        IMPORTANT:
        This must not use Date.now()
        because retries could create duplicate
        PayPal payouts.
        */

        const paypalSenderBatchId =
            paymentMethod === "PAYPAL"
                ? `PARENTIQ-${withdrawalRef.key}`
                : "";


        const withdrawal = {

            id:
                withdrawalRef.key,

            reference,

            agentId,

            agentName:
                agent.fullName || "",


            /*
            ==================================================
            PAYMENT METHOD
            ==================================================
            */

            paymentMethod,

            phone:
                phone || "",

            paypalEmail:
                paypalEmail || "",


            /*
            ==================================================
            ACCOUNTING AMOUNT
            ==================================================

            This remains the agent's commission
            amount in KES.
            */

            amount,


            /*
            ==================================================
            PAYPAL PAYOUT
            ==================================================

            payoutAmount is the amount actually sent
            through PayPal.

            Example:

            amount = KES 200
            payoutAmount = USD 2.00

            The conversion should eventually be
            calculated by the backend using your
            configured FX rate.
            */

            payoutAmount:
                paymentMethod === "PAYPAL"
                    ? payoutAmount
                    : 0,

            payoutCurrency:
                paymentMethod === "PAYPAL"
                    ? payoutCurrency
                    : "KES",

            paypalSenderBatchId,


            /*
            ==================================================
            BALANCE
            ==================================================
            */

            availableBalanceBefore:
                balance,


            /*
            ==================================================
            STATUS
            ==================================================
            */

            status:
                "pending",


            requestedAt:
                now,

            approvedAt:
                null,

            rejectedAt:
                null,

            paidAt:
                null,


            /*
            ==================================================
            ADMIN
            ==================================================
            */

            approvedBy:
                "",

            approvedById:
                "",

            approvedByName:
                "",


            rejectionReason:
                "",


            /*
            ==================================================
            PAYMENT TRACKING
            ==================================================
            */

            paymentStatus:
                "NOT_SENT",

            paymentAttemptedAt:
                null,

            paymentCompletedAt:
                null,

            paymentFailedAt:
                null,

            paymentFailureReason:
                "",

            paymentReference:
                "",


            /*
            ==================================================
            M-PESA
            ==================================================
            */

            mpesaReceipt:
                "",

            conversationId:
                "",

            originatorConversationId:
                "",


            /*
            ==================================================
            PAYPAL
            ==================================================
            */

            paypalBatchId:
                "",

            paypalItemId:
                "",

            paypalTransactionId:
                "",


            /*
            ==================================================
            TIMESTAMPS
            ==================================================
            */

            createdAt:
                now,

            updatedAt:
                now
        };


        /*
        ==================================================
        SAVE WITHDRAWAL
        ==================================================
        */

        await withdrawalRef.set(
            withdrawal
        );


        /*
        ==================================================
        FINANCIAL LEDGER
        ==================================================
        */

        await LedgerManager.record({

            type:
                LedgerTypes.WITHDRAWAL_REQUESTED,

            direction:
                LedgerDirection.DEBIT,

            category:
                LedgerCategory.WITHDRAWAL,

            amount,

            reference,

            withdrawalId:
                withdrawal.id,

            agentId,

            description:
                "Withdrawal requested",

            metadata: {

                paymentMethod,

                phone:
                    phone || "",

                paypalEmail:
                    paypalEmail || "",

                payoutAmount:
                    paymentMethod === "PAYPAL"
                        ? payoutAmount
                        : 0,

                payoutCurrency:
                    paymentMethod === "PAYPAL"
                        ? payoutCurrency
                        : "KES",

                availableBalanceBefore:
                    balance
            }
        });


        /*
        ==================================================
        UPDATE AGENT WALLET
        ==================================================
        */

        await agentRef.update({

            commissionBalance:
                balance - amount,

            pendingWithdrawals:
                pending + amount
        });


        /*
        ==================================================
        REFRESH CACHE
        ==================================================
        */

        await CacheManager.refreshAgent(
            agentId
        );


        /*
        ==================================================
        ACTIVITY
        ==================================================
        */

        await ActivityManager
            .createWithdrawalActivity(
                agentId,
                {
                    withdrawalId:
                        withdrawal.id,

                    reference:
                        withdrawal.reference,

                    amount,

                    status:
                        "REQUESTED"
                }
            );


        /*
        ==================================================
        RETURN
        ==================================================
        */

        return {

            success:
                true,

            withdrawal,

            newBalance:
                balance - amount,

            pendingWithdrawals:
                pending + amount
        };
    }


    /*
    ==================================================
    APPROVE WITHDRAWAL
    ==================================================
    */

    async approveWithdrawal(
        withdrawalId,
        adminId = ""
    ) {

        const withdrawalRef =
            db
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


        if (
            withdrawal.status !== "pending"
        ) {
            throw new Error(
                "Withdrawal has already been processed."
            );
        }


        /*
        ==================================================
        LOAD ADMIN DETAILS
        ==================================================
        */

        let adminName =
            "Administrator";


        if (adminId) {

            const adminSnapshot =
                await db
                    .ref("admins")
                    .child(adminId)
                    .get();


            if (adminSnapshot.exists()) {

                const admin =
                    adminSnapshot.val();


                adminName =
                    admin.fullName ||
                    admin.name ||
                    admin.email ||
                    "Administrator";
            }
        }


        /*
        ==================================================
        APPROVE
        ==================================================
        */

        const now =
            Date.now();


        await withdrawalRef.update({

            status:
                "approved",

            approvedAt:
                now,

            approvedBy:
                adminName,

            approvedById:
                adminId,

            approvedByName:
                adminName,

            updatedAt:
                now
        });


        /*
        ==================================================
        LEDGER
        ==================================================
        */

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
                    adminId,

                paymentMethod:
                    withdrawal.paymentMethod ||
                    "MPESA"
            }
        });


        /*
        ==================================================
        ACTIVITY
        ==================================================
        */

        await ActivityManager
            .createWithdrawalActivity(
                withdrawal.agentId,
                {
                    withdrawalId,

                    reference:
                        withdrawal.reference,

                    amount:
                        withdrawal.amount,

                    status:
                        "APPROVED"
                }
            );


        /*
        ==================================================
        CACHE
        ==================================================
        */

        await CacheManager.refreshAgent(
            withdrawal.agentId
        );


        return {

            success:
                true,

            message:
                "Withdrawal approved."
        };
    }


    /*
    ==================================================
    MARK M-PESA PROCESSING
    ==================================================
    */

    async markProcessing(
        withdrawalId,
        conversationId,
        originatorConversationId
    ) {

        const withdrawalRef =
            db
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
        ==================================================
        ONLY M-PESA USES THIS METHOD
        ==================================================
        */

        if (
            withdrawal.paymentMethod === "PAYPAL"
        ) {
            throw new Error(
                "Use markPayPalProcessing() for PayPal withdrawals."
            );
        }


        /*
        ==================================================
        VALIDATE STATUS
        ==================================================
        */

        if (
            withdrawal.status !== "approved" &&
            withdrawal.status !== "payment_failed"
        ) {
            throw new Error(
                "Withdrawal cannot be processed."
            );
        }


        const now =
            Date.now();


        await withdrawalRef.update({

            status:
                "processing",

            paymentStatus:
                "PROCESSING",

            processingAt:
                now,

            paymentAttemptedAt:
                now,

            conversationId:
                conversationId || "",

            originatorConversationId:
                originatorConversationId || "",

            updatedAt:
                now
        });


        console.log(
            "M-Pesa withdrawal marked as PROCESSING:",
            withdrawalId
        );


        return {

            success:
                true,

            message:
                "Withdrawal is processing."
        };
    }


    /*
    ==================================================
    MARK PAYPAL PROCESSING
    ==================================================
    */

    async markPayPalProcessing(
        withdrawalId,
        paypalBatchId = "",
        paypalItemId = ""
    ) {

        const withdrawalRef =
            db
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
        ==================================================
        VALIDATE PAYMENT METHOD
        ==================================================
        */

        if (
            withdrawal.paymentMethod !== "PAYPAL"
        ) {
            throw new Error(
                "Withdrawal is not a PayPal withdrawal."
            );
        }


        /*
        ==================================================
        VALIDATE STATUS
        ==================================================
        */

        if (
            withdrawal.status !== "approved" &&
            withdrawal.status !== "payment_failed"
        ) {
            throw new Error(
                "Withdrawal cannot be processed."
            );
        }


        const now =
            Date.now();


        await withdrawalRef.update({

            status:
                "processing",

            paymentStatus:
                "PROCESSING",

            processingAt:
                now,

            paymentAttemptedAt:
                now,

            paypalBatchId:
                paypalBatchId || "",

            paypalItemId:
                paypalItemId || "",

            updatedAt:
                now
        });


        console.log(
            "PayPal withdrawal marked as PROCESSING:",
            withdrawalId
        );


        return {

            success:
                true,

            message:
                "PayPal withdrawal is processing."
        };
    }


    /*
    ==================================================
    MARK PAYMENT FAILED
    ==================================================
    */

    async markPaymentFailed(
        withdrawalId,
        reason = ""
    ) {

        const withdrawalRef =
            db
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


        const now =
            Date.now();


        /*
        ==================================================
        UPDATE WITHDRAWAL
        ==================================================
        */

        await withdrawalRef.update({

            status:
                "payment_failed",

            paymentStatus:
                "FAILED",

            paymentFailedAt:
                now,

            paymentFailureReason:
                reason,

            updatedAt:
                now
        });


        /*
        ==================================================
        ACTIVITY
        ==================================================
        */

        await ActivityManager
            .createWithdrawalActivity(
                withdrawal.agentId,
                {

                    withdrawalId,

                    reference:
                        withdrawal.reference,

                    amount:
                        withdrawal.amount,

                    status:
                        "FAILED",

                    reason
                }
            );


        /*
        ==================================================
        CACHE
        ==================================================
        */

        await CacheManager.refreshAgent(
            withdrawal.agentId
        );


        return {

            success:
                true,

            message:
                "Withdrawal marked as failed."
        };
    }


    /*
    ==================================================
    MARK WITHDRAWAL AS PAID
    ==================================================

    IMPORTANT:

    For PayPal, this should only be called after
    PayPal confirms the payout has completed.

    Do NOT call this merely because PayPal accepted
    the payout request.
    ==================================================
    */

    async markAsPaid(
        withdrawalId,
        receipt = "",
        providerReference = ""
    ) {

        const withdrawalRef =
            db
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
        ==================================================
        PREVENT DUPLICATE COMPLETION
        ==================================================
        */

        if (
            withdrawal.status === "paid"
        ) {

            console.log(
                "Withdrawal already marked as paid:",
                withdrawalId
            );


            return {

                success:
                    true,

                message:
                    "Withdrawal already marked as paid."
            };
        }


        /*
        ==================================================
        VALID PAYMENT STATES
        ==================================================
        */

        if (
            withdrawal.status !== "processing" &&
            withdrawal.status !== "approved"
        ) {

            throw new Error(
                "Withdrawal cannot be marked as paid."
            );
        }


        /*
        ==================================================
        LOAD AGENT
        ==================================================
        */

        const agentRef =
            db
                .ref("agents")
                .child(withdrawal.agentId);


        const agentSnapshot =
            await agentRef.get();


        if (!agentSnapshot.exists()) {

            throw new Error(
                "Agent not found."
            );
        }


        const agent =
            agentSnapshot.val();


        const pending =
            Number(
                agent.pendingWithdrawals || 0
            );


        const totalWithdrawn =
            Number(
                agent.totalWithdrawn || 0
            );


        const amount =
            Number(
                withdrawal.amount || 0
            );


        const now =
            Date.now();


        /*
        ==================================================
        UPDATE WITHDRAWAL
        ==================================================
        */

        await withdrawalRef.update({

            status:
                "paid",

            paymentStatus:
                "SUCCESS",

            paidAt:
                now,

            paymentCompletedAt:
                now,

            mpesaReceipt:
                withdrawal.paymentMethod === "MPESA"
                    ? receipt || ""
                    : "",

            paymentReference:
                providerReference ||
                receipt ||
                "",

            paypalTransactionId:
                withdrawal.paymentMethod === "PAYPAL"
                    ? providerReference || ""
                    : withdrawal.paypalTransactionId || "",

            updatedAt:
                now
        });


        /*
        ==================================================
        UPDATE AGENT WALLET
        ==================================================
        */

        await agentRef.update({

            pendingWithdrawals:
                Math.max(
                    0,
                    pending - amount
                ),

            totalWithdrawn:
                totalWithdrawn + amount
        });


        /*
        ==================================================
        LEDGER
        ==================================================
        */

        await LedgerManager.record({

            type:
                LedgerTypes.WITHDRAWAL_PAID,

            direction:
                LedgerDirection.DEBIT,

            category:
                LedgerCategory.WITHDRAWAL,

            amount,

            reference:
                withdrawal.reference,

            withdrawalId,

            agentId:
                withdrawal.agentId,

            description:
                "Withdrawal paid",

            metadata: {

                receipt:
                    receipt || "",

                providerReference:
                    providerReference || "",

                paymentMethod:
                    withdrawal.paymentMethod ||
                    "MPESA",

                paypalBatchId:
                    withdrawal.paypalBatchId ||
                    "",

                paypalItemId:
                    withdrawal.paypalItemId ||
                    "",

                paypalTransactionId:
                    withdrawal.paypalTransactionId ||
                    ""
            }
        });


        /*
        ==================================================
        ACTIVITY
        ==================================================
        */

        await ActivityManager
            .createWithdrawalActivity(
                withdrawal.agentId,
                {

                    withdrawalId,

                    reference:
                        withdrawal.reference,

                    amount,

                    status:
                        "PAID",

                    receipt:
                        receipt || ""
                }
            );


        /*
        ==================================================
        CACHE
        ==================================================
        */

        await CacheManager.refreshAgent(
            withdrawal.agentId
        );


        console.log(
            "Withdrawal marked as PAID:",
            withdrawalId
        );


        return {

            success:
                true,

            message:
                "Withdrawal marked as paid.",

            withdrawalId,

            amount,

            receipt:
                receipt || "",

            providerReference:
                providerReference || ""
        };
    }


    /*
    ==================================================
    REJECT WITHDRAWAL
    ==================================================
    */

    async rejectWithdrawal(
        withdrawalId,
        reason = ""
    ) {

        const withdrawalRef =
            db
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


        if (
            withdrawal.status !== "pending"
        ) {

            throw new Error(
                "Withdrawal has already been processed."
            );
        }


        /*
        ==================================================
        LOAD AGENT
        ==================================================
        */

        const agentRef =
            db
                .ref("agents")
                .child(withdrawal.agentId);


        const agentSnapshot =
            await agentRef.get();


        if (!agentSnapshot.exists()) {

            throw new Error(
                "Agent not found."
            );
        }


        const agent =
            agentSnapshot.val();


        const balance =
            Number(
                agent.commissionBalance || 0
            );


        const pending =
            Number(
                agent.pendingWithdrawals || 0
            );


        const now =
            Date.now();


        /*
        ==================================================
        UPDATE WITHDRAWAL
        ==================================================
        */

        await withdrawalRef.update({

            status:
                "rejected",

            rejectedAt:
                now,

            rejectionReason:
                reason,

            updatedAt:
                now
        });


        /*
        ==================================================
        LEDGER
        ==================================================
        */

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

                reason
            }
        });


        /*
        ==================================================
        RETURN MONEY TO WALLET
        ==================================================
        */

        await agentRef.update({

            commissionBalance:
                balance +
                Number(
                    withdrawal.amount || 0
                ),

            pendingWithdrawals:
                Math.max(
                    0,
                    pending -
                    Number(
                        withdrawal.amount || 0
                    )
                )
        });


        /*
        ==================================================
        ACTIVITY
        ==================================================
        */

        await ActivityManager
            .createWithdrawalActivity(
                withdrawal.agentId,
                {

                    withdrawalId,

                    reference:
                        withdrawal.reference,

                    amount:
                        withdrawal.amount,

                    status:
                        "REJECTED",

                    reason
                }
            );


        /*
        ==================================================
        CACHE
        ==================================================
        */

        await CacheManager.refreshAgent(
            withdrawal.agentId
        );


        return {

            success:
                true,

            message:
                "Withdrawal rejected."
        };
    }


    /*
    ==================================================
    AGENT WITHDRAWAL HISTORY
    ==================================================
    */

    async getAgentWithdrawals(
        agentId
    ) {

        const snapshot =
            await db
                .ref("withdrawalRequests")
                .get();


        if (!snapshot.exists()) {
            return [];
        }


        const withdrawals = [];


        snapshot.forEach(
            child => {

                const withdrawal =
                    child.val();


                if (
                    withdrawal.agentId ===
                    agentId
                ) {

                    withdrawals.push({

                        id:
                            child.key,

                        ...withdrawal
                    });
                }
            }
        );


        withdrawals.sort(
            (a, b) =>
                Number(
                    b.requestedAt || 0
                ) -
                Number(
                    a.requestedAt || 0
                )
        );


        return withdrawals;
    }


    /*
    ==================================================
    GET WITHDRAWAL DETAILS
    ==================================================
    */

    async getWithdrawalDetails(
        withdrawalId
    ) {

        const snapshot =
            await db
                .ref("withdrawalRequests")
                .child(withdrawalId)
                .get();


        if (!snapshot.exists()) {

            throw new Error(
                "Withdrawal request not found."
            );
        }


        const withdrawal =
            snapshot.val();


        /*
        ==================================================
        LOAD AGENT
        ==================================================
        */

        const agentSnapshot =
            await db
                .ref("agents")
                .child(withdrawal.agentId)
                .get();


        /*
        ==================================================
        LOAD APPROVING ADMIN
        ==================================================
        */

        let approvedByName = "";


        if (
            withdrawal.approvedById
        ) {

            const adminSnapshot =
                await db
                    .ref("admins")
                    .child(
                        withdrawal.approvedById
                    )
                    .get();


            if (
                adminSnapshot.exists()
            ) {

                approvedByName =
                    adminSnapshot
                        .val()
                        .fullName || "";
            }
        }


        /*
        ==================================================
        AGENT PAYOUT INFORMATION
        ==================================================
        */

        let email = "";
        let payout = {};


        if (
            agentSnapshot.exists()
        ) {

            const agent =
                agentSnapshot.val();


            email =
                agent.email || "";


            payout =
                agent.payout || {};
        }


        /*
        ==================================================
        RETURN DETAILS
        ==================================================
        */

        return {

            id:
                withdrawal.id ||
                withdrawalId,

            agentId:
                withdrawal.agentId,

            agentName:
                withdrawal.agentName,

            reference:
                withdrawal.reference,


            /*
            Agent information
            */

            email,

            phone:
                withdrawal.phone || "",

            verified:
                payout.verified || false,


            /*
            Payment method
            */

            paymentMethod:
                withdrawal.paymentMethod ||
                "MPESA",


            /*
            PayPal
            */

            paypalEmail:
                withdrawal.paypalEmail ||
                "",

            payoutAmount:
                Number(
                    withdrawal.payoutAmount || 0
                ),

            payoutCurrency:
                withdrawal.payoutCurrency ||
                "",

            paypalSenderBatchId:
                withdrawal.paypalSenderBatchId ||
                "",

            paypalBatchId:
                withdrawal.paypalBatchId ||
                "",

            paypalItemId:
                withdrawal.paypalItemId ||
                "",

            paypalTransactionId:
                withdrawal.paypalTransactionId ||
                "",


            /*
            Accounting
            */

            amount:
                Number(
                    withdrawal.amount || 0
                ),

            availableBalanceBefore:
                withdrawal.availableBalanceBefore,


            /*
            Status
            */

            status:
                withdrawal.status,

            paymentStatus:
                withdrawal.paymentStatus ||
                "NOT_SENT",

            paymentReference:
                withdrawal.paymentReference ||
                "",

            paymentFailureReason:
                withdrawal.paymentFailureReason ||
                "",


            /*
            Timestamps
            */

            requestedAt:
                withdrawal.requestedAt,

            approvedAt:
                withdrawal.approvedAt,

            rejectedAt:
                withdrawal.rejectedAt,

            paidAt:
                withdrawal.paidAt,


            /*
            Admin
            */

            approvedById:
                withdrawal.approvedById ||
                "",

            approvedByName:
                approvedByName,

            rejectionReason:
                withdrawal.rejectionReason ||
                "",


            /*
            M-Pesa
            */

            mpesaReceipt:
                withdrawal.mpesaReceipt ||
                "",


            /*
            Processing
            */

            paymentAttemptedAt:
                withdrawal.paymentAttemptedAt ||
                null,

            paymentCompletedAt:
                withdrawal.paymentCompletedAt ||
                null,

            paymentFailedAt:
                withdrawal.paymentFailedAt ||
                null
        };
    }


    /*
    ==================================================
    PREVENT DUPLICATE WITHDRAWAL
    ==================================================
    */

    async pendingWithdrawalExists(
        agentId
    ) {

        const snapshot =
            await db
                .ref("withdrawalRequests")
                .orderByChild("agentId")
                .equalTo(agentId)
                .get();


        if (!snapshot.exists()) {
            return false;
        }


        let exists = false;


        snapshot.forEach(
            child => {

                const status =
                    child.val().status;


                if (

                    status === "pending" ||

                    status === "approved" ||

                    status === "processing"

                ) {

                    exists = true;
                }
            }
        );


        return exists;
    }


    /*
    ==================================================
    GENERATE WITHDRAWAL REFERENCE
    ==================================================
    */

    async generateWithdrawalReference() {

        const counterRef =
            db.ref(
                "counters/withdrawals"
            );


        const transaction =
            await counterRef.transaction(
                current => {

                    return (
                        current || 0
                    ) + 1;
                }
            );


        const sequence =
            transaction
                .snapshot
                .val();


        const today =
            new Date();


        const year =
            today.getFullYear();


        const month =
            String(
                today.getMonth() + 1
            ).padStart(2, "0");


        const day =
            String(
                today.getDate()
            ).padStart(2, "0");


        const number =
            String(sequence)
                .padStart(6, "0");


        return `WD-${year}${month}${day}-${number}`;
    }
}


module.exports =
    new WithdrawalManager();