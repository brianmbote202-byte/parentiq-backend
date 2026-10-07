const axios = require("axios");
const { db } = require("../firebase");

const CACHE_PATH = "sms_brand_cache";

// How long a successful result remains trusted before re-discovery.
const VERIFIED_CACHE_TTL =
    Number(process.env.SMS_BRAND_CACHE_TTL_MS) ||
    30 * 24 * 60 * 60 * 1000;

// How long a discovery lock lasts.
const DISCOVERY_LOCK_TTL =
    Number(process.env.SMS_BRAND_DISCOVERY_LOCK_TTL_MS) ||
    5 * 60 * 1000;

// Maximum number of search results we inspect.
const MAX_SEARCH_RESULTS = 8;

// Maximum HTML size we are willing to inspect.
const MAX_HTML_BYTES = 2 * 1024 * 1024;

// In-process cache.
// This is only an optimization.
// Firebase remains the persistent global cache.
const memoryCache = new Map();


// ======================================================
// NORMALIZATION
// ======================================================

function normalizeSender(sender) {

    return String(sender || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[^a-z0-9._ -]/g, "")
        .trim();
}


// ======================================================
// SAFE URL
// ======================================================

function normalizeUrl(url, baseUrl = "") {

    if (!url) {
        return "";
    }

    try {

        let value =
            String(url)
                .trim()
                .replace(/^['"]|['"]$/g, "");

        if (!value) {
            return "";
        }

        if (
            value.startsWith("//")
        ) {

            value =
                "https:" + value;

        }

        const resolved =
            new URL(
                value,
                baseUrl || undefined
            );

        if (
            resolved.protocol !== "http:" &&
            resolved.protocol !== "https:"
        ) {

            return "";
        }

        return resolved.href;

    }

    catch {

        return "";

    }
}


// ======================================================
// HTML DECODING
// ======================================================

function decodeHtml(value) {

    if (!value) {
        return "";
    }

    return String(value)
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#x2F;/gi, "/")
        .replace(/&#47;/gi, "/")
        .replace(/\s+/g, " ")
        .trim();
}


// ======================================================
// HTML TEXT
// ======================================================

function stripHtml(html) {

    return String(html || "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

}


// ======================================================
// HTML ATTRIBUTE
// ======================================================

function extractAttribute(
    html,
    tagName,
    attribute,
    valueRegex
) {

    const regex =
        new RegExp(
            `<${tagName}\\b[^>]*${attribute}\\s*=\\s*["']([^"']+)["'][^>]*>`,
            "gi"
        );

    let match;

    while (
        (match = regex.exec(html))
    ) {

        const fullTag =
            match[0] || "";

        if (
            !valueRegex ||
            valueRegex.test(fullTag)
        ) {

            return decodeHtml(match[1]);

        }

    }

    return "";

}


// ======================================================
// META CONTENT
// ======================================================

function extractMetaContent(
    html,
    property
) {

    const regex =
        new RegExp(
            `<meta\\b[^>]*(?:property|name)\\s*=\\s*["']${escapeRegex(property)}["'][^>]*content\\s*=\\s*["']([^"']*)["'][^>]*>`,
            "i"
        );

    const match =
        html.match(regex);

    if (match) {

        return decodeHtml(
            match[1]
        );

    }

    // Some sites reverse attribute order.
    const reverseRegex =
        new RegExp(
            `<meta\\b[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${escapeRegex(property)}["'][^>]*>`,
            "i"
        );

    const reverseMatch =
        html.match(reverseRegex);

    return reverseMatch
        ? decodeHtml(reverseMatch[1])
        : "";
}


// ======================================================
// TITLE
// ======================================================

function extractTitle(html) {

    const match =
        String(html || "")
            .match(
                /<title[^>]*>([\s\S]*?)<\/title>/i
            );

    return match
        ? decodeHtml(
            match[1]
        )
        : "";
}


// ======================================================
// CANONICAL
// ======================================================

function extractCanonicalUrl(
    html,
    baseUrl
) {

    const match =
        String(html || "")
            .match(
                /<link\b[^>]*rel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*>/i
            );

    if (!match) {

        const reverse =
            String(html || "")
                .match(
                    /<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*>/i
                );

        return reverse
            ? normalizeUrl(
                reverse[1],
                baseUrl
            )
            : "";

    }

    return normalizeUrl(
        match[1],
        baseUrl
    );
}


// ======================================================
// ICON / LOGO
// ======================================================

function extractIconCandidates(
    html,
    baseUrl
) {

    const results = [];

    const regex =
        /<link\b[^>]*>/gi;

    let match;

    while (
        (match = regex.exec(html))
    ) {

        const tag =
            match[0];

        const relMatch =
            tag.match(
                /\brel\s*=\s*["']([^"']+)["']/i
            );

        const hrefMatch =
            tag.match(
                /\bhref\s*=\s*["']([^"']+)["']/i
            );

        if (
            !hrefMatch
        ) {
            continue;
        }

        const rel =
            String(
                relMatch?.[1] || ""
            )
                .toLowerCase();

        if (
            !(
                rel.includes("icon") ||
                rel.includes("apple-touch-icon") ||
                rel.includes("mask-icon")
            )
        ) {

            continue;

        }

        const url =
            normalizeUrl(
                hrefMatch[1],
                baseUrl
            );

        if (url) {

            results.push({
                url,
                rel
            });

        }

    }

    return results;
}


// ======================================================
// OPEN GRAPH / IMAGE
// ======================================================

function extractLogoCandidates(
    html,
    baseUrl
) {

    const candidates = [];

    const metaLogoProperties = [

        "og:logo",
        "og:image",
        "twitter:image"

    ];

    for (
        const property of metaLogoProperties
    ) {

        const value =
            extractMetaContent(
                html,
                property
            );

        if (value) {

            const url =
                normalizeUrl(
                    value,
                    baseUrl
                );

            if (url) {

                candidates.push({
                    url,
                    source: property
                });

            }

        }

    }


    /*
    ------------------------------------------
    IMG elements
    ------------------------------------------
    */

    const imgRegex =
        /<img\b[^>]*>/gi;

    let match;

    while (
        (match = imgRegex.exec(html))
    ) {

        const tag =
            match[0];

        const srcMatch =
            tag.match(
                /\bsrc\s*=\s*["']([^"']+)["']/i
            );

        if (!srcMatch) {
            continue;
        }

        const altMatch =
            tag.match(
                /\balt\s*=\s*["']([^"']+)["']/i
            );

        const classMatch =
            tag.match(
                /\bclass\s*=\s*["']([^"']+)["']/i
            );

        const idMatch =
            tag.match(
                /\bid\s*=\s*["']([^"']+)["']/i
            );

        const descriptive =
            (
                `${altMatch?.[1] || ""} ` +
                `${classMatch?.[1] || ""} ` +
                `${idMatch?.[1] || ""}`
            )
                .toLowerCase();

        if (
            !(
                descriptive.includes("logo") ||
                descriptive.includes("brand") ||
                descriptive.includes("header")
            )
        ) {

            continue;
        }

        const url =
            normalizeUrl(
                srcMatch[1],
                baseUrl
            );

        if (url) {

            candidates.push({
                url,
                source: "img"
            });

        }

    }


    return candidates;

}


// ======================================================
// JSON-LD
// ======================================================

function extractJsonLdBlocks(html) {

    const blocks = [];

    const regex =
        /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

    let match;

    while (
        (match = regex.exec(html))
    ) {

        const raw =
            match[1]
                ?.trim();

        if (!raw) {
            continue;
        }

        try {

            const parsed =
                JSON.parse(raw);

            blocks.push(parsed);

        }

        catch {

            /*
            Some websites place invalid JSON-LD
            in the page. Ignore it safely.
            */

        }

    }

    return blocks;

}


// ======================================================
// FLATTEN JSON-LD
// ======================================================

function flattenJsonLd(
    value,
    output = []
) {

    if (!value) {
        return output;
    }

    if (Array.isArray(value)) {

        for (
            const item of value
        ) {

            flattenJsonLd(
                item,
                output
            );

        }

        return output;

    }

    if (
        typeof value !== "object"
    ) {

        return output;

    }

    output.push(value);

    if (
        Array.isArray(value["@graph"])
    ) {

        flattenJsonLd(
            value["@graph"],
            output
        );

    }

    return output;

}


// ======================================================
// SCHEMA TYPE
// ======================================================

function schemaHasType(
    object,
    wanted
) {

    const type =
        object?.["@type"];

    if (Array.isArray(type)) {

        return type.some(
            item =>
                String(item)
                    .toLowerCase() ===
                wanted.toLowerCase()
        );

    }

    return String(type || "")
        .toLowerCase() ===
        wanted.toLowerCase();

}


// ======================================================
// SCHEMA ORGANIZATION
// ======================================================

function extractSchemaIdentity(
    html,
    baseUrl
) {

    const blocks =
        extractJsonLdBlocks(
            html
        );

    const objects = [];

    for (
        const block of blocks
    ) {

        flattenJsonLd(
            block,
            objects
        );

    }


    let best = null;


    for (
        const object of objects
    ) {

        const type =
            String(
                object?.["@type"] || ""
            ).toLowerCase();

        const isOrganization =
            schemaHasType(
                object,
                "Organization"
            ) ||
            schemaHasType(
                object,
                "Corporation"
            ) ||
            schemaHasType(
                object,
                "BankOrCreditUnion"
            ) ||
            type.includes("organization");


        if (!isOrganization) {
            continue;
        }


        const name =
            String(
                object.name || ""
            ).trim();


        const url =
            normalizeUrl(
                typeof object.url === "string"
                    ? object.url
                    : "",
                baseUrl
            );


        let logo = "";

        if (
            typeof object.logo === "string"
        ) {

            logo =
                normalizeUrl(
                    object.logo,
                    baseUrl
                );

        }

        else if (
            object.logo &&
            typeof object.logo === "object"
        ) {

            logo =
                normalizeUrl(
                    object.logo.url ||
                    object.logo.contentUrl ||
                    "",
                    baseUrl
                );

        }


        const sameAs =
            Array.isArray(
                object.sameAs
            )
                ? object.sameAs
                    .map(
                        item =>
                            normalizeUrl(
                                item,
                                baseUrl
                            )
                    )
                    .filter(Boolean)
                : [];


        if (
            name ||
            url ||
            logo
        ) {

            best = {

                name,
                url,
                logo,
                sameAs

            };

            break;

        }

    }

    return best || {

        name: "",
        url: "",
        logo: "",
        sameAs: []

    };

}


// ======================================================
// DOMAIN
// ======================================================

function extractDomain(url) {

    try {

        return new URL(url)
            .hostname
            .toLowerCase()
            .replace(/^www\./, "");

    }

    catch {

        return "";

    }

}


// ======================================================
// REGISTRABLE DOMAIN
// ======================================================

function deriveRegistrableDomain(
    domain
) {

    if (!domain) {
        return "";
    }

    const parts =
        domain
            .split(".")
            .filter(Boolean);

    if (
        parts.length <= 2
    ) {

        return domain;

    }


    /*
    ------------------------------------------
    Common multi-part public suffixes.

    This is intentionally generic rather than
    brand-specific.
    ------------------------------------------
    */

    const knownTwoPartSuffixes = new Set([

        "co.uk",
        "org.uk",
        "ac.uk",
        "gov.uk",

        "com.au",
        "net.au",
        "org.au",

        "co.nz",
        "net.nz",
        "org.nz",

        "co.za",
        "org.za",

        "co.ke",
        "or.ke",
        "ne.ke",
        "go.ke",

        "com.ng",
        "com.gh",
        "com.tz",
        "co.tz",
        "co.ug",
        "or.ug",

        "com.br",
        "com.mx",
        "com.tr",
        "com.sg",
        "com.my",
        "com.ph",
        "com.hk",
        "com.cn",

        "co.in",
        "firm.in",
        "net.in",
        "org.in"

    ]);


    const lastTwo =
        parts
            .slice(-2)
            .join(".");


    if (
        knownTwoPartSuffixes.has(
            lastTwo
        )
    ) {

        return parts
            .slice(-3)
            .join(".");

    }


    return parts
        .slice(-2)
        .join(".");

}


// ======================================================
// DOMAIN IDENTITY
// ======================================================

function deriveDomainIdentityName(
    domain,
    registrableDomain
) {

    const value =
        registrableDomain ||
        domain ||
        "";

    const label =
        value
            .split(".")[0]
            .trim();

    return label
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, c =>
            c.toUpperCase()
        )
        .trim();

}


// ======================================================
// BRAND CLEANING
// ======================================================

function cleanBrandName(
    value
) {

    return String(value || "")
        .replace(/\s+/g, " ")
        .replace(
            /\s*[\-|–—|]\s*(official|home|homepage|website|site).*$/i,
            ""
        )
        .trim();

}


// ======================================================
// GENERIC WEBSITE NAMES
// ======================================================

function isGenericWebsiteName(
    value
) {

    const normalized =
        String(value || "")
            .toLowerCase()
            .trim();

    if (!normalized) {
        return true;
    }

    const genericTerms = [

        "home",
        "homepage",
        "welcome",
        "login",
        "log in",
        "sign in",
        "portal",
        "dashboard",
        "account",
        "business banking",
        "internet banking",
        "online banking",
        "customer portal",
        "article",
        "news",
        "latest news",
        "press release",
        "search",
        "results",
        "services",
        "service",
        "contact us",
        "about us"

    ];

    return genericTerms.some(
        term =>
            normalized === term ||
            normalized.startsWith(
                `${term} `
            )
    );

}


// ======================================================
// SEARCH RESULT BRAND
// ======================================================

function inferBrandFromSearchCandidate(
    candidate
) {

    const values = [

        candidate.title,
        candidate.snippet

    ]
        .map(
            cleanBrandName
        )
        .filter(Boolean);


    for (
        const value of values
    ) {

        if (
            !isGenericWebsiteName(
                value
            )
        ) {

            const cleaned =
                value
                    .split("|")[0]
                    .split(" - ")[0]
                    .split(" – ")[0]
                    .trim();

            if (
                cleaned &&
                !isGenericWebsiteName(
                    cleaned
                )
            ) {

                return cleaned;

            }

        }

    }

    return "";

}


// ======================================================
// SEARCH CANDIDATE
// ======================================================

function websiteFromSearchCandidate(
    candidate
) {

    const domain =
        extractDomain(
            candidate.url
        );

    const registrableDomain =
        deriveRegistrableDomain(
            domain
        );

    const inferredBrand =
        inferBrandFromSearchCandidate(
            candidate
        ) ||
        deriveDomainIdentityName(
            domain,
            registrableDomain
        );


    return {

        sourceUrl:
            candidate.url,

        domain,

        registrableDomain,

        brandName:
            cleanBrandName(
                inferredBrand
            ),

        logoUrl: "",

        faviconUrl: "",

        title:
            candidate.title || "",

        siteName: "",

        description:
            candidate.snippet || "",

        schemaName: "",

        schemaUrl: "",

        schemaLogo: "",

        schemaSameAs: [],

        canonicalUrl:
            candidate.url,

        phoneEvidence: []

    };

}


// ======================================================
// SEARCH ENGINES
// ======================================================

async function searchDuckDuckGo(
    query
) {

    try {

        const response =
            await axios.get(
                "https://html.duckduckgo.com/html/",
                {
                    params: {
                        q: query
                    },

                    headers: {

                        "User-Agent":
                            "Mozilla/5.0 ParentIQBot/1.0"

                    },

                    timeout: 10000,

                    maxContentLength:
                        MAX_HTML_BYTES

                }
            );


        const html =
            String(
                response.data || ""
            );


        const results = [];

        const resultRegex =
            /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

        let match;

        while (
            (match = resultRegex.exec(html))
        ) {

            const url =
                decodeHtml(
                    match[1]
                );

            const title =
                stripHtml(
                    match[2]
                );


            if (
                !url ||
                !/^https?:\/\//i.test(
                    url
                )
            ) {

                continue;

            }


            results.push({

                url,

                title,

                snippet: "",

                provider:
                    "duckduckgo"

            });


            if (
                results.length >=
                MAX_SEARCH_RESULTS
            ) {

                break;

            }

        }

        return results;

    }

    catch (error) {

        console.error(
            "[SMS BRAND] DuckDuckGo search failed:",
            error.message
        );

        return [];

    }

}


// ======================================================
// BING SEARCH
// ======================================================

async function searchBing(
    query
) {

    try {

        const response =
            await axios.get(
                "https://www.bing.com/search",
                {

                    params: {
                        q: query,
                        count:
                            MAX_SEARCH_RESULTS
                    },

                    headers: {

                        "User-Agent":
                            "Mozilla/5.0 ParentIQBot/1.0"

                    },

                    timeout: 10000,

                    maxContentLength:
                        MAX_HTML_BYTES

                }
            );


        const html =
            String(
                response.data || ""
            );


        const results = [];

        const regex =
            /<li[^>]*class="b_algo"[^>]*>[\s\S]*?<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?[\s\S]*?<\/li>/gi;

        let match;

        while (
            (match = regex.exec(html))
        ) {

            const url =
                decodeHtml(
                    match[1]
                );

            const title =
                stripHtml(
                    match[2]
                );

            const snippet =
                stripHtml(
                    match[3] || ""
                );


            if (
                !url ||
                !/^https?:\/\//i.test(
                    url
                )
            ) {

                continue;

            }


            results.push({

                url,

                title,

                snippet,

                provider:
                    "bing"

            });


            if (
                results.length >=
                MAX_SEARCH_RESULTS
            ) {

                break;

            }

        }

        return results;

    }

    catch (error) {

        console.error(
            "[SMS BRAND] Bing search failed:",
            error.message
        );

        return [];

    }

}


// ======================================================
// SEARCH
// ======================================================

async function searchBrand(
    sender
) {

    const queries = [

        `"${sender}" official`,

        `"${sender}" company`,

        `"${sender}" website`,

        `${sender} official website`

    ];


    const allResults = [];


    for (
        const query of queries
    ) {

        const [
            duck,
            bing
        ] =
            await Promise.all([

                searchDuckDuckGo(
                    query
                ),

                searchBing(
                    query
                )

            ]);


        allResults.push(
            ...duck,
            ...bing
        );

    }


    /*
    ------------------------------------------
    Deduplicate URLs
    ------------------------------------------
    */

    const seen =
        new Set();


    return allResults
        .filter(
            candidate => {

                const key =
                    candidate.url
                        .split("#")[0]
                        .replace(
                            /\/$/,
                            ""
                        )
                        .toLowerCase();

                if (
                    seen.has(key)
                ) {

                    return false;

                }

                seen.add(key);

                return true;

            }
        )
        .slice(
            0,
            MAX_SEARCH_RESULTS * 2
        );

}


// ======================================================
// WEBSITE INSPECTION
// ======================================================

async function inspectWebsite(
    candidate
) {

    const url =
        normalizeUrl(
            candidate.url
        );

    if (!url) {
        return null;
    }


    try {

        const response =
            await axios.get(
                url,
                {

                    headers: {

                        "User-Agent":
                            "Mozilla/5.0 ParentIQBot/1.0",

                        "Accept":
                            "text/html,application/xhtml+xml"

                    },

                    timeout: 12000,

                    maxContentLength:
                        MAX_HTML_BYTES,

                    maxBodyLength:
                        MAX_HTML_BYTES,

                    responseType:
                        "text",

                    validateStatus:
                        status =>
                            status >= 200 &&
                            status < 400

                }
            );


        const contentType =
            String(
                response.headers?.[
                    "content-type"
                ] || ""
            )
                .toLowerCase();


        if (
            contentType &&
            !contentType.includes(
                "text/html"
            ) &&
            !contentType.includes(
                "application/xhtml"
            )
        ) {

            return null;

        }


        const html =
            String(
                response.data || ""
            );


        if (
            !html
        ) {

            return null;

        }


        const finalUrl =
            response.request?.res
                ?.responseUrl ||
            url;


        const domain =
            extractDomain(
                finalUrl
            );

        const registrableDomain =
            deriveRegistrableDomain(
                domain
            );


        const title =
            extractTitle(
                html
            );


        const siteName =
            extractMetaContent(
                html,
                "og:site_name"
            );


        const description =
            extractMetaContent(
                html,
                "description"
            );


        const canonicalUrl =
            extractCanonicalUrl(
                html,
                finalUrl
            );


        const schema =
            extractSchemaIdentity(
                html,
                finalUrl
            );


        const iconCandidates =
            extractIconCandidates(
                html,
                finalUrl
            );


        const logoCandidates =
            extractLogoCandidates(
                html,
                finalUrl
            );


        /*
        ------------------------------------------
        Prefer schema organization logo.
        ------------------------------------------
        */

        let logoUrl =
            schema.logo || "";


        if (!logoUrl) {

            const preferredLogo =
                logoCandidates.find(
                    item =>
                        item.source ===
                        "og:logo"
                );

            logoUrl =
                preferredLogo?.url ||
                "";

        }


        if (!logoUrl) {

            const imageCandidate =
                logoCandidates.find(
                    item =>
                        item.source ===
                        "img"
                );

            logoUrl =
                imageCandidate?.url ||
                "";

        }


        /*
        ------------------------------------------
        Favicon
        ------------------------------------------
        */

        const favicon =
            iconCandidates.find(
                item =>
                    item.rel.includes(
                        "icon"
                    )
            )?.url || "";


        /*
        ------------------------------------------
        Website identity.
        ------------------------------------------
        */

        const brandName =
            cleanBrandName(

                schema.name ||

                siteName ||

                inferBrandFromSearchCandidate(
                    candidate
                ) ||

                (
                    !isGenericWebsiteName(
                        title
                    )
                        ? title
                        : ""
                ) ||

                deriveDomainIdentityName(
                    domain,
                    registrableDomain
                )

            );


        return {

            sourceUrl:
                candidate.url,

            domain,

            registrableDomain,

            brandName,

            logoUrl,

            faviconUrl:
                favicon,

            title,

            siteName,

            description,

            schemaName:
                schema.name,

            schemaUrl:
                schema.url,

            schemaLogo:
                schema.logo,

            schemaSameAs:
                schema.sameAs,

            canonicalUrl:
                canonicalUrl ||
                finalUrl,

            phoneEvidence: []

        };

    }

    catch (error) {

        console.error(
            "[SMS BRAND] Website inspection failed:",
            candidate.url,
            error.message
        );

        return null;

    }

}


// ======================================================
// IMAGE VALIDATION
// ======================================================

function looksLikeImageSignature(
    buffer
) {

    if (
        !Buffer.isBuffer(buffer) ||
        buffer.length < 4
    ) {

        return false;

    }


    /*
    PNG
    */

    if (
        buffer
            .subarray(0, 8)
            .equals(
                Buffer.from([
                    0x89,
                    0x50,
                    0x4e,
                    0x47,
                    0x0d,
                    0x0a,
                    0x1a,
                    0x0a
                ])
            )
    ) {

        return true;

    }


    /*
    JPEG
    */

    if (
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
    ) {

        return true;

    }


    /*
    GIF
    */

    const firstSix =
        buffer
            .subarray(
                0,
                6
            )
            .toString(
                "ascii"
            );

    if (
        firstSix === "GIF87a" ||
        firstSix === "GIF89a"
    ) {

        return true;

    }


    /*
    WEBP
    */

    if (
        buffer.length >= 12 &&
        buffer
            .subarray(0, 4)
            .toString("ascii") === "RIFF" &&
        buffer
            .subarray(8, 12)
            .toString("ascii") === "WEBP"
    ) {

        return true;

    }


    /*
    BMP
    */

    if (
        buffer[0] === 0x42 &&
        buffer[1] === 0x4d
    ) {

        return true;

    }


    /*
    ICO
    */

    if (
        buffer.length >= 4 &&
        buffer[0] === 0x00 &&
        buffer[1] === 0x00 &&
        buffer[2] === 0x01 &&
        buffer[3] === 0x00
    ) {

        return true;

    }


    /*
    AVIF / HEIF
    */

    if (
        buffer.length >= 12
    ) {

        const box =
            buffer
                .subarray(
                    4,
                    12
                )
                .toString(
                    "ascii"
                );

        if (
            box === "ftypavif" ||
            box === "ftypavis" ||
            box === "ftypheic" ||
            box === "ftypheix" ||
            box === "ftyphevc" ||
            box === "ftyphevx" ||
            box === "ftypmif1"
        ) {

            return true;

        }

    }


    return false;

}


// ======================================================
// REMOTE IMAGE VALIDATION
// ======================================================

async function validateRemoteImage(
    imageUrl
) {

    const url =
        normalizeUrl(
            imageUrl
        );

    if (!url) {
        return false;
    }


    try {

        const response =
            await axios.get(
                url,
                {

                    responseType:
                        "arraybuffer",

                    headers: {

                        "User-Agent":
                            "Mozilla/5.0 ParentIQBot/1.0",

                        "Accept":
                            "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"

                    },

                    timeout: 10000,

                    maxContentLength:
                        5 * 1024 * 1024,

                    maxBodyLength:
                        5 * 1024 * 1024,

                    validateStatus:
                        status =>
                            status >= 200 &&
                            status < 300

                }
            );


        const contentType =
            String(
                response.headers?.[
                    "content-type"
                ] || ""
            )
                .toLowerCase();


        /*
        SVG is deliberately rejected.

        It can be perfectly valid as a logo,
        but the Android side currently expects
        raster images and we want predictable
        validation.
        */

        if (
            contentType.includes(
                "svg"
            )
        ) {

            return false;

        }


        if (
            !contentType.startsWith(
                "image/"
            )
        ) {

            return false;

        }


        const buffer =
            Buffer.from(
                response.data
            );


        if (
            !buffer.length
        ) {

            return false;

        }


        if (
            buffer.length >
            5 * 1024 * 1024
        ) {

            return false;

        }


        return looksLikeImageSignature(
            buffer
        );

    }

    catch {

        return false;

    }

}


// ======================================================
// URL DOMAIN MATCH
// ======================================================

function sameRegistrableDomain(
    urlA,
    urlB
) {

    const a =
        deriveRegistrableDomain(
            extractDomain(
                urlA
            )
        );

    const b =
        deriveRegistrableDomain(
            extractDomain(
                urlB
            )
        );

    return Boolean(
        a &&
        b &&
        a === b
    );

}


// ======================================================
// SEARCH CANDIDATE SCORE
// ======================================================

function scoreSearchCandidate(
    candidate,
    sender
) {

    const senderNormalized =
        normalizeSender(
            sender
        );

    const candidateText =
        `${candidate.title || ""} ${candidate.snippet || ""}`
            .toLowerCase();


    let score = 0;


    /*
    Exact sender occurrence.
    */

    if (
        candidateText.includes(
            senderNormalized
        )
    ) {

        score += 0.20;

    }


    /*
    Official/company indicators.
    */

    if (
        /\bofficial\b/i.test(
            candidateText
        )
    ) {

        score += 0.15;

    }


    if (
        /\b(company|corporation|bank|telecom|mobile|government|ministry|agency)\b/i.test(
            candidateText
        )
    ) {

        score += 0.08;

    }


    /*
    Search providers are only discovery evidence.
    Never let a search result alone produce a
    high-confidence verified result.
    */

    return Math.min(
        score,
        0.45
    );

}


// ======================================================
// WEBSITE SCORE
// ======================================================

async function scoreWebsiteCandidate(
    website,
    sender,
    searchCandidate
) {

    const senderNormalized =
        normalizeSender(
            sender
        );


    let score = 0;


    const brand =
        normalizeSender(
            website.brandName
        );


    const domain =
        normalizeSender(
            website.registrableDomain
        );


    /*
    ------------------------------------------
    Brand name similarity
    ------------------------------------------
    */

    if (
        brand ===
        senderNormalized
    ) {

        score += 0.35;

    }

    else if (
        brand.includes(
            senderNormalized
        ) ||
        senderNormalized.includes(
            brand
        )
    ) {

        score += 0.20;

    }


    /*
    ------------------------------------------
    Domain identity
    ------------------------------------------
    */

    if (
        domain
            .replace(/\./g, "")
            .includes(
                senderNormalized
            )
    ) {

        score += 0.25;

    }


    /*
    ------------------------------------------
    Search result identity
    ------------------------------------------
    */

    score +=
        scoreSearchCandidate(
            searchCandidate,
            sender
        ) *
        0.50;


    /*
    ------------------------------------------
    Canonical domain consistency
    ------------------------------------------
    */

    if (
        sameRegistrableDomain(
            website.canonicalUrl,
            website.sourceUrl
        )
    ) {

        score += 0.05;

    }


    /*
    ------------------------------------------
    Schema organization
    ------------------------------------------
    */

    if (
        website.schemaName
    ) {

        score += 0.15;

    }


    if (
        website.schemaUrl &&
        sameRegistrableDomain(
            website.schemaUrl,
            website.sourceUrl
        )
    ) {

        score += 0.10;

    }


    /*
    ------------------------------------------
    Logo evidence.

    A logo by itself is NOT identity proof.
    ------------------------------------------
    */

    let verifiedLogo = false;


    if (
        website.schemaLogo
    ) {

        verifiedLogo =
            await validateRemoteImage(
                website.schemaLogo
            );

    }


    if (
        !verifiedLogo &&
        website.logoUrl
    ) {

        verifiedLogo =
            await validateRemoteImage(
                website.logoUrl
            );

    }


    /*
    Favicon is weaker evidence.
    */

    let verifiedFavicon = false;

    if (
        website.faviconUrl
    ) {

        verifiedFavicon =
            await validateRemoteImage(
                website.faviconUrl
            );

    }


    if (
        verifiedLogo
    ) {

        score += 0.10;

    }


    if (
        verifiedFavicon
    ) {

        score += 0.04;

    }


    /*
    ------------------------------------------
    sameAs social/official identities
    ------------------------------------------
    */

    if (
        website.schemaSameAs?.length
    ) {

        score += 0.05;

    }


    return {

        score:
            Math.min(
                score,
                1
            ),

        verifiedLogo,

        verifiedFavicon

    };

}


// ======================================================
// BEST BRAND CANDIDATE
// ======================================================

async function findBestCandidate(
    sender,
    candidates
) {

    const scored = [];


    for (
        const candidate of candidates
    ) {

        const website =
            await inspectWebsite(
                candidate
            );


        if (!website) {
            continue;
        }


        const score =
            await scoreWebsiteCandidate(
                website,
                sender,
                candidate
            );


        scored.push({

            website,

            candidate,

            score:
                score.score,

            verifiedLogo:
                score.verifiedLogo,

            verifiedFavicon:
                score.verifiedFavicon

        });

    }


    scored.sort(
        (a, b) =>
            b.score -
            a.score
    );


    return scored[0] || null;

}


// ======================================================
// CACHE KEY
// ======================================================

function cacheKey(
    sender
) {

    return normalizeSender(
        sender
    )
        .replace(
            /[^a-z0-9._-]/g,
            "_"
        );

}


// ======================================================
// MEMORY CACHE
// ======================================================

function getMemoryCache(
    sender
) {

    const key =
        cacheKey(sender);

    const value =
        memoryCache.get(
            key
        );


    if (!value) {
        return null;
    }


    /*
    Don't use stale in-memory entries.
    */

    if (
        value.cachedAt &&
        Date.now() -
            value.cachedAt >
            VERIFIED_CACHE_TTL
    ) {

        memoryCache.delete(
            key
        );

        return null;

    }


    return value;

}


// ======================================================
// FIREBASE CACHE
// ======================================================

async function getFirebaseCache(
    sender
) {

    const key =
        cacheKey(
            sender
        );


    const snapshot =
        await db
            .ref(CACHE_PATH)
            .child(key)
            .get();


    if (
        !snapshot.exists()
    ) {

        return null;

    }


    const value =
        snapshot.val();


    /*
    A successful verified result can be
    returned immediately.
    */

    if (
        value.status ===
        "FOUND"
    ) {

        if (
            value.cachedAt &&
            Date.now() -
                value.cachedAt >
                VERIFIED_CACHE_TTL
        ) {

            return null;

        }

        return value;

    }


    /*
    Preserve active discovery state.
    */

    if (
        value.status ===
        "DISCOVERING"
    ) {

        if (
            value.discoveryStartedAt &&
            Date.now() -
                value.discoveryStartedAt <
                DISCOVERY_LOCK_TTL
        ) {

            return value;

        }

    }


    return value;

}


// ======================================================
// SAVE CACHE
// ======================================================

async function saveCache(
    sender,
    value
) {

    const key =
        cacheKey(
            sender
        );


    const data = {

        senderKey:
            normalizeSender(
                sender
            ),

        ...value,

        updatedAt:
            Date.now()

    };


    await db
        .ref(CACHE_PATH)
        .child(key)
        .set(
            data
        );


    if (
        data.status ===
        "FOUND"
    ) {

        memoryCache.set(
            key,
            data
        );

    }


    return data;

}


// ======================================================
// DISCOVERY LOCK
// ======================================================

async function acquireDiscoveryLock(
    sender
) {

    const key =
        cacheKey(
            sender
        );


    const ref =
        db
            .ref(CACHE_PATH)
            .child(key);


    let acquired = false;


    await ref.transaction(
        current => {

            const now =
                Date.now();


            if (
                current &&
                current.status ===
                    "FOUND" &&
                current.cachedAt &&
                now -
                    current.cachedAt <
                    VERIFIED_CACHE_TTL
            ) {

                return;

            }


            if (
                current &&
                current.status ===
                    "DISCOVERING" &&
                current.discoveryStartedAt &&
                now -
                    current.discoveryStartedAt <
                    DISCOVERY_LOCK_TTL
            ) {

                return;

            }


            acquired = true;


            return {

                senderKey:
                    normalizeSender(
                        sender
                    ),

                status:
                    "DISCOVERING",

                brandName: "",

                logoUrl: "",

                faviconUrl: "",

                confidence: 0,

                verified: false,

                discoveryStartedAt:
                    now,

                updatedAt:
                    now

            };

        }
    );


    return acquired;

}


// ======================================================
// DISCOVER
// ======================================================

async function discoverBrand(
    sender
) {

    const normalized =
        normalizeSender(
            sender
        );


    if (!normalized) {

        return {

            status:
                "UNKNOWN",

            brandName: "",

            logoUrl: "",

            faviconUrl: "",

            confidence: 0,

            verified: false

        };

    }


    console.log(
        `[SMS BRAND] Starting discovery for "${normalized}"`
    );


    try {

        const candidates =
            await searchBrand(
                normalized
            );


        if (
            !candidates.length
        ) {

            return await saveCache(
                normalized,
                {

                    status:
                        "UNKNOWN",

                    brandName: "",

                    logoUrl: "",

                    faviconUrl: "",

                    confidence: 0,

                    verified: false,

                    lastAttemptAt:
                        Date.now()

                }
            );

        }


        const best =
            await findBestCandidate(
                normalized,
                candidates
            );


        if (!best) {

            return await saveCache(
                normalized,
                {

                    status:
                        "UNKNOWN",

                    brandName: "",

                    logoUrl: "",

                    faviconUrl: "",

                    confidence: 0,

                    verified: false,

                    lastAttemptAt:
                        Date.now()

                }
            );

        }


        /*
        ------------------------------------------
        FINAL IDENTITY CHECK
        ------------------------------------------

        A valid image is NOT enough.

        Require strong identity evidence.
        ------------------------------------------
        */

        const confidence =
            Number(
                best.score.toFixed(2)
            );


        const verified =
            confidence >= 0.80 &&
            Boolean(
                best.website.brandName
            ) &&
            (
                best.verifiedLogo ||
                best.verifiedFavicon ||
                Boolean(
                    best.website.schemaName
                )
            );


        if (!verified) {

            console.log(
                `[SMS BRAND] Candidate rejected for "${normalized}". Confidence=${confidence}`
            );


            return await saveCache(
                normalized,
                {

                    status:
                        "UNKNOWN",

                    brandName: "",

                    logoUrl: "",

                    faviconUrl: "",

                    confidence,

                    verified: false,

                    sourceDomain:
                        best.website.domain,

                    canonicalUrl:
                        best.website.canonicalUrl,

                    lastAttemptAt:
                        Date.now()

                }
            );

        }


        /*
        ------------------------------------------
        Logo selection.

        Prefer a verified actual logo.
        ------------------------------------------
        */

        let logoUrl = "";


        if (
            best.verifiedLogo &&
            best.website.logoUrl
        ) {

            logoUrl =
                best.website.logoUrl;

        }


        /*
        If schema logo was the verified one,
        use that.
        */

        if (
            best.verifiedLogo &&
            best.website.schemaLogo
        ) {

            const schemaValid =
                await validateRemoteImage(
                    best.website.schemaLogo
                );

            if (
                schemaValid
            ) {

                logoUrl =
                    best.website.schemaLogo;

            }

        }


        const faviconUrl =
            best.verifiedFavicon
                ? best.website.faviconUrl
                : "";


        const result = {

            status:
                "FOUND",

            brandName:
                best.website.brandName,

            logoUrl,

            faviconUrl,

            confidence,

            verified: true,

            sourceDomain:
                best.website.domain,

            registrableDomain:
                best.website.registrableDomain,

            canonicalUrl:
                best.website.canonicalUrl,

            schemaName:
                best.website.schemaName,

            schemaUrl:
                best.website.schemaUrl,

            schemaLogo:
                best.website.schemaLogo,

            schemaSameAs:
                best.website.schemaSameAs,

            lastVerifiedAt:
                Date.now(),

            cachedAt:
                Date.now()

        };


        console.log(
            `[SMS BRAND] FOUND "${normalized}" -> "${result.brandName}" confidence=${confidence}`
        );


        return await saveCache(
            normalized,
            result
        );

    }

    catch (error) {

        console.error(
            `[SMS BRAND] Discovery failed for "${normalized}":`,
            error
        );


        return await saveCache(
            normalized,
            {

                status:
                    "UNKNOWN",

                brandName: "",

                logoUrl: "",

                faviconUrl: "",

                confidence: 0,

                verified: false,

                error:
                    error.message,

                lastAttemptAt:
                    Date.now()

            }
        );

    }

}


// ======================================================
// PUBLIC RESOLVE
// ======================================================

async function resolveSender(
    sender
) {

    const normalized =
        normalizeSender(
            sender
        );


    if (!normalized) {

        return {

            status:
                "UNKNOWN",

            brandName: "",

            logoUrl: "",

            faviconUrl: "",

            confidence: 0,

            verified: false

        };

    }


    /*
    ------------------------------------------
    1. Memory cache
    ------------------------------------------
    */

    const memory =
        getMemoryCache(
            normalized
        );


    if (
        memory
    ) {

        return memory;

    }


    /*
    ------------------------------------------
    2. Firebase cache
    ------------------------------------------
    */

    const cached =
        await getFirebaseCache(
            normalized
        );


    if (
        cached &&
        (
            cached.status ===
                "FOUND" ||
            cached.status ===
                "DISCOVERING"
        )
    ) {

        if (
            cached.status ===
            "FOUND"
        ) {

            memoryCache.set(
                cacheKey(
                    normalized
                ),
                cached
            );

        }

        return cached;

    }


    /*
    ------------------------------------------
    3. Acquire discovery lock
    ------------------------------------------
    */

    const acquired =
        await acquireDiscoveryLock(
            normalized
        );


    if (
        !acquired
    ) {

        const current =
            await getFirebaseCache(
                normalized
            );


        return current || {

            status:
                "DISCOVERING",

            brandName: "",

            logoUrl: "",

            faviconUrl: "",

            confidence: 0,

            verified: false

        };

    }


    /*
    ------------------------------------------
    4. Start discovery asynchronously.

    Do NOT make the Android request wait
    through all search engines and websites.
    ------------------------------------------
    */

    setImmediate(
        () => {

            discoverBrand(
                normalized
            )
                .catch(
                    error => {

                        console.error(
                            "[SMS BRAND] Background discovery error:",
                            error
                        );

                    }
                );

        }
    );


    return {

        status:
            "DISCOVERING",

        brandName: "",

        logoUrl: "",

        faviconUrl: "",

        confidence: 0,

        verified: false

    };

}


// ======================================================
// EXPORTS
// ======================================================

module.exports = {

    resolveSender,

    discoverBrand,

    normalizeSender

};


// ======================================================
// HELPER
// ======================================================

function escapeRegex(
    value
) {

    return String(value || "")
        .replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
        );

}