const { db } = require("../firebase");

class EntitlementManager {

    /*
    ==================================================
    GET CHILD
    ==================================================
    */

    async getChild(childId) {

        const snapshot =
            await db
                .ref("children")
                .child(childId)
                .get();

        if (!snapshot.exists()) {
            return null;
        }

        return snapshot.val();

    }


    /*
    ==================================================
    GET PARENT FAMILY SUBSCRIPTION
    ==================================================
    */

    async getFamilySubscription(parentId) {

        if (!parentId) {
            return null;
        }

        const snapshot =
            await db
                .ref("parents")
                .child(parentId)
                .child("familySubscription")
                .get();

        if (!snapshot.exists()) {
            return null;
        }

        return snapshot.val();

    }


    /*
    ==================================================
    COUNT FAMILY CHILDREN
    ==================================================
    
    coveredChildren is the source of truth.

    Example:

    coveredChildren:
        childA: true
        childB: true

    usedChildren = 2

    ==================================================
    */

    getCoveredChildren(familySubscription) {

        const coveredChildren =
            familySubscription?.coveredChildren || {};

        return Object.keys(coveredChildren)
            .filter(childId =>
                coveredChildren[childId] === true
            );

    }


    /*
    ==================================================
    CHECK FAMILY ENTITLEMENT
    ==================================================
    */

    async checkFamilyEntitlement(
        childId,
        parentId,
        familySubscription
    ) {

        const now = Date.now();

        /*
        ----------------------------------------------
        FAMILY SUBSCRIPTION DOES NOT EXIST
        ----------------------------------------------
        */

        if (!familySubscription) {

            return null;

        }


        /*
        ----------------------------------------------
        VERIFY FAMILY PLAN
        ----------------------------------------------
        */

        if (
            familySubscription.planId !== "family"
        ) {

            return null;

        }


        /*
        ----------------------------------------------
        CHECK ACTIVE STATUS
        ----------------------------------------------
        */

        const expiryDate =
            Number(
                familySubscription.expiryDate || 0
            );

        const isActive =
            familySubscription.active === true &&
            familySubscription.premium === true &&
            familySubscription.status === "ACTIVE" &&
            expiryDate > now;


        /*
        ----------------------------------------------
        EXPIRED FAMILY SUBSCRIPTION
        ----------------------------------------------
        */

        if (!isActive) {

            /*
            Only update if it actually appears
            to be expired.
            */

            if (
                expiryDate > 0 &&
                expiryDate <= now
            ) {

                await db
                    .ref("parents")
                    .child(parentId)
                    .child("familySubscription")
                    .update({

                        active: false,

                        premium: false,

                        status: "EXPIRED",

                        updatedAt: now

                    });

                return {

                    premium: false,

                    status: "EXPIRED",

                    expiryDate,

                    planId: "family",

                    planName:
                        familySubscription.planName ||
                        "Family",

                    reason:
                        "FAMILY_SUBSCRIPTION_EXPIRED"

                };

            }


            /*
            Family exists but isn't active.
            */

            return {

                premium: false,

                status:
                    familySubscription.status ||
                    "INACTIVE",

                expiryDate,

                planId: "family",

                planName:
                    familySubscription.planName ||
                    "Family",

                reason:
                    "FAMILY_SUBSCRIPTION_NOT_ACTIVE"

            };

        }


        /*
        ----------------------------------------------
        GET COVERED CHILDREN
        ----------------------------------------------
        */

        const coveredChildren =
            this.getCoveredChildren(
                familySubscription
            );


        /*
        ----------------------------------------------
        CHILD ALREADY COVERED
        ----------------------------------------------
        
        This is important.

        Entitlement checks DO NOT consume a slot.

        If the child is already assigned to Family,
        it remains premium.
        */

        if (
            coveredChildren.includes(childId)
        ) {

            return {

                premium: true,

                status: "ACTIVE",

                planId: "family",

                planName:
                    familySubscription.planName ||
                    "Family",

                expiryDate,

                maxChildren:
                    Number(
                        familySubscription.maxChildren || 3
                    ),

                usedChildren:
                    coveredChildren.length,

                remainingChildren:
                    Math.max(
                        0,
                        Number(
                            familySubscription.maxChildren ||
                            3
                        ) - coveredChildren.length
                    )

            };

        }


        /*
        ----------------------------------------------
        CHILD IS NOT YET COVERED
        ----------------------------------------------
        */

        const maxChildren =
            Number(
                familySubscription.maxChildren || 3
            );

        const usedChildren =
            coveredChildren.length;

        const remainingChildren =
            Math.max(
                0,
                maxChildren - usedChildren
            );


        /*
        ----------------------------------------------
        FAMILY PACKAGE DEPLETED
        ----------------------------------------------
        
        The child belongs to the same parent,
        but all Family slots are already occupied.
        */

        if (
            remainingChildren <= 0
        ) {

            return {

                premium: false,

                status: "LIMIT_REACHED",

                planId: "family",

                planName:
                    familySubscription.planName ||
                    "Family",

                expiryDate,

                maxChildren,

                usedChildren,

                remainingChildren: 0,

                reason:
                    "FAMILY_CHILD_LIMIT_REACHED"

            };

        }


        /*
        ----------------------------------------------
        AVAILABLE FAMILY SLOT
        ----------------------------------------------
        
        IMPORTANT:

        We assign the child here.

        This means entitlement checking can automatically
        claim an available Family slot for a child.

        Once assigned, future checks simply recognize
        the child as covered.
        */

        const childRef =
            db
                .ref("parents")
                .child(parentId)
                .child("familySubscription")
                .child("coveredChildren")
                .child(childId);


        await childRef.set(true);


        const newUsedChildren =
            usedChildren + 1;

        const newRemainingChildren =
            Math.max(
                0,
                maxChildren - newUsedChildren
            );


        console.log(
            "Family child slot assigned:",
            childId,
            "Parent:",
            parentId,
            "Used:",
            newUsedChildren,
            "Remaining:",
            newRemainingChildren
        );


        /*
        ----------------------------------------------
        RETURN PREMIUM
        ----------------------------------------------
        */

        return {

            premium: true,

            status: "ACTIVE",

            planId: "family",

            planName:
                familySubscription.planName ||
                "Family",

            expiryDate,

            maxChildren,

            usedChildren:
                newUsedChildren,

            remainingChildren:
                newRemainingChildren,

            assignedNow: true

        };

    }


