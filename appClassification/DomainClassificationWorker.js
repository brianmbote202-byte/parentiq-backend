const { db } = require("../firebase");

const {
    processPendingDomain,
    synchronizeVisitedUrls
} = require("./DomainCategoryProcessor");


// ============================================================
// CONFIGURATION
// ============================================================

// Maximum number of UNIQUE pending domains sent to Gemini
// per quota cycle.
const MAX_DOMAINS_PER_CYCLE = 5;

// Maximum number of already-classified domains synchronized
// against historical visited URLs in one worker cycle.
//
// This does NOT use Gemini quota.
const MAX_SYNC_DOMAINS_PER_CYCLE = 25;

// Wait between Gemini quota batches.
const QUOTA_INTERVAL = 60 * 1000;

// How often Firebase is checked when there is nothing waiting.
const NORMAL_INTERVAL = 30 * 1000;

// Safety fallback if Gemini returns 429 without a retry time.
const DEFAULT_RETRY_DELAY = 60 * 1000;


// ============================================================
// NORMALIZE DOMAIN
// ============================================================

function normalizeDomain(domain) {

    if (!domain) {
        return "";
    }

    let normalized =
        String(domain)
            .trim()
            .toLowerCase();

    // Remove protocol.
    normalized =
        normalized.replace(
            /^https?:\/\//,
            ""
        );

    // Remove leading www.
    normalized =
        normalized.replace(
            /^www\./,
            ""
        );

    // Remove anything after the hostname.
    normalized =
        normalized.split("/")[0];

    // Remove query parameters.
    normalized =
        normalized.split("?")[0];

    // Remove fragment.
    normalized =
        normalized.split("#")[0];

    // Remove trailing dot.
    normalized =
        normalized.replace(
            /\.$/,
            ""
        );

    return normalized.trim();
}


// ============================================================
// PROCESS PENDING DOMAINS
// ============================================================
//
// This section is responsible ONLY for domains whose Firebase
// category is "pending".
//
// These domains are sent to Gemini.
//
// The Gemini quota limit is preserved.
// ============================================================

