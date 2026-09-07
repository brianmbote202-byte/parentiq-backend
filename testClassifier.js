
require("dotenv").config();

const { classifyApp } = require("./appClassification/AppClassifier");

async function test() {
    try {
        const category = await classifyApp(
            "Google Chrome",
            "com.android.chrome"
        );

        console.log("✅ FINAL RESULT:", category);
    } catch (error) {
        console.error("❌ CLASSIFICATION FAILED:");
        console.error(error);
    }
}

test();
