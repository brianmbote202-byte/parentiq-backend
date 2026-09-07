
const { db } = require("../firebase");
const { classifyApp } = require("./AppClassifier");


async function classifyPendingApp(packageKey) {
    if (!packageKey) {
        throw new Error("packageKey is required");
    }

    const ref = db
        .ref("app_categories")
        .child(packageKey);

    const snapshot = await ref.once("value");

    if (!snapshot.exists()) {
        throw new Error(
            `App category entry not found: ${packageKey}`
        );
    }

    const appData = snapshot.val();

    console.log(
        `🔎 CHECKING APP: ${appData.appName} (${appData.packageName})`
    );

    if (appData.category !== "pending") {
        console.log(
            `⏭️ SKIPPING: already classified as ${appData.category}`
        );

        return {
            packageKey,
            status: "skipped",
            category: appData.category
        };
    }

    const category = await classifyApp(
        appData.appName,
        appData.packageName
    );

    await ref.update({
        category,
        updatedAt: Date.now()
    });

    console.log(
        `✅ FIREBASE CATEGORY UPDATED: ${appData.appName} → ${category}`
    );

    await propagateCategoryToInstalledApps(
        packageKey,
        category
    );

    return {
        packageKey,
        status: "classified",
        category
    };
}


/**
 * Manually correct the category of an already-classified app.
 *
 * This updates:
 *
 * app_categories/{packageKey}
 *
 * and then propagates the corrected category to every
 * matching installed_apps record across all children.
 */
async function correctAppCategory(
    packageKey,
    category
) {
    if (!packageKey || !category) {
        throw new Error(
            "packageKey and category are required"
        );
    }

    const ref = db
        .ref("app_categories")
        .child(packageKey);

    const snapshot = await ref.once("value");

    if (!snapshot.exists()) {
        throw new Error(
            `App category entry not found: ${packageKey}`
        );
    }

    const appData = snapshot.val();

    console.log(
        `🛠️ CORRECTING APP: ${appData.appName} (${appData.packageName})`
    );

    const oldCategory = appData.category;

    await ref.update({
        category,
        updatedAt: Date.now()
    });

    console.log(
        `✅ FIREBASE CATEGORY CORRECTED: ${appData.appName} → ${category}`
    );

    const propagationResult =
        await propagateCategoryToInstalledApps(
            packageKey,
            category
        );

    return {
        packageKey,
        appName: appData.appName || "",
        packageName: appData.packageName || "",
        oldCategory,
        newCategory: category,
        propagated: propagationResult.updated
    };
}


/**
 * Propagate a category from the central app_categories
 * record to every matching installed_apps record.
 */
async function propagateCategoryToInstalledApps(
    packageKey,
    category
) {
    if (!packageKey || !category) {
        throw new Error(
            "packageKey and category are required"
        );
    }

    const installedAppsRef =
        db.ref("installed_apps");

    const snapshot =
        await installedAppsRef.once("value");

    if (!snapshot.exists()) {
        console.log(
            "ℹ️ No installed_apps data found."
        );

        return {
            updated: 0
        };
    }

    const children = snapshot.val() || {};

    const updates = {};
    let updatedCount = 0;

    for (const [childId, childApps] of Object.entries(children)) {

        if (!childApps || typeof childApps !== "object") {
            continue;
        }

        const appRef =
            childApps[packageKey];

        if (!appRef || typeof appRef !== "object") {
            continue;
        }

        updates[
            `installed_apps/${childId}/${packageKey}/category`
        ] = category;

        updatedCount++;

        console.log(
            `🔄 CATEGORY PROPAGATION: ${childId}/${packageKey} → ${category}`
        );
    }

    if (updatedCount === 0) {
        console.log(
            `ℹ️ No installed app records found for ${packageKey}`
        );

        return {
            updated: 0
        };
    }

    await db.ref().update(updates);

    console.log(
        `✅ PROPAGATED ${category} TO ${updatedCount} INSTALLED APP RECORD(S)`
    );

    return {
        updated: updatedCount
    };
}


/**
 * Process pending apps in batches.
 */
async function processPendingApps(limit = 1) {
    const snapshot = await db
        .ref("app_categories")
        .once("value");

    if (!snapshot.exists()) {
        console.log(
            "ℹ️ No app_categories data found."
        );

        return {
            processed: 0,
            failed: 0
        };
    }

    const apps = snapshot.val() || {};

    const pendingApps = Object.entries(apps)
        .filter(([_, appData]) =>
            appData &&
            appData.category === "pending"
        )
        .slice(0, limit);

    console.log(
        `📋 PENDING APPS FOUND: ${pendingApps.length}`
    );

    let processed = 0;
    let failed = 0;

    for (const [packageKey, appData] of pendingApps) {
        try {
            console.log(
                `🚀 PROCESSING PENDING APP: ${appData.appName} (${appData.packageName})`
            );

            await classifyPendingApp(packageKey);

            processed++;

        } catch (error) {
            failed++;

            console.error(
                `❌ FAILED TO CLASSIFY: ${packageKey}`,
                error
            );
        }
    }

    console.log(
        `📊 PENDING PROCESS COMPLETE: ${processed} processed, ${failed} failed`
    );

    return {
        processed,
        failed
    };
}


module.exports = {
    classifyPendingApp,
    correctAppCategory,
    propagateCategoryToInstalledApps,
    processPendingApps
};

