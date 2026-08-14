const { db } = require("../firebase");
const PlanManager = require("../plans/PlanManager");
const ChildManager = require("../children/ChildManager");
const ActivityManager = require("../activity/ActivityManager");


const CacheManager =
    require("../cache/CacheManager");

/*const DashboardCache =
    require("../dashboard/DashboardCache");*/
const EventBus =
    require("../events/EventBus");    

class SubscriptionManager {

    /**
     * Activate or renew a subscription.
     */
   async activate(childId, planId) {

    /*
    --------------------------------------
    Validate Child
    --------------------------------------
    */

    const childExists =
        await ChildManager.childExists(childId);

    if (!childExists) {
        throw new Error("Child not found.");
    }

    /*
    --------------------------------------
    Validate Plan
    --------------------------------------
    */

    const planExists =
        await PlanManager.planExists(planId);

    if (!planExists) {
        throw new Error("Subscription plan does not exist.");
    }

    const active =
        await PlanManager.isPlanActive(planId);

    if (!active) {
        throw new Error("Subscription plan is inactive.");
    }

    const plan =
        await PlanManager.getPlan(planId);

    /*
    --------------------------------------
    Existing Subscription
    --------------------------------------
    */

    const currentSubscription =
        await ChildManager.getSubscription(childId);
        

    const now = Date.now();

    /*const renewals =
    (currentSubscription?.renewals || 0) + 1;*/
    const paymentsCount =
    (currentSubscription?.paymentsCount || 0) + 1;

    const firstSubscribedAt =
    currentSubscription?.firstSubscribedAt || now;




    /*
--------------------------------------
TOTAL CUSTOMER SPEND
--------------------------------------
*/

const lifetimeValue =

    (currentSubscription?.lifetimeValue || 0)

    + Number(plan.price);

    /*
--------------------------------------
CURRENT PLAN PRICE
--------------------------------------
*/

const currentPlanPrice =
    Number(plan.price);

    /*
--------------------------------------
TOTAL DAYS PURCHASED
--------------------------------------
*/

const totalDaysPurchased =

    (currentSubscription?.totalDaysPurchased || 0)

    + plan.durationDays;



const duration =
    plan.durationDays * 24 * 60 * 60 * 1000;




    let startDate = now;
let expiryDate = now + duration;

/*
========================================
ACTIVE SUBSCRIPTION
Extend from current expiry
========================================
*/

if (
    currentSubscription &&
    currentSubscription.status === "ACTIVE" &&
    currentSubscription.expiryDate > now &&
    currentSubscription.planId === plan.id
) {

    startDate =
        currentSubscription.startDate;

    expiryDate =
        currentSubscription.expiryDate + duration;

    console.log(
        "Renewing existing subscription"
    );

}

/*
========================================
EXPIRED SUBSCRIPTION
Start again today
========================================
*/

else {

    console.log(
        "Creating new subscription"
    );

}

   



const subscription = {

    active: true,

    premium: true,

    status: "ACTIVE",

    planId: plan.id,

    planName: plan.name,
    
    planPrice: plan.price,

    durationDays: plan.durationDays,

    createdAt: currentSubscription?.createdAt || now,

    firstSubscribedAt,

    startDate,

    expiryDate,

    paymentsCount,

    totalDaysPurchased,

    lifetimeValue,

    currentPlanPrice,

    lastRenewedAt: now,

    updatedAt: now

};

    /*
    --------------------------------------
    Save Child Subscription
    --------------------------------------
    */

    await db
        .ref("children")
        .child(childId)
        .child("subscription")
        .set(subscription);

    /*
    --------------------------------------
    Load Child
    --------------------------------------
    */

    const childSnapshot =
        await db
            .ref("children")
            .child(childId)
            .get();

    if (!childSnapshot.exists()) {
        return subscription;
    }

    const child =
        childSnapshot.val();

    /*
    --------------------------------------
    Parent
    --------------------------------------
    */

    if (!child.parentId) {
        return subscription;
    }

    const parentSnapshot =
        await db
            .ref("parents")
            .child(child.parentId)
            .get();

    if (!parentSnapshot.exists()) {
        return subscription;
    }

    const parent =
        parentSnapshot.val();

    /*
    --------------------------------------
    Agent
    --------------------------------------
    */

    const agentId =
        parent?.referral?.agentId;

    if (!agentId) {
        return subscription;
    }

    /*
    --------------------------------------
    Update Cached Customer
    --------------------------------------
    */

   /*
--------------------------------------
Update Agent Customer Cache
--------------------------------------
*/

await db
    .ref("agent_customers")
    .child(agentId)
    .child(childId)
    .update({

        subscription: subscription,

        updatedAt: Date.now()

    });

console.log(
    "Agent customer cache updated:",
    childId
);

    /*
    --------------------------------------
    Subscription Activity
    --------------------------------------
    */

    await ActivityManager.createSubscriptionActivity(

        agentId,

        {

            childId,

            childName:
                child.name ||
                child.childName ||
                "Child",

            planName:
                plan.name

        }

    );

    /*
    --------------------------------------
    Refresh Statistics
    --------------------------------------
*/

const renewed =

    currentSubscription &&
    currentSubscription.status === "ACTIVE" &&
    currentSubscription.expiryDate > now &&
    currentSubscription.planId === plan.id;

    EventBus.emit("subscriptionActivated", {

    agentId,

    childId,

    parentId: child.parentId,

    renewed,

    subscription,

    plan

});

return {

    subscription,

    renewed,

    plan,

    child,

    parent,

    agentId

};

}