async function processPendingDomains() {

    console.log(
        "🌐 DOMAIN CLASSIFICATION WORKER: Checking for pending domains..."
    );

    const snapshot =
        await db
            .ref("domain_categories")
            .orderByChild("category")
            .equalTo("pending")
            .once("value");

    if (!snapshot.exists()) {

        console.log(
            "📋 PENDING DOMAINS FOUND: 0"
        );

        return {
            processed: 0,
            failed: 0,
            duplicatesSkipped: 0,
            rateLimited: false,
            quotaBatchComplete: false,
            pendingRemaining: 0,
            retryAfterMs: NORMAL_INTERVAL
        };
    }

    const domains =
        snapshot.val();

    const domainKeys =
        Object.keys(domains);

    console.log(
        `📋 PENDING DOMAIN RECORDS FOUND: ${domainKeys.length}`
    );


    // ========================================================
    // REMOVE DUPLICATE DOMAINS
    // ========================================================

    const uniqueDomains = [];

    const seenDomains =
        new Set();

    let duplicatesSkipped = 0;


    for (const domainKey of domainKeys) {

        const rawDomain =
            domains[domainKey]?.domain;

        const normalizedDomain =
            normalizeDomain(rawDomain);


        // Ignore invalid/empty domain values.
        if (!normalizedDomain) {

            console.log(
                `⚠️ EMPTY OR INVALID DOMAIN SKIPPED: ${domainKey}`
            );

            duplicatesSkipped++;

            continue;
        }


        // Already seen this normalized domain.
        if (
            seenDomains.has(
                normalizedDomain
            )
        ) {

            duplicatesSkipped++;

            console.log(
                `♻️ DUPLICATE DOMAIN SKIPPED: ${normalizedDomain}`
            );

            continue;
        }


        seenDomains.add(
            normalizedDomain
        );


        uniqueDomains.push({
            domainKey,
            rawDomain,
            normalizedDomain
        });
    }


    console.log(
        `🔎 UNIQUE PENDING DOMAINS FOUND: ${uniqueDomains.length}`
    );

    console.log(
        `♻️ DUPLICATES SKIPPED: ${duplicatesSkipped}`
    );


    if (uniqueDomains.length === 0) {

        return {
            processed: 0,
            failed: 0,
            duplicatesSkipped,
            rateLimited: false,
            quotaBatchComplete: false,
            pendingRemaining: 0,
            retryAfterMs: NORMAL_INTERVAL
        };
    }


    // ========================================================
    // LIMIT THIS GEMINI CYCLE
    // ========================================================

    const domainsToProcess =
        uniqueDomains.slice(
            0,
            MAX_DOMAINS_PER_CYCLE
        );


    const pendingRemaining =
        Math.max(
            0,
            uniqueDomains.length -
            domainsToProcess.length
        );


    console.log(
        `📦 THIS GEMINI CYCLE: ${domainsToProcess.length} UNIQUE DOMAINS`
    );


    if (pendingRemaining > 0) {

        console.log(
            `📋 UNIQUE DOMAINS WAITING FOR NEXT GEMINI CYCLE: ${pendingRemaining}`
        );
    }


    let processed = 0;

    let failed = 0;

    let rateLimited = false;

    let retryAfterMs =
        QUOTA_INTERVAL;


    // ========================================================
    // CLASSIFY DOMAINS WITH GEMINI
    // ========================================================

    for (
        const item of domainsToProcess
    ) {

        const domain =
            item.normalizedDomain;


        try {

            console.log(
                `🔎 CLASSIFYING DOMAIN: ${domain}`
            );


            await processPendingDomain(
                domain
            );


            processed++;


            console.log(
                `✅ DOMAIN CLASSIFIED: ${domain}`
            );


        } catch (error) {

            failed++;


            console.error(
                `❌ DOMAIN CLASSIFICATION FAILED: ${domain}`,
                error
            );


            // ==================================================
            // GEMINI RATE LIMIT SAFETY NET
            // ==================================================

            if (
                error?.status === 429 ||
                error?.code === "rate_limit_exceeded"
            ) {

                rateLimited = true;


                // Try to read Google's retry delay.
                const message =
                    error?.message || "";


                const retryMatch =
                    message.match(
                        /retry in ([0-9.]+)s/i
                    );


                if (retryMatch) {

                    const retrySeconds =
                        parseFloat(
                            retryMatch[1]
                        );


                    if (
                        !isNaN(
                            retrySeconds
                        )
                    ) {

                        retryAfterMs =
                            Math.ceil(
                                retrySeconds * 1000
                            ) + 2000;
                    }
                }


                console.log(
                    "⏳ GEMINI RATE LIMIT DETECTED."
                );


                console.log(
                    `⏰ AUTOMATIC RETRY IN ${Math.ceil(
                        retryAfterMs / 1000
                    )} SECONDS.`
                );


                // Stop this Gemini cycle.
                break;
            }
        }
    }


    // ============================================================
    // DETERMINE WHETHER ANOTHER GEMINI BATCH IS NEEDED
    // ============================================================

    const quotaBatchComplete =
        !rateLimited &&
        pendingRemaining > 0;


    if (quotaBatchComplete) {

        retryAfterMs =
            QUOTA_INTERVAL;


        console.log(
            `📦 GEMINI BATCH COMPLETE: ${processed} domains processed.`
        );


        console.log(
            `📋 UNIQUE DOMAINS STILL WAITING: ${pendingRemaining}`
        );


        console.log(
            `⏳ NEXT GEMINI BATCH IN ${Math.ceil(
                QUOTA_INTERVAL / 1000
            )} SECONDS.`
        );
    }


    console.log(
        `📊 DOMAIN CLASSIFICATION COMPLETE: ${processed} processed, ${failed} failed`
    );


    return {
        processed,
        failed,
        duplicatesSkipped,
        rateLimited,
        quotaBatchComplete,
        pendingRemaining,
        retryAfterMs
    };
}


// ============================================================
// SYNCHRONIZE ALREADY-CLASSIFIED DOMAINS
// ============================================================
//
// IMPORTANT:
//
// domain_categories is the SOURCE OF TRUTH.
//
// Example:
//
// domain_categories/teaforturmeric_com
// category = food_and_cooking
//
// Existing visited URL:
//
// analytics_browsing/.../visited_urls/...
// domain = teaforturmeric.com
// category = general
//
// This function automatically corrects the historical visit.
//
// This synchronization DOES NOT call Gemini.
// ============================================================

