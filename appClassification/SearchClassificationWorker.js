const { db } =
    require("../firebase");

const {
    registerSearch,
    processPendingSearch
} =
    require("./SearchCategoryProcessor");


// ============================================================
// CONFIGURATION
// ============================================================

// Maximum number of pending searches classified per cycle.
const MAX_SEARCHES_PER_CYCLE = 10;

// How often Firebase is checked.
const NORMAL_INTERVAL = 30 * 1000;

// Safety retry delay.
const DEFAULT_RETRY_DELAY = 60 * 1000;

// Maximum number of recent search-history dates inspected
// for each child during one discovery cycle.
const MAX_RECENT_DATES_PER_CHILD = 3;

// Maximum number of search records inspected per child/date.
const MAX_SEARCH_RECORDS_PER_DATE = 200;

// Only searches originating from these app categories
// are eligible for search classification.
const ELIGIBLE_SEARCH_APP_CATEGORIES = new Set([
    "browser",
    "social_media",
    "streaming"
]);


// ============================================================
// NORMALIZE SEARCH QUERY
// ============================================================

function normalizeSearchQuery(searchQuery) {

    if (!searchQuery) {
        return "";
    }

    return String(searchQuery)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");

}


// ============================================================
// GET APP CATEGORY
// ============================================================

async function getSearchAppCategory(packageName) {

    if (!packageName) {
        return null;
    }

    const normalizedPackage =
        String(packageName).trim();

    if (!normalizedPackage) {
        return null;
    }

    try {

        const snapshot =
            await db
                .ref("app_categories")
                .orderByChild("packageName")
                .equalTo(normalizedPackage)
                .limitToFirst(1)
                .once("value");


        if (!snapshot.exists()) {

            console.log(
                `⏭️ SEARCH SOURCE APP NOT CLASSIFIED: ${normalizedPackage}`
            );

            return null;
        }


        const records =
            snapshot.val();

        const keys =
            Object.keys(records);


        if (!keys.length) {
            return null;
        }


        const appRecord =
            records[keys[0]];


        const category =
            appRecord?.category
                ?.trim()
                .toLowerCase();


        if (!category) {

            console.log(
                `⏭️ SEARCH SOURCE APP HAS NO CATEGORY: ${normalizedPackage}`
            );

            return null;
        }


        return category;

    } catch (error) {

        console.error(
            `❌ SEARCH SOURCE APP CATEGORY LOOKUP FAILED: ${normalizedPackage}`,
            error
        );

        return null;
    }

}


// ============================================================
// CHECK WHETHER SEARCH SOURCE IS ELIGIBLE
// ============================================================

async function isEligibleSearchSource(packageName) {

    const category =
        await getSearchAppCategory(
            packageName
        );


    if (!category) {
        return false;
    }


    if (
        !ELIGIBLE_SEARCH_APP_CATEGORIES.has(
            category
        )
    ) {

        console.log(
            `⏭️ SEARCH IGNORED: ${packageName} → ${category}`
        );

        return false;
    }


    console.log(
        `🔎 SEARCH SOURCE ELIGIBLE: ${packageName} → ${category}`
    );


    return true;
}


// ============================================================
// CLEANUP IGNORED PENDING SEARCHES
// ============================================================
//
// Removes /search_categories records that are:
//
//     category = pending
//
// AND were found during the current discovery window only
// from non-eligible application categories.
//
// IMPORTANT:
//
// If the same query was found from BOTH:
//
//     WhatsApp → messaging
//     Chrome   → browser
//
// the query is KEPT.
//
// Only queries with NO eligible occurrence in the inspected
// search-history window are deleted.
//
// ============================================================