    /**
     * Get subscription.
     */
    async getSubscription(childId) {

        return await ChildManager.getSubscription(childId);

    }

    /**
     * Check if subscription is active.
     */
    async isActive(childId) {

    const subscription =
        await this.getSubscription(childId);

    if (!subscription) {
        return false;
    }

    return (
        subscription.active === true &&
        subscription.premium === true &&
        subscription.status === "ACTIVE" &&
        Number(subscription.expiryDate || 0) > Date.now()
    );

}

/**
 * Check whether a child currently has Premium access.
 *
 * Premium access can come from:
 *
 * 1. Individual Premium subscription
 * OR
 * 2. Active Family subscription covering this child
 */
/**
 * Check whether a child currently has Premium access.
 *
 * EntitlementManager is the single source of truth.
 *
 * Premium can come from:
 * 1. Individual Premium subscription
 * 2. Active Family subscription
 */
async hasPremiumAccess(childId) {

    if (!childId) {
        return false;
    }

    const entitlement =
        await EntitlementManager.getEntitlement(childId);

    return entitlement.premium === true;
}

    /**
     * Check if subscription has expired.
     */
    async isExpired(childId) {

        const subscription =
            await this.getSubscription(childId);

        if (!subscription) {
            return true;
        }

        return subscription.expiryDate <= Date.now();

    }

    /**
     * Days remaining.
     */
    async daysRemaining(childId) {

        const subscription =
            await this.getSubscription(childId);

        if (!subscription) {
            return 0;
        }

        const diff =
            subscription.expiryDate - Date.now();

        if (diff <= 0) {
            return 0;
        }

        return Math.ceil(
            diff / (1000 * 60 * 60 * 24)
        );

    }

