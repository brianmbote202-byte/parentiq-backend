const { db } =
    require("../firebase");

const {
    classifySearch
} =
    require("./SearchClassifier");


function normalizeSearchQuery(
    searchQuery
) {

    return searchQuery
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}


function createSearchKey(
    normalizedQuery
) {

    return encodeURIComponent(
        normalizedQuery
    )
        .replace(/\./g, "%2E")
        .replace(/%/g, "_")
        .replace(/[^a-zA-Z0-9_-]/g, "_");

}


async function registerSearch(
    searchQuery
) {

    if (!searchQuery) {

        throw new Error(
            "searchQuery is required"
        );

    }


    const normalizedQuery =
        normalizeSearchQuery(
            searchQuery
        );


    if (!normalizedQuery) {

        throw new Error(
            "searchQuery is empty"
        );

    }


    const searchKey =
        createSearchKey(
            normalizedQuery
        );


    const searchRef =
        db
            .ref("search_categories")
            .child(searchKey);


    const snapshot =
        await searchRef.once("value");


    if (snapshot.exists()) {

        const data =
            snapshot.val();


        return {

            status: "existing",

            searchQuery:
                data.searchQuery,

            category:
                data.category,

            intent:
                data.intent

        };

    }


    const pendingData = {

        searchQuery:
            normalizedQuery,

        category:
            "pending",

        updatedAt:
            Date.now()

    };


    await searchRef.set(
        pendingData
    );


    console.log(
        `🔎 SEARCH REGISTERED: ${normalizedQuery} → pending`
    );


    return {

        status: "registered",

        searchQuery:
            normalizedQuery,

        category:
            "pending"

    };

}


async function processPendingSearch(
    searchQuery
) {

    if (!searchQuery) {

        throw new Error(
            "searchQuery is required"
        );

    }


    const normalizedQuery =
        normalizeSearchQuery(
            searchQuery
        );


    const searchKey =
        createSearchKey(
            normalizedQuery
        );


    const searchRef =
        db
            .ref("search_categories")
            .child(searchKey);


    const snapshot =
        await searchRef.once("value");


    if (!snapshot.exists()) {

        throw new Error(
            `Search is not registered: ${normalizedQuery}`
        );

    }


    const data =
        snapshot.val();


    if (
        data.category &&
        data.category !== "pending"
    ) {

        return {

            status: "existing",

            searchQuery:
                normalizedQuery,

            category:
                data.category,

            intent:
                data.intent

        };

    }


    const result =
        await classifySearch(
            normalizedQuery
        );


    await searchRef.update({

        category:
            result.category,

        intent:
            result.intent,

        updatedAt:
            Date.now()

    });


    console.log(
        `🤖 SEARCH CLASSIFIED: ${normalizedQuery} → ${result.category} (${result.intent})`
    );


    return {

        status: "classified",

        searchQuery:
            normalizedQuery,

        category:
            result.category,

        intent:
            result.intent

    };

}


module.exports = {

    registerSearch,

    processPendingSearch

};