async function cleanupIgnoredPendingSearches(
    eligibleQueries,
    ignoredQueries
) {

    console.log(
        "🧹 SEARCH CLEANUP: Checking ignored pending searches..."
    );


    if (
        !ignoredQueries ||
        ignoredQueries.size === 0
    ) {

        console.log(
            "🧹 SEARCH CLEANUP: No ignored searches found."
        );

        return {
            checked: 0,
            deleted: 0,
            kept: 0,
            failed: 0
        };
    }


    try {

        const snapshot =
            await db
                .ref("search_categories")
                .orderByChild("category")
                .equalTo("pending")
                .once("value");


        if (!snapshot.exists()) {

            console.log(
                "🧹 SEARCH CLEANUP: No pending search records found."
            );

            return {
                checked: 0,
                deleted: 0,
                kept: 0,
                failed: 0
            };
        }


        const pendingSearches =
            snapshot.val();


        const pendingKeys =
            Object.keys(
                pendingSearches
            );


        let checked = 0;
        let deleted = 0;
        let kept = 0;
        let failed = 0;


        for (
            const searchKey
            of pendingKeys
        ) {

            const record =
                pendingSearches[
                    searchKey
                ];


            if (!record?.searchQuery) {
                continue;
            }


            const query =
                normalizeSearchQuery(
                    record.searchQuery
                );


            // ----------------------------------------------------
            // Only clean searches that were actually observed
            // during this discovery cycle.
            // ----------------------------------------------------

            if (
                !ignoredQueries.has(query)
            ) {
                continue;
            }


            checked++;


            // ----------------------------------------------------
            // SAFETY CHECK:
            //
            // If this query was ALSO observed from an eligible
            // source, NEVER delete it.
            // ----------------------------------------------------

            if (
                eligibleQueries.has(query)
            ) {

                kept++;

                console.log(
                    `🛡️ SEARCH CLEANUP: KEEPING ${query} → eligible source also found`
                );

                continue;
            }


            // ----------------------------------------------------
            // The query was observed only from non-eligible
            // sources in the inspected search-history window.
            // ----------------------------------------------------

            try {

                await db
                    .ref(
                        `search_categories/${searchKey}`
                    )
                    .remove();


                deleted++;


                console.log(
                    `🗑️ SEARCH CLEANUP: DELETED ${query} → no eligible source`
                );


            } catch (error) {

                failed++;


                console.error(
                    `❌ SEARCH CLEANUP DELETE FAILED: ${query}`,
                    error
                );

            }

        }


        console.log(
            `🧹 SEARCH CLEANUP COMPLETE: ${checked} checked, ${deleted} deleted, ${kept} kept, ${failed} failed`
        );


        return {
            checked,
            deleted,
            kept,
            failed
        };


    } catch (error) {

        console.error(
            "❌ SEARCH CLEANUP FAILED:",
            error
        );


        return {
            checked: 0,
            deleted: 0,
            kept: 0,
            failed: 1
        };

    }

}


// ============================================================
// DISCOVER SEARCHES FROM CHILD SEARCH HISTORY
// ============================================================

