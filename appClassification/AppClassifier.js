require("dotenv").config();


// ============================================================
// NORMALIZE CATEGORY
// ============================================================

function normalizeCategory(value) {

    if (!value || typeof value !== "string") {
        return "";
    }

    return value
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
}


// ============================================================
// VALIDATE CATEGORY
// ============================================================

function validateCategory(category) {

    const normalized =
        normalizeCategory(category);

    if (!normalized) {
        throw new Error(
            "AI returned an empty category"
        );
    }

    // --------------------------------------------------------
    // Category must be lowercase snake_case
    // --------------------------------------------------------

    if (
        !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(
            normalized
        )
    ) {
        throw new Error(
            `Invalid category format: ${category}`
        );
    }

    // --------------------------------------------------------
    // Prevent excessively long AI-generated categories
    // --------------------------------------------------------

    if (normalized.length > 60) {
        throw new Error(
            `Category is too long: ${normalized}`
        );
    }

    // --------------------------------------------------------
    // Prevent the model from returning an entire sentence
    // --------------------------------------------------------

    const words =
        normalized.split("_");

    if (words.length > 6) {
        throw new Error(
            `Category contains too many words: ${normalized}`
        );
    }

    console.log(
        `🤖 RAW AI CATEGORY: ${category}`
    );

    console.log(
        `✅ CATEGORY VALIDATED: ${normalized}`
    );

    return normalized;
}


// ============================================================
// EXTRACT CATEGORY FROM MODEL RESPONSE
// ============================================================

