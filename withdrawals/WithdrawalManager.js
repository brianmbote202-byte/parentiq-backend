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


class WithdrawalManager {

    /*
    ==================================================
    CONSTANTS
    ==================================================
    */

    getWithdrawalRef(withdrawalId) {
        return db
            .ref("withdrawalRequests")
            .child(withdrawalId);
    }

    getAgentRef(agentId) {
        return db
            .ref("agents")
            .child(agentId);
    }


    /*
    ==================================================
    NORMALIZE PAYMENT METHOD
    ==================================================
    */

    normalizePaymentMethod(paymentMethod) {
        return String(paymentMethod || "MPESA")
            .trim()
            .toUpperCase();
    }


    /*
    ==================================================
    NORMALIZE STATUS
    ==================================================
    */

    normalizeStatus(status) {
        return String(status || "")
            .trim()
            .toLowerCase();
    }


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
            this.normalizePaymentMethod(
                paymentMethod
            );

        phone =
            String(phone || "")
                .trim();

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

        if (!agentId) {
            throw new Error(
                "Agent ID is required."
            );
        }

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

            if (
                !Number.isFinite(payoutAmount) ||
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
            !Number.isFinite(amount) ||
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
            this.getAgentRef(agentId);

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
        ==================================================
        STABLE PAYPAL SENDER BATCH ID
        ==================================================

        IMPORTANT:

        This MUST NOT use Date.now().

        The withdrawal ID is stable, allowing the
        same logical payout to retain the same
        PayPal idempotency identity.
        */

        const paypalSenderBatchId =
            paymentMethod === "PAYPAL"
                ? `PARENTIQ-${withdrawalRef.key}`
                : "";


        /*
        ==================================================
        WITHDRAWAL OBJECT
        ==================================================
        */

        const withdrawal = {

            id:
                withdrawalRef.key,

            reference,

            agentId,

            agentName:
                agent.fullName || "",


            /*
            PAYMENT METHOD
            */

            paymentMethod,

            phone,

            paypalEmail,


            /*
            ACCOUNTING
            */

            amount,


            /*
            PAYPAL PAYOUT
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
            BALANCE
            */

            availableBalanceBefore:
                balance,


            /*
            STATUS
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
            ADMIN
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
            PAYMENT TRACKING
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

            paymentAttemptCount:
                0,

            lastPaymentAttemptId:
                "",

            lastPaymentAttemptStatus:
                "",

            processingAt:
                null,

            reconciliationRequiredAt:
                null,

            reconciliationReason:
                "",

            commissionRestored:
                false,

            pendingWithdrawalRestored:
                false,


            /*
            M-PESA
            */

            mpesaReceipt:
                "",

            conversationId:
                "",

            originatorConversationId:
                "",


            /*
            PAYPAL
            */

            paypalBatchId:
                "",

            paypalItemId:
                "",

            paypalTransactionId:
                "",

            paypalBatchStatus:
                "",

            paypalTransactionStatus:
                "",


            /*
            TIMESTAMPS
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

                phone,

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
        CACHE
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
            this.getWithdrawalRef(
                withdrawalId
            );

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
            this.normalizeStatus(
                withdrawal.status
            ) !== "pending"
        ) {
            throw new Error(
                "Withdrawal has already been processed."
            );
        }


        /*
        ==================================================
        LOAD ADMIN
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

            if (
                adminSnapshot.exists()
            ) {

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
    CLAIM PAYMENT PROCESSING
    ==================================================

    ATOMIC PAYMENT LOCK.

    Only:

        approved
        payment_failed

    can enter processing.

    Never automatically process:

        reconciliation_required
        processing
        paid
    */

    async claimPaymentProcessing(
        withdrawalId
    ) {

        const withdrawalRef =
            this.getWithdrawalRef(
                withdrawalId
            );

        let claimError =
            null;


        await withdrawalRef.transaction(
            current => {

                if (!current) {
                    claimError =
                        new Error(
                            "Withdrawal request not found."
                        );

                    return;
                }

                const status =
                    this.normalizeStatus(
                        current.status
                    );


                /*
                ALREADY PROCESSING
                */

                if (
                    status === "processing"
                ) {

                    claimError =
                        new Error(
                            "Withdrawal is already being processed."
                        );

                    return;
                }


                /*
                ALREADY PAID
                */

                if (
                    status === "paid"
                ) {

                    claimError =
                        new Error(
                            "Withdrawal has already been paid."
                        );

                    return;
                }


                /*
                RECONCILIATION REQUIRED
                */

                if (
                    status ===
                    "reconciliation_required"
                ) {

                    claimError =
                        new Error(
                            "Withdrawal requires payment reconciliation before it can be retried."
                        );

                    return;
                }


                /*
                ONLY APPROVED / CONFIRMED FAILURE
                */

                if (
                    status !== "approved" &&
                    status !== "payment_failed"
                ) {

                    claimError =
                        new Error(
                            "Withdrawal cannot be processed."
                        );

                    return;
                }


                const now =
                    Date.now();

                const attemptCount =
                    Number(
                        current.paymentAttemptCount || 0
                    ) + 1;


                return {

                    ...current,

                    status:
                        "processing",

                    paymentStatus:
                        "PROCESSING",

                    processingAt:
                        now,

                    paymentAttemptedAt:
                        now,

                    paymentAttemptCount:
                        attemptCount,

                    paymentFailureReason:
                        "",

                    reconciliationRequiredAt:
                        null,

                    reconciliationReason:
                        "",

                    lastPaymentAttemptStatus:
                        "PROCESSING",

                    updatedAt:
                        now
                };
            }
        );


        if (claimError) {
            throw claimError;
        }


        /*
        ==================================================
        VERIFY
        ==================================================
        */

        const finalSnapshot =
            await withdrawalRef.get();

        if (!finalSnapshot.exists()) {
            throw new Error(
                "Withdrawal request not found."
            );
        }

        const finalWithdrawal =
            finalSnapshot.val();

        if (
            this.normalizeStatus(
                finalWithdrawal.status
            ) !== "processing"
        ) {
            throw new Error(
                "Withdrawal could not be claimed for payment processing."
            );
        }


        console.log(
            "Payment processing CLAIMED:",
            withdrawalId
        );


        return {

            success:
                true,

            withdrawal: {

                id:
                    withdrawalId,

                ...finalWithdrawal
            }
        };
    }


    /*
    ==================================================
    MARK M-PESA PROCESSING
    ==================================================

    LEGACY METHOD.

    New routes should use:

        claimPaymentProcessing()

    before sending money.
    */

    async markProcessing(
        withdrawalId,
        conversationId,
        originatorConversationId
    ) {

        const withdrawalRef =
            this.getWithdrawalRef(
                withdrawalId
            );

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
            this.normalizePaymentMethod(
                withdrawal.paymentMethod
            ) === "PAYPAL"
        ) {
            throw new Error(
                "Use PayPal processing methods for PayPal withdrawals."
            );
        }


        const status =
            this.normalizeStatus(
                withdrawal.status
            );


        if (
            status === "processing"
        ) {

            return {

                success:
                    true,

                alreadyProcessing:
                    true,

                message:
                    "Withdrawal is already processing."
            };
        }


        if (
            status !== "approved" &&
            status !== "payment_failed"
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
                withdrawal.processingAt ||
                now,

            paymentAttemptedAt:
                withdrawal.paymentAttemptedAt ||
                now,

            conversationId:
                conversationId || "",

            originatorConversationId:
                originatorConversationId || "",

            paymentFailureReason:
                "",

            reconciliationRequiredAt:
                null,

            reconciliationReason:
                "",

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
            this.getWithdrawalRef(
                withdrawalId
            );

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
            this.normalizePaymentMethod(
                withdrawal.paymentMethod
            ) !== "PAYPAL"
        ) {
            throw new Error(
                "Withdrawal is not a PayPal withdrawal."
            );
        }


        if (
            this.normalizeStatus(
                withdrawal.status
            ) === "paid"
        ) {

            return {

                success:
                    true,

                alreadyPaid:
                    true,

                message:
                    "Withdrawal is already paid."
            };
        }


        if (
            this.normalizeStatus(
                withdrawal.status
            ) === "reconciliation_required"
        ) {
            throw new Error(
                "Withdrawal requires reconciliation before processing."
            );
        }


        const status =
            this.normalizeStatus(
                withdrawal.status
            );

        if (
            status !== "approved" &&
            status !== "payment_failed" &&
            status !== "processing"
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
                withdrawal.processingAt ||
                now,

            paymentAttemptedAt:
                withdrawal.paymentAttemptedAt ||
                now,

            paypalBatchId:
                paypalBatchId ||
                withdrawal.paypalBatchId ||
                "",

            paypalItemId:
                paypalItemId ||
                withdrawal.paypalItemId ||
                "",

            paypalBatchStatus:
                paypalBatchId
                    ? withdrawal.paypalBatchStatus || ""
                    : "",

            paypalTransactionStatus:
                withdrawal.paypalTransactionStatus ||
                "",

            paymentFailureReason:
                "",

            reconciliationRequiredAt:
                null,

            reconciliationReason:
                "",

            lastPaymentAttemptStatus:
                "PROCESSING",

            updatedAt:
                now
        });


        return {

            success:
                true,

            message:
                "PayPal withdrawal is processing."
        };
    }


