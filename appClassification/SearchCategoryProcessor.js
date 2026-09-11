
const { db } =
    require("../firebase");

const {
    classifySearch
} =
    require("./SearchClassifier");


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
// CREATE FIREBASE SEARCH KEY
// ============================================================

function createSearchKey(normalizedQuery) {

    return encodeURIComponent(
        normalizedQuery
    )
        .replace(/\./g, "%2E")
        .replace(/%/g, "_")
        .replace(
            /[^a-zA-Z0-9_-]/g,
            "_"
        );

}


// ============================================================
// REGISTER SEARCH
// ============================================================
//
// A search is globally registered by normalized query.
//
// New records also remember:
//
//     sourcePackage
//     sourceCategory
//
// This allows the system to know why a search was admitted
// into search_categories.
//
// ============================================================

async function registerSearch(
    searchQuery,
    sourcePackage = null,
    sourceCategory = null
) {

    const normalizedQuery =
        normalizeSearchQuery(
            searchQuery
        );


    if (!normalizedQuery) {
        throw new Error(
            "searchQuery is required"
        );
    }


    const searchKey =
        createSearchKey(
            normalizedQuery
        );


    const ref =
        db.ref(
            `search_categories/${searchKey}`
        );


    const snapshot =
        await ref.once("value");


    // ========================================================
    // SEARCH ALREADY EXISTS
    // ========================================================

    if (snapshot.exists()) {

        const existing =
            snapshot.val();


        // ----------------------------------------------------
        // If this is still pending and we now know its source,
        // preserve/update the source metadata.
        // ----------------------------------------------------

        if (
            existing?.category === "pending" &&
            sourcePackage &&
            sourceCategory
        ) {

            await ref.update({
                sourcePackage,
                sourceCategory,
                updatedAt: Date.now()
            });

        }


        return {
            status: "existing",
            searchKey,
            category:
                existing?.category || null,
            intent:
                existing?.intent || null
        };

    }


    // ========================================================
    // CREATE NEW PENDING SEARCH
    // ========================================================

    const record = {

        searchQuery:
            normalizedQuery,

        category:
            "pending",

        updatedAt:
            Date.now()

    };


    if (sourcePackage) {

        record.sourcePackage =
            sourcePackage;

    }


    if (sourceCategory) {

        record.sourceCategory =
            sourceCategory;

    }


    await ref.set(
        record
    );


    console.log(
        `🔎 SEARCH REGISTERED: ${normalizedQuery} → pending`
    );


    return {
        status: "registered",
        searchKey,
        category: "pending"
    };

}


// ============================================================
// PROCESS PENDING SEARCH
// ============================================================

async function processPendingSearch(
    searchQuery
) {

    const normalizedQuery =
        normalizeSearchQuery(
            searchQuery
        );


    if (!normalizedQuery) {
        throw new Error(
            "searchQuery is required"
        );
    }


    const searchKey =
        createSearchKey(
            normalizedQuery
        );


    const ref =
        db.ref(
            `search_categories/${searchKey}`
        );


    const snapshot =
        await ref.once("value");


    if (!snapshot.exists()) {

        throw new Error(
            `Search not found: ${normalizedQuery}`
        );

    }


    const existing =
        snapshot.val();


    // ========================================================
    // ALREADY CLASSIFIED
    // ========================================================

    if (
        existing?.category &&
        existing.category !== "pending"
    ) {

        return {
            status: "already_classified",
            category:
                existing.category,
            intent:
                existing.intent || null
        };

    }


    // ========================================================
    // CLASSIFY WITH GROQ
    // ========================================================

    console.log(
        `🔎 CLASSIFYING SEARCH: ${normalizedQuery}`
    );


    const result =
        await classifySearch(
            normalizedQuery
        );


    const category =
        result.category
            ?.trim()
            .toLowerCase();


    const intent =
        result.intent
            ?.trim()
            .toLowerCase();


    if (!category) {

        throw new Error(
            `Invalid search category returned for: ${normalizedQuery}`
        );

    }


    if (!intent) {

        throw new Error(
            `Invalid search intent returned for: ${normalizedQuery}`
        );

    }


    // ========================================================
    // SAVE CLASSIFICATION
    // ========================================================

    await ref.update({

        category,

        intent,

        updatedAt:
            Date.now()

    });


    console.log(
        `🤖 SEARCH CLASSIFIED: ${normalizedQuery} → ${category} (${intent})`
    );


    return {
        status: "classified",
        category,
        intent
    };

}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    registerSearch,

    processPendingSearch

};

