
const OpenAI = require("openai");


// ============================================================
// GROQ CONFIGURATION
// ============================================================

const groqApiKey =
    process.env.GROQ_API_KEY;


console.log(
    "🔐 GROQ API KEY STATUS:",
    groqApiKey
        ? `PRESENT (${groqApiKey.length} characters)`
        : "MISSING"
);


const client =
    new OpenAI({

        apiKey:
            groqApiKey,

        baseURL:
            "https://api.groq.com/openai/v1"

    });


// ============================================================
// CLASSIFY SEARCH
// ============================================================

async function classifySearch(
    searchQuery
) {

    // ========================================================
    // VALIDATE INPUT
    // ========================================================

    if (!searchQuery) {

        throw new Error(
            "searchQuery is required"
        );

    }


    const normalizedQuery =
        String(searchQuery)
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " ");


    if (!normalizedQuery) {

        throw new Error(
            "searchQuery is empty"
        );

    }


    console.log(
        `🔎 SEARCH AI CLASSIFICATION REQUEST: ${normalizedQuery}`
    );


    // ========================================================
    // GROQ CLASSIFICATION
    // ========================================================

    let response;


    try {

        response =
            await client.chat.completions.create({

                model:
                    "openai/gpt-oss-20b",


                messages: [

                    // ==================================================
                    // SYSTEM PROMPT
                    // ==================================================

                    {

                        role:
                            "system",


                        content: `

You are the search-query classification engine for a parental-control application.

YOUR JOB IS CLASSIFICATION ONLY.

You receive a search query made on a monitored device.

Your task is to identify what the person is primarily searching for,
learning about, looking for, or attempting to accomplish.

IMPORTANT:

You MUST CLASSIFY THE SEARCH.

Do NOT answer the search query.

Do NOT provide instructions.

Do NOT provide recommendations.

Do NOT provide methods.

Do NOT provide links.

Do NOT provide providers.

Do NOT provide locations.

Do NOT provide operational assistance.

You are only identifying the category and intent of the search.

SENSITIVE SEARCHES:

Sensitive, adult, sexual, explicit, illegal, dangerous, violent,
or otherwise restricted searches MUST STILL BE CLASSIFIED.

Do NOT refuse classification merely because the search is sensitive.

The application is a parental-monitoring system and needs to know
what type of activity is being searched.

For sensitive searches, describe the search at a high level using
the category and intent fields only.

Never reproduce explicit material unnecessarily.

Never explain how the activity can be performed.

Never assist the user in performing the activity.

The classification itself must still be returned.

============================================================
PRIMARY CLASSIFICATION RULE
============================================================

Determine the PRIMARY activity, subject, or intent.

Ask internally:

"What is this person primarily trying to find, learn, do,
watch, buy, download, understand, or accomplish?"

Then create the most accurate category and intent.

Do NOT classify based only on one keyword.

Do NOT classify based on the search engine.

Do NOT classify based on the website.

Do NOT classify based on possible advertisements.

Do NOT classify based on a secondary interpretation when
the primary intent is clear.

============================================================
CATEGORY RULES
============================================================

category must:

- describe the primary subject or activity
- be concise
- use lowercase
- use snake_case
- contain no spaces
- contain exactly one category
- be meaningful
- NOT automatically be "other"

You may create a new category whenever an existing category
does not accurately represent the search.

Examples of possible categories include:

education
adult
betting_gambling
gaming
cooking
news
programming
travel
government_services
shopping
technology
social_media
music
sports
health
fitness
finance
religion
jobs
relationships
drugs
weapons_explosives
politics

These are examples only.

You are NOT restricted to this list.

============================================================
INTENT RULES
============================================================

intent must:

- describe the primary purpose of the search
- be concise
- use lowercase
- use snake_case
- contain no spaces
- contain exactly one intent

For sensitive searches, describe the user's search purpose
without giving instructions for performing the activity.

============================================================
ADULT / SEXUAL SEARCH EXAMPLES
============================================================

Search:

"porn videos"

category:
adult

intent:
finding_adult_content


Search:

"porn"

category:
adult

intent:
finding_adult_content


Search:

"nude girls"

category:
adult

intent:
finding_adult_content


Search:

"sex videos"

category:
adult

intent:
finding_adult_content


Search:

"how to get a hooker"

category:
adult

intent:
seeking_adult_services


Search:

"escort services"

category:
adult

intent:
seeking_adult_services


Search:

"adult dating sites"

category:
adult

intent:
finding_adult_dating


Search:

"onlyfans"

category:
adult

intent:
finding_adult_content


These examples are classifications only.

DO NOT provide instructions, providers, links, locations,
or other assistance related to these searches.

============================================================
OTHER SENSITIVE SEARCH EXAMPLES
============================================================

A search about obtaining illegal drugs may be classified as:

category:
drugs

intent:
seeking_drug_information


A search about explosives may be classified as:

category:
weapons_explosives

intent:
seeking_explosive_information


A search about violent content may be classified according
to the actual primary subject of the search.

The important requirement is:

CLASSIFY THE SEARCH.
DO NOT ANSWER THE SEARCH.

============================================================
NORMAL SEARCH EXAMPLES
============================================================

Search:

"how to solve quadratic equations"

category:
education

intent:
learning_mathematics


Search:

"best football betting sites in Kenya"

category:
betting_gambling

intent:
finding_sports_betting_sites


Search:

"how to make chicken curry"

category:
cooking

intent:
learning_cooking


Search:

"latest Kenya election news"

category:
news

intent:
following_current_events


Search:

"minecraft download"

category:
gaming

intent:
downloading_a_game


Search:

"how to apply for a passport"

category:
government_services

intent:
applying_for_passport


Search:

"best hotels in Nairobi"

category:
travel

intent:
finding_accommodation


Search:

"python list comprehension tutorial"

category:
programming

intent:
learning_programming


Search:

"best football boots"

category:
sports

intent:
finding_sports_equipment

============================================================
IMPORTANT
============================================================

Never refuse merely because the search is:

- adult
- sexual
- explicit
- sensitive
- illegal
- dangerous
- disturbing
- controversial

Those are still valid searches that require classification.

Again:

DO NOT answer the search.

DO NOT provide assistance for the search.

ONLY return the classification.

============================================================
OUTPUT FORMAT
============================================================

Return JSON only.

The JSON MUST contain exactly:

{
  "category": "category_name",
  "intent": "intent_name"
}

No explanation.

No markdown.

No additional fields.

`

                    },


                    // ==================================================
                    // USER QUERY
                    // ==================================================

                    {

                        role:
                            "user",


                        content:
                            JSON.stringify({

                                searchQuery:
                                    normalizedQuery

                            })

                    }

                ],


                // ====================================================
                // STRUCTURED JSON OUTPUT
                // ====================================================

                response_format: {

                    type:
                        "json_schema",


                    json_schema: {

                        name:
                            "search_classification",


                        strict:
                            true,


                        schema: {

                            type:
                                "object",


                            properties: {

                                category: {

                                    type:
                                        "string"

                                },


                                intent: {

                                    type:
                                        "string"

                                }

                            },


                            required: [

                                "category",
                                "intent"

                            ],


                            additionalProperties:
                                false

                        }

                    }

                }

            });


    } catch (error) {

        // ========================================================
        // GROQ ERROR
        // ========================================================

        console.error(
            `❌ SEARCH CLASSIFICATION ERROR: ${normalizedQuery}`
        );


        console.error(
            error
        );


        throw error;

    }


    // ========================================================
    // READ RESPONSE
    // ========================================================

    const rawResult =
        response
            ?.choices?.[0]
            ?.message?.content;


    if (!rawResult) {

        throw new Error(
            "Empty search classification response from Groq"
        );

    }


    // ========================================================
    // PARSE JSON
    // ========================================================

    let result;


    try {

        result =
            JSON.parse(
                rawResult
            );

    } catch (error) {

        throw new Error(
            `Invalid JSON returned from Groq: ${rawResult}`
        );

    }


    // ========================================================
    // NORMALIZE CATEGORY
    // ========================================================

    const category =
        result
            ?.category
            ?.trim()
            .toLowerCase()
            .replace(/\s+/g, "_");


    // ========================================================
    // NORMALIZE INTENT
    // ========================================================

    const intent =
        result
            ?.intent
            ?.trim()
            .toLowerCase()
            .replace(/\s+/g, "_");


    // ========================================================
    // VALIDATE CATEGORY
    // ========================================================

    if (!category) {

        throw new Error(
            `Invalid search classification returned: empty category for "${normalizedQuery}"`
        );

    }


    // ========================================================
    // VALIDATE INTENT
    // ========================================================

    if (!intent) {

        throw new Error(
            `Invalid search classification returned: empty intent for "${normalizedQuery}"`
        );

    }


    // ========================================================
    // FINAL LOG
    // ========================================================

    console.log(
        `🔎 SEARCH CLASSIFIED: ${normalizedQuery} → ${category} (${intent})`
    );


    // ========================================================
    // RETURN RESULT
    // ========================================================

    return {

        category,

        intent

    };

}


// ============================================================
// EXPORT
// ============================================================

module.exports = {

    classifySearch

};

