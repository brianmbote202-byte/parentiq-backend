const OpenAI = require("openai");

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const ALLOWED_DOMAIN_CATEGORIES = [
    "social_media",
    "messaging",
    "gaming",
    "search_engine",
    "streaming",
    "shopping",
    "finance",
    "betting_gambling",
    "sexual_content",
    "education",
    "news",
    "productivity",
    "health",
    "technology",
    "other"
];

async function classifyDomain(domain) {

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

    const response = await client.responses.create({

        model: "gpt-5.6-luna",

        input: [
            {
                role: "system",

                content: `
You are a website domain classification service for a parental-control application.

Classify the domain into exactly ONE of these categories:

${ALLOWED_DOMAIN_CATEGORIES.join(", ")}

Rules:

- Classify the domain based primarily on the website's known purpose.
- Use the domain name as a signal.
- Do not invent categories.
- Return exactly one category from the allowed list.

CATEGORY RULES:

- Social networking and social-media platforms
  → social_media

- Chat, messaging and communication platforms
  → messaging

- Online games, gaming platforms and game communities
  → gaming

- Search engines and general web-search services
  → search_engine

- Video, music, movie and media streaming platforms
  → streaming

- Online stores, marketplaces and ecommerce platforms
  → shopping

- Banks, payment services, investment platforms,
  financial services and cryptocurrency exchanges
  → finance

- Sports betting, casinos, gambling and betting platforms
  → betting_gambling

- Pornographic, sexually explicit or adult-content websites
  → sexual_content

- Schools, universities, educational platforms,
  learning resources and academic services
  → education

- Newspapers, journalism, magazines and news publishers
  → news

- Office tools, work-management tools,
  business productivity and collaboration platforms
  → productivity

- Medical, healthcare, fitness and health-information services
  → health

- Technology companies, developer platforms,
  software documentation and technical resources
  → technology

- Domains whose purpose cannot be determined reliably
  → other

IMPORTANT:

Do not classify a domain simply because its company owns
another type of service.

Classify the actual purpose of the domain being provided.

For example:
- youtube.com → streaming
- instagram.com → social_media
- whatsapp.com → messaging
- google.com → search_engine
- amazon.com → shopping
- bet365.com → betting_gambling

Return JSON only.
                `
            },

            {
                role: "user",

                content: JSON.stringify({
                    domain: normalizedDomain
                })
            }
        ],

        text: {
            format: {
                type: "json_schema",

                name: "domain_classification",

                strict: true,

                schema: {
                    type: "object",

                    properties: {
                        category: {
                            type: "string",
                            enum: ALLOWED_DOMAIN_CATEGORIES
                        }
                    },

                    required: [
                        "category"
                    ],

                    additionalProperties: false
                }
            }
        }
    });

    const result =
        JSON.parse(response.output_text);

    if (
        !ALLOWED_DOMAIN_CATEGORIES.includes(
            result.category
        )
    ) {
        throw new Error(
            `Invalid domain classification returned: ${result.category}`
        );
    }

    console.log(
        `🌐 DOMAIN CLASSIFIED: ${normalizedDomain} → ${result.category}`
    );

    return result.category;
}

module.exports = {
    classifyDomain,
    ALLOWED_DOMAIN_CATEGORIES
};