const OpenAI = require("openai");

const client = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1"
});


async function classifySearch(searchQuery) {

    if (!searchQuery) {

        throw new Error(
            "searchQuery is required"
        );

    }


    const normalizedQuery =
        searchQuery
            .trim()
            .toLowerCase();


    if (!normalizedQuery) {

        throw new Error(
            "searchQuery is empty"
        );

    }


    const response =
        await client.chat.completions.create({

            model: "openai/gpt-oss-20b",

            messages: [

                {

                    role: "system",

                    content: `

You are a search query classification service for a parental-control application.

Your task is to identify the PRIMARY ACTIVITY, SUBJECT, or INTENT represented by
the user's search query.

The classification is NOT restricted to a predefined category list.

You may create a new category whenever necessary.

IMPORTANT:

First determine what the user is fundamentally trying to find, learn, do,
or accomplish through the search.

Then generate a concise category that represents that primary activity.

The category must NOT be based simply on:

- individual keywords in the query
- the search engine being used
- the website where the search occurred
- how the user might eventually spend money
- whether the result could contain advertisements
- a secondary meaning when a clear primary intent exists

CATEGORY RULES:

- Category must describe the primary user activity or subject.
- Category must be concise.
- Category must use lowercase snake_case.
- Category must contain no spaces.
- Category must contain exactly one category.
- Do not automatically use "other" when a meaningful category can be
  determined.
- Create a new category when an existing concept does not accurately
  represent the query.

INTENT RULES:

- intent must describe what the user is primarily trying to accomplish.
- intent must be concise.
- intent must use lowercase snake_case.
- intent must contain no spaces.
- intent must contain exactly one intent.

Examples:

"how to solve quadratic equations"

category → education

intent → learning_mathematics

"best football betting sites in Kenya"

category → betting_gambling

intent → finding_sports_betting_sites

"how to make chicken curry"

category → cooking

intent → learning_cooking

"latest Kenya election news"

category → news

intent → following_current_events

"minecraft download"

category → gaming

intent → downloading_a_game

"how to apply for a passport"

category → government_services

intent → applying_for_passport

"best hotels in Nairobi"

category → travel

intent → finding_accommodation

"python list comprehension tutorial"

category → programming

intent → learning_programming

"porn videos"

category → adult

intent → finding_adult_content

Return JSON only.

`

                },

                {

                    role: "user",

                    content:
                        JSON.stringify({

                            searchQuery:
                                normalizedQuery

                        })

                }

            ],

            response_format: {

                type: "json_schema",

                json_schema: {

                    name: "search_classification",

                    strict: true,

                    schema: {

                        type: "object",

                        properties: {

                            category: {

                                type: "string"

                            },

                            intent: {

                                type: "string"

                            }

                        },

                        required: [

                            "category",
                            "intent"

                        ],

                        additionalProperties: false

                    }

                }

            }

        });


    const rawResult =
        response.choices?.[0]?.message?.content;


    if (!rawResult) {

        throw new Error(
            "Empty search classification response from Groq"
        );

    }


    const result =
        JSON.parse(rawResult);


    const category =
        result.category
            ?.trim()
            .toLowerCase();


    const intent =
        result.intent
            ?.trim()
            .toLowerCase();


    if (!category) {

        throw new Error(
            "Invalid search classification returned: empty category"
        );

    }


    if (!intent) {

        throw new Error(
            "Invalid search classification returned: empty intent"
        );

    }


    console.log(
        `🔎 SEARCH CLASSIFIED: ${normalizedQuery} → ${category} (${intent})`
    );


    return {

        category,

        intent

    };

}


module.exports = {

    classifySearch

};