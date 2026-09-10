
const { db } = require("../firebase");

const { classifyDomain } = require("./DomainClassifier");


// ============================================================
// NORMALIZE DOMAIN
// ============================================================

function normalizeDomain(domain) {

    if (!domain) {
        return "";
    }

    return String(domain)
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0]
        .split("?")[0]
        .split("#")[0]
        .replace(/\.$/, "")
        .trim();
}


// ============================================================
// CREATE FIREBASE DOMAIN KEY
// ============================================================

function createDomainKey(domain) {

    return normalizeDomain(domain)
        .replace(/\./g, "_");
}


// ============================================================
// REGISTER DOMAIN
// ============================================================

async function registerDomain(domain) {

    if (!domain) {
        throw new Error("domain is required");
    }

    const normalizedDomain =
        normalizeDomain(domain);

    if (!normalizedDomain) {
        throw new Error("domain is empty");
    }

    const domainKey =
        createDomainKey(normalizedDomain);

    const ref =
        db
            .ref("domain_categories")
            .child(domainKey);

    const snapshot =
        await ref.once("value");

    if (snapshot.exists()) {

        const existing =
            snapshot.val();

        console.log(
            `⏭️ DOMAIN ALREADY REGISTERED: ${normalizedDomain} → ${existing.category || "pending"}`
        );

        return {
            domainKey,
            domain: normalizedDomain,
            status: "existing",
            category: existing.category || "pending",
            primaryPurpose: existing.primaryPurpose || ""
        };
    }


    const pendingData = {

        domain: normalizedDomain,

        category: "pending",

        updatedAt: Date.now()

    };


    await ref.set(pendingData);


    console.log(
        `🆕 UNKNOWN DOMAIN REGISTERED: ${normalizedDomain} → pending`
    );


    return {

        domainKey,

        domain: normalizedDomain,

        status: "registered",

        category: "pending",

        primaryPurpose: ""

    };
}


// ============================================================
// SYNCHRONIZE DOMAIN CATEGORY WITH VISITED URLS
// ============================================================
//
// domain_categories is the SOURCE OF TRUTH.
//
// Example:
//
// domain_categories
//     teaforturmeric_com
//         category: food_and_cooking
//
// Existing visited URL:
//
// analytics_browsing
//     childId
//         visited_urls
//             date
//                 visit
//                     domain: teaforturmeric.com
//                     category: general
//
// becomes:
//
//                     category: food_and_cooking
//
// ============================================================

async function synchronizeVisitedUrls(
    normalizedDomain,
    category
) {

    if (
        !normalizedDomain ||
        !category ||
        category === "pending"
    ) {

        return {
            updated: 0
        };
    }


    console.log(
        `🔄 SYNCING VISITED URLS: ${normalizedDomain} → ${category}`
    );


    const analyticsSnapshot =
        await db
            .ref("analytics_browsing")
            .once("value");


    if (!analyticsSnapshot.exists()) {

        console.log(
            "📋 NO ANALYTICS DATA FOUND FOR DOMAIN SYNC"
        );

        return {
            updated: 0
        };
    }


    const analyticsData =
        analyticsSnapshot.val();


    let updatedCount = 0;


    // ========================================================
    // LOOP THROUGH CHILDREN
    // ========================================================

    for (
        const childId of Object.keys(analyticsData)
    ) {

        const childData =
            analyticsData[childId];


        if (
            !childData ||
            !childData.visited_urls
        ) {

            continue;
        }


        const visitedUrls =
            childData.visited_urls;


        // ====================================================
        // LOOP THROUGH DATES
        // ====================================================

        for (
            const dateKey of Object.keys(visitedUrls)
        ) {

            const dateVisits =
                visitedUrls[dateKey];


            if (
                !dateVisits ||
                typeof dateVisits !== "object"
            ) {

                continue;
            }


            // =================================================
            // LOOP THROUGH VISIT RECORDS
            // =================================================

            for (
                const visitKey of Object.keys(dateVisits)
            ) {

                const visit =
                    dateVisits[visitKey];


                if (
                    !visit ||
                    typeof visit !== "object"
                ) {

                    continue;
                }


                const visitDomain =
                    normalizeDomain(
                        visit.domain
                    );


                // =============================================
                // DOMAIN DOES NOT MATCH
                // =============================================

                if (
                    visitDomain !==
                    normalizedDomain
                ) {

                    continue;
                }


                // =============================================
                // CATEGORY ALREADY CORRECT
                // =============================================

                if (
                    visit.category ===
                    category
                ) {

                    continue;
                }


                // =============================================
                // UPDATE ONLY CATEGORY
                // =============================================

                const visitRef =
                    db
                        .ref("analytics_browsing")
                        .child(childId)
                        .child("visited_urls")
                        .child(dateKey)
                        .child(visitKey);


                await visitRef.update({

                    category: category

                });


                updatedCount++;


                console.log(
                    `✅ VISITED URL UPDATED: ${normalizedDomain} → ${category}`
                );

                console.log(
                    `   CHILD = ${childId}`
                );

                console.log(
                    `   DATE = ${dateKey}`
                );

                console.log(
                    `   ENTRY = ${visitKey}`
                );
            }
        }
    }


    console.log(
        `📊 VISITED URL SYNC COMPLETE: ${updatedCount} records updated for ${normalizedDomain}`
    );


    return {

        updated: updatedCount

    };
}


