"use strict";

const axios = require("axios");
const { URL } = require("url");

/*
 * ============================================================
 * SMS BRAND RESOLVER
 * ============================================================
 *
 * Backend port of the Android SmsBrandResolver logic.
 *
 * IMPORTANT:
 * - This service does NOT use Firebase.
 * - This service does NOT write to Firebase.
 * - This service does NOT use a Firebase cache.
 * - Search discovery is dynamic.
 *
 * Pipeline:
 *
 * sender
 *   ↓
 * normalize sender
 *   ↓
 * build search queries
 *   ↓
 * search providers
 *   ↓
 * normalize search URLs
 *   ↓
 * reject infrastructure / invalid domains
 *   ↓
 * rank candidates
 *   ↓
 * inspect real websites
 *   ↓
 * extract identity / JSON-LD / logo / favicon
 *   ↓
 * score website
 *   ↓
 * return verified result
 *
 * ============================================================
 */


/* ============================================================
 * CONFIGURATION
 * ============================================================
 */

const SEARCH_TIMEOUT_MS = 6000;
const WEBSITE_TIMEOUT_MS = 6500;
const IMAGE_TIMEOUT_MS = 4500;

const MAX_HTML_BYTES = 2 * 1024 * 1024;

const MAX_SEARCH_CANDIDATES = 18;
const MAX_WEBSITES_TO_INSPECT = 6;

const FOUND_CACHE_TTL_MS = 30 * 60 * 1000;

// UNKNOWN is intentionally short-lived.
// We do NOT want a failed discovery to poison the resolver.
const UNKNOWN_CACHE_TTL_MS = 60 * 1000;

const MIN_CONFIDENCE = 0.70;


/* ============================================================
 * MEMORY CACHE
 * ============================================================
 *
 * Deliberately NOT Firebase.
 */

const memoryCache = new Map();

/*
 * Prevent duplicate simultaneous discovery requests.
 *
 * Example:
 *
 * request A -> VODACOM
 * request B -> VODACOM
 * request C -> VODACOM
 *
 * All three share the same Promise.
 */

const pendingResolutions = new Map();


/* ============================================================
 * SEARCH PROVIDERS
 * ============================================================
 */

const PROVIDER_GOOGLE = "google";
const PROVIDER_BING = "bing";
const PROVIDER_DDG = "ddg";


/*
 * Temporary provider cooldown.
 *
 * Render frequently sees DDG timeouts.
 * We therefore do not allow DDG to delay every request.
 */

const providerCooldownUntil = new Map();

function isProviderCoolingDown(provider) {
    const until =
        providerCooldownUntil.get(provider) || 0;

    return until > Date.now();
}

function markProviderFailed(provider) {
    /*
     * DDG is especially prone to timeout from cloud hosts.
     * Keep the cooldown short enough that it can recover.
     */
    const duration =
        provider === PROVIDER_DDG
            ? 2 * 60 * 1000
            : 30 * 1000;

    providerCooldownUntil.set(
        provider,
        Date.now() + duration
    );
}


/* ============================================================
 * HTTP
 * ============================================================
 */

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/154.0 Safari/537.36 ParentIQ-SMS-Resolver/1.0";


async function httpGetText(
    url,
    timeout = SEARCH_TIMEOUT_MS
) {
    const response =
        await axios.get(url, {
            timeout,
            maxRedirects: 5,
            responseType: "text",
            validateStatus: () => true,
            headers: {
                "User-Agent": USER_AGENT,
                "Accept":
                    "text/html,application/xhtml+xml," +
                    "application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language":
                    "en-US,en;q=0.9"
            }
        });

    if (
        response.status < 200 ||
        response.status >= 300
    ) {
        throw new Error(
            `HTTP ${response.status}`
        );
    }

    let html =
        typeof response.data === "string"
            ? response.data
            : String(response.data || "");

    /*
     * Prevent enormous pages from consuming memory.
     */
    if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
        html =
            html.slice(
                0,
                Math.floor(MAX_HTML_BYTES / 2)
            );
    }

    return {
        html,
        finalUrl:
            response.request?.res?.responseUrl ||
            url
    };
}


/* ============================================================
 * NORMALIZATION
 * ============================================================
 */

function normalizeForComparison(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}


function normalizeSender(sender) {
    return String(sender || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 120);
}


function firstNonBlank(...values) {
    for (const value of values) {
        if (
            value !== undefined &&
            value !== null &&
            String(value).trim()
        ) {
            return String(value).trim();
        }
    }

    return "";
}


/* ============================================================
 * GENERIC SENDER DESCRIPTORS
 * ============================================================
 */

const GENERIC_SENDER_DESCRIPTORS =
    new Set([
        "info",
        "news",
        "alert",
        "alerts",
        "sms",
        "service",
        "services",
        "notify",
        "notification",
        "notifications",
        "support",
        "official",
        "online",
        "mobile",
        "money",
        "pay",
        "banking",
        "data",
        "update",
        "updates",
        "message",
        "messages",
        "gbl"
    ]);


function isGenericSenderDescriptor(value) {
    return GENERIC_SENDER_DESCRIPTORS.has(
        normalizeForComparison(value)
    );
}


/* ============================================================
 * SENDER CORE
 * ============================================================
 */

function deriveSenderCore(sender) {
    const normalized =
        normalizeForComparison(sender);

    if (!normalized) {
        return "";
    }

    const descriptors = [
        "notifications",
        "notification",
        "services",
        "service",
        "support",
        "official",
        "alerts",
        "alert",
        "updates",
        "update",
        "messages",
        "message",
        "mobile",
        "online",
        "banking",
        "money",
        "news",
        "info",
        "data",
        "sms",
        "pay",
        "notify",
        "gbl"
    ];

    let candidate = normalized;

    let changed = true;

    while (
        changed &&
        candidate.length >= 4
    ) {
        changed = false;

        const descriptor =
            descriptors
                .slice()
                .sort(
                    (a, b) =>
                        b.length - a.length
                )
                .find(
                    value =>
                        candidate.endsWith(value) &&
                        candidate.length >
                            value.length + 2
                );

        if (descriptor) {
            candidate =
                candidate.slice(
                    0,
                    -descriptor.length
                );

            changed = true;
        }
    }

    if (candidate.length >= 3) {
        return candidate;
    }

    return normalized;
}