function extractCategory(output) {

    if (!output || typeof output !== "string") {
        return "";
    }

    const text =
        output.trim();


    // --------------------------------------------------------
    // 1. CLEAN JSON
    // --------------------------------------------------------

    try {

        const parsed =
            JSON.parse(text);

        if (
            parsed &&
            typeof parsed.category === "string"
        ) {

            return normalizeCategory(
                parsed.category
            );
        }

    } catch (_) {

        // Continue checking other formats.

    }


    // --------------------------------------------------------
    // 2. JSON EMBEDDED INSIDE OTHER TEXT
    // --------------------------------------------------------

    const jsonMatch =
        text.match(
            /\{[\s\S]*?"category"\s*:\s*"([^"]+)"[\s\S]*?\}/i
        );

    if (
        jsonMatch &&
        jsonMatch[1]
    ) {

        const category =
            normalizeCategory(
                jsonMatch[1]
            );

        if (category) {
            return category;
        }
    }


    // --------------------------------------------------------
    // 3. EXPLICIT CATEGORY DECLARATION
    //
    // Example:
    //
    // category: social_media
    // --------------------------------------------------------

    const categoryMatch =
        text.match(
            /^\s*category\s*[:=]\s*["'`]?(.*?)["'`]?\s*$/im
        );

    if (
        categoryMatch &&
        categoryMatch[1]
    ) {

        const category =
            normalizeCategory(
                categoryMatch[1]
            );

        if (category) {
            return category;
        }
    }


    // --------------------------------------------------------
    // 4. EXPLICIT FINAL CATEGORY SENTENCE
    //
    // Example:
    //
    // The appropriate category is social_media.
    // --------------------------------------------------------

    const finalCategoryMatch =
        text.match(
            /\b(?:appropriate|primary|correct|best|final)\s+category\s+(?:is|would\s+be)\s+["'`]?([a-zA-Z0-9][a-zA-Z0-9 _-]*)["'`]?[.!]?/i
        );

    if (
        finalCategoryMatch &&
        finalCategoryMatch[1]
    ) {

        const category =
            normalizeCategory(
                finalCategoryMatch[1]
            );

        if (category) {
            return category;
        }
    }


    // --------------------------------------------------------
    // 5. CLEAN SINGLE CATEGORY
    //
    // Example:
    //
    // artificial_intelligence
    //
    // This is the format explicitly requested.
    // --------------------------------------------------------

    if (
        !text.includes("\n") &&
        !text.includes(" ") &&
        /^[a-zA-Z0-9_]+$/.test(text)
    ) {

        const category =
            normalizeCategory(text);

        if (category) {
            return category;
        }
    }


    return "";
}


// ============================================================
// GROQ REQUEST
// ============================================================

async function requestClassification(
    appName,
    packageName
) {

    const prompt = `
You classify Android applications by their PRIMARY PURPOSE.

You are NOT restricted to a predefined category list.

Create the most accurate reusable category.

CATEGORY RULES:

- Use the application's primary function.
- Create a new category when necessary.
- Never force an inaccurate category.
- Categories must be concise and reusable.
- Use lowercase snake_case.
- Do not use spaces.
- Do not use the application name as the category.
- Do not create a category unnecessarily specific to one application.

Examples:

YouTube = video_streaming
WhatsApp = messaging
Facebook = social_media
Instagram = social_media
Chrome = browser
Firefox = browser
Google Maps = navigation
Uber = transportation
Spotify = music_streaming
Netflix = video_streaming
Google Drive = cloud_storage
Microsoft Word = productivity
Khan Academy = education
M-PESA = finance
Amazon = shopping
Chess = gaming
Fitbit = health_fitness
Grok = artificial_intelligence

SYSTEM APPLICATIONS:

If the application is primarily a system component, framework,
provider, launcher, settings component, update service,
background service, installer, device-management component,
or technical support package, classify according to its
technical role.

Examples:

Android System = system
System UI = system_ui
Package Installer = system_installer
Settings = system_settings

IMPORTANT:

Return ONLY the category.

Do NOT explain your answer.
Do NOT provide reasoning.
Do NOT provide a thinking process.
Do NOT use markdown.
Do NOT return JSON.
Do NOT include punctuation.

Example output:

video_streaming
`;


    const response =
    await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
            method: "POST",

            headers: {
                "Authorization":
                    `Bearer ${process.env.GROQ_API_KEY}`,

                "Content-Type":
                    "application/json"
            },

            body: JSON.stringify({

                model:
                    "openai/gpt-oss-20b",

                messages: [

                    {
                        role: "system",
                        content: prompt
                    },

                    {
                        role: "user",
                        content:
                            `App name: ${appName}\nPackage name: ${packageName}`
                    }

                ],

                temperature: 0,

                max_tokens: 100
            })
        }
    );
    // --------------------------------------------------------
    // READ RESPONSE
    // --------------------------------------------------------

    const data =
        await response.json();


    // --------------------------------------------------------
    // API ERROR
    // --------------------------------------------------------

    if (!response.ok) {

        throw new Error(
    `Groq API error ${response.status}: ${
        data?.error?.message ||
        JSON.stringify(data)
    }`
);
    }


    // --------------------------------------------------------
    // GET MESSAGE
    // --------------------------------------------------------

    const message =
        data?.choices?.[0]?.message;


    const output =
        message?.content;


    // --------------------------------------------------------
    // MODEL RETURNED CONTENT
    // --------------------------------------------------------

    if (
        typeof output === "string" &&
        output.trim()
    ) {

        console.log(
    `🔎 GROQ RAW CLASSIFICATION: ${output}`
);

        return output.trim();
    }


    // --------------------------------------------------------
    // MODEL RETURNED NO CONTENT
    // --------------------------------------------------------

    console.log(
        "⚠️ OPENROUTER RESPONSE WITHOUT CONTENT:"
    );

    console.log(
        JSON.stringify(
            data,
            null,
            2
        )
    );


    // --------------------------------------------------------
    // CHECK WHETHER MODEL PUT CATEGORY IN REASONING
    //
    // This is only a fallback.
    // We do NOT disable reasoning.
    // --------------------------------------------------------

    const reasoning =
        message?.reasoning;


    if (
        typeof reasoning === "string" &&
        reasoning.trim()
    ) {

        const reasoningCategory =
            extractCategory(
                reasoning
            );

        if (reasoningCategory) {

            console.log(
                `⚠️ CATEGORY RECOVERED FROM MODEL RESPONSE: ${reasoningCategory}`
            );

            return reasoningCategory;
        }
    }


    throw new Error(
        "Groq returned no usable content"
    );
}


// ============================================================
// MAIN CLASSIFIER
// ============================================================

async function classifyApp(
    appName,
    packageName
) {

    if (
        !appName ||
        !packageName
    ) {

        throw new Error(
            "appName and packageName are required"
        );
    }


    if (
    !process.env.GROQ_API_KEY
) {
    throw new Error(
        "GROQ_API_KEY is not configured"
    );
}


    try {

        const output =
            await requestClassification(
                appName,
                packageName
            );


        const rawCategory =
            extractCategory(
                output
            );


        if (!rawCategory) {

            throw new Error(
                `Groq returned no usable category: ${output}`
            );
        }


        // ----------------------------------------------------
        // VALIDATE BEFORE ANY FIREBASE WRITE
        // ----------------------------------------------------

        const category =
            validateCategory(
                rawCategory
            );


        console.log(
            `🤖 APP CLASSIFIED: ${appName} (${packageName}) → ${category}`
        );


        return category;

    } catch (error) {

        console.error(
            `❌ GROQ APP CLASSIFICATION FAILED: ${appName} (${packageName})`
        );

        console.error(error);

        throw error;
    }
}


// ============================================================
// EXPORT
// ============================================================

module.exports = {
    classifyApp
};