    /*
    ==================================================
    RECORD PAYPAL SUBMISSION
    ==================================================

    Called after PayPal returns a payout batch ID.

    This NEVER changes wallet balances.
    */

    async recordPayPalSubmission(
        withdrawalId,
        {
            paymentId = "",
            paypalBatchId = "",
            paypalItemId = "",
            paypalBatchStatus = "",
            paymentReference = ""
        } = {}
    ) {

        const withdrawalRef =
            this.getWithdrawalRef(
                withdrawalId
            );

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
            this.normalizePaymentMethod(
                withdrawal.paymentMethod
            ) !== "PAYPAL"
        ) {
            throw new Error(
                "Withdrawal is not a PayPal withdrawal."
            );
        }


        if (
            this.normalizeStatus(
                withdrawal.status
            ) === "paid"
        ) {

            return {

                success:
                    true,

                alreadyPaid:
                    true
            };
        }


        const now =
            Date.now();


        await withdrawalRef.update({

            status:
                "processing",

            paymentStatus:
                "PROCESSING",

            processingAt:
                withdrawal.processingAt ||
                now,

            paymentAttemptedAt:
                withdrawal.paymentAttemptedAt ||
                now,

            paypalBatchId:
                paypalBatchId ||
                withdrawal.paypalBatchId ||
                "",

            paypalItemId:
                paypalItemId ||
                withdrawal.paypalItemId ||
                "",

            paypalBatchStatus:
                paypalBatchStatus ||
                withdrawal.paypalBatchStatus ||
                "",

            paymentReference:
                paymentReference ||
                withdrawal.paymentReference ||
                "",

            lastPaymentAttemptId:
                paymentId ||
                withdrawal.lastPaymentAttemptId ||
                "",

            lastPaymentAttemptStatus:
                "PROCESSING",

            paymentFailureReason:
                "",

            reconciliationRequiredAt:
                null,

            reconciliationReason:
                "",

            updatedAt:
                now
        });


