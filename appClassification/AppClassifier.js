
const OpenAI = require("openai");

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const ALLOWED_CATEGORIES = [
    "social_media",
    "messaging",
    "gaming",
    "browser",
    "productivity",
    "education",
    "finance",
    "streaming",
    "shopping",
    "betting_gambling",
    "health",
    "other"
];

async function classifyApp(appName, packageName) {
    if (!appName || !packageName) {
        throw new Error("appName and packageName are required");
    }

    const response = await client.responses.create({
        model: "gpt-5.6-luna",
        input: [
            {
                role: "system",
                content: `
You are an Android application classification service.

Classify the application into exactly ONE of these categories:

${ALLOWED_CATEGORIES.join(", ")}

Rules:
- Classify based primarily on the application's known purpose.
- Use both application name and package name as signals.
- Do not invent categories.
- System utilities, settings, contacts, launchers, device tools and unclear
  applications should normally be classified as "other".
- Background services, app managers, installers, update components,
  companion services, provider packages and system components should be
  classified according to their technical role, not the consumer product
  or brand they belong to.
- If a package is primarily a background/system component rather than a
  user-facing application, classify it as "other".
- Social networking applications → social_media.
- Chat and direct messaging applications → messaging.
- Games → gaming.
- Web browsers → browser.
- Video, music and movie streaming services → streaming.
- Gambling, casino, sportsbook and betting applications → betting_gambling.
- Banking, payment and financial applications → finance.
- Health, fitness and medical applications → health.
- Shopping and marketplace applications → shopping.
- If the purpose cannot be determined reliably → other.




Return JSON only.
                `
            },
            {
                role: "user",
                content: JSON.stringify({
                    appName,
                    packageName
                })
            }
        ],
        text: {
            format: {
                type: "json_schema",
                name: "app_classification",
                strict: true,
                schema: {
                    type: "object",
                    properties: {
                        category: {
                            type: "string",
                            enum: ALLOWED_CATEGORIES
                        }
                    },
                    required: ["category"],
                    additionalProperties: false
                }
            }
        }
    });

    const result = JSON.parse(response.output_text);

    if (!ALLOWED_CATEGORIES.includes(result.category)) {
        throw new Error(
            `Invalid classification returned: ${result.category}`
        );
    }

    console.log(
        `🤖 APP CLASSIFIED: ${appName} (${packageName}) → ${result.category}`
    );

    return result.category;
}

module.exports = {
    classifyApp,
    ALLOWED_CATEGORIES
};

