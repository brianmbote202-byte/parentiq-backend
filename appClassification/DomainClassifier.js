
const OpenAI = require("openai");

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

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

Your task is to identify the PRIMARY ACTIVITY and PRIMARY PURPOSE of the
specific website represented by the domain.

The classification is NOT restricted to a predefined category list.

You may create a new category whenever necessary.

IMPORTANT:

First determine what the website fundamentally exists to provide to users.

Then generate a concise category that represents that primary activity.

The category must NOT be based simply on:
- how the website makes money
- whether the website accepts payments
- whether the website is a marketplace
- whether users can buy something
- whether the company is a technology company
- secondary features offered by the website

When a website facilitates transactions for a particular service, classify
the underlying service rather than the transaction mechanism.

Examples:

booking.com
primaryPurpose → travel_booking
category → travel

airbnb.com
primaryPurpose → accommodation_booking
category → travel

amazon.com
primaryPurpose → ecommerce
category → shopping

indeed.com
primaryPurpose → job_search
category → jobs

upwork.com
primaryPurpose → freelance_work
category → freelancing

wikipedia.org
primaryPurpose → online_reference
category → reference

github.com
primaryPurpose → software_development
category → technology

youtube.com
primaryPurpose → video_streaming
category → streaming

instagram.com
primaryPurpose → social_networking
category → social_media

whatsapp.com
primaryPurpose → messaging
category → messaging

google.com
primaryPurpose → web_search
category → search_engine

bet365.com
primaryPurpose → sports_betting_and_gambling
category → betting_gambling

CATEGORY RULES:

- Category must describe the primary user activity.
- Category must be concise.
- Category must use lowercase snake_case.
- Category must contain no spaces.
- Category must contain exactly one category.
- Do not automatically use "other" when a meaningful category can be
  determined.
- Do not use a category based only on the company's industry.
- Do not use "shopping" merely because transactions occur on the website.
- Do not use "finance" merely because the website processes payments.
- Do not use "technology" merely because the website is operated by a
  technology company.

PRIMARY PURPOSE RULES:

- primaryPurpose must describe the specific service or activity provided
  by the domain.
- primaryPurpose must be concise.
- primaryPurpose must use lowercase snake_case.
- primaryPurpose must contain no spaces.
- primaryPurpose must contain exactly one purpose.

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
        }
    });

    const result =
        JSON.parse(response.output_text);

    const category =
        result.category
            ?.trim()
            .toLowerCase();

    const primaryPurpose =
        result.primaryPurpose
            ?.trim()
            .toLowerCase();

    if (!category) {
        throw new Error(
            "Invalid domain classification returned: empty category"
        );
    }

    if (!primaryPurpose) {
        throw new Error(
            "Invalid domain classification returned: empty primaryPurpose"
        );
    }

    console.log(
        `🌐 DOMAIN CLASSIFIED: ${normalizedDomain} → ${category} (${primaryPurpose})`
    );

    return {
        category,
        primaryPurpose
    };
}

module.exports = {
    classifyDomain
};