function deriveSenderTokens(sender) {
    const normalized =
        normalizeForComparison(sender);

    if (!normalized) {
        return [];
    }

    const tokens = new Set();

    /*
     * Original separated tokens.
     */
    String(sender)
        .trim()
        .split(/[^A-Za-z0-9]+/)
        .map(normalizeForComparison)
        .filter(token => token.length >= 3)
        .filter(
            token =>
                !isGenericSenderDescriptor(token)
        )
        .forEach(token => tokens.add(token));

    /*
     * Main derived core.
     */
    const core =
        deriveSenderCore(sender);

    if (core.length >= 3) {
        tokens.add(core);
    }

    /*
     * Compressed sender suffixes.
     */
    const suffixes = [
        "info",
        "news",
        "alert",
        "alerts",
        "sms",
        "service",
        "services",
        "notify",
        "notification",
        "notifications",
        "support",
        "official",
        "online",
        "mobile",
        "money",
        "pay",
        "banking",
        "bank",
        "data",
        "gbl"
    ];

    for (const suffix of suffixes) {
        if (
            normalized.endsWith(suffix) &&
            normalized.length >
                suffix.length + 2
        ) {
            const prefix =
                normalized.slice(
                    0,
                    -suffix.length
                );

            if (prefix.length >= 3) {
                tokens.add(prefix);
            }
        }
    }

    return Array.from(tokens)
        .sort(
            (a, b) =>
                b.length - a.length
        );
}


/* ============================================================
 * PHONE
 * ============================================================
 */

function isPhoneNumber(value) {
    const normalized =
        String(value || "")
            .replace(/[\s()+\-]/g, "");

    return /^\d{7,15}$/.test(normalized);
}


/* ============================================================
 * DOMAIN HELPERS
 * ============================================================
 */

const SEARCH_INFRASTRUCTURE_DOMAINS =
    new Set([
        "google.com",
        "google.co.ke",
        "google.co.ug",
        "google.co.tz",
        "google.rw",
        "bing.com",
        "bing.co.uk",
        "duckduckgo.com",
        "lite.duckduckgo.com",
        "search.yahoo.com",
        "yahoo.com",
        "yandex.com",
        "baidu.com",
        "ask.com",
        "aol.com",
        "ecosia.org",
        "brave.com",
        "search.brave.com"
    ]);


const BLOCKED_DOMAINS =
    new Set([
        "localhost",
        "example.com",
        "example.org",
        "example.net"
    ]);


function normalizeDomain(domain) {
    return String(domain || "")
        .toLowerCase()
        .trim()
        .replace(/^www\./, "")
        .replace(/\.$/, "");
}


function extractDomain(url) {
    try {
        return normalizeDomain(
            new URL(url).hostname
        );
    } catch {
        return "";
    }
}


function isSearchInfrastructureDomain(domain) {
    const normalized =
        normalizeDomain(domain);

    if (!normalized) {
        return true;
    }

    if (
        SEARCH_INFRASTRUCTURE_DOMAINS.has(
            normalized
        )
    ) {
        return true;
    }

    return Array.from(
        SEARCH_INFRASTRUCTURE_DOMAINS
    ).some(
        infrastructure =>
            normalized.endsWith(
                "." + infrastructure
            )
    );
}


function isAcceptableDomain(domain) {
    const normalized =
        normalizeDomain(domain);

    if (!normalized) {
        return false;
    }

    if (
        BLOCKED_DOMAINS.has(normalized)
    ) {
        return false;
    }

    if (
        isSearchInfrastructureDomain(normalized)
    ) {
        return false;
    }

    if (!normalized.includes(".")) {
        return false;
    }

    if (
        !/^[a-z0-9.-]+$/i.test(normalized)
    ) {
        return false;
    }

    return true;
}


/* ============================================================
 * REGISTRABLE DOMAIN
 * ============================================================
 */

const MULTI_PART_SUFFIXES = [
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
    "net.za",

    "co.ke",
    "or.ke",
    "ne.ke",

    "co.tz",
    "or.tz",

    "co.ug",
    "or.ug",

    "co.rw",
    "or.rw"
];


function getRegistrableDomain(domain) {
    const normalized =
        normalizeDomain(domain);

    if (!normalized) {
        return "";
    }

    for (
        const suffix of MULTI_PART_SUFFIXES
    ) {
        if (
            normalized.endsWith(
                "." + suffix
            )
        ) {
            const prefix =
                normalized.slice(
                    0,
                    -suffix.length - 1
                );

            const parts =
                prefix.split(".");

            if (parts.length) {
                return (
                    parts[parts.length - 1] +
                    "." +
                    suffix
                );
            }
        }
    }

    const parts =
        normalized.split(".");

    if (parts.length >= 2) {
        return (
            parts[parts.length - 2] +
            "." +
            parts[parts.length - 1]
        );
    }

    return normalized;
}


/* ============================================================
 * SEARCH URL NORMALIZATION
 * ============================================================
 */

function htmlDecode(value) {
    return String(value || "")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&#x27;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#(\d+);/g, (_, n) =>
            String.fromCharCode(
                Number(n)
            )
        )
        .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
            String.fromCharCode(
                parseInt(n, 16)
            )
        );
}


function getQueryParameter(url, name) {
    try {
        const parsed =
            new URL(url);

        return (
            parsed.searchParams.get(name) ||
            ""
        );
    } catch {
        return "";
    }
}


