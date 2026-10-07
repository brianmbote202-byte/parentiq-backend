const axios = require("axios");
const { db } = require("../firebase");

const CACHE_PATH = "sms_brand_cache";

const VERIFIED_CACHE_TTL =
    Number(process.env.SMS_BRAND_CACHE_TTL_MS) ||
    30 * 24 * 60 * 60 * 1000;

const DISCOVERY_LOCK_TTL =
    Number(process.env.SMS_BRAND_DISCOVERY_LOCK_TTL_MS) ||
    5 * 60 * 1000;

const MAX_SEARCH_RESULTS = 8;
const MAX_HTML_BYTES = 2 * 1024 * 1024;

const MAX_CANDIDATES_TO_INSPECT = 6;

const memoryCache = new Map();


// ============================================================
// NORMALIZATION
// ============================================================

function normalizeSender(sender) {
    return String(sender || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[^a-z0-9._ -]/g, "")
        .trim();
}


// ============================================================
// URL HELPERS
// ============================================================

function normalizeUrl(url, baseUrl = "") {
    if (!url) {
        return "";
    }

    try {
        const absolute =
            new URL(String(url).trim(), baseUrl || undefined);

        absolute.hash = "";

        return absolute.href;
    } catch {
        return "";
    }
}


function getRegistrableDomain(hostname) {
    const host =
        String(hostname || "")
            .toLowerCase()
            .replace(/^www\./, "")
            .trim();

    if (!host) {
        return "";
    }

    const parts = host.split(".").filter(Boolean);

    if (parts.length <= 2) {
        return host;
    }

    const knownSecondLevelTlds = new Set([
        "co.uk",
        "org.uk",
        "ac.uk",
        "gov.uk",
        "com.au",
        "net.au",
        "org.au",
        "co.nz",
        "com.br",
        "com.cn",
        "com.sg",
        "co.za",
        "co.ke",
        "or.ke",
        "ne.ke",
        "go.ke",
        "ac.ke",
        "sc.ke",
        "me.ke",
        "mobi.ke",
        "tv",
    ]);

    const lastTwo =
        parts.slice(-2).join(".");

    if (knownSecondLevelTlds.has(lastTwo)) {
        return parts.slice(-3).join(".");
    }

    return parts.slice(-2).join(".");
}


function getDomainFromUrl(url) {
    try {
        return new URL(url).hostname
            .toLowerCase()
            .replace(/^www\./, "");
    } catch {
        return "";
    }
}


// ============================================================
// TEXT / HTML HELPERS
// ============================================================

