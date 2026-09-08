const { db } = require("../firebase");
const { classifyDomain } = require("./DomainClassifier");

async function registerDomain(domain) {

    if (!domain) {
        throw new Error("domain is required");
    }

    const normalizedDomain =
        domain
            .trim()
            .toLowerCase()
            .replace(/^www\./, "");

    if (!normalizedDomain) {
        throw new Error("domain is empty");
    }

    const domainKey =
        normalizedDomain.replace(/\./g, "_");

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

//==========PROCESS PENDING DOMAINS===========
async function processPendingDomain(domain) {

    if (!domain) {
        throw new Error("domain is required");
    }

    const normalizedDomain =
        domain
            .trim()
            .toLowerCase()
            .replace(/^www\./, "");

    if (!normalizedDomain) {
        throw new Error("domain is empty");
    }

    const domainKey =
        normalizedDomain.replace(/\./g, "_");

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

    if (existing.category !== "pending") {

        console.log(
            `⏭️ DOMAIN ALREADY CLASSIFIED: ${normalizedDomain} → ${existing.category}`
        );

        return {
            domainKey,
            domain: normalizedDomain,
            status: "existing",
            category: existing.category,
            primaryPurpose: existing.primaryPurpose || ""
        };
    }

    console.log(
        `🤖 CLASSIFYING PENDING DOMAIN: ${normalizedDomain}`
    );

    const result =
        await classifyDomain(normalizedDomain);

    await ref.update({
        category: result.category,
        primaryPurpose: result.primaryPurpose,
        updatedAt: Date.now()
    });

    console.log(
        `✅ DOMAIN CLASSIFIED AND UPDATED: ${normalizedDomain} → ${result.category} (${result.primaryPurpose})`
    );

    return {
        domainKey,
        domain: normalizedDomain,
        status: "classified",
        category: result.category,
        primaryPurpose: result.primaryPurpose
    };
}

module.exports = {
    registerDomain,
    processPendingDomain
};