    /*
    ==================================================
    MAIN ENTITLEMENT CHECK
    ==================================================
    */
async getEntitlement(childId) {

    /*
    ==================================================
    VALIDATE CHILD ID
    ==================================================
    */

    if (!childId) {

        return {

            premium: false,

            status: "ERROR",

            reason: "CHILD_ID_REQUIRED"

        };

    }


    /*
    ==================================================
    GET CHILD
    ==================================================
    */

    const child =
        await this.getChild(childId);


    if (!child) {

        return {

            premium: false,

            status: "NOT_FOUND",

            reason: "CHILD_NOT_FOUND"

        };

    }


    /*
    ==================================================
    GET PARENT ID
    ==================================================
    */

    const parentId =
        child.parentId || null;


    /*
    ==================================================
    CURRENT TIME
    ==================================================
    */

    const now =
        Date.now();


    /*
    ==================================================
    FIRST: CHECK INDIVIDUAL CHILD SUBSCRIPTION
    ==================================================

    IMPORTANT:

    A child may have its own Premium subscription even
    when the parent's Family allocation is already full.

    Therefore we MUST check the child's own subscription
    before rejecting because of FAMILY_CHILD_LIMIT_REACHED.
    */

    const subscriptionRef =
        db
            .ref("children")
            .child(childId)
            .child("subscription");


    const snapshot =
        await subscriptionRef.get();


    if (snapshot.exists()) {

        const subscription =
            snapshot.val();


        const expiryDate =
            Number(
                subscription.expiryDate || 0
            );


        /*
        ----------------------------------------------
        INDIVIDUAL PREMIUM IS ACTIVE
        ----------------------------------------------
        */

        const individualPremium =
            subscription.premium === true &&
            subscription.active === true &&
            subscription.status === "ACTIVE" &&
            expiryDate > now;


        if (individualPremium) {

            return {

                premium: true,

                status: "ACTIVE",

                expiryDate,

                planId:
                    subscription.planId ||
                    null,

                planName:
                    subscription.planName ||
                    null,

                childId,

                parentId

            };

        }


        /*
        ----------------------------------------------
        INDIVIDUAL SUBSCRIPTION EXPIRED
        ----------------------------------------------
        */

        if (
            expiryDate > 0 &&
            expiryDate <= now
        ) {

            await subscriptionRef.update({

                active: false,

                premium: false,

                status: "EXPIRED",

                updatedAt: now

            });

        }

    }


    /*
    ==================================================
    SECOND: CHECK FAMILY SUBSCRIPTION
    ==================================================

    Family entitlement is parent-based.

    We only reach this section if the child does NOT
    already have its own active individual subscription.
    */

    if (parentId) {

        const familySubscription =
            await this.getFamilySubscription(
                parentId
            );


        if (familySubscription) {

            const familyEntitlement =
                await this.checkFamilyEntitlement(
                    childId,
                    parentId,
                    familySubscription
                );


            /*
            ------------------------------------------
            FAMILY CHILD IS COVERED
            ------------------------------------------
            */

            if (familyEntitlement) {

                return {

                    ...familyEntitlement,

                    childId,

                    parentId

                };

            }

        }

    }


    /*
    ==================================================
    THIRD: NO ACTIVE SUBSCRIPTION
    ==================================================
    */

    const currentSnapshot =
        await subscriptionRef.get();


    if (!currentSnapshot.exists()) {

        return {

            premium: false,

            status: "NONE",

            reason: "NO_SUBSCRIPTION",

            childId,

            parentId

        };

    }


    const currentSubscription =
        currentSnapshot.val();


    const currentExpiryDate =
        Number(
            currentSubscription.expiryDate || 0
        );


    /*
    ==================================================
    EXPIRED
    ==================================================
    */

    if (
        currentExpiryDate > 0 &&
        currentExpiryDate <= now
    ) {

        return {

            premium: false,

            status: "EXPIRED",

            expiryDate:
                currentExpiryDate,

            planId:
                currentSubscription.planId ||
                null,

            planName:
                currentSubscription.planName ||
                null,

            reason:
                "SUBSCRIPTION_EXPIRED",

            childId,

            parentId

        };

    }


    /*
    ==================================================
    FAMILY LIMIT / OTHER INACTIVE STATE
    ==================================================
    */

    return {

        premium: false,

        status:
            currentSubscription.status ||
            "INACTIVE",

        expiryDate:
            currentExpiryDate,

        planId:
            currentSubscription.planId ||
            null,

        planName:
            currentSubscription.planName ||
            null,

        reason:
            "SUBSCRIPTION_NOT_ACTIVE",

        childId,

        parentId

    };

}


    /*
    ==================================================
    SIMPLE BOOLEAN CHECK
    ==================================================
    */

    async isPremium(childId) {

        const entitlement =
            await this.getEntitlement(childId);

        return entitlement.premium === true;

    }

}


module.exports = new EntitlementManager();