// ============================================================
// PROCESS PENDING DOMAIN
// ============================================================

async function processPendingDomain(domain) {

    if (!domain) {

        throw new Error("domain is required");

    }


    const normalizedDomain =
        normalizeDomain(domain);


    if (!normalizedDomain) {

        throw new Error("domain is empty");

    }


    const domainKey =
        createDomainKey(
            normalizedDomain
        );


    const ref =
        db
            .ref("domain_categories")
            .child(domainKey);


    const snapshot =
        await ref.once("value");


    if (!snapshot.exists()) {

        throw new Error(
            `Domain is not registered: ${normalizedDomain}`
        );

    }


    const existing =
        snapshot.val();


    // ========================================================
    // ALREADY CLASSIFIED
    // ========================================================
    //
    // IMPORTANT:
    //
    // Even if the domain was classified previously,
    // synchronize its existing visited_urls records.
    //
    // This fixes historical records such as:
    //
    // domain_categories:
    //     teaforturmeric.com → food_and_cooking
    //
    // visited_urls:
    //     teaforturmeric.com → general
    //
    // ========================================================

    if (
        existing.category !==
        "pending"
    ) {

        console.log(
            `⏭️ DOMAIN ALREADY CLASSIFIED: ${normalizedDomain} → ${existing.category}`
        );


        try {

            const syncResult =
                await synchronizeVisitedUrls(
                    normalizedDomain,
                    existing.category
                );


            console.log(
                `🔄 DOMAIN VISIT SYNC: ${normalizedDomain} → ${syncResult.updated} visited URL records updated`
            );

        } catch (syncError) {

            console.error(
                `⚠️ VISITED URL SYNC FAILED FOR ${normalizedDomain}:`,
                syncError
            );

        }


        return {

            domainKey,

            domain:
                normalizedDomain,

            status:
                "existing",

            category:
                existing.category,

            primaryPurpose:
                existing.primaryPurpose || ""

        };
    }


    // ========================================================
    // GEMINI CLASSIFICATION
    // ========================================================

    console.log(
        `🤖 CLASSIFYING PENDING DOMAIN: ${normalizedDomain}`
    );


    const result =
        await classifyDomain(
            normalizedDomain
        );


    // ========================================================
    // UPDATE DOMAIN REGISTRY
    // ========================================================

    await ref.update({

        category:
            result.category,

        primaryPurpose:
            result.primaryPurpose,

        updatedAt:
            Date.now()

    });


    console.log(
        `✅ DOMAIN CLASSIFIED AND UPDATED: ${normalizedDomain} → ${result.category} (${result.primaryPurpose})`
    );


    // ========================================================
    // UPDATE EXISTING VISITED URLS
    // ========================================================

    try {

        const syncResult =
            await synchronizeVisitedUrls(
                normalizedDomain,
                result.category
            );


        console.log(
            `🔄 DOMAIN VISIT SYNC: ${normalizedDomain} → ${syncResult.updated} visited URL records updated`
        );

    } catch (syncError) {

        // ====================================================
        // IMPORTANT:
        //
        // Gemini classification has already succeeded.
        //
        // If synchronization fails, do NOT mark the domain
        // classification itself as failed.
        //
        // ====================================================

        console.error(
            `⚠️ VISITED URL SYNC FAILED FOR ${normalizedDomain}:`,
            syncError
        );

    }


    // ========================================================
    // RETURN RESULT
    // ========================================================

    return {

        domainKey,

        domain:
            normalizedDomain,

        status:
            "classified",

        category:
            result.category,

        primaryPurpose:
            result.primaryPurpose

    };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    registerDomain,

    processPendingDomain

};

