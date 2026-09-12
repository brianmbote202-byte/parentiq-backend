
const { processPendingApps } = require("./AppCategoryProcessor");

// ============================================================
// APP CLASSIFICATION WORKER STATE
// ============================================================

let isProcessing = false;

// ============================================================
// WORKER SETTINGS
// ============================================================

// Check Firebase every 30 seconds.
const PROCESS_INTERVAL_MS = 30 * 1000;

// Classify one app per cycle.
// This keeps OpenRouter Free usage controlled.
const BATCH_SIZE = 1;

// ============================================================
// RUN ONE CLASSIFICATION CYCLE
// ============================================================

async function runClassificationCycle() {

    // Prevent overlapping classification cycles.
    if (isProcessing) {

        console.log(
            "⏳ APP CLASSIFICATION WORKER: Previous cycle still running. Skipping."
        );

        return;
    }

    isProcessing = true;

    try {

        console.log(
            "🤖 APP CLASSIFICATION WORKER: Checking for pending apps..."
        );

        const result =
            await processPendingApps(
                BATCH_SIZE
            );

        console.log(
            `📊 APP CLASSIFICATION WORKER: ${result.processed} processed, ${result.failed} failed`
        );

    } catch (error) {

        console.error(
            "❌ APP CLASSIFICATION WORKER FAILED:",
            error
        );

    } finally {

        isProcessing = false;
    }
}

// ============================================================
// START AUTOMATIC WORKER
// ============================================================

function startAppClassificationWorker() {

    console.log(
        "🚀 APP CLASSIFICATION WORKER STARTED"
    );

    console.log(
        "⏱️ APP CLASSIFICATION CHECK INTERVAL: 30 seconds"
    );

    console.log(
        `📦 MAX APPS PER CYCLE: ${BATCH_SIZE}`
    );

    // ========================================================
    // INITIAL CHECK
    // ========================================================

    // Check immediately when the backend starts.
    runClassificationCycle();

    // ========================================================
    // CONTINUOUS AUTOMATIC CHECK
    // ========================================================

    // Continue checking automatically.
    setInterval(
        runClassificationCycle,
        PROCESS_INTERVAL_MS
    );
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
    startAppClassificationWorker
};