async function synchronizeClassifiedDomains() {

    console.log(
        "🔄 DOMAIN VISIT SYNC: Checking already-classified domains..."
    );


    const snapshot =
        await db
            .ref("domain_categories")
            .once("value");


    if (!snapshot.exists()) {

        console.log(
            "📋 CLASSIFIED DOMAINS FOUND: 0"
        );

        return {
            checked: 0,
            synchronized: 0,
            failed: 0
        };
    }


    const domains =
        snapshot.val();


    const domainKeys =
        Object.keys(domains);


    console.log(
        `📋 DOMAIN REGISTRY RECORDS FOUND: ${domainKeys.length}`
    );


    const classifiedDomains = [];

    const seenDomains =
        new Set();


    // ========================================================
    // BUILD UNIQUE CLASSIFIED DOMAIN LIST
    // ========================================================

    for (
        const domainKey of domainKeys
    ) {

        const record =
            domains[domainKey];


        if (!record) {
            continue;
        }


        const category =
            String(
                record.category || ""
            )
                .trim()
                .toLowerCase();


        // Do NOT synchronize pending domains here.
        if (
            !category ||
            category === "pending"
        ) {
            continue;
        }


        const normalizedDomain =
            normalizeDomain(
                record.domain
            );


        if (!normalizedDomain) {

            console.log(
                `⚠️ CLASSIFIED DOMAIN HAS INVALID DOMAIN VALUE: ${domainKey}`
            );

            continue;
        }


        // Prevent duplicate synchronization work.
        if (
            seenDomains.has(
                normalizedDomain
            )
        ) {
            continue;
        }


        seenDomains.add(
            normalizedDomain
        );


        classifiedDomains.push({
            domainKey,
            domain: normalizedDomain,
            category
        });
    }


    console.log(
        `🔎 CLASSIFIED DOMAINS AVAILABLE FOR SYNC: ${classifiedDomains.length}`
    );


    if (
        classifiedDomains.length === 0
    ) {

        console.log(
            "✅ NO CLASSIFIED DOMAINS REQUIRE SYNC."
        );

        return {
            checked: 0,
            synchronized: 0,
            failed: 0
        };
    }


    // ========================================================
    // LIMIT SYNC WORK PER FIREBASE CYCLE
    // ========================================================

    const domainsToSync =
        classifiedDomains.slice(
            0,
            MAX_SYNC_DOMAINS_PER_CYCLE
        );


    if (
        classifiedDomains.length >
        MAX_SYNC_DOMAINS_PER_CYCLE
    ) {

        console.log(
            `📦 SYNC LIMIT: Processing ${MAX_SYNC_DOMAINS_PER_CYCLE} of ${classifiedDomains.length} classified domains this cycle.`
        );
    }


    let synchronized = 0;

    let failed = 0;


    // ========================================================
    // SYNCHRONIZE VISITED URL RECORDS
    // ========================================================

    for (
        const item of domainsToSync
    ) {

        try {

            console.log(
                `🔄 SYNCING VISITED URLS: ${item.domain} → ${item.category}`
            );


            const result =
                await synchronizeVisitedUrls(
                    item.domain,
                    item.category
                );


            const updated =
                Number(
                    result?.updated || 0
                );


            synchronized += updated;


            console.log(
                `✅ DOMAIN VISIT SYNC COMPLETE: ${item.domain} → ${updated} records updated`
            );


        } catch (error) {

            failed++;


            console.error(
                `❌ DOMAIN VISIT SYNC FAILED: ${item.domain}`,
                error
            );
        }
    }


    console.log(
        `📊 DOMAIN VISIT SYNC COMPLETE: ${domainsToSync.length} domains checked, ${synchronized} visited URL records updated, ${failed} domains failed`
    );


    return {
        checked: domainsToSync.length,
        synchronized,
        failed
    };
}


// ============================================================
// AUTOMATIC DOMAIN WORKER
// ============================================================

let workerTimer = null;

let workerRunning = false;


// ============================================================
// RUN ONE WORKER CYCLE
// ============================================================

