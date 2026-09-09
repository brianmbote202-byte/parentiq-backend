const { db } =
    require("../firebase");

const {
    processPendingDomain
} =
    require("./DomainCategoryProcessor");

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
            failed: 0
        };
    }

    const domains =
        snapshot.val();

    let processed = 0;
    let failed = 0;

    for (const domainKey of Object.keys(domains)) {

        const domain =
            domains[domainKey].domain;

        try {

            await processPendingDomain(domain);

            processed++;

        } catch (error) {

            failed++;

            console.error(
                `❌ DOMAIN CLASSIFICATION FAILED: ${domain}`,
                error
            );

            if (
                error?.status === 429 ||
                error?.code === "rate_limit_exceeded"
            ) {

                console.error(
                    "🛑 OPENAI RATE LIMIT REACHED. STOPPING DOMAIN WORKER."
                );

                break;
            }
        }
    }

    console.log(
        `📊 DOMAIN CLASSIFICATION COMPLETE: ${processed} processed, ${failed} failed`
    );

    return {
        processed,
        failed
    };
}

module.exports = {
    processPendingDomains
};