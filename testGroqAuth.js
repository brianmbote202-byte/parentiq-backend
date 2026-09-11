require("dotenv").config();

const OpenAI = require("openai");

const groqApiKey = process.env.GROQ_API_KEY;

console.log("==============================================");
console.log("🔐 GROQ AUTHENTICATION TEST");
console.log("==============================================");

console.log(
    "GROQ_API_KEY:",
    groqApiKey
        ? `PRESENT (${groqApiKey.length} characters)`
        : "MISSING"
);

if (!groqApiKey) {
    console.error("❌ GROQ_API_KEY is missing");
    process.exit(1);
}

const client = new OpenAI({
    apiKey: groqApiKey,
    baseURL: "https://api.groq.com/openai/v1"
});

async function testGroqAuthentication() {

    try {

        console.log("🔄 Testing Groq authentication...");

        const response =
            await client.models.list();

        console.log("==============================================");
        console.log("✅ GROQ AUTHENTICATION SUCCESSFUL");
        console.log("==============================================");

        console.log(
            `📦 Groq returned ${response.data?.length || 0} models`
        );

        process.exit(0);

    } catch (error) {

        console.log("==============================================");
        console.error("❌ GROQ AUTHENTICATION FAILED");
        console.log("==============================================");

        console.error(
            "Error name:",
            error?.name
        );

        console.error(
            "Error status:",
            error?.status
        );

        console.error(
            "Error code:",
            error?.code
        );

        console.error(
            "Error message:",
            error?.message
        );

        process.exit(1);
    }
}

testGroqAuthentication();