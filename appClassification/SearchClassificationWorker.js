const { db } =
    require("../firebase");

const {
    processPendingSearch
} =
    require("./SearchCategoryProcessor");


async function processPendingSearches() {

    console.log(
        "🔎 SEARCH CLASSIFICATION WORKER: Checking for pending searches..."
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

            failed: 0

        };

    }


    const searches =
        snapshot.val();


    let processed = 0;

    let failed = 0;


    for (
        const searchKey
        of Object.keys(searches)
    ) {

        const searchQuery =
            searches[searchKey]
                .searchQuery;


        try {

            await processPendingSearch(
                searchQuery
            );


            processed++;

        } catch (error) {

            failed++;


            console.error(
                `❌ SEARCH CLASSIFICATION FAILED: ${searchQuery}`,
                error
            );


            if (
                error?.status === 429 ||
                error?.code === "rate_limit_exceeded"
            ) {

                console.error(
                    "🛑 OPENAI RATE LIMIT REACHED. STOPPING SEARCH WORKER."
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

        failed

    };

}


module.exports = {

    processPendingSearches

};