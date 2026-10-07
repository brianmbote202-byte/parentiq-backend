const axios = require("axios");
const { db } = require("../firebase");


// ============================================================
// CONFIGURATION
// ============================================================

const CACHE_PATH = "sms_brand_cache";

const VERIFIED_CACHE_TTL =
    Number(process.env.SMS_BRAND_CACHE_TTL_MS) ||
    30 * 24 * 60 * 60 * 1000;

const UNKNOWN_CACHE_TTL =
    Number(process.env.SMS_BRAND_UNKNOWN_CACHE_TTL_MS) ||
    6 * 60 * 60 * 1000;

const DISCOVERY_LOCK_TTL =
    Number(process.env.SMS_BRAND_DISCOVERY_LOCK_TTL_MS) ||
    5 * 60 * 1000;

const MAX_SEARCH_RESULTS = 12;

const MAX_CANDIDATES_TO_INSPECT = 6;

const MAX_HTML_BYTES =
    2 * 1024 * 1024;

const MAX_IMAGE_BYTES =
    5 * 1024 * 1024;

const BING_TIMEOUT =
    Number(process.env.SMS_BRAND_BING_TIMEOUT_MS) ||
    7000;

const DDG_TIMEOUT =
    Number(process.env.SMS_BRAND_DDG_TIMEOUT_MS) ||
    4500;


// ============================================================
// MEMORY CACHE
// ============================================================

const memoryCache = new Map();


// ============================================================
// SEARCH ENGINE / NON-BRAND DOMAINS
// ============================================================

const BLOCKED_REGISTRABLE_DOMAINS = new Set([
    "google.com",
    "google.co.uk",
    "google.co.ke",

    "bing.com",

    "duckduckgo.com",

    "yahoo.com",
    "yahoo.co.uk",

    "baidu.com",

    "yandex.com",
    "yandex.ru",

    "ask.com",

    "aol.com",

    "ecosia.org",

    "wikipedia.org",
    "wikimedia.org",

    "facebook.com",
    "instagram.com",

    "linkedin.com",

    "twitter.com",
    "x.com",

    "youtube.com",

    "tiktok.com",

    "reddit.com",

    "pinterest.com"
]);


// ============================================================
// GENERIC HELPERS
// ============================================================

function normalizeSender(sender) {

    return String(sender || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[^a-z0-9._ -]/g, "")
        .trim();
}


function senderKey(sender) {

    return normalizeSender(sender)
        .replace(/[^a-z0-9]/g, "");
}


