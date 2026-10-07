"use strict";

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

const SEARCH_TIMEOUT =
    Number(process.env.SMS_BRAND_SEARCH_TIMEOUT_MS) ||
    6000;

const WEBSITE_TIMEOUT =
    Number(process.env.SMS_BRAND_WEBSITE_TIMEOUT_MS) ||
    7000;

const IMAGE_TIMEOUT =
    Number(process.env.SMS_BRAND_IMAGE_TIMEOUT_MS) ||
    5000;

const MAX_HTML_BYTES =
    2 * 1024 * 1024;

const MAX_IMAGE_BYTES =
    5 * 1024 * 1024;

const MAX_SEARCH_RESULTS = 24;

const MAX_CANDIDATES_TO_INSPECT = 6;

// ============================================================
// MEMORY CACHE
// ============================================================

const memoryCache = new Map();

// ============================================================
// HTTP HEADERS
// ============================================================

const BROWSER_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/128.0 Safari/537.36",

    "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

    "Accept-Language":
        "en-US,en;q=0.9"
};

// ============================================================
// DOMAINS THAT MUST NEVER BECOME BRANDS
// ============================================================

const BLOCKED_REGISTRABLE_DOMAINS = new Set([
    "google.com",
    "google.co.uk",
    "google.co.ke",
    "googleusercontent.com",

    "bing.com",
    "bing.co.uk",

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
    "pinterest.com",

    "medium.com",
    "quora.com",

    "github.com",
    "gitlab.com",

    "stackoverflow.com",
    "stackexchange.com",

    "tripadvisor.com",
    "trustpilot.com",

    "amazon.com",
    "amazon.co.uk",
    "amazon.co.ke",

    "apple.com",
    "microsoft.com",

    "cloudflare.com"
]);

