
const { db } = require("../firebase");
const { classifyApp } = require("./AppClassifier");


// ============================================================
// CATEGORY VALIDATION
// ============================================================
//
// Categories are intentionally OPEN-ENDED.
//
// We do NOT use a fixed category list.
//
// Examples of valid categories:
//
// navigation
// transportation
// music_streaming
// video_streaming
// cloud_storage
// system
// system_ui
// system_settings
// artificial_intelligence
// system_configuration
// system_toolkit
// digital_wallet
// password_manager
// cybersecurity
//
// "pending" is reserved as the workflow state for apps that
// have not yet been classified.
//

function validateCategory(category) {

    if (
        typeof category !== "string"
    ) {
        throw new Error(
            "Category must be a string"
        );
    }

    const normalized =
        category
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "_")
            .replace(/-+/g, "_")
            .replace(/[^a-z0-9_]/g, "")
            .replace(/_+/g, "_")
            .replace(/^_+|_+$/g, "");

    if (!normalized) {
        throw new Error(
            "Category cannot be empty"
        );
    }

    // --------------------------------------------------------
    // RESERVED WORKFLOW VALUE
    // --------------------------------------------------------

    if (normalized === "pending") {
        throw new Error(
            'Invalid category: "pending" is reserved for unclassified apps'
        );
    }

    // --------------------------------------------------------
    // MUST CONTAIN AT LEAST ONE LETTER
    // --------------------------------------------------------

    if (!/[a-z]/.test(normalized)) {
        throw new Error(
            `Invalid category: ${category}`
        );
    }

    // --------------------------------------------------------
    // MAXIMUM CATEGORY LENGTH
    // --------------------------------------------------------

    if (normalized.length > 80) {
        throw new Error(
            `Category is too long: ${normalized.length} characters`
        );
    }

    // --------------------------------------------------------
    // FINAL FORMAT CHECK
    // --------------------------------------------------------

    if (
        !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(
            normalized
        )
    ) {
        throw new Error(
            `Invalid category format: ${category}`
        );
    }

    return normalized;
}


// ============================================================
// CLASSIFY ONE PENDING APP
// ============================================================

async function classifyPendingApp(packageKey) {

    if (!packageKey) {
        throw new Error(
            "packageKey is required"
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

    // --------------------------------------------------------
    // ASK AI FOR CATEGORY
    // --------------------------------------------------------

    const rawCategory = await classifyApp(
        appData.appName,
        appData.packageName
    );

    console.log(
        `🤖 RAW AI CATEGORY: ${rawCategory}`
    );

    // --------------------------------------------------------
    // VALIDATE AI CATEGORY
    // --------------------------------------------------------

    const category =
        validateCategory(
            rawCategory
        );

    console.log(
        `✅ CATEGORY VALIDATED: ${category}`
    );

    // --------------------------------------------------------
    // WRITE ONLY VALIDATED CATEGORY
    // --------------------------------------------------------

    await ref.update({
        category,
        updatedAt: Date.now()
    });

    console.log(
        `✅ FIREBASE CATEGORY UPDATED: ${appData.appName} → ${category}`
    );

    // --------------------------------------------------------
    // PROPAGATE VALIDATED CATEGORY
    // --------------------------------------------------------

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


// ============================================================
// MANUALLY CORRECT APP CATEGORY
// ============================================================

async function correctAppCategory(
    packageKey,
    category
) {

    if (!packageKey || !category) {
        throw new Error(
            "packageKey and category are required"
        );
    }

    // --------------------------------------------------------
    // VALIDATE BEFORE FIREBASE WRITE
    // --------------------------------------------------------

    const validatedCategory =
        validateCategory(
            category
        );

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

    const oldCategory =
        appData.category;

    await ref.update({
        category: validatedCategory,
        updatedAt: Date.now()
    });

    console.log(
        `✅ FIREBASE CATEGORY CORRECTED: ${appData.appName} → ${validatedCategory}`
    );

    const propagationResult =
        await propagateCategoryToInstalledApps(
            packageKey,
            validatedCategory
        );

    return {
        packageKey,
        appName: appData.appName || "",
        packageName: appData.packageName || "",
        oldCategory,
        newCategory: validatedCategory,
        propagated: propagationResult.updated
    };
}


// ============================================================
// PROPAGATE CATEGORY TO INSTALLED APPS
// ============================================================

async function propagateCategoryToInstalledApps(
    packageKey,
    category
) {

    if (!packageKey || !category) {
        throw new Error(
            "packageKey and category are required"
        );
    }

    // --------------------------------------------------------
    // VALIDATE BEFORE PROPAGATION WRITE
    // --------------------------------------------------------

    const validatedCategory =
        validateCategory(
            category
        );

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

    const children =
        snapshot.val() || {};

    const updates = {};

    let updatedCount = 0;

    for (
        const [childId, childApps]
        of Object.entries(children)
    ) {

        if (
            !childApps ||
            typeof childApps !== "object"
        ) {
            continue;
        }

        const appRef =
            childApps[packageKey];

        if (
            !appRef ||
            typeof appRef !== "object"
        ) {
            continue;
        }

        updates[
            `installed_apps/${childId}/${packageKey}/category`
        ] = validatedCategory;

        updatedCount++;

        console.log(
            `🔄 CATEGORY PROPAGATION: ${childId}/${packageKey} → ${validatedCategory}`
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
        `✅ PROPAGATED ${validatedCategory} TO ${updatedCount} INSTALLED APP RECORD(S)`
    );

    return {
        updated: updatedCount
    };
}


// ============================================================
// PROCESS PENDING APPS
// ============================================================

async function processPendingApps(
    limit = 1
) {

    // --------------------------------------------------------
    // QUERY FIREBASE DIRECTLY FOR PENDING APPS
    // --------------------------------------------------------
    //
    // Firebase returns ONLY records where:
    //
    // category === "pending"
    //
    // This avoids downloading the complete app_categories tree.
    //
    // limit keeps OpenRouter Free usage controlled.
    //

    const snapshot = await db
        .ref("app_categories")
        .orderByChild("category")
        .equalTo("pending")
        .limitToFirst(limit)
        .once("value");

    // --------------------------------------------------------
    // NO PENDING APPS
    // --------------------------------------------------------

    if (!snapshot.exists()) {

        console.log(
            "📋 NO PENDING APPS FOUND"
        );

        return {
            processed: 0,
            failed: 0
        };
    }

    // --------------------------------------------------------
    // CONVERT FIREBASE RESULT
    // --------------------------------------------------------

    const apps =
        snapshot.val() || {};

    const pendingApps =
        Object.entries(apps);

    console.log(
        `📋 PENDING APPS FOUND: ${pendingApps.length}`
    );

    // --------------------------------------------------------
    // PROCESS RESULTS
    // --------------------------------------------------------

    let processed = 0;
    let failed = 0;

    for (
        const [packageKey, appData]
        of pendingApps
    ) {

        try {

            console.log(
                `🚀 PROCESSING PENDING APP: ${appData.appName} (${appData.packageName})`
            );

            await classifyPendingApp(
                packageKey
            );

            processed++;

        } catch (error) {

            failed++;

            console.error(
                `❌ FAILED TO CLASSIFY: ${packageKey}`,
                error
            );
        }
    }

    // --------------------------------------------------------
    // SUMMARY
    // --------------------------------------------------------

    console.log(
        `📊 PENDING PROCESS COMPLETE: ${processed} processed, ${failed} failed`
    );

    return {
        processed,
        failed
    };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    classifyPendingApp,
    correctAppCategory,
    propagateCategoryToInstalledApps,
    processPendingApps,
    validateCategory
};