function decodeHtmlEntities(value) {

    return String(value || "")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#x2F;/gi, "/")
        .replace(/&#47;/gi, "/")
        .replace(/&#x27;/gi, "'")
        .replace(/&#34;/gi, '"');
}


function stripHtml(value) {

    return decodeHtmlEntities(
        String(value || "")
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
    )
        .replace(/\s+/g, " ")
        .trim();
}


function cleanText(value) {

    return stripHtml(value)
        .replace(/\s+/g, " ")
        .trim();
}


function safeUrl(rawUrl, baseUrl = null) {

    try {

        if (!rawUrl) {
            return null;
        }

        let value =
            decodeHtmlEntities(
                String(rawUrl).trim()
            );

        if (!value) {
            return null;
        }

        if (
            value.startsWith("//")
        ) {
            value = "https:" + value;
        }

        if (
            baseUrl &&
            !/^https?:\/\//i.test(value)
        ) {

            value =
                new URL(
                    value,
                    baseUrl
                ).href;
        }

        const parsed =
            new URL(value);

        if (
            parsed.protocol !== "http:" &&
            parsed.protocol !== "https:"
        ) {
            return null;
        }

        return parsed.href;

    } catch {

        return null;
    }
}


function hostnameFromUrl(url) {

    try {

        return new URL(url)
            .hostname
            .toLowerCase()
            .replace(/^www\./, "");

    } catch {

        return "";
    }
}


function getRegistrableDomain(hostname) {

    const host =
        String(hostname || "")
            .toLowerCase()
            .replace(/^www\./, "");

    if (!host) {
        return "";
    }

    const parts =
        host.split(".")
            .filter(Boolean);

    if (parts.length <= 2) {
        return host;
    }

    const secondLevelTlds = new Set([
        "co.uk",
        "org.uk",
        "ac.uk",

        "co.ke",
        "or.ke",
        "ne.ke",

        "co.tz",
        "or.tz",

        "co.ug",
        "or.ug",

        "co.rw",
        "or.rw",

        "co.za",

        "co.ng",
        "com.ng",

        "co.gh",
        "com.gh",

        "com.au",
        "net.au",
        "org.au",

        "co.nz",

        "co.in",

        "com.sg",

        "com.my",

        "com.mx",

        "com.br",

        "com.tr",

        "com.ar"
    ]);

    const lastTwo =
        parts.slice(-2).join(".");

    if (
        secondLevelTlds.has(lastTwo) &&
        parts.length >= 3
    ) {

        return parts
            .slice(-3)
            .join(".");
    }

    return parts
        .slice(-2)
        .join(".");
}


function registrableDomainFromUrl(url) {

    return getRegistrableDomain(
        hostnameFromUrl(url)
    );
}


function isBlockedDomain(url) {

    const domain =
        registrableDomainFromUrl(url);

    if (!domain) {
        return true;
    }

    return BLOCKED_REGISTRABLE_DOMAINS
        .has(domain);
}


function isUsableExternalUrl(url) {

    if (!url) {
        return false;
    }

    try {

        const parsed =
            new URL(url);

        if (
            parsed.protocol !== "http:" &&
            parsed.protocol !== "https:"
        ) {
            return false;
        }

        if (
            isBlockedDomain(url)
        ) {
            return false;
        }

        return true;

    } catch {

        return false;
    }
}


// ============================================================
// BRAND NAME CLEANING
// ============================================================

function cleanBrandName(value) {

    let text =
        cleanText(value);

    if (!text) {
        return "";
    }

    text =
        text
            .replace(/\s+/g, " ")
            .trim();

    text =
        text
            .replace(
                /\s*[-|–—:]\s*(official|home|homepage|website|contact|login|sign in).*$/i,
                ""
            )
            .trim();

    text =
        text
            .replace(
                /\s+(official website|official site)$/i,
                ""
            )
            .trim();

    if (
        text.length > 100
    ) {
        text =
            text.substring(0, 100)
                .trim();
    }

    return text;
}


function normalizeComparableText(value) {

    return cleanText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}


// ============================================================
// HTML EXTRACTION
// ============================================================

function extractTitle(html) {

    const match =
        String(html || "")
            .match(
                /<title[^>]*>([\s\S]*?)<\/title>/i
            );

    if (!match) {
        return "";
    }

    return cleanBrandName(
        match[1]
    );
}


function extractCanonical(html, baseUrl) {

    const match =
        String(html || "")
            .match(
                /<link\b[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*>/i
            );

    if (!match) {
        return "";
    }

    const href =
        match[0].match(
            /\bhref=["']([^"']+)["']/i
        );

    if (!href) {
        return "";
    }

    return safeUrl(
        href[1],
        baseUrl
    ) || "";
}


function extractMetaContent(
    html,
    names
) {

    const wanted =
        new Set(
            names.map(
                value =>
                    String(value)
                        .toLowerCase()
            )
        );

    const regex =
        /<meta\b[^>]*>/gi;

    let match;

    while (
        (match = regex.exec(html || "")) !== null
    ) {

        const tag =
            match[0];

        const nameMatch =
            tag.match(
                /\b(?:name|property|itemprop)=["']([^"']+)["']/i
            );

        if (!nameMatch) {
            continue;
        }

        const name =
            nameMatch[1]
                .toLowerCase()
                .trim();

        if (
            !wanted.has(name)
        ) {
            continue;
        }

        const contentMatch =
            tag.match(
                /\bcontent=["']([^"']+)["']/i
            );

        if (
            contentMatch
        ) {
            return decodeHtmlEntities(
                contentMatch[1]
            ).trim();
        }
    }

    return "";
}


// ============================================================
// JSON-LD
// ============================================================

function extractJsonLdObjects(html) {

    const results = [];

    const regex =
        /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

    let match;

    while (
        (match = regex.exec(html || "")) !== null
    ) {

        const raw =
            match[1]
                .trim();

        if (!raw) {
            continue;
        }

        try {

            const parsed =
                JSON.parse(raw);

            if (
                Array.isArray(parsed)
            ) {

                for (
                    const item of parsed
                ) {

                    if (
                        item &&
                        typeof item === "object"
                    ) {

                        results.push(item);
                    }
                }

            } else if (
                parsed &&
                typeof parsed === "object"
            ) {

                results.push(parsed);
            }

        } catch {
            // Ignore malformed JSON-LD.
        }
    }

    return results;
}


function extractJsonLdIdentity(
    objects
) {

    let name = "";
    let url = "";
    let logo = "";

    for (
        const object of objects
    ) {

        if (!object) {
            continue;
        }

        const types =
            Array.isArray(object["@type"])
                ? object["@type"]
                : [object["@type"]];

        const normalizedTypes =
            types
                .filter(Boolean)
                .map(
                    type =>
                        String(type)
                            .toLowerCase()
                );

        const isOrganization =
            normalizedTypes.some(
                type =>
                    type.includes("organization") ||
                    type.includes("corporation") ||
                    type.includes("brand") ||
                    type === "localbusiness"
            );

        if (
            !isOrganization
        ) {
            continue;
        }

        if (
            !name &&
            typeof object.name === "string"
        ) {

            name =
                cleanBrandName(
                    object.name
                );
        }

        if (
            !url &&
            typeof object.url === "string"
        ) {

            url =
                object.url.trim();
        }

        if (
            !logo
        ) {

            if (
                typeof object.logo === "string"
            ) {

                logo =
                    object.logo.trim();

            } else if (
                object.logo &&
                typeof object.logo === "object" &&
                typeof object.logo.url === "string"
            ) {

                logo =
                    object.logo.url.trim();
            }
        }
    }

    return {
        name,
        url,
        logo
    };
}


// ============================================================
// IMAGE / ICON EXTRACTION
// ============================================================

function extractIconCandidates(
    html,
    baseUrl
) {

    const candidates = [];

    const regex =
        /<link\b[^>]*>/gi;

    let match;

    while (
        (match = regex.exec(html || "")) !== null
    ) {

        const tag =
            match[0];

        const relMatch =
            tag.match(
                /\brel=["']([^"']+)["']/i
            );

        const hrefMatch =
            tag.match(
                /\bhref=["']([^"']+)["']/i
            );

        if (
            !relMatch ||
            !hrefMatch
        ) {
            continue;
        }

        const rel =
            relMatch[1]
                .toLowerCase();

        if (
            !(
                rel.includes("icon") ||
                rel.includes("shortcut")
            )
        ) {
            continue;
        }

        const url =
            safeUrl(
                hrefMatch[1],
                baseUrl
            );

        if (url) {
            candidates.push(url);
        }
    }

    return [
        ...new Set(candidates)
    ];
}


function extractLogoCandidates(
    html,
    baseUrl
) {

    const candidates = [];

    const metaLogo =
        extractMetaContent(
            html,
            [
                "og:logo",
                "logo"
            ]
        );

    if (metaLogo) {

        const url =
            safeUrl(
                metaLogo,
                baseUrl
            );

        if (url) {
            candidates.push(url);
        }
    }


    const regex =
        /<img\b[^>]*>/gi;

    let match;

    while (
        (match = regex.exec(html || "")) !== null
    ) {

        const tag =
            match[0];

        const srcMatch =
            tag.match(
                /\bsrc=["']([^"']+)["']/i
            );

        if (!srcMatch) {
            continue;
        }

        const descriptor =
            [
                tag.match(
                    /\balt=["']([^"']+)["']/i
                )?.[1] || "",

                tag.match(
                    /\bclass=["']([^"']+)["']/i
                )?.[1] || "",

                tag.match(
                    /\bid=["']([^"']+)["']/i
                )?.[1] || "",

                srcMatch[1]
            ]
                .join(" ")
                .toLowerCase();

        if (
            !/\b(logo|brand|wordmark|logotype)\b/i.test(
                descriptor
            )
        ) {
            continue;
        }

        const url =
            safeUrl(
                srcMatch[1],
                baseUrl
            );

        if (url) {
            candidates.push(url);
        }
    }

    return [
        ...new Set(candidates)
    ];
}


// ============================================================
// IMAGE VALIDATION
// ============================================================

async function validateImageUrl(
    url
) {

    if (
        !isUsableExternalUrl(url)
    ) {
        return false;
    }

    try {

        const response =
            await axios.get(
                url,
                {
                    timeout: 5000,
                    maxContentLength:
                        MAX_IMAGE_BYTES,
                    maxBodyLength:
                        MAX_IMAGE_BYTES,
                    responseType: "arraybuffer",
                    validateStatus:
                        status =>
                            status >= 200 &&
                            status < 400
                }
            );

        const contentType =
            String(
                response.headers[
                    "content-type"
                ] || ""
            )
                .toLowerCase();

        if (
            contentType.startsWith(
                "image/"
            )
        ) {
            return true;
        }

        return false;

    } catch {

        return false;
    }
}


async function findVerifiedImage(
    candidates
) {

    const unique =
        [
            ...new Set(
                candidates
                    .filter(Boolean)
            )
        ];

    for (
        const url of unique
    ) {

        if (
            await validateImageUrl(url)
        ) {

            return url;
        }
    }

    return "";
}


// ============================================================
// SEARCH RESULT URL NORMALIZATION
// ============================================================

function normalizeSearchResultUrl(
    rawUrl,
    engine
) {

    if (!rawUrl) {
        return null;
    }

    let url =
        safeUrl(rawUrl);

    if (!url) {
        return null;
    }


    // DuckDuckGo redirect URL.
    try {

        const parsed =
            new URL(url);

        if (
            engine === "duckduckgo" &&
            parsed.hostname
                .toLowerCase()
                .includes("duckduckgo.com") &&
            parsed.pathname === "/l/"
        ) {

            const redirected =
                parsed.searchParams.get(
                    "uddg"
                );

            if (redirected) {

                url =
                    safeUrl(
                        decodeURIComponent(
                            redirected
                        )
                    );
            }
        }

    } catch {
        return null;
    }


    if (
        !url
    ) {
        return null;
    }


    if (
        !isUsableExternalUrl(url)
    ) {
        return null;
    }


    return url;
}


// ============================================================
// SEARCH RESULT PARSERS
// ============================================================

function parseBingResults(
    html
) {

    const results = [];

    const regex =
        /<li\b[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;

    let match;

    while (
        (match = regex.exec(html || "")) !== null
    ) {

        const block =
            match[1];

        const linkMatch =
            block.match(
                /<h2\b[^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
            );

        if (!linkMatch) {
            continue;
        }

        const rawUrl =
            linkMatch[1];

        const title =
            cleanText(
                linkMatch[2]
            );

        const snippetMatch =
            block.match(
                /<p\b[^>]*>([\s\S]*?)<\/p>/i
            );

        const snippet =
            snippetMatch
                ? cleanText(
                    snippetMatch[1]
                )
                : "";

        const url =
            normalizeSearchResultUrl(
                rawUrl,
                "bing"
            );

        if (!url) {
            continue;
        }

        results.push({
            url,
            title,
            snippet,
            engine: "bing"
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


function parseDuckDuckGoResults(
    html
) {

    const results = [];

    const regex =
        /<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let match;

    while (
        (match = regex.exec(html || "")) !== null
    ) {

        const rawUrl =
            match[1];

        const title =
            cleanText(
                match[2]
            );

        const after =
            html.substring(
                match.index
            );

        const snippetMatch =
            after.match(
                /class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i
            );

        const snippet =
            snippetMatch
                ? cleanText(
                    snippetMatch[1]
                )
                : "";

        const url =
            normalizeSearchResultUrl(
                rawUrl,
                "duckduckgo"
            );

        if (!url) {
            continue;
        }

        results.push({
            url,
            title,
            snippet,
            engine: "duckduckgo"
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


// ============================================================
// SEARCH ENGINE CALLS
// ============================================================

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
                        count: 10
                    },

                    timeout:
                        BING_TIMEOUT,

                    maxContentLength:
                        MAX_HTML_BYTES,

                    maxBodyLength:
                        MAX_HTML_BYTES,

                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
                        "Accept":
                            "text/html,application/xhtml+xml"
                    }
                }
            );

        return parseBingResults(
            response.data
        );

    } catch (error) {

        console.error(
            "[SMS BRAND] Bing search failed:",
            error.message
        );

        return [];
    }
}


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

                    timeout:
                        DDG_TIMEOUT,

                    maxContentLength:
                        MAX_HTML_BYTES,

                    maxBodyLength:
                        MAX_HTML_BYTES,

                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
                        "Accept":
                            "text/html,application/xhtml+xml"
                    }
                }
            );

        return parseDuckDuckGoResults(
            response.data
        );

    } catch (error) {

        console.error(
            "[SMS BRAND] DuckDuckGo search failed:",
            error.message
        );

        return [];
    }
}


// ============================================================
// SEARCH CANDIDATE SCORING
// ============================================================

function scoreSearchCandidate(
    candidate,
    sender
) {

    const normalizedSender =
        senderKey(sender);

    const domain =
        registrableDomainFromUrl(
            candidate.url
        );

    if (!domain) {
        return 0;
    }

    const domainParts =
        domain.split(".");

    const domainName =
        domainParts[0] || "";

    const normalizedDomain =
        normalizeComparableText(
            domainName
        );

    const title =
        normalizeComparableText(
            candidate.title
        );

    const snippet =
        normalizeComparableText(
            candidate.snippet
        );

    let score = 0;


    // Exact domain brand match.
    if (
        normalizedDomain ===
        normalizedSender
    ) {

        score += 0.50;

    } else if (
        normalizedDomain.includes(
            normalizedSender
        )
    ) {

        score += 0.30;
    }


    // Exact title match.
    if (
        title ===
        normalizedSender
    ) {

        score += 0.35;

    } else if (
        title.includes(
            normalizedSender
        )
    ) {

        score += 0.20;
    }


    // Search snippet relevance.
    if (
        snippet.includes(
            normalizedSender
        )
    ) {

        score += 0.10;
    }


    // Official wording is useful.
    if (
        title.includes("official") ||
        snippet.includes("official")
    ) {

        score += 0.05;
    }


    return Math.min(
        score,
        1
    );
}


// ============================================================
// SEARCH CANDIDATE DEDUPLICATION
// ============================================================

function dedupeSearchCandidates(
    candidates,
    sender
) {

    const byDomain =
        new Map();

    for (
        const candidate of candidates
    ) {

        if (
            !candidate ||
            !candidate.url
        ) {
            continue;
        }


        if (
            !isUsableExternalUrl(
                candidate.url
            )
        ) {
            continue;
        }


        const domain =
            registrableDomainFromUrl(
                candidate.url
            );

        if (!domain) {
            continue;
        }


        const searchScore =
            scoreSearchCandidate(
                candidate,
                sender
            );


        const existing =
            byDomain.get(
                domain
            );


        if (
            !existing ||
            searchScore >
                existing.searchScore
        ) {

            byDomain.set(
                domain,
                {
                    ...candidate,
                    searchScore
                }
            );
        }
    }


    return [
        ...byDomain.values()
    ]
        .sort(
            (a, b) =>
                b.searchScore -
                a.searchScore
        )
        .slice(
            0,
            MAX_SEARCH_RESULTS
        );
}


// ============================================================
// SEARCH
// ============================================================

async function searchBrand(
    sender
) {

    const queries = [
        `"${sender}" official`,
        `"${sender}" official website`,
        `${sender} company`,
        `${sender} brand`
    ];


    console.log(
        `[SMS BRAND] Running ${queries.length * 2} search requests for "${sender}"`
    );


    const tasks = [];


    for (
        const query of queries
    ) {

        tasks.push(
            searchBing(query)
        );

        tasks.push(
            searchDuckDuckGo(query)
        );
    }


    const settled =
        await Promise.allSettled(
            tasks
        );


    const rawCandidates = [];


    for (
        const result of settled
    ) {

        if (
            result.status ===
            "fulfilled"
        ) {

            rawCandidates.push(
                ...result.value
            );
        }
    }


    const uniqueCandidates =
        dedupeSearchCandidates(
            rawCandidates,
            sender
        );


    console.log(
        `[SMS BRAND] Search produced ${rawCandidates.length} raw candidates, ${uniqueCandidates.length} valid external candidates`
    );


    if (
        uniqueCandidates.length === 0
    ) {

        console.log(
            `[SMS BRAND] No search candidates found for "${sender}"`
        );
    }


    return uniqueCandidates;
}


// ============================================================
// WEBSITE INSPECTION
// ============================================================

async function inspectWebsite(
    searchCandidate
) {

    const websiteUrl =
        searchCandidate.url;

    if (
        !isUsableExternalUrl(
            websiteUrl
        )
    ) {
        return null;
    }


    try {

        const response =
            await axios.get(
                websiteUrl,
                {
                    timeout: 7000,

                    maxContentLength:
                        MAX_HTML_BYTES,

                    maxBodyLength:
                        MAX_HTML_BYTES,

                    responseType:
                        "text",

                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
                        "Accept":
                            "text/html,application/xhtml+xml"
                    },

                    validateStatus:
                        status =>
                            status >= 200 &&
                            status < 400
                }
            );


        const html =
            String(
                response.data || ""
            );


        if (!html) {
            return null;
        }


        let finalUrl =
            websiteUrl;


        try {

            if (
                response.request &&
                response.request.res &&
                response.request.res.responseUrl
            ) {

                finalUrl =
                    response.request
                        .res
                        .responseUrl;
            }

        } catch {
            // Keep original URL.
        }


        const title =
            extractTitle(
                html
            );


        const description =
            extractMetaContent(
                html,
                [
                    "description",
                    "og:description"
                ]
            );


        const ogSiteName =
            extractMetaContent(
                html,
                [
                    "og:site_name"
                ]
            );


        const canonical =
            extractCanonical(
                html,
                finalUrl
            );


        const jsonLdObjects =
            extractJsonLdObjects(
                html
            );


        const jsonLdIdentity =
            extractJsonLdIdentity(
                jsonLdObjects
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


        return {
            url: finalUrl,

            registrableDomain:
                registrableDomainFromUrl(
                    finalUrl
                ),

            title,

            description,

            ogSiteName,

            canonical,

            jsonLdName:
                jsonLdIdentity.name,

            jsonLdUrl:
                jsonLdIdentity.url,

            jsonLdLogo:
                safeUrl(
                    jsonLdIdentity.logo,
                    finalUrl
                ) || "",

            logoCandidates,

            iconCandidates,

            searchCandidate
        };

    } catch (error) {

        console.error(
            `[SMS BRAND] Website inspection failed for ${websiteUrl}:`,
            error.message
        );

        return null;
    }
}


// ============================================================
// WEBSITE BRAND SCORING
// ============================================================

async function scoreWebsiteCandidate(
    website,
    sender
) {

    if (!website) {
        return null;
    }


    const normalizedSender =
        senderKey(sender);


    const domain =
        website.registrableDomain
            .split(".")[0] || "";


    const normalizedDomain =
        normalizeComparableText(
            domain
        );


    const names = [
        website.jsonLdName,
        website.ogSiteName,
        website.title,
        website.description
    ]
        .filter(Boolean);


    let score = 0;


    // --------------------------------------------------------
    // DOMAIN IDENTITY
    // --------------------------------------------------------

    if (
        normalizedDomain ===
        normalizedSender
    ) {

        score += 0.30;

    } else if (
        normalizedDomain.includes(
            normalizedSender
        )
    ) {

        score += 0.15;
    }


    // --------------------------------------------------------
    // BRAND NAME IDENTITY
    // --------------------------------------------------------

    let exactBrandName = false;

    for (
        const name of names
    ) {

        const normalizedName =
            normalizeComparableText(
                name
            );

        if (
            normalizedName ===
            normalizedSender
        ) {

            score += 0.35;

            exactBrandName = true;

            break;
        }
    }


    if (
        !exactBrandName
    ) {

        for (
            const name of names
        ) {

            const normalizedName =
                normalizeComparableText(
                    name
                );

            if (
                normalizedName.includes(
                    normalizedSender
                )
            ) {

                score += 0.20;

                break;
            }
        }
    }


    // --------------------------------------------------------
    // SEARCH RELEVANCE
    // --------------------------------------------------------

    if (
        website.searchCandidate
    ) {

        score +=
            Math.min(
                website.searchCandidate
                    .searchScore || 0,
                1
            ) * 0.20;
    }


    // --------------------------------------------------------
    // JSON-LD CORROBORATION
    // --------------------------------------------------------

    if (
        website.jsonLdName
    ) {

        const normalizedJsonLdName =
            normalizeComparableText(
                website.jsonLdName
            );

        if (
            normalizedJsonLdName ===
            normalizedSender
        ) {

            score += 0.15;
        }
    }


    // --------------------------------------------------------
    // CANONICAL DOMAIN
    // --------------------------------------------------------

    if (
        website.canonical
    ) {

        const canonicalDomain =
            registrableDomainFromUrl(
                website.canonical
            );

        if (
            canonicalDomain ===
            website.registrableDomain
        ) {

            score += 0.05;
        }
    }


    // --------------------------------------------------------
    // LOGO VALIDATION
    // --------------------------------------------------------

    const logoCandidates = [
        website.jsonLdLogo,
        ...website.logoCandidates
    ]
        .filter(Boolean)
        .slice(0, 5);


    const verifiedLogoUrl =
        await findVerifiedImage(
            logoCandidates
        );


    if (
        verifiedLogoUrl
    ) {

        score += 0.10;
    }


    // --------------------------------------------------------
    // FAVICON VALIDATION
    // --------------------------------------------------------

    const faviconCandidates =
        website.iconCandidates
            .filter(Boolean)
            .slice(0, 5);


    const verifiedFaviconUrl =
        await findVerifiedImage(
            faviconCandidates
        );


    if (
        verifiedFaviconUrl
    ) {

        score += 0.04;
    }


    // --------------------------------------------------------
    // BRAND NAME
    // --------------------------------------------------------

    let brandName =
        cleanBrandName(
            website.jsonLdName ||
            website.ogSiteName ||
            website.title
        );


    if (
        !brandName &&
        website.searchCandidate
    ) {

        brandName =
            cleanBrandName(
                website.searchCandidate.title
            );
    }


    score =
        Math.min(
            score,
            1
        );


    const verified =
        score >= 0.80 &&
        (
            Boolean(
                verifiedLogoUrl
            ) ||
            Boolean(
                verifiedFaviconUrl
            )
        );


    return {
        brandName,

        logoUrl:
            verifiedLogoUrl || "",

        faviconUrl:
            verifiedFaviconUrl || "",

        confidence:
            Number(
                score.toFixed(3)
            ),

        verified,

        websiteUrl:
            website.url,

        registrableDomain:
            website.registrableDomain,

        searchCandidate:
            website.searchCandidate
    };
}


// ============================================================
// FIND BEST WEBSITE
// ============================================================

async function findBestCandidate(
    sender,
    searchCandidates
) {

    const ranked =
        [
            ...searchCandidates
        ]
            .sort(
                (a, b) =>
                    (
                        b.searchScore || 0
                    ) -
                    (
                        a.searchScore || 0
                    )
            )
            .slice(
                0,
                MAX_CANDIDATES_TO_INSPECT
            );


    console.log(
        `[SMS BRAND] Inspecting ${ranked.length} website candidates for "${sender}"`
    );


    if (
        ranked.length === 0
    ) {

        return null;
    }


    const inspections =
        await Promise.all(
            ranked.map(
                candidate =>
                    inspectWebsite(
                        candidate
                    )
            )
        );


    const websites =
        inspections
            .filter(Boolean);


    if (
        websites.length === 0
    ) {

        return null;
    }


    const scored =
        await Promise.all(
            websites.map(
                website =>
                    scoreWebsiteCandidate(
                        website,
                        sender
                    )
            )
        );


    const valid =
        scored
            .filter(Boolean)
            .sort(
                (a, b) =>
                    b.confidence -
                    a.confidence
            );


    if (
        valid.length === 0
    ) {

        return null;
    }


    const best =
        valid[0];


    console.log(
        `[SMS BRAND] Best candidate: ${best.registrableDomain} -> ${best.brandName} (score=${best.confidence})`
    );


    console.log(
        `[SMS BRAND] Verification result for "${sender}": verified=${best.verified}, confidence=${best.confidence}, brand="${best.brandName}", logo=${Boolean(best.logoUrl)}, favicon=${Boolean(best.faviconUrl)}`
    );


    return best;
}


// ============================================================
// FIREBASE CACHE
// ============================================================

async function getFirebaseCache(
    sender
) {

    const key =
        senderKey(sender);

    if (!key) {
        return null;
    }


    const now =
        Date.now();


    // --------------------------------------------------------
    // MEMORY CACHE
    // --------------------------------------------------------

    const memory =
        memoryCache.get(key);


    if (memory) {

        if (
            memory.status ===
            "FOUND"
        ) {

            if (
                now -
                    memory.cachedAt <
                VERIFIED_CACHE_TTL
            ) {

                return memory;
            }

        } else if (
            memory.status ===
            "DISCOVERING"
        ) {

            if (
                now -
                    memory.discoveryStartedAt <
                DISCOVERY_LOCK_TTL
            ) {

                return memory;
            }

        } else if (
            memory.status ===
            "UNKNOWN"
        ) {

            if (
                now -
                    memory.cachedAt <
                UNKNOWN_CACHE_TTL
            ) {

                return memory;
            }
        }
    }


    // --------------------------------------------------------
    // FIREBASE
    // --------------------------------------------------------

    try {

        const snapshot =
            await db
                .ref(
                    `${CACHE_PATH}/${key}`
                )
                .once("value");


        const data =
            snapshot.val();


        if (!data) {
            return null;
        }


        if (
            data.status ===
            "FOUND"
        ) {

            if (
                now -
                    Number(
                        data.cachedAt || 0
                    ) <
                VERIFIED_CACHE_TTL
            ) {

                memoryCache.set(
                    key,
                    data
                );

                return data;
            }

            return null;
        }


        if (
            data.status ===
            "DISCOVERING"
        ) {

            if (
                now -
                    Number(
                        data.discoveryStartedAt ||
                        0
                    ) <
                DISCOVERY_LOCK_TTL
            ) {

                memoryCache.set(
                    key,
                    data
                );

                return data;
            }

            return null;
        }


        if (
            data.status ===
            "UNKNOWN"
        ) {

            if (
                now -
                    Number(
                        data.cachedAt || 0
                    ) <
                UNKNOWN_CACHE_TTL
            ) {

                memoryCache.set(
                    key,
                    data
                );

                return data;
            }

            return null;
        }


        return null;

    } catch (error) {

        console.error(
            "[SMS BRAND] Firebase cache read failed:",
            error.message
        );

        return null;
    }
}


// ============================================================
// SAVE CACHE
// ============================================================

async function saveFirebaseCache(
    sender,
    data
) {

    const key =
        senderKey(sender);

    if (!key) {
        return;
    }


    const payload = {
        ...data,
        senderKey: key,
        updatedAt: Date.now()
    };


    memoryCache.set(
        key,
        payload
    );


    try {

        await db
            .ref(
                `${CACHE_PATH}/${key}`
            )
            .set(payload);

    } catch (error) {

        console.error(
            "[SMS BRAND] Firebase cache write failed:",
            error.message
        );
    }
}


// ============================================================
// DISCOVERY LOCK
// ============================================================

async function acquireDiscoveryLock(
    sender
) {

    const key =
        senderKey(sender);

    if (!key) {
        return false;
    }


    const now =
        Date.now();


    let acquired =
        false;


    try {

        await db
            .ref(
                `${CACHE_PATH}/${key}`
            )
            .transaction(
                current => {

                    if (
                        current &&
                        current.status ===
                        "DISCOVERING" &&
                        now -
                            Number(
                                current.discoveryStartedAt ||
                                0
                            ) <
                        DISCOVERY_LOCK_TTL
                    ) {

                        return;
                    }


                    acquired = true;


                    return {
                        status:
                            "DISCOVERING",

                        senderKey:
                            key,

                        discoveryStartedAt:
                            now
                    };
                }
            );


        if (
            acquired
        ) {

            memoryCache.set(
                key,
                {
                    status:
                        "DISCOVERING",

                    senderKey:
                        key,

                    discoveryStartedAt:
                        now
                }
            );
        }


        return acquired;

    } catch (error) {

        console.error(
            "[SMS BRAND] Discovery lock failed:",
            error.message
        );

        return false;
    }
}


// ============================================================
// DISCOVERY
// ============================================================

async function discoverBrand(
    sender
) {

    console.log(
        `[SMS BRAND] Starting discovery for "${sender}"`
    );


    const candidates =
        await searchBrand(
            sender
        );


    if (
        candidates.length === 0
    ) {

        console.log(
            `[SMS BRAND] No search candidates found for "${sender}"`
        );


        await saveFirebaseCache(
            sender,
            {
                status:
                    "UNKNOWN",

                brandName:
                    "",

                logoUrl:
                    "",

                faviconUrl:
                    "",

                confidence:
                    0,

                verified:
                    false,

                cachedAt:
                    Date.now()
            }
        );


        return {
            status:
                "UNKNOWN",

            brandName:
                "",

            logoUrl:
                "",

            faviconUrl:
                "",

            confidence:
                0,

            verified:
                false
        };
    }


    const best =
        await findBestCandidate(
            sender,
            candidates
        );


    if (
        !best
    ) {

        await saveFirebaseCache(
            sender,
            {
                status:
                    "UNKNOWN",

                brandName:
                    "",

                logoUrl:
                    "",

                faviconUrl:
                    "",

                confidence:
                    0,

                verified:
                    false,

                cachedAt:
                    Date.now()
            }
        );


        return {
            status:
                "UNKNOWN",

            brandName:
                "",

            logoUrl:
                "",

            faviconUrl:
                "",

            confidence:
                0,

            verified:
                false
        };
    }


    if (
        !best.verified
    ) {

        await saveFirebaseCache(
            sender,
            {
                status:
                    "UNKNOWN",

                brandName:
                    best.brandName || "",

                logoUrl:
                    best.logoUrl || "",

                faviconUrl:
                    best.faviconUrl || "",

                confidence:
                    best.confidence || 0,

                verified:
                    false,

                websiteUrl:
                    best.websiteUrl || "",

                cachedAt:
                    Date.now()
            }
        );


        return {
            status:
                "UNKNOWN",

            brandName:
                best.brandName || "",

            logoUrl:
                best.logoUrl || "",

            faviconUrl:
                best.faviconUrl || "",

            confidence:
                best.confidence || 0,

            verified:
                false
        };
    }


    const result = {

        status:
            "FOUND",

        brandName:
            best.brandName,

        logoUrl:
            best.logoUrl,

        faviconUrl:
            best.faviconUrl,

        confidence:
            best.confidence,

        verified:
            true,

        websiteUrl:
            best.websiteUrl,

        cachedAt:
            Date.now()
    };


    await saveFirebaseCache(
        sender,
        result
    );


    return result;
}


// ============================================================
// PUBLIC RESOLVER
// ============================================================

async function resolveSender(
    sender
) {

    const normalized =
        normalizeSender(sender);


    if (!normalized) {

        return {
            status:
                "UNKNOWN",

            brandName:
                "",

            logoUrl:
                "",

            faviconUrl:
                "",

            confidence:
                0,

            verified:
                false
        };
    }


    // --------------------------------------------------------
    // CHECK CACHE
    // --------------------------------------------------------

    const cached =
        await getFirebaseCache(
            normalized
        );


    if (
        cached &&
        cached.status ===
        "FOUND"
    ) {

        console.log(
            `[SMS BRAND] Cache HIT for "${normalized}"`
        );

        return cached;
    }


    if (
        cached &&
        cached.status ===
        "UNKNOWN"
    ) {

        console.log(
            `[SMS BRAND] UNKNOWN cache HIT for "${normalized}"`
        );

        return cached;
    }


    if (
        cached &&
        cached.status ===
        "DISCOVERING"
    ) {

        console.log(
            `[SMS BRAND] Discovery already running for "${normalized}"`
        );

        return {
            status:
                "DISCOVERING",

            senderKey:
                senderKey(normalized),

            brandName:
                "",

            logoUrl:
                "",

            faviconUrl:
                "",

            confidence:
                0,

            verified:
                false,

            discoveryStartedAt:
                cached.discoveryStartedAt
        };
    }


    // --------------------------------------------------------
    // ACQUIRE LOCK
    // --------------------------------------------------------

    const acquired =
        await acquireDiscoveryLock(
            normalized
        );


    if (!acquired) {

        return {
            status:
                "DISCOVERING",

            senderKey:
                senderKey(normalized),

            brandName:
                "",

            logoUrl:
                "",

            faviconUrl:
                "",

            confidence:
                0,

            verified:
                false
        };
    }


    // --------------------------------------------------------
    // DISCOVER
    // --------------------------------------------------------

    try {

        return await discoverBrand(
            normalized
        );

    } catch (error) {

        console.error(
            `[SMS BRAND] Discovery failed for "${normalized}":`,
            error
        );


        await saveFirebaseCache(
            normalized,
            {
                status:
                    "UNKNOWN",

                brandName:
                    "",

                logoUrl:
                    "",

                faviconUrl:
                    "",

                confidence:
                    0,

                verified:
                    false,

                cachedAt:
                    Date.now()
            }
        );


        return {
            status:
                "UNKNOWN",

            brandName:
                "",

            logoUrl:
                "",

            faviconUrl:
                "",

            confidence:
                0,

            verified:
                false
        };
    }
}


module.exports = {
    resolveSender
};