async function runDomainWorker() {

    // Prevent overlapping executions.
    if (workerRunning) {

        console.log(
            "⏳ DOMAIN WORKER ALREADY RUNNING. SKIPPING THIS CYCLE."
        );

        return;
    }


    workerRunning = true;


    try {

        // ====================================================
        // STEP 1
        // PROCESS PENDING DOMAINS WITH GEMINI
        // ====================================================

        const result =
            await processPendingDomains();


        // ====================================================
        // STEP 2
        // SYNCHRONIZE ALREADY-CLASSIFIED DOMAINS
        // ====================================================
        //
        // This is independent of Gemini quota.
        //
        // Therefore it runs even when there are zero pending
        // domains.
        // ====================================================

        let syncResult;


        try {

            syncResult =
                await synchronizeClassifiedDomains();


        } catch (syncError) {

            console.error(
                "❌ CLASSIFIED DOMAIN SYNCHRONIZATION ERROR:",
                syncError
            );


            syncResult = {
                checked: 0,
                synchronized: 0,
                failed: 1
            };
        }


        // ====================================================
        // DETERMINE NEXT WORKER DELAY
        // ====================================================

        let nextDelay =
            NORMAL_INTERVAL;


        // ====================================================
        // GEMINI RATE LIMIT
        // ====================================================

        if (
            result.rateLimited
        ) {

            nextDelay =
                result.retryAfterMs ||
                DEFAULT_RETRY_DELAY;


            console.log(
                "🔄 DOMAIN WORKER: Gemini rate limit detected."
            );


            console.log(
                `⏳ NEXT AUTOMATIC RETRY IN ${Math.ceil(
                    nextDelay / 1000
                )} SECONDS.`
            );
        }


        // ====================================================
        // MORE PENDING DOMAINS REMAIN
        // ====================================================

        else if (
            result.quotaBatchComplete
        ) {

            nextDelay =
                QUOTA_INTERVAL;


            console.log(
                `🔄 DOMAIN WORKER: ${result.pendingRemaining} unique pending domains remain.`
            );


            console.log(
                `⏳ NEXT GEMINI BATCH IN ${Math.ceil(
                    nextDelay / 1000
                )} SECONDS.`
            );
        }


        // ====================================================
        // NORMAL CHECK
        // ====================================================

        else {

            nextDelay =
                NORMAL_INTERVAL;


            console.log(
                "🔄 DOMAIN WORKER: Pending classification and classified-domain synchronization check complete."
            );


            console.log(
                `🔄 VISITED URL RECORDS SYNCHRONIZED: ${syncResult.synchronized}`
            );


            console.log(
                `⏱️ NEXT FIREBASE CHECK IN ${Math.ceil(
                    nextDelay / 1000
                )} SECONDS.`
            );
        }


        // ====================================================
        // SCHEDULE NEXT CYCLE
        // ====================================================

        workerTimer =
            setTimeout(
                runDomainWorker,
                nextDelay
            );


    } catch (error) {

        console.error(
            "❌ DOMAIN WORKER ERROR:",
            error
        );


        // Keep the worker alive after unexpected errors.
        workerTimer =
            setTimeout(
                runDomainWorker,
                DEFAULT_RETRY_DELAY
            );


    } finally {

        workerRunning = false;
    }
}


// ============================================================
// START WORKER
// ============================================================

function startDomainClassificationWorker() {

    console.log(
        "🚀 AUTOMATIC DOMAIN CLASSIFICATION WORKER STARTED"
    );


    console.log(
        `📦 MAX UNIQUE DOMAINS PER GEMINI CYCLE: ${MAX_DOMAINS_PER_CYCLE}`
    );


    console.log(
        `🔄 MAX CLASSIFIED DOMAINS PER SYNC CYCLE: ${MAX_SYNC_DOMAINS_PER_CYCLE}`
    );


    console.log(
        `⏱️ QUOTA INTERVAL: ${QUOTA_INTERVAL / 1000} seconds`
    );


    console.log(
        `🔄 NORMAL FIREBASE CHECK: ${NORMAL_INTERVAL / 1000} seconds`
    );


    // Run immediately.
    runDomainWorker();
}


// ============================================================
// STOP WORKER
// ============================================================

function stopDomainClassificationWorker() {

    if (workerTimer) {

        clearTimeout(
            workerTimer
        );

        workerTimer = null;
    }


    console.log(
        "🛑 AUTOMATIC DOMAIN CLASSIFICATION WORKER STOPPED"
    );
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    processPendingDomains,

    synchronizeClassifiedDomains,

    startDomainClassificationWorker,

    stopDomainClassificationWorker

};