async function discoverSearchesFromHistory() {

    console.log(
        "🔎 SEARCH HISTORY: Checking for new child searches..."
    );


    let discovered = 0;
    let eligible = 0;
    let ignored = 0;
    let registered = 0;
    let existing = 0;
    let failed = 0;


    // --------------------------------------------------------
    // Queries observed from eligible sources.
    // --------------------------------------------------------

    const eligibleQueries =
        new Set();


    // --------------------------------------------------------
    // Queries observed from ignored sources.
    // --------------------------------------------------------

    const ignoredQueries =
        new Set();


    // --------------------------------------------------------
    // Prevent duplicate registration during this cycle.
    // --------------------------------------------------------

    const seenQueries =
        new Set();


    try {

        // ====================================================
        // STEP 1
        // GET CHILD IDs
        // ====================================================

        const childrenSnapshot =
            await db
                .ref("analytics_browsing")
                .orderByKey()
                .limitToFirst(100)
                .once("value");


        if (!childrenSnapshot.exists()) {

            console.log(
                "📋 SEARCH HISTORY FOUND: 0"
            );


            return {
                discovered: 0,
                eligible: 0,
                ignored: 0,
                registered: 0,
                existing: 0,
                failed: 0,
                cleanup: {
                    checked: 0,
                    deleted: 0,
                    kept: 0,
                    failed: 0
                }
            };
        }


        const childIds =
            Object.keys(
                childrenSnapshot.val()
            );


        console.log(
            `👶 SEARCH HISTORY CHILDREN FOUND: ${childIds.length}`
        );


        // ====================================================
        // STEP 2
        // PROCESS ONE CHILD AT A TIME
        // ====================================================

        for (const childId of childIds) {

            try {

                console.log(
                    `🔎 CHECKING SEARCH HISTORY: ${childId}`
                );


                // =================================================
                // STEP 2A
                // GET SEARCH-HISTORY DATE NODES
                // =================================================

                const datesSnapshot =
                    await db
                        .ref(
                            `analytics_browsing/${childId}/search_history`
                        )
                        .orderByKey()
                        .once("value");


                if (
                    !datesSnapshot.exists()
                ) {
                    continue;
                }


                const searchHistory =
                    datesSnapshot.val();


                const dateKeys =
                    Object.keys(
                        searchHistory
                    );


                // =================================================
                // STEP 2B
                // USE ONLY MOST RECENT DATES
                // =================================================

                const recentDates =
                    dateKeys
                        .sort()
                        .reverse()
                        .slice(
                            0,
                            MAX_RECENT_DATES_PER_CHILD
                        );


                console.log(
                    `📅 SEARCH HISTORY DATES: ${childId} → ${recentDates.length} recent dates checked`
                );


                // =================================================
                // STEP 3
                // PROCESS EACH RECENT DATE
                // =================================================

                for (const dateKey of recentDates) {

                    try {

                        const dailySnapshot =
                            await db
                                .ref(
                                    `analytics_browsing/${childId}/search_history/${dateKey}`
                                )
                                .orderByKey()
                                .limitToLast(
                                    MAX_SEARCH_RECORDS_PER_DATE
                                )
                                .once("value");


                        if (
                            !dailySnapshot.exists()
                        ) {
                            continue;
                        }


                        const dailySearches =
                            dailySnapshot.val();


                        const searchIds =
                            Object.keys(
                                dailySearches
                            );


                        console.log(
                            `🔎 SEARCH RECORDS: ${childId}/${dateKey} → ${searchIds.length}`
                        );


                        // =================================================
                        // STEP 4
                        // PROCESS SEARCH RECORDS
                        // =================================================

                        for (
                            const searchId
                            of searchIds
                        ) {

                            const searchRecord =
                                dailySearches[
                                    searchId
                                ];


                            if (!searchRecord) {
                                continue;
                            }


                            const query =
                                normalizeSearchQuery(
                                    searchRecord.query
                                );


                            // Ignore empty searches.
                            if (!query) {
                                continue;
                            }


                            discovered++;


                            // =================================================
                            // CHECK SOURCE PACKAGE
                            // =================================================

                            const packageName =
                                searchRecord.package;


                            if (!packageName) {

                                ignored++;

                                ignoredQueries.add(
                                    query
                                );


                                console.log(
                                    `⏭️ SEARCH IGNORED: ${query} → no source package`
                                );


                                continue;
                            }


                            // =================================================
                            // ONLY BROWSER / SOCIAL MEDIA / STREAMING
                            // =================================================

                            const searchSourceIsEligible =
                                await isEligibleSearchSource(
                                    packageName
                                );


                            if (
                                !searchSourceIsEligible
                            ) {

                                ignored++;


                                ignoredQueries.add(
                                    query
                                );


                                continue;
                            }


                            // =================================================
                            // ELIGIBLE SOURCE FOUND
                            // =================================================

                            eligible++;


                            // ------------------------------------------------
                            // IMPORTANT:
                            //
                            // If this query was previously seen from an
                            // ignored source, it is now protected because
                            // an eligible source also exists.
                            // ------------------------------------------------

                            eligibleQueries.add(
                                query
                            );


                            // =================================================
                            // GLOBAL DUPLICATE PROTECTION
                            // =================================================

                            if (
                                seenQueries.has(query)
                            ) {
                                continue;
                            }


                            seenQueries.add(
                                query
                            );


                            try {

                                const result =
                                    await registerSearch(
                                        query
                                    );


                                if (
                                    result.status ===
                                    "registered"
                                ) {

                                    registered++;


                                    console.log(
                                        `🆕 UNKNOWN SEARCH REGISTERED: ${query} → pending`
                                    );

                                } else {

                                    existing++;

                                }


                            } catch (error) {

                                failed++;


                                console.error(
                                    `❌ SEARCH REGISTRATION FAILED: ${query}`,
                                    error
                                );

                            }

                        }


                    } catch (error) {

                        failed++;


                        console.error(
                            `❌ DAILY SEARCH HISTORY READ FAILED: ${childId}/${dateKey}`,
                            error
                        );

                    }

                }


            } catch (error) {

                failed++;


                console.error(
                    `❌ SEARCH HISTORY READ FAILED: ${childId}`,
                    error
                );

            }

        }


        // ====================================================
        // STEP 5
        // CLEANUP OLD PENDING SEARCHES
        // ====================================================

        const cleanup =
            await cleanupIgnoredPendingSearches(
                eligibleQueries,
                ignoredQueries
            );


        console.log(
            `📊 SEARCH HISTORY DISCOVERY COMPLETE: ${discovered} searches found, ${eligible} eligible, ${ignored} ignored, ${registered} registered, ${existing} already known, ${failed} failed`
        );


        return {
            discovered,
            eligible,
            ignored,
            registered,
            existing,
            failed,
            cleanup
        };


    } catch (error) {

        console.error(
            "❌ SEARCH HISTORY DISCOVERY ERROR:",
            error
        );


        return {
            discovered,
            eligible,
            ignored,
            registered,
            existing,
            failed: failed + 1,
            cleanup: {
                checked: 0,
                deleted: 0,
                kept: 0,
                failed: 1
            }
        };

    }

}


