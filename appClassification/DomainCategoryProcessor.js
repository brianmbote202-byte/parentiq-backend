
const { db } = require("../firebase");

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

    await ref.setValue(pendingData);

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

module.exports = {
    registerDomain
};