    /**
 * Activate or renew a Family subscription
 * at the parent level.
 *
 * IMPORTANT:
 * The child's subscription is NOT removed.
 *
 * The child subscription remains the source
 * for agent/customer/payment records.
 *
 * The parent familySubscription is the
 * source of truth for Family entitlement.
 */
async activateFamily(parentId, childId, planId = "family") {

    /*
    --------------------------------------
    Validate Parent
    --------------------------------------
    */

    if (!parentId) {
        throw new Error("Parent ID is required.");
    }

    /*
    --------------------------------------
    Validate Child
    --------------------------------------
    */

    const childExists =
        await ChildManager.childExists(childId);

    if (!childExists) {
        throw new Error("Child not found.");
    }

    /*
    --------------------------------------
    Validate Plan
    --------------------------------------
    */

    const planExists =
        await PlanManager.planExists(planId);

    if (!planExists) {
        throw new Error("Subscription plan does not exist.");
    }

    const active =
        await PlanManager.isPlanActive(planId);

    if (!active) {
        throw new Error("Subscription plan is inactive.");
    }

    const plan =
        await PlanManager.getPlan(planId);

    /*
    --------------------------------------
    Make sure this is Family
    --------------------------------------
    */

    if (plan.id !== "family") {
        throw new Error(
            "activateFamily can only be used with the Family plan."
        );
    }

    /*
    --------------------------------------
    Parent Family Subscription
    --------------------------------------
    */

    const familyRef =
        db
            .ref("parents")
            .child(parentId)
            .child("familySubscription");

    const snapshot =
        await familyRef.get();

    const currentFamily =
        snapshot.exists()
            ? snapshot.val()
            : null;

    const now = Date.now();

    /*
    --------------------------------------
    PAYMENT / RENEWAL COUNTERS
    --------------------------------------
    */

    const paymentsCount =
        Number(
            currentFamily?.paymentsCount || 0
        ) + 1;

    const lifetimeValue =
        Number(
            currentFamily?.lifetimeValue || 0
        ) + Number(plan.price);

    const totalDaysPurchased =
        Number(
            currentFamily?.totalDaysPurchased || 0
        ) + Number(plan.durationDays);

    const firstSubscribedAt =
        currentFamily?.firstSubscribedAt || now;

    /*
    --------------------------------------
    FAMILY DURATION
    --------------------------------------
    */

    const duration =
        Number(plan.durationDays) *
        24 *
        60 *
        60 *
        1000;

    let startDate = now;

    let expiryDate =
        now + duration;

    /*
    ======================================
    ACTIVE FAMILY SUBSCRIPTION
    ======================================
    
    If the Family subscription is still
    active, extend it instead of starting
    a completely new period.
    */

    if (
        currentFamily &&
        currentFamily.status === "ACTIVE" &&
        currentFamily.active === true &&
        Number(currentFamily.expiryDate || 0) > now
    ) {

        startDate =
            currentFamily.startDate || now;

        expiryDate =
            Number(currentFamily.expiryDate) +
            duration;

        console.log(
            "Renewing existing Family subscription"
        );

    }

    else {

        console.log(
            "Creating new Family subscription"
        );

    }

    /*
    --------------------------------------
    COVERED CHILDREN
    --------------------------------------
    
    IMPORTANT:
    
    Preserve the existing coveredChildren
    when renewing Family.
    */

    const coveredChildren =
        currentFamily?.coveredChildren || {};

    /*
    --------------------------------------
    FAMILY SUBSCRIPTION
    --------------------------------------
    */

    const familySubscription = {

        active: true,

        premium: true,

        status: "ACTIVE",

        planId: plan.id,

        planName: plan.name,

        planPrice: plan.price,

        durationDays: plan.durationDays,

        maxChildren:
            Number(
                plan.maxChildren || 3
            ),

        createdAt:
            currentFamily?.createdAt || now,

        firstSubscribedAt,

        startDate,

        expiryDate,

        paymentsCount,

        totalDaysPurchased,

        lifetimeValue,

        currentPlanPrice:
            Number(plan.price),

        lastRenewedAt: now,

        updatedAt: now,

        coveredChildren

    };

    /*
    --------------------------------------
    SAVE PARENT FAMILY SUBSCRIPTION
    --------------------------------------
    */

    await familyRef.set(
        familySubscription
    );

    /*
    --------------------------------------
    MAKE SURE THE PAYING CHILD
    IS COVERED
    --------------------------------------
    
    The first child that paid for Family
    should automatically occupy one slot.
    */

    if (
        !coveredChildren[childId]
    ) {

        await familyRef
            .child("coveredChildren")
            .child(childId)
            .set(true);

        familySubscription.coveredChildren[childId] =
            true;

    }

    /*
    --------------------------------------
    RETURN UPDATED COUNTS
    --------------------------------------
    */

    const usedChildren =
        Object.keys(
            familySubscription.coveredChildren || {}
        ).filter(
            id =>
                familySubscription
                    .coveredChildren[id] === true
        ).length;

    const maxChildren =
        Number(
            familySubscription.maxChildren || 3
        );

    const remainingChildren =
        Math.max(
            0,
            maxChildren - usedChildren
        );

    console.log(
        "================================"
    );

    console.log(
        "FAMILY SUBSCRIPTION ACTIVATED"
    );

    console.log(
        "Parent:",
        parentId
    );

    console.log(
        "Child:",
        childId
    );

    console.log(
        "Plan:",
        plan.id
    );

    console.log(
        "Used Children:",
        usedChildren
    );

    console.log(
        "Remaining Children:",
        remainingChildren
    );

    console.log(
        "Expiry:",
        expiryDate
    );

    console.log(
        "================================"
    );

    return {

        ...familySubscription,

        coveredChildren:
            familySubscription.coveredChildren,

        usedChildren,

        remainingChildren

    };

}

}

module.exports = new SubscriptionManager();