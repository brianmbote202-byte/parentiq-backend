const { processPendingApps } = require("./AppCategoryProcessor");

let isProcessing = false;

const PROCESS_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const BATCH_SIZE = 1;

async function runClassificationCycle() {
    if (isProcessing) {
        console.log("⏳ APP CLASSIFICATION WORKER: Previous cycle still running. Skipping.");
        return;
    }

    isProcessing = true;

    try {
        console.log("🤖 APP CLASSIFICATION WORKER: Checking for pending apps...");

        const result = await processPendingApps(BATCH_SIZE);

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

function startAppClassificationWorker() {
    console.log(
        "🚀 APP CLASSIFICATION WORKER STARTED"
    );

    // Check once when the backend starts.
    runClassificationCycle();

    // Then check every 5 minutes.
    setInterval(
        runClassificationCycle,
        PROCESS_INTERVAL_MS
    );
}

module.exports = {
    startAppClassificationWorker
};