function decodeHtmlEntities(value) {
    return String(value || "")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#x27;/gi, "'")
        .replace(/&#x2F;/gi, "/")
        .replace(/&#(\d+);/g, (_, code) => {
            try {
                return String.fromCharCode(Number(code));
            } catch {
                return "";
            }
        });
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


function extractMeta(html, name) {
    const escaped =
        name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const patterns = [
        new RegExp(
            `<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
            "i"
        ),
        new RegExp(
            `<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["']`,
            "i"
        ),
        new RegExp(
            `<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
            "i"
        ),
        new RegExp(
            `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["']`,
            "i"
        )
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);

        if (match && match[1]) {
            return decodeHtmlEntities(match[1]).trim();
        }
    }

    return "";
}


function extractTitle(html) {
    const match =
        String(html || "").match(
            /<title[^>]*>([\s\S]*?)<\/title>/i
        );

    return match
        ? stripHtml(match[1])
        : "";
}


function extractCanonical(html, baseUrl) {
    const match =
        String(html || "").match(
            /<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["']/i
        ) ||
        String(html || "").match(
            /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical[^"']*["']/i
        );

    if (!match) {
        return "";
    }

    return normalizeUrl(match[1], baseUrl);
}


// ============================================================
// ICON / LOGO EXTRACTION
// ============================================================

function extractIconCandidates(html, baseUrl) {
    const candidates = [];

    const regex =
        /<link\b[^>]*>/gi;

    const tags =
        String(html || "").match(regex) || [];

    for (const tag of tags) {
        const relMatch =
            tag.match(
                /rel=["']([^"']+)["']/i
            );

        const hrefMatch =
            tag.match(
                /href=["']([^"']+)["']/i
            );

        if (!hrefMatch) {
            continue;
        }

        const rel =
            String(
                relMatch?.[1] || ""
            ).toLowerCase();

        const href =
            normalizeUrl(
                hrefMatch[1],
                baseUrl
            );

        if (!href) {
            continue;
        }

        if (
            rel.includes("icon") ||
            rel.includes("apple-touch-icon") ||
            rel.includes("mask-icon")
        ) {
            candidates.push(href);
        }
    }

    return [
        ...new Set(candidates)
    ];
}


function extractLogoCandidates(html, baseUrl) {
    const candidates = [];

    const metaNames = [
        "og:image",
        "og:logo",
        "twitter:image"
    ];

    for (const name of metaNames) {
        const value =
            extractMeta(html, name);

        if (value) {
            const normalized =
                normalizeUrl(
                    value,
                    baseUrl
                );

            if (normalized) {
                candidates.push(normalized);
            }
        }
    }

    const imageRegex =
        /<img\b[^>]*>/gi;

    const imageTags =
        String(html || "").match(imageRegex) || [];

    for (const tag of imageTags) {
        const srcMatch =
            tag.match(
                /\bsrc=["']([^"']+)["']/i
            );

        if (!srcMatch) {
            continue;
        }

        const lower =
            tag.toLowerCase();

        const looksLikeLogo =
            lower.includes("logo") ||
            lower.includes("brand") ||
            lower.includes("header");

        if (!looksLikeLogo) {
            continue;
        }

        const normalized =
            normalizeUrl(
                srcMatch[1],
                baseUrl
            );

        if (normalized) {
            candidates.push(normalized);
        }
    }

    return [
        ...new Set(candidates)
    ];
}


// ============================================================
// JSON-LD
// ============================================================

function extractJsonLd(html) {
    const blocks = [];

    const regex =
        /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

    let match;

    while ((match = regex.exec(html)) !== null) {
        const raw =
            match[1]
                ?.trim();

        if (!raw) {
            continue;
        }

        try {
            blocks.push(
                JSON.parse(raw)
            );
        } catch {
            try {
                const cleaned =
                    raw
                        .replace(
                            /^\s*<!--/,
                            ""
                        )
                        .replace(
                            /-->\s*$/,
                            ""
                        );

                blocks.push(
                    JSON.parse(cleaned)
                );
            } catch {
                // Ignore malformed JSON-LD.
            }
        }
    }

    return blocks;
}


function flattenJsonLd(value) {
    const result = [];

    function visit(item) {
        if (!item) {
            return;
        }

        if (Array.isArray(item)) {
            for (const child of item) {
                visit(child);
            }

            return;
        }

        if (
            typeof item !== "object"
        ) {
            return;
        }

        result.push(item);

        if (Array.isArray(item["@graph"])) {
            visit(item["@graph"]);
        }
    }

    visit(value);

    return result;
}


function extractSchemaOrganization(html, baseUrl) {
    const blocks =
        extractJsonLd(html);

    const objects =
        flattenJsonLd(blocks);

    const organizationTypes = new Set([
        "organization",
        "corporation",
        "localbusiness",
        "brand",
        "store",
        "bankorcreditunion",
        "telecom"
    ]);

    let best = null;

    for (const object of objects) {
        const typeValue =
            object["@type"];

        const types =
            Array.isArray(typeValue)
                ? typeValue
                : [typeValue];

        const normalizedTypes =
            types
                .filter(Boolean)
                .map(
                    type =>
                        String(type)
                            .toLowerCase()
                            .replace(/[^a-z]/g, "")
                );

        const isOrganization =
            normalizedTypes.some(
                type =>
                    organizationTypes.has(type) ||
                    type.includes("organization") ||
                    type.includes("corporation") ||
                    type.includes("telecom")
            );

        if (!isOrganization) {
            continue;
        }

        const name =
            typeof object.name === "string"
                ? object.name.trim()
                : "";

        if (!name) {
            continue;
        }

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
        } else if (
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
            Array.isArray(object.sameAs)
                ? object.sameAs
                    .filter(Boolean)
                    .map(value =>
                        normalizeUrl(
                            value,
                            baseUrl
                        )
                    )
                    .filter(Boolean)
                : [];

        const candidate = {
            name,
            url,
            logo,
            sameAs
        };

        if (
            !best ||
            Boolean(candidate.logo) ||
            Boolean(candidate.url)
        ) {
            best = candidate;
        }
    }

    return (
        best || {
            name: "",
            url: "",
            logo: "",
            sameAs: []
        }
    );
}


// ============================================================
// BRAND NAME CLEANING
// ============================================================

function cleanBrandName(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .replace(
            /\s*[-|–—:]\s*(official|home|homepage|website|site).*$/i,
            ""
        )
        .replace(
            /\s+(official website|official site)$/i,
            ""
        )
        .trim();
}


function isGenericWebsiteName(value) {
    const normalized =
        String(value || "")
            .toLowerCase()
            .trim();

    if (!normalized) {
        return true;
    }

    const genericNames = [
        "home",
        "homepage",
        "welcome",
        "official website",
        "official site",
        "website",
        "online",
        "portal",
        "login",
        "sign in"
    ];

    return genericNames.includes(
        normalized
    );
}


function deriveDomainIdentityName(
    domain,
    registrableDomain
) {
    const source =
        registrableDomain ||
        domain ||
        "";

    const firstPart =
        source
            .split(".")[0]
            .trim();

    if (!firstPart) {
        return "";
    }

    return firstPart
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, char =>
            char.toUpperCase()
        )
        .trim();
}


// ============================================================
// SEARCH CANDIDATE BRAND INFERENCE
// ============================================================

function inferBrandFromSearchCandidate(
    candidate
) {
    const text =
        [
            candidate?.title,
            candidate?.snippet
        ]
            .filter(Boolean)
            .join(" ")
            .trim();

    if (!text) {
        return "";
    }

    return cleanBrandName(
        text
            .substringBefore?.("|") ||
            text
    );
}


// Compatibility helper because String.substringBefore
// does not exist in JavaScript.
function cleanSearchTitle(value) {
    return String(value || "")
        .split("|")[0]
        .split(" - ")[0]
        .split(" – ")[0]
        .trim();
}


function inferBrandFromSearchCandidateSafe(
    candidate
) {
    const text =
        firstNonBlank(
            candidate?.title,
            candidate?.snippet
        );

    if (!text) {
        return "";
    }

    return cleanBrandName(
        cleanSearchTitle(text)
    );
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


// ============================================================
// SEARCH RESULT -> WEBSITE
// ============================================================

function websiteFromSearchCandidate(
    candidate
) {
    if (!candidate?.url) {
        return "";
    }

    try {
        const parsed =
            new URL(candidate.url);

        return `${parsed.protocol}//${parsed.host}/`;
    } catch {
        return "";
    }
}


// ============================================================
// SEARCH ENGINES
// ============================================================

async function searchDuckDuckGo(query) {
    try {
        const response =
            await axios.get(
                "https://html.duckduckgo.com/html/",
                {
                    params: {
                        q: query
                    },
                    timeout: 10000,
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36"
                    },
                    maxContentLength:
                        MAX_HTML_BYTES,
                    maxBodyLength:
                        MAX_HTML_BYTES
                }
            );

        const html =
            String(response.data || "");

        const results = [];

        const regex =
            /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

        let match;

        while (
            (match = regex.exec(html)) !== null
        ) {
            const url =
                decodeHtmlEntities(
                    match[1]
                );

            const title =
                stripHtml(
                    match[2]
                );

            if (!url) {
                continue;
            }

            results.push({
                engine: "duckduckgo",
                url,
                title,
                snippet: ""
            });
        }

        return results;
    } catch (error) {
        console.warn(
            "[SMS BRAND] DuckDuckGo search failed:",
            error.message
        );

        return [];
    }
}


async function searchBing(query) {
    try {
        const response =
            await axios.get(
                "https://www.bing.com/search",
                {
                    params: {
                        q: query
                    },
                    timeout: 10000,
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36",
                        Accept:
                            "text/html,application/xhtml+xml"
                    },
                    maxContentLength:
                        MAX_HTML_BYTES,
                    maxBodyLength:
                        MAX_HTML_BYTES
                }
            );

        const html =
            String(
                response.data || ""
            );

        const results = [];

        const regex =
            /<li[^>]+class=["'][^"']*b_algo[^"']*["'][^>]*>[\s\S]*?<h2[^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?/gi;

        let match;

        while (
            (match = regex.exec(html)) !== null
        ) {
            let url =
                decodeHtmlEntities(
                    match[1]
                ).trim();

            const title =
                stripHtml(
                    match[2]
                );

            const snippet =
                stripHtml(
                    match[3] || ""
                );

            if (!url) {
                continue;
            }

            /*
             * Bing can return redirect URLs such as:
             *
             * https://www.bing.com/ck/a?...
             *
             * Those are not actual brand websites.
             */

            try {
                const parsed =
                    new URL(url);

                const hostname =
                    parsed.hostname
                        .toLowerCase()
                        .replace(/^www\./, "");

                if (
                    hostname === "bing.com"
                ) {
                    continue;
                }
            } catch {
                continue;
            }

            results.push({
                engine: "bing",
                url,
                title,
                snippet
            });
        }

        return results;

    } catch (error) {
        console.warn(
            "[SMS BRAND] Bing search failed:",
            error.message
        );

        return [];
    }
}


// ============================================================
// PARALLEL SEARCH
// ============================================================
async function searchBrand(sender) {
    const queries = [
        `"${sender}" official`,
        `"${sender}" company`,
        `"${sender}" website`,
        `${sender} official website`
    ];

    const tasks = [];

    for (const query of queries) {
        tasks.push(
            searchDuckDuckGo(query)
        );

        tasks.push(
            searchBing(query)
        );
    }

    console.log(
        `[SMS BRAND] Running ${tasks.length} search requests for "${sender}"`
    );

    const settled =
        await Promise.allSettled(tasks);

    const allResults = [];

    for (const result of settled) {
        if (
            result.status === "fulfilled" &&
            Array.isArray(result.value)
        ) {
            allResults.push(
                ...result.value
            );
        }
    }

    // --------------------------------------------------------
    // Domains that should NEVER be treated as brand websites.
    // These are search engines, social/search infrastructure,
    // or redirect/search-result domains.
    // --------------------------------------------------------

    const blockedDomains = new Set([
        "bing.com",
        "www.bing.com",
        "google.com",
        "www.google.com",
        "duckduckgo.com",
        "www.duckduckgo.com",
        "yahoo.com",
        "www.yahoo.com",
        "search.yahoo.com",
        "baidu.com",
        "www.baidu.com",
        "yandex.com",
        "www.yandex.com",
        "ask.com",
        "www.ask.com",
        "aol.com",
        "www.aol.com",
        "ecosia.org",
        "www.ecosia.org"
    ]);

    const filtered =
        allResults.filter(candidate => {
            const normalizedUrl =
                normalizeUrl(
                    candidate?.url
                );

            if (!normalizedUrl) {
                return false;
            }

            let parsed;

            try {
                parsed =
                    new URL(
                        normalizedUrl
                    );
            } catch {
                return false;
            }

            const hostname =
                parsed.hostname
                    .toLowerCase()
                    .replace(/^www\./, "");

            if (
                blockedDomains.has(hostname)
            ) {
                return false;
            }

            // Reject obvious search-result URLs.
            const pathAndQuery =
                `${parsed.pathname}${parsed.search}`
                    .toLowerCase();

            if (
                pathAndQuery.includes("/search") ||
                pathAndQuery.includes("/results") ||
                pathAndQuery.includes("q=") ||
                pathAndQuery.includes("query=")
            ) {
                return false;
            }

            return true;
        });

    const seen = new Set();

    const unique =
        filtered.filter(candidate => {
            const normalizedUrl =
                normalizeUrl(
                    candidate.url
                );

            if (!normalizedUrl) {
                return false;
            }

            const key =
                normalizedUrl
                    .split("#")[0]
                    .replace(/\/$/, "")
                    .toLowerCase();

            if (
                seen.has(key)
            ) {
                return false;
            }

            seen.add(key);

            return true;
        });

    const limited =
        unique.slice(
            0,
            MAX_SEARCH_RESULTS
        );

    console.log(
        `[SMS BRAND] Search produced ${allResults.length} raw candidates, ${unique.length} valid external candidates; inspecting ${limited.length}`
    );

    return limited;
}

// ============================================================
// WEBSITE INSPECTION
// ============================================================

async function inspectWebsite(
    candidate
) {
    const websiteUrl =
        websiteFromSearchCandidate(
            candidate
        );

    if (!websiteUrl) {
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
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36",
                        Accept:
                            "text/html,application/xhtml+xml"
                    },
                    validateStatus:
                        status =>
                            status >= 200 &&
                            status < 400
                }
            );

        const html =
            String(response.data || "");

        if (!html) {
            return null;
        }

        const title =
            extractTitle(html);

        const siteName =
            extractMeta(
                html,
                "og:site_name"
            );

        const description =
            extractMeta(
                html,
                "description"
            );

        const canonicalUrl =
            extractCanonical(
                html,
                websiteUrl
            );

        const schema =
            extractSchemaOrganization(
                html,
                websiteUrl
            );

        const iconCandidates =
            extractIconCandidates(
                html,
                websiteUrl
            );

        const logoCandidates =
            extractLogoCandidates(
                html,
                websiteUrl
            );

        const domain =
            getDomainFromUrl(
                websiteUrl
            );

        const registrableDomain =
            getRegistrableDomain(
                domain
            );

        const brandName =
            cleanBrandName(
                schema.name ||
                siteName ||
                inferBrandFromSearchCandidateSafe(
                    candidate
                ) ||
                (
                    !isGenericWebsiteName(title)
                        ? title
                        : ""
                ) ||
                deriveDomainIdentityName(
                    domain,
                    registrableDomain
                )
            );

        return {
            url: websiteUrl,
            title,
            siteName,
            description,
            canonicalUrl,
            schemaName:
                schema.name || "",
            schemaUrl:
                schema.url || "",
            schemaLogo:
                schema.logo || "",
            sameAs:
                schema.sameAs || [],
            iconCandidates,
            logoCandidates,
            domain,
            registrableDomain,
            brandName
        };

    } catch (error) {
        console.warn(
            `[SMS BRAND] Website inspection failed for ${websiteUrl}:`,
            error.message
        );

        return null;
    }
}