function normalizeSearchResultUrl(rawUrl) {
    if (!rawUrl) {
        return "";
    }

    let value =
        htmlDecode(
            String(rawUrl)
                .trim()
                .replace(/\\u003d/gi, "=")
                .replace(/\\u0026/gi, "&")
                .replace(/\\\//g, "/")
        );

    /*
     * Google relative redirect.
     */
    if (value.startsWith("/url?")) {
        const target =
            getQueryParameter(
                "https://www.google.com" +
                    value,
                "q"
            ) ||
            getQueryParameter(
                "https://www.google.com" +
                    value,
                "url"
            );

        if (target) {
            value = target;
        }
    }

    /*
     * Google absolute redirect.
     */
    try {
        const parsed =
            new URL(value);

        const host =
            normalizeDomain(
                parsed.hostname
            );

        if (
            host === "google.com" ||
            host.endsWith(".google.com")
        ) {
            const target =
                parsed.searchParams.get("q") ||
                parsed.searchParams.get("url");

            if (target) {
                value = target;
            }
        }
    } catch {
        // Continue below.
    }

    /*
     * DuckDuckGo redirect.
     */
    if (
        value.includes("uddg=")
    ) {
        const target =
            getQueryParameter(
                value,
                "uddg"
            );

        if (target) {
            value = target;
        }
    }

    /*
     * Bing redirect.
     */
    try {
        const parsed =
            new URL(value);

        const host =
            normalizeDomain(
                parsed.hostname
            );

        if (
            host === "bing.com" ||
            host.endsWith(".bing.com")
        ) {
            const target =
                parsed.searchParams.get("u") ||
                parsed.searchParams.get("url");

            if (target) {
                value = target;
            }
        }
    } catch {
        // Continue.
    }

    /*
     * Relative links are not useful unless we know
     * their search-engine origin. Search results should
     * therefore normally be absolute.
     */
    if (
        !/^https?:\/\//i.test(value)
    ) {
        return "";
    }

    return normalizeCandidateUrl(value);
}


/* ============================================================
 * CANDIDATE URL VALIDATION
 * ============================================================
 */

function normalizeCandidateUrl(value) {
    try {
        const parsed =
            new URL(value);

        if (
            parsed.protocol !== "http:" &&
            parsed.protocol !== "https:"
        ) {
            return "";
        }

        const domain =
            normalizeDomain(
                parsed.hostname
            );

        if (
            !isAcceptableDomain(domain)
        ) {
            return "";
        }

        const path =
            (
                parsed.pathname +
                parsed.search
            ).toLowerCase();

        const blockedFragments = [
            "/dtd/",
            "/schema",
            "/schemas/",
            "/doctype",
            "/www.w3.org/",
            "/search",
            "/preferences",
            "/settings",
            "/account",
            "/accounts",
            "/images/",
            "/img/",
            "/css/",
            "/js/"
        ];

        if (
            blockedFragments.some(
                fragment =>
                    path.includes(fragment)
            )
        ) {
            return "";
        }

        const blockedExtensions = [
            ".dtd",
            ".xsd",
            ".css",
            ".js",
            ".map",
            ".xml"
        ];

        if (
            blockedExtensions.some(
                extension =>
                    parsed.pathname
                        .toLowerCase()
                        .endsWith(extension)
            )
        ) {
            return "";
        }

        parsed.hash = "";

        /*
         * Remove tracking noise.
         */
        const trackingParameters = [
            "utm_source",
            "utm_medium",
            "utm_campaign",
            "utm_term",
            "utm_content",
            "gclid",
            "fbclid",
            "ref",
            "referrer"
        ];

        for (
            const parameter of trackingParameters
        ) {
            parsed.searchParams.delete(
                parameter
            );
        }

        return parsed.toString();
    } catch {
        return "";
    }
}


/* ============================================================
 * SEARCH CANDIDATE EXTRACTION
 * ============================================================
 *
 * Important:
 * We intentionally use generic <a href> extraction,
 * matching the Android resolver.
 *
 * We do NOT depend on:
 *   .b_algo
 *   .result
 *   .result__a
 *
 * because search-engine HTML changes.
 */

function stripTags(value) {
    return String(value || "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}


function decodeAttribute(value) {
    return htmlDecode(
        String(value || "")
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'")
    );
}


function extractSearchCandidates(
    html,
    provider
) {
    const candidates = [];

    if (!html) {
        return candidates;
    }

    const anchorRegex =
        /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;

    let match;

    while (
        (match = anchorRegex.exec(html)) &&
        candidates.length <
            MAX_SEARCH_CANDIDATES
    ) {
        const rawHref =
            decodeAttribute(
                firstNonBlank(
                    match[1],
                    match[2],
                    match[3]
                )
            );

        const url =
            normalizeSearchResultUrl(
                rawHref
            );

        if (!url) {
            continue;
        }

        const domain =
            extractDomain(url);

        if (
            !isAcceptableDomain(domain)
        ) {
            continue;
        }

        const anchorText =
            stripTags(match[4]);

        if (!anchorText) {
            continue;
        }

        /*
         * Get a small amount of surrounding text.
         * Search snippets often sit near the anchor.
         */
        const start =
            Math.max(
                0,
                match.index - 600
            );

        const end =
            Math.min(
                html.length,
                anchorRegex.lastIndex + 1200
            );

        const surrounding =
            stripTags(
                html.slice(start, end)
            );

        const snippet =
            surrounding
                .replace(
                    anchorText,
                    ""
                )
                .slice(0, 700)
                .trim();

        candidates.push({
            url,
            title: anchorText.slice(0, 300),
            snippet,
            provider
        });
    }

    /*
     * Deduplicate by registrable domain.
     */
    const unique = [];
    const seen = new Set();

    for (const candidate of candidates) {
        const domain =
            getRegistrableDomain(
                extractDomain(candidate.url)
            );

        if (!domain || seen.has(domain)) {
            continue;
        }

        seen.add(domain);
        unique.push(candidate);
    }

    return unique;
}


/* ============================================================
 * SEARCH PROVIDERS
 * ============================================================
 */

async function searchGoogle(query) {
    const url =
        "https://www.google.com/search?" +
        new URLSearchParams({
            q: query,
            num: "10",
            hl: "en"
        }).toString();

    try {
        const page =
            await httpGetText(
                url,
                SEARCH_TIMEOUT_MS
            );

        return extractSearchCandidates(
            page.html,
            PROVIDER_GOOGLE
        );
    } catch (error) {
        console.warn(
            "[SMS BRAND] Google search failed:",
            error.message
        );

        markProviderFailed(
            PROVIDER_GOOGLE
        );

        return [];
    }
}


async function searchBing(query) {
    const url =
        "https://www.bing.com/search?" +
        new URLSearchParams({
            q: query,
            count: "10",
            setlang: "en"
        }).toString();

    try {
        const page =
            await httpGetText(
                url,
                SEARCH_TIMEOUT_MS
            );

        return extractSearchCandidates(
            page.html,
            PROVIDER_BING
        );
    } catch (error) {
        console.warn(
            "[SMS BRAND] Bing search failed:",
            error.message
        );

        markProviderFailed(
            PROVIDER_BING
        );

        return [];
    }
}


async function searchDuckDuckGo(query) {
    const url =
        "https://lite.duckduckgo.com/lite/?" +
        new URLSearchParams({
            q: query
        }).toString();

    try {
        const page =
            await httpGetText(
                url,
                SEARCH_TIMEOUT_MS
            );

        return extractSearchCandidates(
            page.html,
            PROVIDER_DDG
        );
    } catch (error) {
        console.warn(
            "[SMS BRAND] DuckDuckGo search failed:",
            error.message
        );

        markProviderFailed(
            PROVIDER_DDG
        );

        return [];
    }
}


/* ============================================================
 * SEARCH QUERY GENERATION
 * ============================================================
 */

function buildSearchQueries(
    sender,
    country
) {
    const queries =
        new Set();

    const cleanSender =
        normalizeSender(sender);

    if (!cleanSender) {
        return [];
    }

    const senderCore =
        deriveSenderCore(
            cleanSender
        );

    const senderTokens =
        deriveSenderTokens(
            cleanSender
        );

    /*
     * Same conceptual query strategy as Android.
     *
     * We cap the backend to the most useful queries
     * because running 12 queries × 3 engines is too slow.
     */

    if (country) {
        queries.add(
            `"${cleanSender}" "${country}" official`
        );

        queries.add(
            `"${cleanSender}" "${country}"`
        );
    }

    queries.add(
        `"${cleanSender}" official`
    );

    if (
        senderCore &&
        senderCore !==
            normalizeForComparison(
                cleanSender
            )
    ) {
        if (country) {
            queries.add(
                `"${senderCore}" "${country}" official`
            );

            queries.add(
                `"${senderCore}" "${country}"`
            );
        }

        queries.add(
            `"${senderCore}" official website`
        );
    }

    for (
        const token of senderTokens.slice(0, 3)
    ) {
        if (token.length < 4) {
            continue;
        }

        if (country) {
            queries.add(
                `"${token}" "${country}" official`
            );
        }

        queries.add(
            `"${token}" official website`
        );
    }

    if (isPhoneNumber(cleanSender)) {
        queries.add(
            `"${cleanSender}" business`
        );

        if (country) {
            queries.add(
                `"${cleanSender}" "${country}" business`
            );
        }
    }

    return Array.from(queries).slice(0, 6);
}


/* ============================================================
 * SEARCH CANDIDATE RANKING
 * ============================================================
 */

function countryMatchesDomain(
    domain,
    country
) {
    if (!domain || !country) {
        return false;
    }

    const normalizedCountry =
        String(country)
            .toLowerCase()
            .trim();

    const countryDomains = {
        kenya: [".ke", ".co.ke", ".or.ke"],
        uganda: [".ug", ".co.ug", ".or.ug"],
        tanzania: [".tz", ".co.tz", ".or.tz"],
        rwanda: [".rw", ".co.rw", ".or.rw"],
        southafrica: [".za", ".co.za"]
    };

    const suffixes =
        countryDomains[
            normalizedCountry
                .replace(/\s+/g, "")
        ] || [];

    return suffixes.some(
        suffix =>
            domain.endsWith(suffix)
    );
}


function containsOfficialSignal(text) {
    const normalized =
        String(text || "")
            .toLowerCase();

    return [
        "official",
        "official website",
        "official site",
        "corporate",
        "company",
        "about us",
        "contact us"
    ].some(
        signal =>
            normalized.includes(signal)
    );
}


function scoreSearchCandidate(
    candidate,
    sender,
    country
) {
    const senderNormalized =
        normalizeForComparison(
            sender
        );

    const senderCore =
        deriveSenderCore(sender);

    const senderTokens =
        deriveSenderTokens(sender);

    const domainNormalized =
        normalizeForComparison(
            extractDomain(candidate.url)
        );

    const titleNormalized =
        normalizeForComparison(
            candidate.title
        );

    const snippetNormalized =
        normalizeForComparison(
            candidate.snippet
        );

    let score = 0;

    if (
        senderNormalized &&
        domainNormalized.includes(
            senderNormalized
        )
    ) {
        score += 3.0;
    }

    if (
        senderCore.length >= 4 &&
        domainNormalized.includes(
            senderCore
        )
    ) {
        score += 2.5;
    }

    if (
        senderTokens.some(
            token =>
                token.length >= 4 &&
                domainNormalized.includes(token)
        )
    ) {
        score += 1.75;
    }

    if (
        senderCore.length >= 4 &&
        titleNormalized.includes(
            senderCore
        )
    ) {
        score += 2.0;
    }

    if (
        senderTokens.some(
            token =>
                token.length >= 4 &&
                titleNormalized.includes(token)
        )
    ) {
        score += 1.25;
    }

    if (
        senderCore.length >= 4 &&
        snippetNormalized.includes(
            senderCore
        )
    ) {
        score += 0.75;
    }

    if (
        countryMatchesDomain(
            extractDomain(candidate.url),
            country
        )
    ) {
        score += 0.75;
    }

    if (
        containsOfficialSignal(
            candidate.title +
            " " +
            candidate.snippet
        )
    ) {
        score += 0.75;
    }

    const hasIdentityEvidence =
        senderNormalized &&
        (
            domainNormalized.includes(
                senderNormalized
            ) ||
            (
                senderCore.length >= 4 &&
                domainNormalized.includes(
                    senderCore
                )
            ) ||
            senderTokens.some(
                token =>
                    token.length >= 4 &&
                    domainNormalized.includes(
                        token
                    )
            ) ||
            (
                senderCore.length >= 4 &&
                titleNormalized.includes(
                    senderCore
                )
            )
        );

    /*
     * Very important:
     *
     * A candidate must have some sender identity
     * evidence. This prevents bing.com / google.com /
     * unrelated sites from winning.
     */
    if (!hasIdentityEvidence) {
        score =
            Math.min(
                score,
                2.75
            );
    }

    return score;
}


function rankSearchCandidates(
    candidates,
    sender,
    country
) {
    return candidates
        .map(candidate => ({
            ...candidate,
            score:
                scoreSearchCandidate(
                    candidate,
                    sender,
                    country
                )
        }))
        .sort(
            (a, b) =>
                b.score - a.score
        );
}


/* ============================================================
 * WEBSITE TEXT HELPERS
 * ============================================================
 */

function cleanWebsiteBrandName(value) {
    let normalized =
        htmlDecode(
            String(value || "")
        )
            .replace(/\s+/g, " ")
            .trim();

    if (!normalized) {
        return "";
    }

    /*
     * Remove common title suffixes.
     */
    normalized =
        normalized
            .replace(
                /\s*[-|–—]\s*(official|official website|home|homepage|welcome|login|sign in)\s*$/i,
                ""
            )
            .trim();

    normalized =
        normalized
            .replace(
                /\s*[-|–—]\s*(gateway to.*|government services.*|digital services.*)$/i,
                ""
            )
            .trim();

    if (normalized.length > 100) {
        normalized =
            normalized.slice(
                0,
                100
            ).trim();
    }

    return normalized;
}


function isGenericWebsiteName(value) {
    const normalized =
        normalizeForComparison(value);

    return new Set([
        "home",
        "homepage",
        "welcome",
        "officialwebsite",
        "website",
        "search",
        "login",
        "signin",
        "contact",
        "about",
        "support",
        "services"
    ]).has(normalized);
}


/* ============================================================
 * HTML META EXTRACTION
 * ============================================================
 */

function extractTagAttribute(
    tag,
    attribute
) {
    const regex =
        new RegExp(
            "\\b" +
            attribute +
            "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))",
            "i"
        );

    const match =
        tag.match(regex);

    return htmlDecode(
        firstNonBlank(
            match?.[1],
            match?.[2],
            match?.[3]
        )
    );
}


function extractMetaContent(
    html,
    attribute,
    value
) {
    const metaRegex =
        /<meta\b[^>]*>/gi;

    let match;

    while (
        (match = metaRegex.exec(html))
    ) {
        const tag =
            match[0];

        const attr =
            extractTagAttribute(
                tag,
                attribute
            );

        if (
            attr &&
            attr.toLowerCase() ===
                value.toLowerCase()
        ) {
            return extractTagAttribute(
                tag,
                "content"
            );
        }
    }

    return "";
}


function extractTitle(html) {
    const match =
        html.match(
            /<title\b[^>]*>([\s\S]*?)<\/title>/i
        );

    return cleanWebsiteBrandName(
        stripTags(
            match?.[1] || ""
        )
    );
}


/* ============================================================
 * URL RESOLUTION
 * ============================================================
 */

function resolveUrl(
    value,
    baseUrl
) {
    if (!value) {
        return "";
    }

    try {
        return new URL(
            value,
            baseUrl
        ).toString();
    } catch {
        return "";
    }
}


/* ============================================================
 * JSON-LD
 * ============================================================
 */

function extractJsonLdObjects(html) {
    const objects = [];

    const regex =
        /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

    let match;

    while (
        (match = regex.exec(html))
    ) {
        const raw =
            htmlDecode(
                match[1]
            ).trim();

        if (!raw) {
            continue;
        }

        try {
            const parsed =
                JSON.parse(raw);

            if (Array.isArray(parsed)) {
                objects.push(...parsed);
            } else {
                objects.push(parsed);
            }
        } catch {
            /*
             * Some sites contain malformed JSON-LD.
             * Ignore it and continue with other identity signals.
             */
        }
    }

    return objects;
}


function flattenJsonLd(
    value,
    output = []
) {
    if (!value) {
        return output;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            flattenJsonLd(
                item,
                output
            );
        }

        return output;
    }

    if (
        typeof value === "object"
    ) {
        if (
            Array.isArray(
                value["@graph"]
            )
        ) {
            flattenJsonLd(
                value["@graph"],
                output
            );
        }

        output.push(value);
    }

    return output;
}


function isOrganizationSchema(object) {
    if (
        !object ||
        typeof object !== "object"
    ) {
        return false;
    }

    const type =
        object["@type"];

    const types =
        Array.isArray(type)
            ? type
            : [type];

    return types.some(
        value =>
            [
                "Organization",
                "Corporation",
                "LocalBusiness",
                "Brand",
                "BankOrCreditUnion",
                "FinancialService",
                "TelecommunicationsBusiness"
            ].includes(
                String(value || "")
            )
    );
}


function extractSchemaIdentity(
    html,
    baseUrl
) {
    const objects =
        flattenJsonLd(
            extractJsonLdObjects(html)
        );

    const organization =
        objects.find(
            isOrganizationSchema
        );

    if (!organization) {
        return {
            name: "",
            url: "",
            logo: "",
            sameAs: []
        };
    }

    let logo = "";

    if (
        typeof organization.logo ===
            "string"
    ) {
        logo =
            resolveUrl(
                organization.logo,
                baseUrl
            );
    } else if (
        organization.logo &&
        typeof organization.logo ===
            "object"
    ) {
        logo =
            resolveUrl(
                firstNonBlank(
                    organization.logo.url,
                    organization.logo.contentUrl
                ),
                baseUrl
            );
    }

    const sameAs =
        Array.isArray(
            organization.sameAs
        )
            ? organization.sameAs
                .map(
                    value =>
                        resolveUrl(
                            value,
                            baseUrl
                        )
                )
                .filter(Boolean)
            : [];

    return {
        name:
            cleanWebsiteBrandName(
                organization.name || ""
            ),
        url:
            resolveUrl(
                organization.url || "",
                baseUrl
            ),
        logo,
        sameAs
    };
}


/* ============================================================
 * CANONICAL
 * ============================================================
 */

function extractCanonicalUrl(
    html,
    baseUrl
) {
    const regex =
        /<link\b[^>]*>/gi;

    let match;

    while (
        (match = regex.exec(html))
    ) {
        const tag =
            match[0];

        const rel =
            extractTagAttribute(
                tag,
                "rel"
            );

        if (
            !rel
                .toLowerCase()
                .split(/\s+/)
                .includes("canonical")
        ) {
            continue;
        }

        const href =
            extractTagAttribute(
                tag,
                "href"
            );

        return resolveUrl(
            href,
            baseUrl
        );
    }

    return "";
}


/* ============================================================
 * LOGO / FAVICON DISCOVERY
 * ============================================================
 */

function extractLinkIcons(
    html,
    baseUrl
) {
    const icons = [];

    const regex =
        /<link\b[^>]*>/gi;

    let match;

    while (
        (match = regex.exec(html))
    ) {
        const tag =
            match[0];

        const rel =
            extractTagAttribute(
                tag,
                "rel"
            )
                .toLowerCase();

        if (
            !(
                rel.includes("icon") ||
                rel.includes("shortcut icon") ||
                rel.includes("apple-touch-icon")
            )
        ) {
            continue;
        }

        const href =
            extractTagAttribute(
                tag,
                "href"
            );

        const resolved =
            resolveUrl(
                href,
                baseUrl
            );

        if (resolved) {
            icons.push(resolved);
        }
    }

    return icons;
}


function extractExplicitLogoImages(
    html,
    baseUrl
) {
    const logos = [];

    const imgRegex =
        /<img\b[^>]*>/gi;

    let match;

    while (
        (match = imgRegex.exec(html))
    ) {
        const tag =
            match[0];

        const src =
            extractTagAttribute(
                tag,
                "src"
            );

        if (!src) {
            continue;
        }

        const alt =
            extractTagAttribute(
                tag,
                "alt"
            );

        const id =
            extractTagAttribute(
                tag,
                "id"
            );

        const className =
            extractTagAttribute(
                tag,
                "class"
            );

        const descriptor =
            (
                alt +
                " " +
                id +
                " " +
                className +
                " " +
                src
            ).toLowerCase();

        /*
         * We deliberately require an explicit logo-like
         * signal. This prevents a random article image
         * from being returned as the brand logo.
         */
        if (
            !(
                descriptor.includes("logo") ||
                descriptor.includes("wordmark") ||
                descriptor.includes("logotype") ||
                descriptor.includes("brand")
            )
        ) {
            continue;
        }

        const resolved =
            resolveUrl(
                src,
                baseUrl
            );

        if (resolved) {
            logos.push(resolved);
        }
    }

    return logos;
}


/* ============================================================
 * IMAGE VALIDATION
 * ============================================================
 */

async function validateImageUrl(url) {
    if (!url) {
        return false;
    }

    try {
        const response =
            await axios.get(
                url,
                {
                    timeout:
                        IMAGE_TIMEOUT_MS,
                    responseType:
                        "arraybuffer",
                    maxContentLength:
                        1_500_000,
                    maxBodyLength:
                        1_500_000,
                    maxRedirects: 4,
                    validateStatus:
                        () => true,
                    headers: {
                        "User-Agent":
                            USER_AGENT,
                        "Accept":
                            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
                    }
                }
            );

        const contentType =
            String(
                response.headers[
                    "content-type"
                ] || ""
            ).toLowerCase();

        return (
            response.status >= 200 &&
            response.status < 300 &&
            contentType.startsWith(
                "image/"
            )
        );
    } catch {
        return false;
    }
}


/* ============================================================
 * WEBSITE INSPECTION
 * ============================================================
 */

async function inspectWebsite(
    requestedUrl,
    sender,
    searchCandidate
) {
    try {
        const page =
            await httpGetText(
                requestedUrl,
                WEBSITE_TIMEOUT_MS
            );

        const finalUrl =
            normalizeCandidateUrl(
                page.finalUrl
            ) ||
            normalizeCandidateUrl(
                requestedUrl
            );

        if (!finalUrl) {
            return null;
        }

        const finalDomain =
            extractDomain(
                finalUrl
            );

        if (
            !isAcceptableDomain(
                finalDomain
            )
        ) {
            return null;
        }

        const registrableDomain =
            getRegistrableDomain(
                finalDomain
            );

        const html =
            page.html;

        const title =
            extractTitle(html);

        const siteName =
            cleanWebsiteBrandName(
                extractMetaContent(
                    html,
                    "property",
                    "og:site_name"
                ) ||
                extractMetaContent(
                    html,
                    "name",
                    "application-name"
                )
            );

        const description =
            extractMetaContent(
                html,
                "name",
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

        const icons =
            extractLinkIcons(
                html,
                finalUrl
            );

        const logoCandidates =
            extractExplicitLogoImages(
                html,
                finalUrl
            );

        /*
         * Only validate a small number of images.
         * Image validation is one of the expensive operations.
         */

        let logoUrl = "";

        const logoPool =
            [
                schema.logo,
                ...logoCandidates
            ]
                .filter(Boolean)
                .filter(
                    (value, index, array) =>
                        array.indexOf(value) ===
                        index
                )
                .slice(0, 4);

        for (
            const candidate of logoPool
        ) {
            if (
                await validateImageUrl(
                    candidate
                )
            ) {
                logoUrl =
                    candidate;

                break;
            }
        }

        let faviconUrl = "";

        const faviconPool =
            icons
                .filter(Boolean)
                .filter(
                    (value, index, array) =>
                        array.indexOf(value) ===
                        index
                )
                .slice(0, 4);

        for (
            const candidate of faviconPool
        ) {
            if (
                await validateImageUrl(
                    candidate
                )
            ) {
                faviconUrl =
                    candidate;

                break;
            }
        }

        /*
         * DO NOT manufacture:
         *
         * https://domain/favicon.ico
         *
         * unless the site actually advertised it.
         */

        const domainName =
            cleanWebsiteBrandName(
                finalDomain
                    .replace(
                        /^www\./i,
                        ""
                    )
                    .split(".")
                    .slice(
                        0,
                        -1
                    )
                    .join(" ")
            );

        const brandName =
            firstNonBlank(
                schema.name,
                siteName,
                domainName,
                title
            );

        return {
            sourceUrl: finalUrl,
            domain: finalDomain,
            registrableDomain,

            brandName:
                cleanWebsiteBrandName(
                    brandName
                ),

            logoUrl,
            faviconUrl,

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

            canonicalUrl,

            searchTitle:
                searchCandidate?.title || "",

            searchSnippet:
                searchCandidate?.snippet || ""
        };

    } catch (error) {
        console.warn(
            "[SMS BRAND] Website inspection failed:",
            requestedUrl,
            error.message
        );

        return null;
    }
}


/* ============================================================
 * WEBSITE SCORING
 * ============================================================
 */

function scoreWebsite(
    website,
    sender,
    country,
    searchScore
) {
    if (!website) {
        return 0;
    }

    const senderNormalized =
        normalizeForComparison(
            sender
        );

    const senderCore =
        deriveSenderCore(sender);

    const senderTokens =
        deriveSenderTokens(sender);

    const domainNormalized =
        normalizeForComparison(
            website.domain
        );

    const titleNormalized =
        normalizeForComparison(
            website.title
        );

    const siteNameNormalized =
        normalizeForComparison(
            website.siteName
        );

    const schemaNameNormalized =
        normalizeForComparison(
            website.schemaName
        );

    let score = 0;

    /*
     * Search relevance.
     *
     * Normalize search score into a modest contribution.
     */
    score +=
        Math.min(
            2.0,
            searchScore * 0.35
        );

    /*
     * Strong domain identity.
     */
    if (
        senderNormalized &&
        domainNormalized.includes(
            senderNormalized
        )
    ) {
        score += 3.0;
    }

    if (
        senderCore.length >= 4 &&
        domainNormalized.includes(
            senderCore
        )
    ) {
        score += 2.5;
    }

    if (
        senderTokens.some(
            token =>
                token.length >= 4 &&
                domainNormalized.includes(
                    token
                )
        )
    ) {
        score += 1.5;
    }

    /*
     * Page identity.
     */
    if (
        senderCore.length >= 4 &&
        titleNormalized.includes(
            senderCore
        )
    ) {
        score += 1.75;
    }

    if (
        senderCore.length >= 4 &&
        siteNameNormalized.includes(
            senderCore
        )
    ) {
        score += 2.25;
    }

    if (
        senderCore.length >= 4 &&
        schemaNameNormalized.includes(
            senderCore
        )
    ) {
        score += 3.0;
    }

    if (
        senderTokens.some(
            token =>
                token.length >= 4 &&
                schemaNameNormalized.includes(
                    token
                )
        )
    ) {
        score += 1.5;
    }

    /*
     * Country.
     */
    if (
        countryMatchesDomain(
            website.domain,
            country
        )
    ) {
        score += 0.75;
    }

    /*
     * Official/corporate evidence.
     */
    if (
        containsOfficialSignal(
            website.title +
            " " +
            website.siteName +
            " " +
            website.description
        )
    ) {
        score += 0.75;
    }

    /*
     * Canonical identity.
     */
    if (
        website.canonicalUrl &&
        getRegistrableDomain(
            extractDomain(
                website.canonicalUrl
            )
        ) ===
            website.registrableDomain
    ) {
        score += 0.5;
    }

    /*
     * Real identity assets.
     */
    if (website.logoUrl) {
        score += 1.0;
    }

    if (website.faviconUrl) {
        score += 0.35;
    }

    /*
     * SameAs is useful identity evidence.
     */
    if (
        Array.isArray(
            website.schemaSameAs
        ) &&
        website.schemaSameAs.length > 0
    ) {
        score += 0.4;
    }

    /*
     * CRITICAL:
     *
     * Do not let a website win merely because
     * it has a title/logo/favicon.
     *
     * There must be sender identity evidence.
     */
    const hasIdentityEvidence =
        (
            senderNormalized &&
            domainNormalized.includes(
                senderNormalized
            )
        ) ||
        (
            senderCore.length >= 4 &&
            domainNormalized.includes(
                senderCore
            )
        ) ||
        (
            senderCore.length >= 4 &&
            titleNormalized.includes(
                senderCore
            )
        ) ||
        (
            senderCore.length >= 4 &&
            siteNameNormalized.includes(
                senderCore
            )
        ) ||
        (
            senderCore.length >= 4 &&
            schemaNameNormalized.includes(
                senderCore
            )
        ) ||
        senderTokens.some(
            token =>
                token.length >= 4 &&
                domainNormalized.includes(
                    token
                )
        );

    if (!hasIdentityEvidence) {
        score =
            Math.min(
                score,
                2.75
            );
    }

    /*
     * Convert the Android-style evidence score
     * to a 0..1 confidence.
     *
     * Strong matches normally land around 0.8-0.98.
     */
    const confidence =
        Math.max(
            0,
            Math.min(
                1,
                score / 10
            )
        );

    return confidence;
}


/* ============================================================
 * BRAND NAME SELECTION
 * ============================================================
 */

function chooseBestBrandName(
    sender,
    website
) {
    const candidates = [
        website.schemaName,
        website.siteName,
        website.brandName,
        cleanWebsiteBrandName(
            website.title
        )
    ];

    const senderCore =
        deriveSenderCore(sender);

    /*
     * Prefer names that agree with the sender.
     */
    for (
        const candidate of candidates
    ) {
        const cleaned =
            cleanWebsiteBrandName(
                candidate
            );

        if (!cleaned) {
            continue;
        }

        if (
            isGenericWebsiteName(
                cleaned
            )
        ) {
            continue;
        }

        const normalized =
            normalizeForComparison(
                cleaned
            );

        if (
            senderCore.length >= 4 &&
            (
                normalized.includes(
                    senderCore
                ) ||
                senderCore.includes(
                    normalized
                )
            )
        ) {
            return cleaned;
        }
    }

    /*
     * Otherwise use the first non-generic identity.
     */
    for (
        const candidate of candidates
    ) {
        const cleaned =
            cleanWebsiteBrandName(
                candidate
            );

        if (
            cleaned &&
            !isGenericWebsiteName(
                cleaned
            )
        ) {
            return cleaned;
        }
    }

    return "";
}


/* ============================================================
 * SEARCH DISCOVERY
 * ============================================================
 */

async function discoverWebCandidates(
    sender,
    country
) {
    const queries =
        buildSearchQueries(
            sender,
            country
        );

    if (!queries.length) {
        return [];
    }

    const candidates = [];
    const seenDomains = new Set();

    function addCandidates(values) {
        for (const candidate of values) {
            if (
                !candidate ||
                !candidate.url
            ) {
                continue;
            }

            const domain =
                getRegistrableDomain(
                    extractDomain(
                        candidate.url
                    )
                );

            if (!domain) {
                continue;
            }

            if (
                seenDomains.has(domain)
            ) {
                continue;
            }

            seenDomains.add(domain);

            candidates.push(
                candidate
            );

            if (
                candidates.length >=
                MAX_SEARCH_CANDIDATES
            ) {
                break;
            }
        }
    }


    /*
     * ========================================================
     * PRIMARY SEARCH
     * ========================================================
     *
     * Run the primary query across engines in parallel.
     *
     * This is faster than:
     *
     * DDG → wait → Bing → wait → Google
     *
     * which was contributing heavily to the Render latency.
     */

    const primaryQuery =
        queries[0];

    console.log(
        `[SMS BRAND] Primary search: "${primaryQuery}"`
    );

    const primaryTasks = [];

    if (
        !isProviderCoolingDown(
            PROVIDER_GOOGLE
        )
    ) {
        primaryTasks.push(
            searchGoogle(
                primaryQuery
            )
        );
    }

    if (
        !isProviderCoolingDown(
            PROVIDER_BING
        )
    ) {
        primaryTasks.push(
            searchBing(
                primaryQuery
            )
        );
    }

    /*
     * DDG is deliberately fallback-first because
     * Render has repeatedly shown DDG timeouts.
     */
    const primaryResults =
        await Promise.allSettled(
            primaryTasks
        );

    for (
        const result of primaryResults
    ) {
        if (
            result.status ===
                "fulfilled"
        ) {
            addCandidates(
                result.value
            );
        }
    }

    /*
     * ========================================================
     * SECONDARY SEARCH
     * ========================================================
     */

    if (
        candidates.length < 4 &&
        queries.length > 1
    ) {
        const secondaryQuery =
            queries[1];

        console.log(
            `[SMS BRAND] Secondary search: "${secondaryQuery}"`
        );

        const secondaryTasks = [];

        if (
            !isProviderCoolingDown(
                PROVIDER_GOOGLE
            )
        ) {
            secondaryTasks.push(
                searchGoogle(
                    secondaryQuery
                )
            );
        }

        if (
            !isProviderCoolingDown(
                PROVIDER_BING
            )
        ) {
            secondaryTasks.push(
                searchBing(
                    secondaryQuery
                )
            );
        }

        const secondaryResults =
            await Promise.allSettled(
                secondaryTasks
            );

        for (
            const result of secondaryResults
        ) {
            if (
                result.status ===
                    "fulfilled"
            ) {
                addCandidates(
                    result.value
                );
            }
        }
    }

    /*
     * ========================================================
     * DDG FALLBACK
     * ========================================================
     *
     * Only use DDG when Google/Bing did not give
     * us enough usable domains.
     */

    if (
        candidates.length < 3 &&
        !isProviderCoolingDown(
            PROVIDER_DDG
        )
    ) {
        console.log(
            `[SMS BRAND] DDG fallback for "${primaryQuery}"`
        );

        addCandidates(
            await searchDuckDuckGo(
                primaryQuery
            )
        );
    }

    console.log(
        `[SMS BRAND] Search produced ${candidates.length} valid external candidates`
    );

    return rankSearchCandidates(
        candidates,
        sender,
        country
    );
}


/* ============================================================
 * RESULT HELPERS
 * ============================================================
 */

function unknownResult(
    senderKey
) {
    return {
        status: "UNKNOWN",

        senderKey,

        brandName: "",
        logoUrl: "",
        faviconUrl: "",

        confidence: 0,
        verified: false,

        websiteUrl: "",

        cachedAt: Date.now()
    };
}


function foundResult(
    senderKey,
    website,
    confidence
) {
    const finalBrand =
        chooseBestBrandName(
            senderKey,
            website
        );

    /*
     * Actual logo has priority.
     * Favicon is fallback.
     *
     * Neither is manufactured.
     */
    const finalLogo =
        website.logoUrl ||
        website.faviconUrl ||
        "";

    return {
        status: "FOUND",

        senderKey,

        brandName:
            finalBrand,

        logoUrl:
            finalLogo,

        faviconUrl:
            website.faviconUrl || "",

        confidence:
            Number(
                confidence.toFixed(3)
            ),

        verified:
            confidence >= 0.80 &&
            Boolean(finalBrand) &&
            Boolean(
                website.logoUrl ||
                website.faviconUrl
            ),

        websiteUrl:
            website.sourceUrl || "",

        cachedAt: Date.now()
    };
}


/* ============================================================
 * CACHE
 * ============================================================
 */

function getMemoryCache(
    senderKey
) {
    const entry =
        memoryCache.get(
            senderKey
        );

    if (!entry) {
        return null;
    }

    const age =
        Date.now() -
        entry.cachedAt;

    const ttl =
        entry.result.status ===
            "FOUND"
            ? FOUND_CACHE_TTL_MS
            : UNKNOWN_CACHE_TTL_MS;

    if (age > ttl) {
        memoryCache.delete(
            senderKey
        );

        return null;
    }

    return entry.result;
}


function putMemoryCache(
    senderKey,
    result
) {
    memoryCache.set(
        senderKey,
        {
            cachedAt: Date.now(),
            result
        }
    );

    /*
     * Keep memory bounded.
     */
    if (
        memoryCache.size > 1000
    ) {
        const firstKey =
            memoryCache.keys().next().value;

        if (firstKey) {
            memoryCache.delete(
                firstKey
            );
        }
    }
}


/* ============================================================
 * MAIN RESOLVER
 * ============================================================
 */

async function resolveSender(
    sender,
    options = {}
) {
    const cleanSender =
        normalizeSender(sender);

    const senderKey =
        cleanSender.toLowerCase();

    const country =
        String(
            options.country ||
            "Kenya"
        )
            .trim();

    if (!cleanSender) {
        return unknownResult("");
    }

    /*
     * 1. Fast memory hit.
     */
    const cached =
        getMemoryCache(
            senderKey
        );

    if (cached) {
        console.log(
            `[SMS BRAND] Memory cache hit: "${senderKey}"`
        );

        return cached;
    }

    /*
     * 2. Share in-flight discovery.
     */
    const existingPromise =
        pendingResolutions.get(
            senderKey
        );

    if (existingPromise) {
        console.log(
            `[SMS BRAND] Joining existing resolution: "${senderKey}"`
        );

        return existingPromise;
    }

    /*
     * 3. Start discovery.
     */
    const promise =
        (async () => {
            try {
                console.log(
                    `[SMS BRAND] Starting discovery for "${senderKey}"`
                );

                const candidates =
                    await discoverWebCandidates(
                        cleanSender,
                        country
                    );

                if (!candidates.length) {
                    console.log(
                        `[SMS BRAND] No search candidates found for "${senderKey}"`
                    );

                    const result =
                        unknownResult(
                            senderKey
                        );

                    putMemoryCache(
                        senderKey,
                        result
                    );

                    return result;
                }

                const ranked =
                    candidates
                        .slice(
                            0,
                            MAX_WEBSITES_TO_INSPECT
                        );

                console.log(
                    `[SMS BRAND] Inspecting ${ranked.length} website candidates for "${senderKey}"`
                );

                /*
                 * Inspect websites in parallel.
                 *
                 * This is another major speed improvement.
                 */
                const inspected =
                    await Promise.all(
                        ranked.map(
                            async candidate => {
                                const website =
                                    await inspectWebsite(
                                        candidate.url,
                                        cleanSender,
                                        candidate
                                    );

                                if (!website) {
                                    return null;
                                }

                                const confidence =
                                    scoreWebsite(
                                        website,
                                        cleanSender,
                                        country,
                                        candidate.score
                                    );

                                return {
                                    candidate,
                                    website,
                                    confidence
                                };
                            }
                        )
                    );

                const valid =
                    inspected
                        .filter(Boolean)
                        .sort(
                            (a, b) =>
                                b.confidence -
                                a.confidence
                        );

                if (!valid.length) {
                    console.log(
                        `[SMS BRAND] Website inspection produced no valid identity for "${senderKey}"`
                    );

                    const result =
                        unknownResult(
                            senderKey
                        );

                    putMemoryCache(
                        senderKey,
                        result
                    );

                    return result;
                }

                const best =
                    valid[0];

                console.log(
                    `[SMS BRAND] Best candidate: ${best.website.domain} -> ${best.website.brandName} (confidence=${best.confidence.toFixed(3)})`
                );

                /*
                 * Final confidence gate.
                 */
                if (
                    best.confidence <
                    MIN_CONFIDENCE
                ) {
                    console.log(
                        `[SMS BRAND] Candidate rejected: confidence=${best.confidence.toFixed(3)} < ${MIN_CONFIDENCE}`
                    );

                    const result =
                        unknownResult(
                            senderKey
                        );

                    putMemoryCache(
                        senderKey,
                        result
                    );

                    return result;
                }

                const result =
                    foundResult(
                        senderKey,
                        best.website,
                        best.confidence
                    );

                console.log(
                    `[SMS BRAND] Resolved "${senderKey}" -> "${result.brandName}" verified=${result.verified}`
                );

                /*
                 * Cache only the final in-memory result.
                 *
                 * Nothing is written to Firebase.
                 */
                putMemoryCache(
                    senderKey,
                    result
                );

                return result;

            } catch (error) {
                console.error(
                    `[SMS BRAND] Resolution failed for "${senderKey}":`,
                    error
                );

                const result =
                    unknownResult(
                        senderKey
                    );

                /*
                 * Short UNKNOWN cache only.
                 */
                putMemoryCache(
                    senderKey,
                    result
                );

                return result;

            } finally {
                pendingResolutions.delete(
                    senderKey
                );
            }
        })();

    pendingResolutions.set(
        senderKey,
        promise
    );

    return promise;
}


/* ============================================================
 * EXPORT
 * ============================================================
 */

module.exports = {
    resolveSender
};