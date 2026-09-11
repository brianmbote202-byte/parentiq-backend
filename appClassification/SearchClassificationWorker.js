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
// DISCOVER SEARCHES FROM CHILD SEARCH HISTORY
// ============================================================
//
// IMPORTANT:
//
// We NEVER download:
//
//     /analytics_browsing
//
// We NEVER download:
//
//     /analytics_browsing/{childId}/search_history
//
// as one giant object.
//
// Instead:
//
//     analytics_browsing
//          ↓
//     child IDs
//          ↓
//     search_history dates
//          ↓
//     recent dates only
//          ↓
//     individual search records
//
// This keeps Firebase reads small and prevents Render
// Node.js heap exhaustion.
// ============================================================

async function discoverSearchesFromHistory() {

    console.log(
        "🔎 SEARCH HISTORY: Checking for new child searches..."
    );

    let discovered = 0;
    let registered = 0;
    let existing = 0;
    let failed = 0;

    const seenQueries =
        new Set();

    try {

        // ====================================================
        // STEP 1
        // GET CHILD IDs ONLY
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
                registered: 0,
                existing: 0,
                failed: 0
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
                // GET ONLY SEARCH-HISTORY DATE KEYS
                // =================================================
                //
                // We intentionally do NOT call .once("value")
                // on search_history.
                //
                // We only need its immediate children (dates).
                //
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
                // USE ONLY THE MOST RECENT DATES
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


        console.log(
            `📊 SEARCH HISTORY DISCOVERY COMPLETE: ${discovered} searches found, ${registered} registered, ${existing} already known, ${failed} failed`
        );


        return {
            discovered,
            registered,
            existing,
            failed
        };


    } catch (error) {

        console.error(
            "❌ SEARCH HISTORY DISCOVERY ERROR:",
            error
        );


        return {
            discovered,
            registered,
            existing,
            failed: failed + 1
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