// ============================================================
// PROCESS PENDING SEARCHES
// ============================================================

async function processPendingSearches() {

    console.log(
        "🤖 SEARCH CLASSIFICATION: Checking for pending searches..."
    );


    const snapshot =
        await db
            .ref("search_categories")
            .orderByChild("category")
            .equalTo("pending")
            .once("value");


    if (!snapshot.exists()) {

        console.log(
            "📋 PENDING SEARCHES FOUND: 0"
        );


        return {
            processed: 0,
            failed: 0,
            rateLimited: false
        };
    }


    const searches =
        snapshot.val();


    const searchKeys =
        Object.keys(searches);


    console.log(
        `📋 PENDING SEARCH RECORDS FOUND: ${searchKeys.length}`
    );


    const searchesToProcess =
        searchKeys.slice(
            0,
            MAX_SEARCHES_PER_CYCLE
        );


    if (
        searchKeys.length >
        MAX_SEARCHES_PER_CYCLE
    ) {

        console.log(
            `📦 SEARCH CLASSIFICATION LIMIT: Processing ${MAX_SEARCHES_PER_CYCLE} of ${searchKeys.length} pending searches this cycle.`
        );

    }


    let processed = 0;
    let failed = 0;
    let rateLimited = false;


    for (
        const searchKey
        of searchesToProcess
    ) {

        const searchQuery =
            searches[
                searchKey
            ]?.searchQuery;


        if (!searchQuery) {

            console.log(
                `⚠️ INVALID SEARCH RECORD SKIPPED: ${searchKey}`
            );

            continue;
        }


        try {

            console.log(
                `🔎 CLASSIFYING SEARCH: ${searchQuery}`
            );


            await processPendingSearch(
                searchQuery
            );


            processed++;


            console.log(
                `✅ SEARCH CLASSIFIED: ${searchQuery}`
            );


        } catch (error) {

            failed++;


            console.error(
                `❌ SEARCH CLASSIFICATION FAILED: ${searchQuery}`,
                error
            );


            // =================================================
            // GROQ RATE LIMIT SAFETY
            // =================================================

            if (
                error?.status === 429 ||
                error?.code ===
                    "rate_limit_exceeded"
            ) {

                rateLimited = true;


                console.log(
                    "⏳ GROQ RATE LIMIT DETECTED. STOPPING SEARCH CLASSIFICATION CYCLE."
                );


                break;
            }

        }

    }


    console.log(
        `📊 SEARCH CLASSIFICATION COMPLETE: ${processed} processed, ${failed} failed`
    );


    return {
        processed,
        failed,
        rateLimited
    };

}