        return {

            success:
                true,

            withdrawalId,

            paypalBatchId:
                paypalBatchId ||
                withdrawal.paypalBatchId ||
                "",

            paypalItemId:
                paypalItemId ||
                withdrawal.paypalItemId ||
                ""
        };
    }


    /*
    ==================================================
    MARK RECONCILIATION REQUIRED
    ==================================================

    CRITICAL FINANCIAL SAFETY METHOD.

    NEVER restores wallet funds.

    Used when provider outcome is unknown.
    */

    async markReconciliationRequired(
        withdrawalId,
        reason = "",
        {
            paymentId = "",
            paypalBatchId = "",
            paypalItemId = "",
            paypalBatchStatus = "",
            paypalTransactionStatus = ""
        } = {}
    ) {

        const withdrawalRef =
            this.getWithdrawalRef(
                withdrawalId
            );

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
        ALREADY PAID
        ==================================================
        */

        if (
            this.normalizeStatus(
                withdrawal.status
            ) === "paid"
        ) {

            await withdrawalRef.update({

                paymentStatus:
                    "SUCCESS",

                paymentFailureReason:
                    "",

                reconciliationRequiredAt:
                    null,

                reconciliationReason:
                    "",

                lastPaymentAttemptStatus:
                    "SUCCESS",

                updatedAt:
                    Date.now()
            });


            return {

                success:
                    true,

                alreadyPaid:
                    true
            };
        }


        /*
        ==================================================
        ALREADY CONFIRMED FAILED
        ==================================================
        */

        if (
            this.normalizeStatus(
                withdrawal.status
            ) === "payment_failed" &&
            withdrawal.commissionRestored === true
        ) {

            return {

                success:
                    true,

                alreadyFailed:
                    true,

                message:
                    "Withdrawal has already been confirmed as failed."
            };
        }


        const now =
            Date.now();


        await withdrawalRef.update({

            status:
                "reconciliation_required",

            paymentStatus:
                "RECONCILIATION_REQUIRED",

            /*
            UNKNOWN IS NOT THE SAME AS FAILED.
            */

            paymentFailureReason:
                "",

            reconciliationRequiredAt:
                now,

            reconciliationReason:
                reason ||
                "Payment provider outcome is unknown.",

            lastPaymentAttemptId:
                paymentId ||
                withdrawal.lastPaymentAttemptId ||
                "",

            lastPaymentAttemptStatus:
                "RECONCILIATION_REQUIRED",

            paypalBatchId:
                paypalBatchId ||
                withdrawal.paypalBatchId ||
                "",

            paypalItemId:
                paypalItemId ||
                withdrawal.paypalItemId ||
                "",

            paypalBatchStatus:
                paypalBatchStatus ||
                withdrawal.paypalBatchStatus ||
                "",

            paypalTransactionStatus:
                paypalTransactionStatus ||
                withdrawal.paypalTransactionStatus ||
                "",

            updatedAt:
                now
        });


        /*
        ==================================================
        DO NOT RESTORE WALLET
        ==================================================
        */

        await CacheManager.refreshAgent(
            withdrawal.agentId
        );


        console.warn(
            "======================================"
        );

        console.warn(
            "PAYMENT RECONCILIATION REQUIRED"
        );

        console.warn(
            "Withdrawal:",
            withdrawalId
        );

        console.warn(
            "Provider:",
            withdrawal.paymentMethod
        );

        console.warn(
            "Reason:",
            reason ||
            "Unknown provider outcome"
        );

        console.warn(
            "Wallet NOT restored."
        );

        console.warn(
            "======================================"
        );


        return {

            success:
                true,

            reconciliationRequired:
                true,

            withdrawalId,

            message:
                "Payment outcome is unknown. Wallet remains reserved until reconciliation."
        };
    }


    /*
    ==================================================
    MARK PAYMENT FAILED
    ==================================================

    ONLY for CONFIRMED provider failure.

    NEVER use for an ambiguous provider response.
    */

    async markPaymentFailed(
        withdrawalId,
        reason = ""
    ) {

        const withdrawalRef =
            this.getWithdrawalRef(
                withdrawalId
            );

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
        ALREADY PAID
        ==================================================
        */

        if (
            this.normalizeStatus(
                withdrawal.status
            ) === "paid"
        ) {

            await withdrawalRef.update({

                paymentStatus:
                    "SUCCESS",

                paymentFailureReason:
                    "",

                reconciliationRequiredAt:
                    null,

                reconciliationReason:
                    "",

                lastPaymentAttemptStatus:
                    "SUCCESS",

                updatedAt:
                    Date.now()
            });


            return {

                success:
                    true,

                alreadyPaid:
                    true,

                message:
                    "Withdrawal is already paid."
            };
        }


        /*
        ==================================================
        NEVER AUTO-FAIL RECONCILIATION STATE
        ==================================================
        */

        if (
            this.normalizeStatus(
                withdrawal.status
            ) ===
            "reconciliation_required"
        ) {

            throw new Error(
                "Cannot mark reconciliation-required payment as failed without confirmed provider status."
            );
        }


        /*
        ==================================================
        LOAD AGENT
        ==================================================
        */

        const agentRef =
            this.getAgentRef(
                withdrawal.agentId
            );

        const agentSnapshot =
            await agentRef.get();

        if (!agentSnapshot.exists()) {
            throw new Error(
                "Agent not found."
            );
        }

        const agent =
            agentSnapshot.val();


        /*
        ==================================================
        AMOUNT
        ==================================================
        */

        const amount =
            Number(
                withdrawal.amount || 0
            );

        if (
            !Number.isFinite(amount) ||
            amount <= 0
        ) {
            throw new Error(
                "Invalid withdrawal amount."
            );
        }


        /*
        ==================================================
        RESTORATION FLAGS
        ==================================================
        */

        const commissionRestored =
            withdrawal.commissionRestored === true;

        const pendingRestored =
            withdrawal.pendingWithdrawalRestored === true;


        /*
        ==================================================
        ALREADY FULLY RESTORED
        ==================================================
        */

        if (
            this.normalizeStatus(
                withdrawal.status
            ) === "payment_failed" &&
            commissionRestored &&
            pendingRestored
        ) {

            await withdrawalRef.update({

                paymentStatus:
                    "FAILED",

                paymentFailureReason:
                    reason ||
                    withdrawal.paymentFailureReason ||
                    "",

                lastPaymentAttemptStatus:
                    "FAILED",

                updatedAt:
                    Date.now()
            });


            return {

                success:
                    true,

                alreadyProcessed:
                    true,

                message:
                    "Payment already failed and wallet was restored."
            };
        }


        /*
        ==================================================
        CURRENT WALLET
        ==================================================
        */

        const commissionBalance =
            Number(
                agent.commissionBalance || 0
            );

        const pendingWithdrawals =
            Number(
                agent.pendingWithdrawals || 0
            );


        let restoredBalance =
            commissionBalance;

        let restoredPending =
            pendingWithdrawals;


        /*
        ==================================================
        RESTORE COMMISSION
        ==================================================
        */

        if (!commissionRestored) {

            restoredBalance =
                commissionBalance + amount;
        }


        /*
        ==================================================
        RESTORE PENDING
        ==================================================
        */

        if (!pendingRestored) {

            restoredPending =
                Math.max(
                    0,
                    pendingWithdrawals - amount
                );
        }


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
                withdrawal.paymentFailedAt ||
                now,

            paymentFailureReason:
                reason ||
                withdrawal.paymentFailureReason ||
                "Payment provider confirmed the payout failed.",

            commissionRestored:
                true,

            pendingWithdrawalRestored:
                true,

            reconciliationRequiredAt:
                null,

            reconciliationReason:
                "",

            lastPaymentAttemptStatus:
                "FAILED",

            updatedAt:
                now
        });


        /*
        ==================================================
        UPDATE AGENT WALLET
        ==================================================
        */

        await agentRef.update({

            commissionBalance:
                restoredBalance,

            pendingWithdrawals:
                restoredPending
        });


        /*
        ==================================================
        LEDGER
        ==================================================
        */

        if (!commissionRestored) {

            await LedgerManager.record({

                type:
                    LedgerTypes.WITHDRAWAL_REJECTED,

                direction:
                    LedgerDirection.CREDIT,

                category:
                    LedgerCategory.WITHDRAWAL,

                amount,

                reference:
                    withdrawal.reference,

                withdrawalId,

                agentId:
                    withdrawal.agentId,

                description:
                    "Failed payment — commission restored",

                metadata: {

                    reason,

                    paymentMethod:
                        withdrawal.paymentMethod ||
                        "MPESA",

                    paymentStatus:
                        "FAILED",

                    commissionRestored:
                        true
                }
            });
        }


        /*
        ==================================================
        ACTIVITY
        ==================================================
        */

        if (!commissionRestored) {

            await ActivityManager
                .createWithdrawalActivity(
                    withdrawal.agentId,
                    {

                        withdrawalId,

                        reference:
                            withdrawal.reference,

                        amount,

                        status:
                            "FAILED",

                        reason,

                        commissionRestored:
                            true
                    }
                );
        }


        /*
        ==================================================
        CACHE
        ==================================================
        */

        await CacheManager.refreshAgent(
            withdrawal.agentId
        );


        console.log(
            "======================================"
        );

        console.log(
            "PAYMENT FAILED — WALLET RESTORED"
        );

        console.log(
            "Withdrawal:",
            withdrawalId
        );

        console.log(
            "Agent:",
            withdrawal.agentId
        );

        console.log(
            "Amount:",
            amount
        );

        console.log(
            "Commission restored:",
            !commissionRestored
        );

        console.log(
            "Pending restored:",
            !pendingRestored
        );

        console.log(
            "======================================"
        );


        return {

            success:
                true,

            message:
                "Payment failed and wallet restored.",

            withdrawalId,

            amountRestored:
                !commissionRestored
                    ? amount
                    : 0,

            pendingWithdrawalRestored:
                !pendingRestored
                    ? amount
                    : 0,

            commissionBalance:
                restoredBalance,

            pendingWithdrawals:
                restoredPending
        };
    }


    /*
    ==================================================
    MARK WITHDRAWAL AS PAID
    ==================================================

    PayPal:

        ONLY after confirmed SUCCESS/COMPLETED.

    M-Pesa:

        after confirmed successful receipt.
    */

    async markAsPaid(
        withdrawalId,
        receipt = "",
        providerReference = "",
        providerData = {}
    ) {

        const withdrawalRef =
            this.getWithdrawalRef(
                withdrawalId
            );

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
        PROVIDER DATA
        ==================================================
        */

        const paypalBatchId =
            providerData.paypalBatchId ||
            withdrawal.paypalBatchId ||
            "";

        const paypalItemId =
            providerData.paypalItemId ||
            withdrawal.paypalItemId ||
            "";

        const paypalTransactionId =
            providerData.paypalTransactionId ||
            withdrawal.paypalTransactionId ||
            providerReference ||
            "";

        const paypalBatchStatus =
            providerData.paypalBatchStatus ||
            withdrawal.paypalBatchStatus ||
            (
                withdrawal.paymentMethod === "PAYPAL"
                    ? "SUCCESS"
                    : ""
            );

        const paypalTransactionStatus =
            providerData.paypalTransactionStatus ||
            withdrawal.paypalTransactionStatus ||
            (
                withdrawal.paymentMethod === "PAYPAL"
                    ? "SUCCESS"
                    : ""
            );


        /*
        ==================================================
        ALREADY PAID
        ==================================================

        CRITICAL:

        Do not return before synchronizing
        provider information.
        */

        if (
            this.normalizeStatus(
                withdrawal.status
            ) === "paid"
        ) {

            const now =
                Date.now();

            await withdrawalRef.update({

                paymentStatus:
                    "SUCCESS",

                paymentFailureReason:
                    "",

                paymentCompletedAt:
                    withdrawal.paymentCompletedAt ||
                    withdrawal.paidAt ||
                    now,

                paymentReference:
                    providerReference ||
                    withdrawal.paymentReference ||
                    receipt ||
                    "",

                mpesaReceipt:
                    withdrawal.paymentMethod === "MPESA"
                        ? (
                            receipt ||
                            withdrawal.mpesaReceipt ||
                            ""
                        )
                        : "",

                paypalBatchId,

                paypalItemId,

                paypalTransactionId,

                paypalBatchStatus,

                paypalTransactionStatus,

                reconciliationRequiredAt:
                    null,

                reconciliationReason:
                    "",

                lastPaymentAttemptStatus:
                    "SUCCESS",

                updatedAt:
                    now
            });


            await CacheManager.refreshAgent(
                withdrawal.agentId
            );


            return {

                success:
                    true,

                alreadyPaid:
                    true,

                message:
                    "Withdrawal was already paid; provider information synchronized.",

                withdrawalId
            };
        }


        /*
        ==================================================
        VALID PAYMENT STATES
        ==================================================
        */

        const status =
            this.normalizeStatus(
                withdrawal.status
            );

        if (
            status !== "processing" &&
            status !== "approved"
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
            this.getAgentRef(
                withdrawal.agentId
            );

        const agentSnapshot =
            await agentRef.get();

        if (!agentSnapshot.exists()) {
            throw new Error(
                "Agent not found."
            );
        }

        const agent =
            agentSnapshot.val();


        /*
        ==================================================
        ACCOUNTING
        ==================================================
        */

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

        if (
            !Number.isFinite(amount) ||
            amount <= 0
        ) {
            throw new Error(
                "Invalid withdrawal amount."
            );
        }


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
                withdrawal.paidAt ||
                now,

            paymentCompletedAt:
                withdrawal.paymentCompletedAt ||
                now,

            paymentFailureReason:
                "",

            reconciliationRequiredAt:
                null,

            reconciliationReason:
                "",

            mpesaReceipt:
                withdrawal.paymentMethod === "MPESA"
                    ? (
                        receipt ||
                        withdrawal.mpesaReceipt ||
                        ""
                    )
                    : "",

            paymentReference:
                providerReference ||
                receipt ||
                withdrawal.paymentReference ||
                "",

            paypalBatchId,

            paypalItemId,

            paypalTransactionId,

            paypalBatchStatus,

            paypalTransactionStatus,

            lastPaymentAttemptStatus:
                "SUCCESS",

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

                paypalBatchId,

                paypalItemId,

                paypalTransactionId,

                paypalBatchStatus,

                paypalTransactionStatus
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
            this.getWithdrawalRef(
                withdrawalId
            );

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
            this.normalizeStatus(
                withdrawal.status
            ) !== "pending"
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
            this.getAgentRef(
                withdrawal.agentId
            );

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

        const amount =
            Number(
                withdrawal.amount || 0
            );

        if (
            !Number.isFinite(amount) ||
            amount <= 0
        ) {
            throw new Error(
                "Invalid withdrawal amount."
            );
        }

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

            commissionRestored:
                true,

            pendingWithdrawalRestored:
                true,

            paymentStatus:
                "FAILED",

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

            amount,

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
                balance + amount,

            pendingWithdrawals:
                Math.max(
                    0,
                    pending - amount
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

                    amount,

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
                .orderByChild("agentId")
                .equalTo(agentId)
                .get();

        if (!snapshot.exists()) {
            return [];
        }

        const withdrawals = [];


        snapshot.forEach(
            child => {

                const withdrawal =
                    child.val();

                withdrawals.push({

                    id:
                        child.key,

                    ...withdrawal
                });
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
            await this
                .getWithdrawalRef(
                    withdrawalId
                )
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
            await this
                .getAgentRef(
                    withdrawal.agentId
                )
                .get();


        /*
        ==================================================
        LOAD ADMIN
        ==================================================
        */

        let approvedByName =
            withdrawal.approvedByName ||
            withdrawal.approvedBy ||
            "";

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

                const admin =
                    adminSnapshot.val();

                approvedByName =
                    admin.fullName ||
                    admin.name ||
                    admin.email ||
                    approvedByName ||
                    "";
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
        RETURN
        ==================================================
        */

        return {

            id:
                withdrawal.id ||
                withdrawalId,

            agentId:
                withdrawal.agentId,

            agentName:
                withdrawal.agentName ||
                "",

            reference:
                withdrawal.reference ||
                "",


            /*
            AGENT
            */

            email,

            phone:
                withdrawal.phone ||
                "",

            verified:
                payout.verified ||
                false,


            /*
            PAYMENT METHOD
            */

            paymentMethod:
                withdrawal.paymentMethod ||
                "MPESA",


            /*
            PAYPAL
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

            paypalBatchStatus:
                withdrawal.paypalBatchStatus ||
                "",

            paypalTransactionStatus:
                withdrawal.paypalTransactionStatus ||
                "",


            /*
            ACCOUNTING
            */

            amount:
                Number(
                    withdrawal.amount || 0
                ),

            availableBalanceBefore:
                withdrawal.availableBalanceBefore,


            /*
            STATUS
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
            RECONCILIATION
            */

            reconciliationRequired:
                this.normalizeStatus(
                    withdrawal.status
                ) ===
                "reconciliation_required",

            reconciliationRequiredAt:
                withdrawal.reconciliationRequiredAt ||
                null,

            reconciliationReason:
                withdrawal.reconciliationReason ||
                "",


            /*
            PAYMENT ATTEMPTS
            */

            paymentAttemptCount:
                Number(
                    withdrawal.paymentAttemptCount || 0
                ),

            lastPaymentAttemptId:
                withdrawal.lastPaymentAttemptId ||
                "",

            lastPaymentAttemptStatus:
                withdrawal.lastPaymentAttemptStatus ||
                "",


            /*
            RESTORATION
            */

            commissionRestored:
                withdrawal.commissionRestored === true,

            pendingWithdrawalRestored:
                withdrawal.pendingWithdrawalRestored === true,


            /*
            TIMESTAMPS
            */

            requestedAt:
                withdrawal.requestedAt,

            approvedAt:
                withdrawal.approvedAt,

            rejectedAt:
                withdrawal.rejectedAt,

            paidAt:
                withdrawal.paidAt,

            paymentAttemptedAt:
                withdrawal.paymentAttemptedAt ||
                null,

            paymentCompletedAt:
                withdrawal.paymentCompletedAt ||
                null,

            paymentFailedAt:
                withdrawal.paymentFailedAt ||
                null,

            processingAt:
                withdrawal.processingAt ||
                null,


            /*
            ADMIN
            */

            approvedById:
                withdrawal.approvedById ||
                "",

            approvedByName,

            rejectionReason:
                withdrawal.rejectionReason ||
                "",


            /*
            M-PESA
            */

            mpesaReceipt:
                withdrawal.mpesaReceipt ||
                "",

            conversationId:
                withdrawal.conversationId ||
                "",

            originatorConversationId:
                withdrawal.originatorConversationId ||
                ""
        };
    }


    /*
    ==================================================
    PREVENT DUPLICATE WITHDRAWAL
    ==================================================

    ACTIVE STATES:

        pending
        approved
        processing
        reconciliation_required

    payment_failed and rejected are NOT active.
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


        let exists =
            false;


        snapshot.forEach(
            child => {

                const status =
                    this.normalizeStatus(
                        child.val().status
                    );


                if (

                    status === "pending" ||

                    status === "approved" ||

                    status === "processing" ||

                    status ===
                        "reconciliation_required"

                ) {

                    exists =
                        true;
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
                        Number(current || 0) + 1
                    );
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
            )
                .padStart(2, "0");

        const day =
            String(
                today.getDate()
            )
                .padStart(2, "0");


        const number =
            String(sequence)
                .padStart(6, "0");


        return (
            `WD-${year}${month}${day}-${number}`
        );
    }
}


module.exports =
    new WithdrawalManager();