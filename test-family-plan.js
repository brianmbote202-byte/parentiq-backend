require("dotenv").config();

const { db } = require("./firebase");

const PARENT_ID = "j2QPHVecYZeuRlgfnQDIijEHoSn2";

const CHILD_1 = "child_1786128098897";
const CHILD_2 = "child_1786516334473";
const CHILD_3 = "TEST_FAMILY_CHILD_3";

async function runTest() {

    console.log("==========================================");
    console.log("PARENTIQ FAMILY PLAN TEST");
    console.log("==========================================");

    console.log("Parent:", PARENT_ID);
    console.log("Plan: FAMILY");
    console.log("Price: KES 1,800");
    console.log("Maximum children: 3");

    /*
    ==========================================
    1. VERIFY PARENT
    ==========================================
    */

    const parentSnap =
        await db.ref("parents").child(PARENT_ID).get();

    if (!parentSnap.exists()) {

        throw new Error(
            "Parent does not exist: " + PARENT_ID
        );

    }

    console.log("✅ Parent exists");

    /*
    ==========================================
    2. VERIFY EXISTING CHILDREN
    ==========================================
    */

    const child1Snap =
        await db.ref("children").child(CHILD_1).get();

    const child2Snap =
        await db.ref("children").child(CHILD_2).get();

    if (!child1Snap.exists()) {
        throw new Error("Child 1 does not exist");
    }

    if (!child2Snap.exists()) {
        throw new Error("Child 2 does not exist");
    }

    console.log("✅ Child 1 exists:", CHILD_1);
    console.log("✅ Child 2 exists:", CHILD_2);

    /*
    ==========================================
    3. CREATE TEMPORARY THIRD CHILD
    ==========================================
    */

    await db.ref("children").child(CHILD_3).set({

        name: "Family Test Child",

        parentId: PARENT_ID,

        paired: true,

        createdAt: Date.now(),

        testChild: true

    });

    console.log("✅ Temporary Child 3 created");

    /*
    ==========================================
    4. ADD CHILD 3 TO PARENT
    ==========================================
    */

    await db
        .ref("parent_children")
        .child(PARENT_ID)
        .child(CHILD_3)
        .set(true);

    console.log("✅ Child 3 attached to parent");

    /*
    ==========================================
    5. SIMULATE FAMILY SUBSCRIPTION
    ==========================================
    */

    const now = Date.now();

    const expiry =
        now +
        (30 * 24 * 60 * 60 * 1000);

    const familySubscription = {

        active: true,

        status: "ACTIVE",

        planId: "family",

        planName: "Family",

        planPrice: 1800,

        maxChildren: 3,

        durationDays: 30,

        startDate: now,

        expiryDate: expiry,

        testMode: true,

        updatedAt: now

    };

    await db
        .ref("parents")
        .child(PARENT_ID)
        .child("subscription")
        .set(familySubscription);

    console.log("✅ Family subscription simulated");

    /*
    ==========================================
    6. READ PARENT'S CHILDREN
    ==========================================
    */

    const childrenSnap =
        await db
            .ref("parent_children")
            .child(PARENT_ID)
            .get();

    const children =
        childrenSnap.val() || {};

    const childIds =
        Object.keys(children);

    console.log("");
    console.log("==========================================");
    console.log("FAMILY CHILDREN");
    console.log("==========================================");

    console.log(childIds);

    /*
    ==========================================
    7. TEST LIMIT
    ==========================================
    */

    const familyLimit = 3;

    console.log("");
    console.log("Children linked:", childIds.length);
    console.log("Family limit:", familyLimit);

    if (childIds.length <= familyLimit) {

        console.log("");
        console.log("✅ TEST PASSED");
        console.log(
            "Family plan supports all linked children."
        );

    } else {

        console.log("");
        console.log("❌ TEST FAILED");
        console.log(
            "Parent has more children than Family allows."
        );

    }

    /*
    ==========================================
    8. VERIFY EACH CHILD
    ==========================================
    */

    console.log("");
    console.log("==========================================");
    console.log("CHILD ACCESS TEST");
    console.log("==========================================");

    for (const childId of childIds) {

        const childSnap =
            await db
                .ref("children")
                .child(childId)
                .get();

        if (!childSnap.exists()) {

            console.log(
                "❌ Child missing:",
                childId
            );

            continue;
        }

        const child =
            childSnap.val();

        console.log(
            "✅ Child:",
            childId,
            "| Parent:",
            child.parentId
        );

    }

    console.log("");
    console.log("==========================================");
    console.log("TEST COMPLETE");
    console.log("==========================================");

    console.log("");
    console.log("IMPORTANT:");
    console.log(
        "This was a simulated Family subscription."
    );
    console.log(
        "No KES 1,800 payment was made."
    );

}

runTest()

    .catch(error => {

        console.error("");
        console.error("❌ TEST ERROR");
        console.error(error);

        process.exit(1);

    });