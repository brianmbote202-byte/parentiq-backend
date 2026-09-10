const { GoogleGenAI } = require("@google/genai");

const client = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

/**
 * Classifies a domain using Google Gemini.
 *
 * Returns:
 * {
 *   category: string,
 *   primaryPurpose: string
 * }
 */
async function classifyDomain(domain) {

    if (!domain || typeof domain !== "string") {
        throw new Error("Invalid domain supplied");
    }

    const normalizedDomain = domain
        .trim()
        .toLowerCase()
        .replace(/^www\./, "");

    const prompt = `
Classify the following internet domain based on its PRIMARY activity and purpose.

Domain:
${normalizedDomain}

Rules:

1. Identify what the domain primarily exists for.
2. Do not classify based only on the domain name.
3. Use the actual primary service or activity associated with the domain.
4. Create a clear category using lowercase snake_case.
5. Categories should be meaningful and reusable across many domains.
6. Avoid overly specific categories unless necessary.
7. Return ONLY the requested JSON structure.

Examples:

booking.com
category: travel
primaryPurpose: hotel and travel booking

airbnb.com
category: travel
primaryPurpose: accommodation and travel booking

amazon.com
category: shopping
primaryPurpose: online shopping and ecommerce

indeed.com
category: jobs
primaryPurpose: job searching and recruitment

upwork.com
category: freelancing
primaryPurpose: freelance work marketplace

wikipedia.org
category: reference
primaryPurpose: online encyclopedia and reference information

github.com
category: technology
primaryPurpose: software development and code hosting

youtube.com
category: streaming
primaryPurpose: online video streaming

instagram.com
category: social_media
primaryPurpose: social networking and photo/video sharing

whatsapp.com
category: messaging
primaryPurpose: instant messaging and communication

google.com
category: search_engine
primaryPurpose: internet search and online services

bet365.com
category: betting_gambling
primaryPurpose: online sports betting and gambling

Now classify:

${normalizedDomain}
`;

    try {

        const interaction = await client.interactions.create({
            model: "gemini-3.6-flash",

            input: prompt,

            response_format: {
                type: "text",
                mime_type: "application/json",

                schema: {
                    type: "object",

                    properties: {
                        category: {
                            type: "string"
                        },

                        primaryPurpose: {
                            type: "string"
                        }
                    },

                    required: [
                        "category",
                        "primaryPurpose"
                    ],

                    additionalProperties: false
                }
            }
        });

        const outputText = interaction.output_text;

        if (!outputText) {
            throw new Error("Gemini returned empty output");
        }

        console.log(
            `🤖 GEMINI RAW DOMAIN RESPONSE: ${normalizedDomain} → ${outputText}`
        );

        let result;

        try {
            result = JSON.parse(outputText);
        } catch (parseError) {
            throw new Error(
                `Gemini returned invalid JSON: ${outputText}`
            );
        }

        if (
            !result.category ||
            typeof result.category !== "string"
        ) {
            throw new Error(
                `Invalid Gemini category for ${normalizedDomain}`
            );
        }

        if (
            !result.primaryPurpose ||
            typeof result.primaryPurpose !== "string"
        ) {
            throw new Error(
                `Invalid Gemini primaryPurpose for ${normalizedDomain}`
            );
        }

        const category = result.category
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "_")
            .replace(/[^a-z0-9_]/g, "");

        const primaryPurpose = result.primaryPurpose.trim();

        console.log(
            `🌐 DOMAIN CLASSIFIED BY GEMINI: ${normalizedDomain} → ${category} (${primaryPurpose})`
        );

        return {
            category,
            primaryPurpose
        };

    } catch (error) {

        console.error(
            `❌ GEMINI DOMAIN CLASSIFICATION ERROR: ${normalizedDomain}`,
            error
        );

        throw error;
    }
}

module.exports = {
    classifyDomain
};