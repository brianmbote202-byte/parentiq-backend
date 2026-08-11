const { db } = require("../firebase");

class PaymentManager {

    /*
    ==================================================
    CREATE PAYMENT
    ==================================================
    */

    async create(data) {

        const paymentRef =
            db.ref("payments").push();

        const now =
            Date.now();

        const payment = {

            /*
            -----------------------------
            Identity
            -----------------------------
            */

            id:
                paymentRef.key,

            reference:
                data.reference || "",

            /*
            -----------------------------
            Payment Type
            -----------------------------
            */

            type:
                data.type || "",

            category:
                data.category || "",

            /*
            -----------------------------
            Provider
            -----------------------------
            */

            provider:
                data.provider || "MPESA",

            providerReference:
                data.providerReference || "",

            receipt:
                data.receipt || "",

            /*
            -----------------------------
            Related Records
            -----------------------------
            */

            withdrawalId:
                data.withdrawalId || "",

            checkoutId:
                data.checkoutId || "",

            childId:
                data.childId || "",

            parentId:
                data.parentId || "",

            agentId:
                data.agentId || "",

            /*
            -----------------------------
            Money
            -----------------------------
            */

            amount:
                Number(data.amount || 0),

            currency:
                data.currency || "KES",

            /*
            -----------------------------
            Destination
            -----------------------------
            */

            phone:
                data.phone || "",

            account:
                data.account || "",

            /*
            -----------------------------
            Status
            -----------------------------
            */

            status:
                data.status || "SUCCESS",

            /*
            -----------------------------
            Description
            -----------------------------
            */

            description:
                data.description || "",

            /*
            -----------------------------
            Extra Information
            -----------------------------
            */

            metadata:
                data.metadata || {},

            /*
            -----------------------------
            Audit
            -----------------------------
            */

            createdAt:
                now,

            updatedAt:
                now

        };

        await paymentRef.set(payment);

        console.log(
            "Payment created:",
            payment.id
        );

        return payment;

    }

    /*
    ==================================================
    GET PAYMENT
    ==================================================
    */

    async get(paymentId) {

        const snapshot =
            await db
                .ref("payments")
                .child(paymentId)
                .get();

        if (!snapshot.exists()) {
            return null;
        }

        return snapshot.val();

    }

    /*
    ==================================================
    UPDATE PAYMENT
    ==================================================
    */

    async update(paymentId, updates = {}) {

        updates.updatedAt =
            Date.now();

        await db
            .ref("payments")
            .child(paymentId)
            .update(updates);

        return this.get(paymentId);

    }

    /*
    ==================================================
    MARK SUCCESS
    ==================================================
    */

    async markSuccess(

        paymentId,

        receipt = "",

        providerReference = ""

    ) {

        return this.update(paymentId, {

            status:
                "SUCCESS",

            receipt,

            providerReference

        });

    }

    /*
    ==================================================
    MARK FAILED
    ==================================================
    */

    async markFailed(

        paymentId,

        reason = ""

    ) {

        return this.update(paymentId, {

            status:
                "FAILED",

            failureReason:
                reason

        });

    }

    /*
    ==================================================
    PAYMENT EXISTS
    ==================================================
    */

    async exists(paymentId) {

        const snapshot =
            await db
                .ref("payments")
                .child(paymentId)
                .get();

        return snapshot.exists();

    }

}

module.exports =
    new PaymentManager();