// ============================================================
// REMOTE IMAGE VALIDATION
// ============================================================

function isValidImageSignature(buffer) {
    if (!Buffer.isBuffer(buffer)) {
        return false;
    }

    if (
        buffer.length >= 8 &&
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

    if (
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
    ) {
        return true;
    }

    if (
        buffer.length >= 6 &&
        (
            buffer
                .subarray(0, 6)
                .toString("ascii") === "GIF87a" ||
            buffer
                .subarray(0, 6)
                .toString("ascii") === "GIF89a"
        )
    ) {
        return true;
    }

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

    if (
        buffer.length >= 2 &&
        buffer[0] === 0x42 &&
        buffer[1] === 0x4d
    ) {
        return true;
    }

    if (
        buffer.length >= 4 &&
        buffer[0] === 0x00 &&
        buffer[1] === 0x00 &&
        (
            buffer[2] === 0x01 ||
            buffer[2] === 0x02
        ) &&
        buffer[3] === 0x00
    ) {
        return true;
    }

    if (
        buffer.length >= 12 &&
        buffer
            .subarray(4, 12)
            .toString("ascii")
            .includes("ftyp")
    ) {
        return true;
    }

    return false;
}


async function validateRemoteImage(
    imageUrl
) {
    if (!imageUrl) {
        return false;
    }

    try {
        const response =
            await axios.get(
                imageUrl,
                {
                    responseType:
                        "arraybuffer",
                    timeout: 5000,
                    maxContentLength:
                        5 * 1024 * 1024,
                    maxBodyLength:
                        5 * 1024 * 1024,
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0"
                    },
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
            ).toLowerCase();

        if (
            !contentType.includes("image/")
        ) {
            return false;
        }

        if (
            contentType.includes(
                "svg"
            )
        ) {
            return false;
        }

        const buffer =
            Buffer.from(
                response.data
            );

        return isValidImageSignature(
            buffer
        );

    } catch {
        return false;
    }
}


// ============================================================
// CANDIDATE SCORING
// ============================================================

async function scoreWebsiteCandidate(
    website,
    sender,
    searchCandidate
) {
    let score = 0;

    const normalizedSender =
        normalizeSender(sender);

    const brand =
        normalizeSender(
            website.brandName
        );

    const domain =
        normalizeSender(
            website.domain
        );

    const registrableDomain =
        normalizeSender(
            website.registrableDomain
        );

    if (
        brand &&
        brand === normalizedSender
    ) {
        score += 0.35;
    } else if (
        brand &&
        (
            brand.includes(
                normalizedSender
            ) ||
            normalizedSender.includes(
                brand
            )
        )
    ) {
        score += 0.20;
    }

    if (
        domain.includes(
            normalizedSender
        ) ||
        registrableDomain.includes(
            normalizedSender
        )
    ) {
        score += 0.25;
    }

    const searchText =
        [
            searchCandidate?.title,
            searchCandidate?.snippet
        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

    if (
        searchText.includes(
            normalizedSender
        )
    ) {
        score += 0.10;
    }

    if (
        searchCandidate?.url
    ) {
        const candidateDomain =
            getDomainFromUrl(
                searchCandidate.url
            );

        if (
            candidateDomain &&
            getRegistrableDomain(
                candidateDomain
            ) ===
            website.registrableDomain
        ) {
            score += 0.50;
        }
    }

    if (
        website.canonicalUrl
    ) {
        const canonicalDomain =
            getRegistrableDomain(
                getDomainFromUrl(
                    website.canonicalUrl
                )
            );

        if (
            canonicalDomain &&
            canonicalDomain ===
            website.registrableDomain
        ) {
            score += 0.05;
        }
    }

    if (
        website.schemaName &&
        normalizeSender(
            website.schemaName
        ) === normalizedSender
    ) {
        score += 0.15;
    }

    if (
        website.schemaUrl &&
        getRegistrableDomain(
            getDomainFromUrl(
                website.schemaUrl
            )
        ) ===
        website.registrableDomain
    ) {
        score += 0.10;
    }

    let verifiedLogo = false;
    let verifiedFavicon = false;

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
        website.logoCandidates?.length
    ) {
        for (
            const logoUrl
            of website.logoCandidates
        ) {
            if (
                await validateRemoteImage(
                    logoUrl
                )
            ) {
                verifiedLogo = true;
                break;
            }
        }
    }

    if (
        !verifiedLogo &&
        website.iconCandidates?.length
    ) {
        for (
            const iconUrl
            of website.iconCandidates
        ) {
            if (
                await validateRemoteImage(
                    iconUrl
                )
            ) {
                verifiedFavicon = true;
                break;
            }
        }
    }

    if (verifiedLogo) {
        score += 0.10;
    }

    if (verifiedFavicon) {
        score += 0.04;
    }

    const sameAsCount =
        Array.isArray(
            website.sameAs
        )
            ? website.sameAs.length
            : 0;

    if (
        sameAsCount > 0
    ) {
        score += 0.05;
    }

    return {
        score: Math.min(
            score,
            1
        ),
        verifiedLogo,
        verifiedFavicon
    };
}


// ============================================================
// BEST CANDIDATE
// ============================================================

async function findBestCandidate(
    sender,
    candidates
) {
    const limited =
        Array.isArray(candidates)
            ? candidates.slice(
                0,
                MAX_CANDIDATES_TO_INSPECT
            )
            : [];

    console.log(
        `[SMS BRAND] Inspecting ${limited.length} website candidates for "${sender}"`
    );

    const settled =
        await Promise.allSettled(
            limited.map(
                async candidate => {
                    const website =
                        await inspectWebsite(
                            candidate
                        );

                    if (!website) {
                        return null;
                    }

                    const score =
                        await scoreWebsiteCandidate(
                            website,
                            sender,
                            candidate
                        );

                    return {
                        candidate,
                        website,
                        ...score
                    };
                }
            )
        );

    const scored = [];

    for (const result of settled) {
        if (
            result.status ===
                "fulfilled" &&
            result.value
        ) {
            scored.push(
                result.value
            );
        }
    }

    scored.sort(
        (a, b) =>
            b.score - a.score
    );

    const best =
        scored[0] || null;

    if (best) {
        console.log(
            `[SMS BRAND] Best candidate: ${best.website.domain} -> ${best.website.brandName} (score=${best.score.toFixed(3)})`
        );
    } else {
        console.log(
            `[SMS BRAND] No viable website candidate found for "${sender}"`
        );
    }

    return best;
}


// ============================================================
// FIREBASE CACHE
// ============================================================

function cacheKey(sender) {
    return normalizeSender(sender)
        .replace(/[.#$/[\]]/g, "_");
}


async function getFirebaseCache(sender) {
    const key =
        cacheKey(sender);

    const snapshot =
        await db
            .ref(CACHE_PATH)
            .child(key)
            .get();

    if (!snapshot.exists()) {
        return null;
    }

    const value =
        snapshot.val();

    if (
        value.status === "FOUND"
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

    if (
        value.status === "DISCOVERING"
    ) {
        if (
            value.discoveryStartedAt &&
            Date.now() -
                value.discoveryStartedAt <
                DISCOVERY_LOCK_TTL
        ) {
            return value;
        }

        // IMPORTANT:
        // A stale DISCOVERING record must NOT be returned.
        // Returning it here would permanently prevent
        // resolveSender() from acquiring a new discovery lock.
        return null;
    }

    return value;
}


async function acquireDiscoveryLock(
    sender
) {
    const key =
        cacheKey(sender);

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
                status:
                    "DISCOVERING",
                brandName: "",
                logoUrl: "",
                faviconUrl: "",
                confidence: 0,
                verified: false,
                senderKey:
                    normalizeSender(sender),
                discoveryStartedAt:
                    now
            };
        }
    );

    return acquired;
}


async function saveCache(
    sender,
    value
) {
    const key =
        cacheKey(sender);

    await db
        .ref(CACHE_PATH)
        .child(key)
        .set(value);

    memoryCache.set(
        key,
        {
            value,
            cachedAt:
                Date.now()
        }
    );
}


// ============================================================
// DISCOVERY
// ============================================================

async function discoverBrand(
    sender
) {
    const normalized =
        normalizeSender(sender);

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
            console.log(
                `[SMS BRAND] No search candidates found for "${normalized}"`
            );

            await saveCache(
                normalized,
                {
                    status: "UNKNOWN",
                    senderKey:
                        normalized,
                    brandName: "",
                    logoUrl: "",
                    faviconUrl: "",
                    confidence: 0,
                    verified: false,
                    cachedAt:
                        Date.now()
                }
            );

            return;
        }

        const best =
            await findBestCandidate(
                normalized,
                candidates
            );

        if (!best) {
            await saveCache(
                normalized,
                {
                    status: "UNKNOWN",
                    senderKey:
                        normalized,
                    brandName: "",
                    logoUrl: "",
                    faviconUrl: "",
                    confidence: 0,
                    verified: false,
                    cachedAt:
                        Date.now()
                }
            );

            return;
        }

        const website =
            best.website;

        const confidence =
            Number(
                best.score || 0
            );

        const brandName =
            cleanBrandName(
                website.brandName
            );

        let logoUrl = "";
        let faviconUrl = "";

        if (
            website.schemaLogo &&
            await validateRemoteImage(
                website.schemaLogo
            )
        ) {
            logoUrl =
                website.schemaLogo;
        }

        if (
            !logoUrl &&
            website.logoCandidates?.length
        ) {
            for (
                const candidateLogo
                of website.logoCandidates
            ) {
                if (
                    await validateRemoteImage(
                        candidateLogo
                    )
                ) {
                    logoUrl =
                        candidateLogo;
                    break;
                }
            }
        }

        if (
            website.iconCandidates?.length
        ) {
            for (
                const icon
                of website.iconCandidates
            ) {
                if (
                    await validateRemoteImage(
                        icon
                    )
                ) {
                    faviconUrl =
                        icon;
                    break;
                }
            }
        }

        const verified =
            confidence >= 0.80 &&
            Boolean(brandName) &&
            (
                Boolean(logoUrl) ||
                Boolean(faviconUrl) ||
                Boolean(
                    website.schemaName
                )
            );

        console.log(
            `[SMS BRAND] Verification result for "${normalized}": verified=${verified}, confidence=${confidence.toFixed(3)}, brand="${brandName}", logo=${Boolean(logoUrl)}, favicon=${Boolean(faviconUrl)}`
        );

        if (!verified) {
            await saveCache(
                normalized,
                {
                    status: "UNKNOWN",
                    senderKey:
                        normalized,
                    brandName:
                        brandName || "",
                    logoUrl:
                        logoUrl || "",
                    faviconUrl:
                        faviconUrl || "",
                    confidence,
                    verified: false,
                    sourceDomain:
                        website.domain || "",
                    registrableDomain:
                        website.registrableDomain || "",
                    canonicalUrl:
                        website.canonicalUrl || "",
                    schemaName:
                        website.schemaName || "",
                    schemaUrl:
                        website.schemaUrl || "",
                    schemaLogo:
                        website.schemaLogo || "",
                    cachedAt:
                        Date.now()
                }
            );

            return;
        }

        const result = {
            status: "FOUND",
            senderKey:
                normalized,
            brandName,
            logoUrl,
            faviconUrl,
            confidence,
            verified: true,
            sourceDomain:
                website.domain || "",
            registrableDomain:
                website.registrableDomain || "",
            canonicalUrl:
                website.canonicalUrl || "",
            schemaName:
                website.schemaName || "",
            schemaUrl:
                website.schemaUrl || "",
            schemaLogo:
                website.schemaLogo || "",
            lastVerifiedAt:
                Date.now(),
            cachedAt:
                Date.now()
        };

        await saveCache(
            normalized,
            result
        );

        console.log(
            `[SMS BRAND] FOUND "${normalized}" -> "${brandName}"`
        );

    } catch (error) {
        console.error(
            `[SMS BRAND] Discovery failed for "${normalized}":`,
            error
        );

        try {
            await saveCache(
                normalized,
                {
                    status: "UNKNOWN",
                    senderKey:
                        normalized,
                    brandName: "",
                    logoUrl: "",
                    faviconUrl: "",
                    confidence: 0,
                    verified: false,
                    cachedAt:
                        Date.now()
                }
            );
        } catch (cacheError) {
            console.error(
                "[SMS BRAND] Failed to save UNKNOWN cache:",
                cacheError
            );
        }
    }
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
            status: "UNKNOWN",
            brandName: "",
            logoUrl: "",
            faviconUrl: "",
            confidence: 0,
            verified: false
        };
    }

    const key =
        cacheKey(normalized);

    // --------------------------------------------------------
    // 1. Memory cache
    // --------------------------------------------------------

    const memory =
        memoryCache.get(key);

    if (memory) {
        if (
            memory.value.status ===
                "FOUND" &&
            memory.value.cachedAt &&
            Date.now() -
                memory.value.cachedAt <
                VERIFIED_CACHE_TTL
        ) {
            return memory.value;
        }

        if (
            memory.value.status ===
                "DISCOVERING" &&
            memory.value.discoveryStartedAt &&
            Date.now() -
                memory.value.discoveryStartedAt <
                DISCOVERY_LOCK_TTL
        ) {
            return memory.value;
        }

        memoryCache.delete(key);
    }

    // --------------------------------------------------------
    // 2. Firebase cache
    // --------------------------------------------------------

    const cached =
        await getFirebaseCache(
            normalized
        );

    if (cached) {
        memoryCache.set(
            key,
            {
                value: cached,
                cachedAt:
                    Date.now()
            }
        );

        if (
            cached.status ===
                "FOUND" ||
            cached.status ===
                "DISCOVERING"
        ) {
            return cached;
        }
    }

    // --------------------------------------------------------
    // 3. Acquire discovery lock
    // --------------------------------------------------------

    const acquired =
        await acquireDiscoveryLock(
            normalized
        );

    if (!acquired) {
        const current =
            await getFirebaseCache(
                normalized
            );

        if (current) {
            return current;
        }

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

    // --------------------------------------------------------
    // 4. Background discovery
    // --------------------------------------------------------

    const discovering = {
        status:
            "DISCOVERING",
        senderKey:
            normalized,
        brandName: "",
        logoUrl: "",
        faviconUrl: "",
        confidence: 0,
        verified: false,
        discoveryStartedAt:
            Date.now()
    };

    memoryCache.set(
        key,
        {
            value: discovering,
            cachedAt:
                Date.now()
        }
    );

    setImmediate(
        () => {
            discoverBrand(
                normalized
            ).catch(error => {
                console.error(
                    `[SMS BRAND] Background discovery error for "${normalized}":`,
                    error
                );
            });
        }
    );

    return discovering;
}


// ============================================================
// REGEX HELPER
// ============================================================

function escapeRegex(value) {
    return String(value || "")
        .replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
        );
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    resolveSender,
    discoverBrand,
    normalizeSender
};