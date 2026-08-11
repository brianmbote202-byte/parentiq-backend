const { db } = require("../firebase");

const LedgerTypes =
    require("./LedgerTypes");

class LedgerManager {

    /*
    =====================================
    RECORD LEDGER ENTRY
    =====================================
    */

 /*
=====================================
RECORD LEDGER ENTRY
(IDEMPOTENT)
=====================================
*/

async record(entry) {

    const key =
        entry.checkoutId ||
        entry.withdrawalId ||
        entry.reference;

    /*
    If there is no natural unique key,
    fall back to push().
    */

    if (!key) {

        const ref = db
            .ref("finance")
            .child("ledger")
            .push();

        await ref.set({

            id: ref.key,

            type: entry.type,

            direction: entry.direction,

            category: entry.category,

            amount: Number(entry.amount),

            reference: entry.reference || "",

            agentId: entry.agentId || "",

            parentId: entry.parentId || "",

            childId: entry.childId || "",

            withdrawalId: entry.withdrawalId || "",

            checkoutId: entry.checkoutId || "",

            description: entry.description || "",

            metadata: entry.metadata || {},

            createdAt: Date.now()

        });

        return ref.key;

    }

    /*
    =====================================
    USE TRANSACTION
    Prevent duplicate ledger entries.
    =====================================
    */

    const ledgerRef =
        db.ref("finance")
          .child("ledger")
          .child(key);

    const result =
        await ledgerRef.transaction(current => {

            if (current) {

                return;

            }

            return {

                id: key,

                type: entry.type,

                direction: entry.direction,

                category: entry.category,

                amount: Number(entry.amount),

                reference: entry.reference || "",

                agentId: entry.agentId || "",

                parentId: entry.parentId || "",

                childId: entry.childId || "",

                withdrawalId: entry.withdrawalId || "",

                checkoutId: entry.checkoutId || "",

                description: entry.description || "",

                metadata: entry.metadata || {},

                createdAt: Date.now()

            };

        });

    if (!result.committed) {

        console.log(
            "Ledger entry already exists:",
            key
        );

    }

    return key;

}
    /*
    =====================================
    GET ALL LEDGER ENTRIES
    =====================================
    */

    async getEntries() {

        const snapshot = await db
            .ref("finance")
            .child("ledger")
            .get();

        if (!snapshot.exists()) {
            return [];
        }

        return Object.values(snapshot.val());

    }

    /*
    =====================================
    GET TOTAL REVENUE
    =====================================
    */

    async getRevenue() {

        const entries =
            await this.getEntries();

        let revenue = 0;

        for (const entry of entries) {

            if (
                entry.type ===
                LedgerTypes.SUBSCRIPTION_PAYMENT
            ) {

                revenue += Number(entry.amount || 0);

            }

        }

        return revenue;

    }

    /*
    =====================================
    GET MONTHLY REVENUE
    =====================================
    */

    async getMonthlyRevenue() {

        const entries =
            await this.getEntries();

        const startOfMonth =
            new Date(
                new Date().getFullYear(),
                new Date().getMonth(),
                1
            ).getTime();

        let revenue = 0;

        for (const entry of entries) {

            if (
                entry.type ===
                    LedgerTypes.SUBSCRIPTION_PAYMENT &&
                entry.createdAt >= startOfMonth
            ) {

                revenue += Number(entry.amount || 0);

            }

        }

        return revenue;

    }

    /*
    =====================================
    GET TOTAL COMMISSIONS
    =====================================
    */

    async getTotalCommissions() {

        const entries =
            await this.getEntries();

        let commissions = 0;

        for (const entry of entries) {

            if (
                entry.type ===
                LedgerTypes.COMMISSION_EARNED
            ) {

                commissions +=
                    Number(entry.amount || 0);

            }

        }

        return commissions;

    }

    /*
    =====================================
    GET WITHDRAWALS PAID
    =====================================
    */

    async getWithdrawalsPaid() {

        const entries =
            await this.getEntries();

        let withdrawals = 0;

        for (const entry of entries) {

            if (
                entry.type ===
                LedgerTypes.WITHDRAWAL_PAID
            ) {

                withdrawals +=
                    Number(entry.amount || 0);

            }

        }

        return withdrawals;

    }

    /*
    =====================================
    GET NET REVENUE
    =====================================
    */

    async getNetRevenue() {

        const revenue =
            await this.getRevenue();

        const commissions =
            await this.getTotalCommissions();

        const withdrawals =
            await this.getWithdrawalsPaid();

        return (
            revenue -
            commissions -
            withdrawals
        );

    }

    /*
    =====================================
    GET COMPLETE FINANCIAL SUMMARY
    =====================================
    */

    async getSummary() {

        const revenue =
            await this.getRevenue();

        const monthlyRevenue =
            await this.getMonthlyRevenue();

        const commissions =
            await this.getTotalCommissions();

        const withdrawalsPaid =
            await this.getWithdrawalsPaid();

        const netRevenue =
            revenue -
            commissions -
            withdrawalsPaid;

        return {

            totalRevenue:
                revenue,

            monthlyRevenue,

            totalCommissions:
                commissions,

            withdrawalsPaid,

            netRevenue

        };

    }

}

module.exports = new LedgerManager();