// ============================================================
// AUTOMATIC SEARCH WORKER
// ============================================================

let workerTimer = null;
let workerRunning = false;


// ============================================================
// RUN ONE WORKER CYCLE
// ============================================================

async function runSearchWorker() {

    // Prevent overlapping executions.
    if (workerRunning) {

        console.log(
            "⏳ SEARCH WORKER ALREADY RUNNING. SKIPPING THIS CYCLE."
        );

        return;
    }


    workerRunning = true;


    try {

        // ====================================================
        // STEP 1
        // DISCOVER REAL CHILD SEARCHES
        // ====================================================

        await discoverSearchesFromHistory();


        // ====================================================
        // STEP 2
        // CLASSIFY PENDING SEARCHES
        // ====================================================

        const result =
            await processPendingSearches();


        // ====================================================
        // STEP 3
        // DETERMINE NEXT CHECK
        // ====================================================

        let nextDelay =
            NORMAL_INTERVAL;


        if (
            result.rateLimited
        ) {

            nextDelay =
                DEFAULT_RETRY_DELAY;


            console.log(
                "🔄 SEARCH WORKER: Groq rate limit detected."
            );


            console.log(
                `⏳ NEXT AUTOMATIC RETRY IN ${Math.ceil(
                    nextDelay / 1000
                )} SECONDS.`
            );


        } else {

            console.log(
                "🔄 SEARCH WORKER: Discovery and classification check complete."
            );


            console.log(
                `⏱️ NEXT SEARCH CHECK IN ${Math.ceil(
                    nextDelay / 1000
                )} SECONDS.`
            );

        }


        // ====================================================
        // SCHEDULE NEXT CYCLE
        // ====================================================

        workerTimer =
            setTimeout(
                runSearchWorker,
                nextDelay
            );


    } catch (error) {

        console.error(
            "❌ SEARCH WORKER ERROR:",
            error
        );


        workerTimer =
            setTimeout(
                runSearchWorker,
                DEFAULT_RETRY_DELAY
            );


    } finally {

        workerRunning = false;

    }

}


// ============================================================
// START WORKER
// ============================================================

function startSearchClassificationWorker() {

    console.log(
        "🚀 AUTOMATIC SEARCH CLASSIFICATION WORKER STARTED"
    );


    console.log(
        `📦 MAX SEARCHES PER CLASSIFICATION CYCLE: ${MAX_SEARCHES_PER_CYCLE}`
    );


    console.log(
        `🔄 NORMAL FIREBASE CHECK: ${NORMAL_INTERVAL / 1000} seconds`
    );


    runSearchWorker();

}


// ============================================================
// STOP WORKER
// ============================================================

function stopSearchClassificationWorker() {

    if (workerTimer) {

        clearTimeout(
            workerTimer
        );

        workerTimer = null;

    }


    console.log(
        "🛑 AUTOMATIC SEARCH CLASSIFICATION WORKER STOPPED"
    );

}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    discoverSearchesFromHistory,

    processPendingSearches,

    startSearchClassificationWorker,

    stopSearchClassificationWorker

};