const SEARCH_INFRASTRUCTURE_HOSTS = new Set([
    "www.google.com",
    "google.com",
    "www.bing.com",
    "bing.com",
    "html.duckduckgo.com",
    "duckduckgo.com",
    "search.yahoo.com"
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

function normalizeComparableText(value) {
    return cleanText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

function senderTokens(sender) {
    return normalizeSender(sender)
        .split(/[\s._-]+/)
        .filter(Boolean);
}

function senderCore(sender) {
    const tokens = senderTokens(sender);

    if (tokens.length === 0) {
        return "";
    }

    return tokens
        .filter(token => token.length >= 3)
        .join("");
}

function decodeHtmlEntities(value) {
    let text = String(value || "");

    text = text
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#x2f;/gi, "/")
        .replace(/&#47;/gi, "/")
        .replace(/&#x27;/gi, "'")
        .replace(/&#34;/gi, '"')
        .replace(/&#x3d;/gi, "=")
        .replace(/&#61;/gi, "=");

    text = text.replace(
        /&#(\d+);/g,
        (_, code) => {
            try {
                return String.fromCharCode(
                    Number(code)
                );
            } catch {
                return _;
            }
        }
    );

    return text;
}

function stripHtml(value) {
    return decodeHtmlEntities(
        String(value || "")
            .replace(
                /<script\b[^>]*>[\s\S]*?<\/script>/gi,
                " "
            )
            .replace(
                /<style\b[^>]*>[\s\S]*?<\/style>/gi,
                " "
            )
            .replace(/<[^>]+>/g, " ")
    );
}

function cleanText(value) {
    return stripHtml(value)
        .replace(/\s+/g, " ")
        .trim();
}

function cleanBrandName(value) {
    let text = cleanText(value);

    if (!text) {
        return "";
    }

    text = text
        .replace(/\s+/g, " ")
        .trim();

    text = text
        .replace(
            /\s*[-|–—:]\s*(official|home|homepage|website|contact|login|sign in)\s*$/i,
            ""
        )
        .trim();

    text = text
        .replace(
            /\s+(official website|official site)$/i,
            ""
        )
        .trim();

    text = text
        .replace(
            /^(welcome to|welcome)\s+/i,
            ""
        )
        .trim();

    if (text.length > 100) {
        text = text.substring(0, 100).trim();
    }

    return text;
}

// ============================================================
// URL HELPERS
// ============================================================

function safeUrl(rawUrl, baseUrl = null) {
    try {
        if (!rawUrl) {
            return null;
        }

        let value = decodeHtmlEntities(
            String(rawUrl).trim()
        );

        value = value
            .replace(/\\u003d/gi, "=")
            .replace(/\\u0026/gi, "&")
            .replace(/\\\//g, "/");

        if (!value) {
            return null;
        }

        if (value.startsWith("//")) {
            value = "https:" + value;
        }

        if (
            baseUrl &&
            !/^https?:\/\//i.test(value)
        ) {
            value = new URL(
                value,
                baseUrl
            ).href;
        }

        const parsed = new URL(value);

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
    const host = String(hostname || "")
        .toLowerCase()
        .replace(/^www\./, "")
        .trim();

    if (!host) {
        return "";
    }

    const parts = host
        .split(".")
        .filter(Boolean);

    if (parts.length <= 2) {
        return host;
    }

    const compoundSuffixes = new Set([
        "co.uk",
        "org.uk",
        "ac.uk",
        "gov.uk",

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
        "org.za",
        "net.za",

        "co.ng",
        "com.ng",

        "co.gh",
        "com.gh",

        "com.au",
        "net.au",
        "org.au",

        "co.nz",
        "net.nz",
        "org.nz",

        "co.in",
        "firm.in",
        "net.in",
        "org.in",

        "com.sg",
        "com.my",
        "com.mx",
        "com.br",
        "com.tr",
        "com.ar",
        "com.ph",
        "com.pk",
        "com.bd",
        "com.eg",
        "com.sa",
        "com.ae"
    ]);

    const lastTwo = parts
        .slice(-2)
        .join(".");

    if (
        compoundSuffixes.has(lastTwo) &&
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

    if (
        BLOCKED_REGISTRABLE_DOMAINS.has(
            domain
        )
    ) {
        return true;
    }

    const host =
        hostnameFromUrl(url);

    return SEARCH_INFRASTRUCTURE_HOSTS.has(
        host
    );
}

function isAcceptableDomain(domain) {
    const normalized =
        String(domain || "")
            .toLowerCase()
            .replace(/^www\./, "")
            .trim();

    if (!normalized) {
        return false;
    }

    if (
        BLOCKED_REGISTRABLE_DOMAINS.has(
            normalized
        )
    ) {
        return false;
    }

    if (
        normalized === "localhost" ||
        normalized.includes("example.com")
    ) {
        return false;
    }

    if (
        !normalized.includes(".")
    ) {
        return false;
    }

    return /^[a-z0-9.-]+$/.test(
        normalized
    );
}

function isUsableExternalUrl(url) {
    if (!url) {
        return false;
    }

    try {
        const parsed = new URL(url);

        if (
            parsed.protocol !== "http:" &&
            parsed.protocol !== "https:"
        ) {
            return false;
        }

        const domain =
            registrableDomainFromUrl(url);

        if (
            !isAcceptableDomain(domain)
        ) {
            return false;
        }

        return !isBlockedDomain(url);
    } catch {
        return false;
    }
}

// ============================================================
// SEARCH URL NORMALIZATION
// ============================================================

function extractQueryParameter(
    url,
    parameter
) {
    try {
        const parsed = new URL(url);

        return (
            parsed.searchParams.get(
                parameter
            ) || ""
        );
    } catch {
        return "";
    }
}

function normalizeSearchResultUrl(
    rawUrl,
    engine
) {
    if (!rawUrl) {
        return null;
    }

    let value =
        decodeHtmlEntities(
            String(rawUrl).trim()
        );

    value = value
        .replace(/\\u003d/gi, "=")
        .replace(/\\u0026/gi, "&")
        .replace(/\\\//g, "/");

    if (
        value.startsWith("/")
    ) {
        if (
            engine === "google"
        ) {
            value =
                "https://www.google.com" +
                value;
        } else if (
            engine === "bing"
        ) {
            value =
                "https://www.bing.com" +
                value;
        } else if (
            engine === "duckduckgo"
        ) {
            value =
                "https://duckduckgo.com" +
                value;
        }
    }

    let url =
        safeUrl(value);

    if (!url) {
        return null;
    }

    try {
        const parsed =
            new URL(url);

        const host =
            parsed.hostname.toLowerCase();

        // Google /url?q=...
        if (
            host === "google.com" ||
            host.endsWith(".google.com")
        ) {
            const target =
                parsed.searchParams.get("q") ||
                parsed.searchParams.get("url");

            if (target) {
                url =
                    safeUrl(
                        decodeURIComponent(
                            target
                        )
                    );
            }
        }

        // Bing /url?u=...
        if (
            host === "bing.com" ||
            host.endsWith(".bing.com")
        ) {
            const target =
                parsed.searchParams.get("u") ||
                parsed.searchParams.get("url");

            if (target) {
                url =
                    safeUrl(
                        decodeURIComponent(
                            target
                        )
                    );
            }
        }

        // DuckDuckGo /l/?uddg=...
        if (
            host === "duckduckgo.com" ||
            host.endsWith(".duckduckgo.com")
        ) {
            const target =
                parsed.searchParams.get(
                    "uddg"
                );

            if (target) {
                url =
                    safeUrl(
                        decodeURIComponent(
                            target
                        )
                    );
            }
        }
    } catch {
        return null;
    }

    if (!url) {
        return null;
    }

    if (
        !isUsableExternalUrl(url)
    ) {
        return null;
    }

    try {
        const parsed = new URL(url);

        parsed.hash = "";

        return parsed.href;
    } catch {
        return null;
    }
}

// ============================================================
// SEARCH CANDIDATE EXTRACTION
// ============================================================

function extractAnchorCandidates(
    html,
    engine
) {
    const results = [];

    const regex =
        /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;

    let match;

    while (
        (match = regex.exec(html || "")) !== null
    ) {
        const rawUrl =
            match[1] ||
            match[2] ||
            match[3] ||
            "";

        const title =
            cleanText(match[4]);

        const url =
            normalizeSearchResultUrl(
                rawUrl,
                engine
            );

        if (!url) {
            continue;
        }

        if (!title) {
            continue;
        }

        const contextStart =
            Math.max(
                0,
                match.index - 500
            );

        const contextEnd =
            Math.min(
                String(html).length,
                regex.lastIndex + 1000
            );

        const context =
            cleanText(
                String(html).substring(
                    contextStart,
                    contextEnd
                )
            );

        results.push({
            url,
            title,
            snippet: context,
            engine
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
// SEARCH ENGINES
// ============================================================

async function searchBing(query) {
    try {
        const response =
            await axios.get(
                "https://www.bing.com/search",
                {
                    params: {
                        q: query,
                        count: 10,
                        setlang: "en-US"
                    },

                    timeout:
                        SEARCH_TIMEOUT,

                    maxContentLength:
                        MAX_HTML_BYTES,

                    maxBodyLength:
                        MAX_HTML_BYTES,

                    headers:
                        BROWSER_HEADERS,

                    validateStatus:
                        status =>
                            status >= 200 &&
                            status < 400
                }
            );

        return extractAnchorCandidates(
            response.data,
            "bing"
        );
    } catch (error) {
        console.error(
            "[SMS BRAND] Bing search failed:",
            error.message
        );

        return [];
    }
}

async function searchDuckDuckGo(query) {
    try {
        const response =
            await axios.get(
                "https://html.duckduckgo.com/html/",
                {
                    params: {
                        q: query
                    },

                    timeout:
                        SEARCH_TIMEOUT,

                    maxContentLength:
                        MAX_HTML_BYTES,

                    maxBodyLength:
                        MAX_HTML_BYTES,

                    headers:
                        BROWSER_HEADERS,

                    validateStatus:
                        status =>
                            status >= 200 &&
                            status < 400
                }
            );

        return extractAnchorCandidates(
            response.data,
            "duckduckgo"
        );
    } catch (error) {
        console.error(
            "[SMS BRAND] DuckDuckGo search failed:",
            error.message
        );

        return [];
    }
}

async function searchGoogle(query) {
    try {
        const response =
            await axios.get(
                "https://www.google.com/search",
                {
                    params: {
                        q: query,
                        num: 10,
                        hl: "en"
                    },

                    timeout:
                        SEARCH_TIMEOUT,

                    maxContentLength:
                        MAX_HTML_BYTES,

                    maxBodyLength:
                        MAX_HTML_BYTES,

                    headers:
                        BROWSER_HEADERS,

                    validateStatus:
                        status =>
                            status >= 200 &&
                            status < 400
                }
            );

        return extractAnchorCandidates(
            response.data,
            "google"
        );
    } catch (error) {
        console.error(
            "[SMS BRAND] Google search failed:",
            error.message
        );

        return [];
    }
}

// ============================================================
// SEARCH SCORING
// ============================================================

function containsOfficialSignal(text) {
    return /\b(official|official website|official site|corporation|company|telecom|bank|airlines|insurance|government)\b/i
        .test(text || "");
}

function scoreSearchCandidate(
    candidate,
    sender
) {
    const normalizedSender =
        normalizeComparableText(
            sender
        );

    const core =
        normalizeComparableText(
            senderCore(sender)
        );

    const tokens =
        senderTokens(sender)
            .map(normalizeComparableText)
            .filter(
                token =>
                    token.length >= 3
            );

    const domain =
        registrableDomainFromUrl(
            candidate.url
        );

    if (!domain) {
        return 0;
    }

    const domainName =
        domain
            .split(".")[0] || "";

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

    // Strong domain identity.
    if (
        normalizedDomain ===
        normalizedSender
    ) {
        score += 3.0;
    } else if (
        core.length >= 4 &&
        normalizedDomain.includes(core)
    ) {
        score += 2.4;
    } else if (
        tokens.some(
            token =>
                token.length >= 4 &&
                normalizedDomain.includes(token)
        )
    ) {
        score += 1.7;
    }

    // Strong title identity.
    if (
        core.length >= 4 &&
        title.includes(core)
    ) {
        score += 2.0;
    } else if (
        normalizedSender &&
        title.includes(normalizedSender)
    ) {
        score += 2.0;
    } else if (
        tokens.some(
            token =>
                token.length >= 4 &&
                title.includes(token)
        )
    ) {
        score += 1.0;
    }

    // Snippet identity.
    if (
        core.length >= 4 &&
        snippet.includes(core)
    ) {
        score += 0.8;
    }

    // Official signal.
    if (
        containsOfficialSignal(
            candidate.title +
            " " +
            candidate.snippet
        )
    ) {
        score += 0.5;
    }

    // Never allow an unrelated domain to win
    // merely because its title says "official".
    const identityEvidence =
        normalizedDomain === normalizedSender ||
        (
            core.length >= 4 &&
            normalizedDomain.includes(core)
        ) ||
        tokens.some(
            token =>
                token.length >= 4 &&
                normalizedDomain.includes(token)
        ) ||
        (
            core.length >= 4 &&
            title.includes(core)
        );

    if (!identityEvidence) {
        score = Math.min(
            score,
            1.0
        );
    }

    return score;
}

// ============================================================
// SEARCH DEDUPLICATION
// ============================================================

function dedupeSearchCandidates(
    candidates,
    sender
) {
    const byDomain = new Map();

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

        const score =
            scoreSearchCandidate(
                candidate,
                sender
            );

        const existing =
            byDomain.get(domain);

        if (
            !existing ||
            score >
                existing.searchScore
        ) {
            byDomain.set(
                domain,
                {
                    ...candidate,
                    searchScore: score
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

async function searchBrand(sender) {
    const queries = [
        `"${sender}" official`,
        `"${sender}" official website`,
        `${sender} company`
    ];

    console.log(
        `[SMS BRAND] Running ${
            queries.length * 3
        } search requests for "${sender}"`
    );

    const tasks = [];

    for (
        const query of queries
    ) {
        tasks.push(
            searchGoogle(query)
        );

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

    const candidates =
        dedupeSearchCandidates(
            rawCandidates,
            sender
        );

    console.log(
        `[SMS BRAND] Search produced ${
            rawCandidates.length
        } raw candidates, ${
            candidates.length
        } valid external candidates`
    );

    if (
        candidates.length === 0
    ) {
        console.log(
            `[SMS BRAND] No search candidates found for "${sender}"`
        );
    }

    return candidates;
}

// ============================================================
// HTML EXTRACTION
// ============================================================

function extractTitle(html) {
    const match =
        String(html || "").match(
            /<title\b[^>]*>([\s\S]*?)<\/title>/i
        );

    return match
        ? cleanBrandName(match[1])
        : "";
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
        (match = regex.exec(
            html || ""
        )) !== null
    ) {
        const tag =
            match[0];

        const nameMatch =
            tag.match(
                /\b(?:name|property|itemprop)\s*=\s*["']([^"']+)["']/i
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
                /\bcontent\s*=\s*["']([^"']+)["']/i
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

function extractCanonical(
    html,
    baseUrl
) {
    const regex =
        /<link\b[^>]*>/gi;

    let match;

    while (
        (match = regex.exec(
            html || ""
        )) !== null
    ) {
        const tag =
            match[0];

        const relMatch =
            tag.match(
                /\brel\s*=\s*["']([^"']+)["']/i
            );

        if (
            !relMatch ||
            !/\bcanonical\b/i.test(
                relMatch[1]
            )
        ) {
            continue;
        }

        const hrefMatch =
            tag.match(
                /\bhref\s*=\s*["']([^"']+)["']/i
            );

        if (!hrefMatch) {
            continue;
        }

        return (
            safeUrl(
                hrefMatch[1],
                baseUrl
            ) || ""
        );
    }

    return "";
}

// ============================================================
// JSON-LD
// ============================================================

function extractJsonLdObjects(html) {
    const results = [];

    const regex =
        /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

    let match;

    while (
        (match = regex.exec(
            html || ""
        )) !== null
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
                results.push(
                    ...parsed.filter(
                        item =>
                            item &&
                            typeof item ===
                                "object"
                    )
                );
            } else if (
                parsed &&
                typeof parsed ===
                    "object"
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
        if (
            !object ||
            typeof object !== "object"
        ) {
            continue;
        }

        const types =
            Array.isArray(
                object["@type"]
            )
                ? object["@type"]
                : [
                    object["@type"]
                ];

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
                    type.includes(
                        "organization"
                    ) ||
                    type.includes(
                        "corporation"
                    ) ||
                    type === "brand" ||
                    type ===
                        "localbusiness"
            );

        if (
            !isOrganization
        ) {
            continue;
        }

        if (
            !name &&
            typeof object.name ===
                "string"
        ) {
            name =
                cleanBrandName(
                    object.name
                );
        }

        if (
            !url &&
            typeof object.url ===
                "string"
        ) {
            url =
                object.url.trim();
        }

        if (!logo) {
            if (
                typeof object.logo ===
                    "string"
            ) {
                logo =
                    object.logo.trim();
            } else if (
                object.logo &&
                typeof object.logo ===
                    "object" &&
                typeof object.logo.url ===
                    "string"
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
// ICON / LOGO EXTRACTION
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
        (match = regex.exec(
            html || ""
        )) !== null
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
                rel.includes("shortcut") ||
                rel.includes("apple-touch")
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

    // Only add /favicon.ico as a fallback.
    const root =
        safeUrl("/", baseUrl);

    if (root) {
        candidates.push(
            new URL(
                "/favicon.ico",
                root
            ).href
        );
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

    const explicitMetaLogo =
        extractMetaContent(
            html,
            [
                "og:logo",
                "logo",
                "twitter:image"
            ]
        );

    if (
        explicitMetaLogo
    ) {
        const url =
            safeUrl(
                explicitMetaLogo,
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
        (match = regex.exec(
            html || ""
        )) !== null
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

        const descriptor = [
            tag.match(
                /\balt\s*=\s*["']([^"']+)["']/i
            )?.[1] || "",

            tag.match(
                /\bclass\s*=\s*["']([^"']+)["']/i
            )?.[1] || "",

            tag.match(
                /\bid\s*=\s*["']([^"']+)["']/i
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

async function validateImageUrl(url) {
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
                    timeout:
                        IMAGE_TIMEOUT,

                    responseType:
                        "arraybuffer",

                    maxContentLength:
                        MAX_IMAGE_BYTES,

                    maxBodyLength:
                        MAX_IMAGE_BYTES,

                    headers: {
                        "User-Agent":
                            BROWSER_HEADERS[
                                "User-Agent"
                            ],

                        Accept:
                            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
                    },

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
            ).toLowerCase();

        return contentType.startsWith(
            "image/"
        );
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
                candidates.filter(Boolean)
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
                    timeout:
                        WEBSITE_TIMEOUT,

                    maxContentLength:
                        MAX_HTML_BYTES,

                    maxBodyLength:
                        MAX_HTML_BYTES,

                    responseType:
                        "text",

                    headers:
                        BROWSER_HEADERS,

                    maxRedirects: 5,

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
            ).toLowerCase();

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

        if (!html) {
            return null;
        }

        let finalUrl =
            websiteUrl;

        try {
            if (
                response.request &&
                response.request.res &&
                response.request.res
                    .responseUrl
            ) {
                finalUrl =
                    response.request
                        .res
                        .responseUrl;
            }
        } catch {
            // Keep original URL.
        }

        if (
            !isUsableExternalUrl(
                finalUrl
            )
        ) {
            return null;
        }

        const title =
            extractTitle(html);

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
                safeUrl(
                    jsonLdIdentity.url,
                    finalUrl
                ) || "",

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
// WEBSITE SCORING
// ============================================================

function identityMatches(
    value,
    sender
) {
    const normalized =
        normalizeComparableText(
            value
        );

    const senderNormalized =
        normalizeComparableText(
            sender
        );

    const core =
        normalizeComparableText(
            senderCore(sender)
        );

    const tokens =
        senderTokens(sender)
            .map(normalizeComparableText)
            .filter(
                token =>
                    token.length >= 3
            );

    if (!normalized) {
        return false;
    }

    if (
        normalized ===
        senderNormalized
    ) {
        return true;
    }

    if (
        core.length >= 4 &&
        normalized.includes(core)
    ) {
        return true;
    }

    return tokens.some(
        token =>
            token.length >= 4 &&
            normalized.includes(token)
    );
}

async function scoreWebsiteCandidate(
    website,
    sender
) {
    if (!website) {
        return null;
    }

    const domain =
        website.registrableDomain;

    if (
        !isAcceptableDomain(domain)
    ) {
        return null;
    }

    const domainName =
        domain
            .split(".")[0] || "";

    const normalizedDomain =
        normalizeComparableText(
            domainName
        );

    const normalizedSender =
        normalizeComparableText(
            sender
        );

    const core =
        normalizeComparableText(
            senderCore(sender)
        );

    const tokens =
        senderTokens(sender)
            .map(normalizeComparableText)
            .filter(
                token =>
                    token.length >= 3
            );

    let score = 0;

    let domainIdentity = false;

    let nameIdentity = false;

    let organizationEvidence = false;

    // --------------------------------------------------------
    // DOMAIN IDENTITY
    // --------------------------------------------------------

    if (
        normalizedDomain ===
        normalizedSender
    ) {
        score += 0.32;
        domainIdentity = true;
    } else if (
        core.length >= 4 &&
        normalizedDomain.includes(core)
    ) {
        score += 0.27;
        domainIdentity = true;
    } else if (
        tokens.some(
            token =>
                token.length >= 4 &&
                normalizedDomain.includes(token)
        )
    ) {
        score += 0.18;
        domainIdentity = true;
    }

    // --------------------------------------------------------
    // ORGANIZATION NAME
    // --------------------------------------------------------

    const identityNames = [
        website.jsonLdName,
        website.ogSiteName,
        website.title
    ].filter(Boolean);

    for (
        const name of identityNames
    ) {
        const normalizedName =
            normalizeComparableText(
                name
            );

        if (
            normalizedName ===
            normalizedSender
        ) {
            score += 0.28;
            nameIdentity = true;
            break;
        }

        if (
            core.length >= 4 &&
            normalizedName.includes(core)
        ) {
            score += 0.20;
            nameIdentity = true;
            break;
        }

        if (
            tokens.some(
                token =>
                    token.length >= 4 &&
                    normalizedName.includes(token)
            )
        ) {
            score += 0.12;
            nameIdentity = true;
            break;
        }
    }

    // --------------------------------------------------------
    // JSON-LD ORGANIZATION EVIDENCE
    // --------------------------------------------------------

    if (
        website.jsonLdName
    ) {
        organizationEvidence =
            true;

        score += 0.12;
    }

    if (
        website.jsonLdUrl
    ) {
        const jsonLdDomain =
            registrableDomainFromUrl(
                website.jsonLdUrl
            );

        if (
            jsonLdDomain &&
            jsonLdDomain === domain
        ) {
            score += 0.08;
        }
    }

    // --------------------------------------------------------
    // SEARCH RELEVANCE
    // --------------------------------------------------------

    if (
        website.searchCandidate
    ) {
        const searchScore =
            Math.min(
                Number(
                    website.searchCandidate
                        .searchScore || 0
                ),
                8
            );

        score +=
            Math.min(
                searchScore / 8,
                0.12
            );
    }

    // --------------------------------------------------------
    // CANONICAL
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
            domain
        ) {
            score += 0.05;
        }
    }

    // --------------------------------------------------------
    // OFFICIAL WEBSITE SIGNAL
    // --------------------------------------------------------

    const pageEvidence = [
        website.title,
        website.description,
        website.ogSiteName
    ]
        .filter(Boolean)
        .join(" ");

    if (
        containsOfficialSignal(
            pageEvidence
        )
    ) {
        score += 0.04;
    }

    // --------------------------------------------------------
    // LOGO
    // --------------------------------------------------------

    const logoCandidates = [
        website.jsonLdLogo,
        ...website.logoCandidates
    ]
        .filter(Boolean)
        .slice(0, 6);

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
    // FAVICON
    // --------------------------------------------------------

    const faviconCandidates =
        website.iconCandidates
            .filter(Boolean)
            .slice(0, 6);

    const verifiedFaviconUrl =
        await findVerifiedImage(
            faviconCandidates
        );

    if (
        verifiedFaviconUrl
    ) {
        score += 0.03;
    }

    // --------------------------------------------------------
    // CRITICAL IDENTITY SAFETY
    // --------------------------------------------------------

    // A valid image/favicon alone must NEVER make an
    // unrelated website a verified brand.

    if (
        !domainIdentity &&
        !nameIdentity
    ) {
        score = Math.min(
            score,
            0.35
        );
    }

    // Organization evidence without sender identity
    // is still insufficient.
    if (
        organizationEvidence &&
        !domainIdentity &&
        !nameIdentity
    ) {
        score = Math.min(
            score,
            0.45
        );
    }

    // --------------------------------------------------------
    // BRAND NAME
    // --------------------------------------------------------

    let brandName =
        cleanBrandName(
            website.jsonLdName ||
            website.ogSiteName ||
            ""
        );

    if (
        !brandName
    ) {
        brandName =
            cleanBrandName(
                website.title
            );
    }

    // Never use search-engine titles.
    if (
        /^(search|results?|microsoft bing|google search|duckduckgo)$/i
            .test(
                brandName
            )
    ) {
        brandName = "";
    }

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
        Boolean(brandName) &&
        Boolean(domainIdentity || nameIdentity) &&
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
            domain,

        searchCandidate:
            website.searchCandidate
    };
}

// ============================================================
// FIND BEST CANDIDATE
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
        inspections.filter(
            Boolean
        );

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
        `[SMS BRAND] Best candidate: ${
            best.registrableDomain
        } -> ${
            best.brandName
        } (score=${
            best.confidence
        })`
    );

    console.log(
        `[SMS BRAND] Verification result for "${sender}": ` +
        `verified=${best.verified}, ` +
        `confidence=${best.confidence}, ` +
        `brand="${best.brandName}", ` +
        `logo=${Boolean(best.logoUrl)}, ` +
        `favicon=${Boolean(best.faviconUrl)}`
    );

    return best;
}

// ============================================================
// RESULT HELPERS
// ============================================================

function unknownResult(
    sender,
    extra = {}
) {
    return {
        status: "UNKNOWN",
        senderKey:
            senderKey(sender),
        brandName: "",
        logoUrl: "",
        faviconUrl: "",
        confidence: 0,
        verified: false,
        ...extra
    };
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
                    Number(
                        memory.cachedAt || 0
                    ) <
                VERIFIED_CACHE_TTL
            ) {
                return memory;
            }

            memoryCache.delete(key);
        }

        if (
            memory.status ===
            "UNKNOWN"
        ) {
            if (
                now -
                    Number(
                        memory.cachedAt || 0
                    ) <
                UNKNOWN_CACHE_TTL
            ) {
                return memory;
            }

            memoryCache.delete(key);
        }

        if (
            memory.status ===
            "DISCOVERING"
        ) {
            if (
                now -
                    Number(
                        memory.discoveryStartedAt ||
                            0
                    ) <
                DISCOVERY_LOCK_TTL
            ) {
                return memory;
            }

            memoryCache.delete(key);
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
// DISTRIBUTED DISCOVERY LOCK
// ============================================================

async function acquireDiscoveryLock(
    sender
) {
    const key =
        senderKey(sender);

    if (!key) {
        return false;
    }

    const lockPath =
        `${CACHE_PATH}/${key}`;

    const now =
        Date.now();

    let acquired = false;

    try {
        await db
            .ref(lockPath)
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

        const result =
            unknownResult(
                sender,
                {
                    cachedAt:
                        Date.now()
                }
            );

        await saveFirebaseCache(
            sender,
            result
        );

        return result;
    }

    const best =
        await findBestCandidate(
            sender,
            candidates
        );

    if (!best) {
        const result =
            unknownResult(
                sender,
                {
                    cachedAt:
                        Date.now()
                }
            );

        await saveFirebaseCache(
            sender,
            result
        );

        return result;
    }

    if (
        !best.verified
    ) {
        const result = {
            status: "UNKNOWN",

            senderKey:
                senderKey(sender),

            brandName:
                best.brandName || "",

            logoUrl:
                best.logoUrl || "",

            faviconUrl:
                best.faviconUrl || "",

            confidence:
                best.confidence || 0,

            verified: false,

            websiteUrl:
                best.websiteUrl || "",

            cachedAt:
                Date.now()
        };

        await saveFirebaseCache(
            sender,
            result
        );

        return result;
    }

    const result = {
        status: "FOUND",

        senderKey:
            senderKey(sender),

        brandName:
            best.brandName,

        logoUrl:
            best.logoUrl,

        faviconUrl:
            best.faviconUrl,

        confidence:
            best.confidence,

        verified: true,

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
        return unknownResult(
            sender
        );
    }

    // --------------------------------------------------------
    // CACHE FIRST
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

            brandName: "",
            logoUrl: "",
            faviconUrl: "",

            confidence: 0,

            verified: false,

            discoveryStartedAt:
                cached.discoveryStartedAt
        };
    }

    // --------------------------------------------------------
    // ACQUIRE DISTRIBUTED LOCK
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

            brandName: "",
            logoUrl: "",
            faviconUrl: "",

            confidence: 0,

            verified: false
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

        const result =
            unknownResult(
                normalized,
                {
                    cachedAt:
                        Date.now()
                }
            );

        await saveFirebaseCache(
            normalized,
            result
        );

        return result;
    }
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
    resolveSender
};