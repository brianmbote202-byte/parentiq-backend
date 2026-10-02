const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
require("./events/CacheEventListener");

const SubscriptionManager = require("./subscriptions/SubscriptionManager");
const CommissionManager = require("./commissions/CommissionManager");

const crypto = require("crypto");

//==========currency exchange========
const {
    getUsdToKesRate,
    usdToKes
} = require("./services/CurrencyService");

//=======PAYPAL========
const PayPalManager =
    require("./payments/PayPalManager");

const PayPalFulfillmentManager =
    require("./payments/PayPalFulfillmentManager");    

const WithdrawalManager =
    require("./withdrawals/WithdrawalManager");


const express = require("express");
const cors = require("cors");

const DashboardManager =
require("./dashboard/DashboardManager");

//======APP CLASSIFICATION=====
const { classifyApp } = require("./appClassification/AppClassifier");




const {
    classifyPendingApp,
    correctAppCategory,
    processPendingApps
} = require("./appClassification/AppCategoryProcessor"); 

const {
    startAppClassificationWorker
} = require("./appClassification/AppClassificationWorker");

const {
    startDomainClassificationWorker
} = require("./appClassification/DomainClassificationWorker");


//===============searches categorization==========
const {
    startSearchClassificationWorker
} = require("./appClassification/SearchClassificationWorker");



const ActivityManager =
    require("./activity/ActivityManager");


const DashboardCache =
    require("./cache/DashboardCache");

const CacheManager =
    require("./cache/CacheManager");    

const CustomerManager =
require("./customers/CustomerManager");

const customerRoutes =
    require("./routes/customerRoutes");

const agentRoutes =
require("./routes/agentRoutes");

const activityRoutes = require("./routes/activityRoutes");

const AdminManager =
require("./admin/AdminManager");

const referralManager =
    require("./referrals/ReferralManager");

const referralRoutes =
    require("./routes/referrals");   

const withdrawalRoutes =
    require("./routes/withdrawals");

const growthRoutes =
    require("./routes/growth");   
    
const GrowthCoachBuilder =
    require("./coaching/GrowthCoachBuilder");    


const AgentPreferenceManager =
    require("./preferences/AgentPreferenceManager"); 

const payoutRoutes =
    require("./routes/payoutRoutes");

const MpesaB2CManager =
    require("./payments/MpesaB2CManager");  

const PayPalPayoutManager =
    require("./payments/PayPalPayoutManager");    
    
const AccountBalanceManager =
    require("./mpesa/AccountBalanceManager");   

const balanceRoutes = require("./routes/balance");    
    
const AdminDashboardManager =
    require("./admin/AdminDashboardManager"); 

const PlanManager =
    require("./plans/PlanManager");  
    
const EntitlementManager =
    require("./subscriptions/EntitlementManager");    



    /*===================================
    FINANCE
    =====================================*/
    
const LedgerManager =
    require("./finance/LedgerManager");

const LedgerTypes =
    require("./finance/LedgerTypes");

const LedgerDirection =
    require("./finance/LedgerDirection");

const LedgerCategory =
    require("./finance/LedgerCategory");   
    
/*
====================================
PAYMENTS
====================================
*/

const PaymentStatus =
    require("./payments/PaymentStatus");    

    

    

const { stkPush } = require("./mpesa/daraja"); 
const PaystackManager = require("./payments/PaystackManager");
const { db } = require("./firebase");

const initializeDatabase = require("./database/DatabaseInitializer");

const app = express();


initializeDatabase()
    .then(() => {
        console.log("ParentIQ backend is ready.");
    })
    .catch((error) => {
        console.error(error);
    });

app.use(cors());
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));




//==================DOMAIN CLASSIFIER REGISTER============

const { registerDomain } =
    require("./appClassification/DomainCategoryProcessor");

app.post("/domain-classification/register", async (req, res) => {

    try {

        const { domain } = req.body;

        if (!domain) {
            return res.status(400).json({
                success: false,
                error: "domain is required"
            });
        }

        const result =
            await registerDomain(domain);

        return res.json({
            success: true,
            ...result
        });

    } catch (error) {

        console.error(
            "❌ Domain registration endpoint failed:",
            error
        );

        return res.status(500).json({
            success: false,
            error: "Domain registration failed"
        });
    }
});



//================= DOMAIN CLASSIFICATION API =================

const { classifyDomain } =
    require("./appClassification/DomainClassifier");

app.post(
    "/domain-classification/classify",
    async (req, res) => {

        try {

            const { domain } =
                req.body;

            if (!domain) {

                return res.status(400).json({
                    success: false,
                    error: "domain is required"
                });
            }

            const normalizedDomain =
                domain
                    .trim()
                    .toLowerCase()
                    .replace(/^www\./, "");

            if (!normalizedDomain) {

                return res.status(400).json({
                    success: false,
                    error: "invalid domain"
                });
            }

            const result =
                await classifyDomain(
                    normalizedDomain
                );

            return res.json({

                success: true,

                domain:
                    normalizedDomain,

                category:
                    result.category,

                primaryPurpose:
                    result.primaryPurpose

            });

        } catch (error) {

            console.error(
                "❌ Domain classification endpoint failed:",
                error
            );

            return res.status(500).json({

                success: false,

                error:
                    "Domain classification failed"

            });
        }
    }
);

//================= SEARCH CLASSIFICATION API =================

const { classifySearch } =
    require("./appClassification/SearchClassifier");


app.post(
    "/search-classification/classify",
    async (req, res) => {

        try {

            const { searchQuery } =
                req.body;


            if (!searchQuery) {

                return res.status(400).json({

                    success: false,

                    error:
                        "searchQuery is required"

                });

            }


            const normalizedQuery =
                searchQuery
                    .trim()
                    .toLowerCase();


            if (!normalizedQuery) {

                return res.status(400).json({

                    success: false,

                    error:
                        "invalid searchQuery"

                });

            }


            const result =
                await classifySearch(
                    normalizedQuery
                );


            return res.json({

                success: true,

                searchQuery:
                    normalizedQuery,

                category:
                    result.category,

                intent:
                    result.intent

            });


        } catch (error) {

            console.error(
                "❌ Search classification endpoint failed:",
                error
            );


            return res.status(500).json({

                success: false,

                error:
                    "Search classification failed"

            });

        }

    }
);
//========searches temporal test==========
app.post(
    "/search-classification/register",
    async (req, res) => {

        try {

            const { searchQuery } =
                req.body;

            if (!searchQuery) {
                return res.status(400).json({
                    success: false,
                    error: "searchQuery is required"
                });
            }

            const {
                registerSearch
            } =
                require("./appClassification/SearchCategoryProcessor");

            const result =
                await registerSearch(
                    searchQuery
                );

            return res.json({
                success: true,
                ...result
            });

        } catch (error) {

            console.error(
                "❌ Search registration failed:",
                error
            );

            return res.status(500).json({
                success: false,
                error: "Search registration failed"
            });
        }
    }
);


app.post("/app-classification/classify", async (req, res) => {
    try {
        const { appName, packageName } = req.body;

        if (!appName || !packageName) {
            return res.status(400).json({
                success: false,
                error: "appName and packageName are required"
            });
        }

        const category = await classifyApp(
            appName,
            packageName
        );

        return res.json({
            success: true,
            appName,
            packageName,
            category
        });

    } catch (error) {
        console.error(
            "❌ App classification endpoint failed:",
            error
        );

        return res.status(500).json({
            success: false,
            error: "App classification failed"
        });
    }
});

//=============UPDATE PENDING APP CATEGOTY=========
app.post("/app-classification/classify-pending", async (req, res) => {
    try {
        const { packageKey } = req.body;

        if (!packageKey) {
            return res.status(400).json({
                success: false,
                error: "packageKey is required"
            });
        }

        const result = await classifyPendingApp(packageKey);

        return res.json({
            success: true,
            ...result
        });

    } catch (error) {
        console.error(
            "❌ Pending app classification failed:",
            error
        );

        return res.status(500).json({
            success: false,
            error: "Pending app classification failed"
        });
    }
});

//=========process pending categories in batches==========
app.post("/app-classification/process-pending", async (req, res) => {
    try {
        const result = await processPendingApps(5);

        return res.json({
            success: true,
            ...result
        });

    } catch (error) {
        console.error(
            "❌ Pending apps processing failed:",
            error
        );

        return res.status(500).json({
            success: false,
            error: "Pending apps processing failed"
        });
    }
});

//==================PENDING APPS INSPECTION=========

app.get("/app-classification/pending", async (req, res) => {
    try {
        const snapshot = await db
            .ref("app_categories")
            .once("value");

        if (!snapshot.exists()) {
            return res.json({
                success: true,
                count: 0,
                apps: []
            });
        }

        const apps = snapshot.val() || {};

        const pendingApps = Object.entries(apps)
            .filter(([_, appData]) =>
                appData &&
                appData.category === "pending"
            )
            .map(([packageKey, appData]) => ({
                packageKey,
                appName: appData.appName || "",
                packageName: appData.packageName || ""
            }));

        return res.json({
            success: true,
            count: pendingApps.length,
            apps: pendingApps
        });

    } catch (error) {
        console.error(
            "❌ Failed to inspect pending apps:",
            error
        );

        return res.status(500).json({
            success: false,
            error: "Failed to inspect pending apps"
        });
    }
});

//============app classification correction========
app.post("/app-classification/correct", async (req, res) => {
    try {
        const { packageKey, category } = req.body;

        if (!packageKey || !category) {
            return res.status(400).json({
                success: false,
                error: "packageKey and category are required"
            });
        }

        const result = await correctAppCategory(
            packageKey,
            category
        );

        return res.json({
            success: true,
            ...result
        });

    } catch (error) {
        console.error(
            "❌ App category correction failed:",
            error
        );

        return res.status(500).json({
            success: false,
            error: "App category correction failed"
        });
    }
});










app.use("/apk", express.static(path.join(__dirname, "apk")));
app.use("/customers", customerRoutes);
app.use("/agents", agentRoutes);
app.use("/withdrawals", withdrawalRoutes);
app.use("/referrals", referralRoutes);
app.use("/growth", growthRoutes);
app.use("/activities", activityRoutes);
app.use("/payout", payoutRoutes);

app.use("/mpesa/balance", balanceRoutes);



/**
 * TEST ROUTE
 */
app.get("/", (req, res) => {
    res.send("M-Pesa Backend is Running 🚀");
});


//====================== STK PUSH ======================
 app.post("/stkpush", async (req, res) => {

    try {

        const {
            uid,
            childId,
            phone,
            planId
        } = req.body;


        // ==================================================
        // VALIDATION
        // ==================================================

        if (
            !uid ||
            !childId ||
            !phone ||
            !planId
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "uid, childId, phone and planId are required."

            });
        }


        console.log("================================");
        console.log("NEW STK PUSH REQUEST");
        console.log("================================");

        console.log("Body:");
        console.log(req.body);


        // ==================================================
        // LOAD PLAN
        // ==================================================

        const plan =
            await PlanManager.getPlan(planId);


        console.log("================================");
        console.log("PLAN LOADED");
        console.log("================================");

        console.log(plan);


        if (!plan) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid subscription plan."

            });
        }


        // ==================================================
        // VALIDATE PLAN PRICE
        // ==================================================

        const planPrice =
            Number(plan.price);


        if (
            !Number.isFinite(planPrice) ||
            planPrice <= 0
        ) {

            console.error(
                "Invalid plan price:",
                plan.price
            );

            return res.status(500).json({

                success: false,

                message:
                    "Invalid subscription plan price."

            });
        }
        // ==================================================
// GET CURRENT USD/KES EXCHANGE RATE
// ==================================================

let fxRate = null;
let usdAmount = null;
let fxDate = null;
let fxProvider = null;

try {

    const fx =
        await getUsdToKesRate();

    fxRate =
        Number(fx.rate);

    fxDate =
        fx.date || null;

    fxProvider =
        fx.provider || null;

    if (
        Number.isFinite(fxRate) &&
        fxRate > 0
    ) {

        usdAmount =
            Number(
                (planPrice / fxRate).toFixed(2)
            );

    }

    console.log("================================");
    console.log("PAYMENT CURRENCY CONVERSION");
    console.log("================================");

    console.log(
        "Plan Amount KES:",
        planPrice
    );

    console.log(
        "USD/KES Rate:",
        fxRate
    );

    console.log(
        "USD Amount:",
        usdAmount
    );

    console.log(
        "FX Provider:",
        fxProvider
    );

    console.log(
        "FX Date:",
        fxDate
    );

    console.log("================================");

}
catch (fxError) {

    console.error(
        "FX conversion failed:",
        fxError.message
    );

    /*
     * M-Pesa must still work even if
     * the FX provider temporarily fails.
     *
     * The actual M-Pesa charge remains KES.
     */

    fxRate = null;
    usdAmount = null;
}


        // ==================================================
        // PREVENT DUPLICATE STK REQUESTS
        // ==================================================

        const transactionsSnapshot =
            await db
                .ref("transactions")
                .orderByChild("phone")
                .equalTo(phone)
                .once("value");


        if (transactionsSnapshot.exists()) {

            const transactions =
                transactionsSnapshot.val() || {};

            const nowCheck =
                Date.now();

            const pendingEntry =
                Object.entries(transactions)
                    .find(([_, transaction]) => {

                        if (!transaction) {
                            return false;
                        }


                        if (
                            transaction.status !==
                            "PENDING"
                        ) {
                            return false;
                        }


                        const createdAt =
                            Number(
                                transaction.createdAt || 0
                            );


                        /*
                         * Only block recent pending
                         * transactions.
                         *
                         * Older stale transactions
                         * will not block a new payment.
                         */

                        return (
                            createdAt > 0 &&
                            nowCheck - createdAt <
                            5 * 60 * 1000
                        );

                    });


            if (pendingEntry) {

                const [
                    pendingCheckoutId,
                    pendingTransaction
                ] = pendingEntry;


                console.warn(
                    "================================"
                );

                console.warn(
                    "DUPLICATE STK REQUEST BLOCKED"
                );

                console.warn(
                    "Phone:",
                    phone
                );

                console.warn(
                    "Existing Checkout:",
                    pendingCheckoutId
                );

                console.warn(
                    "Existing Plan:",
                    pendingTransaction.planId
                );

                console.warn(
                    "================================"
                );


                return res.status(409).json({

                    success: false,

                    message:
                        "A payment request is already pending. Please complete or wait for the current M-Pesa prompt.",

                    checkoutId:
                        pendingCheckoutId

                });
            }
        }


        // ==================================================
        // SEND STK PUSH
        // ==================================================

        console.log("================================");
        console.log("SENDING STK PUSH");
        console.log("================================");

        console.log(
            "Phone:",
            phone
        );

        console.log(
            "Plan:",
            plan.name
        );

        console.log(
            "Amount:",
            planPrice
        );


        /*
         * IMPORTANT:
         *
         * Use the actual plan price.
         *
         * Family = 1800
         * Premium = 750
         */

        const response =
            await stkPush(
                phone,
                planPrice,
                plan.name
            );


        const checkoutId =
            response.CheckoutRequestID;


        if (!checkoutId) {

            console.error(
                "M-Pesa did not return CheckoutRequestID"
            );

            return res.status(500).json({

                success: false,

                message:
                    "M-Pesa did not return a CheckoutRequestID."

            });
        }


        const now =
            Date.now();


        // ==================================================
        // SAVE TRANSACTION
        // ==================================================

        await db
    .ref(`transactions/${checkoutId}`)
    .set({

        uid,

        childId,

        phone,

        planId,

        planName:
            plan.name,

        // Actual amount charged by M-Pesa
        amount:
            planPrice,

        // Currency actually charged
        currency:
            "KES",

        // USD equivalent shown to the customer
        displayAmountUSD:
            usdAmount,

        displayCurrency:
            "USD",

        // Exchange-rate information
        fxRate:
            fxRate,

        fxProvider:
            fxProvider,

        fxDate:
            fxDate,

        status:
            "PENDING",

        processed:
            false,

        processing:
            false,

        createdAt:
            now

    });
        // ==================================================
        // UPDATE CHILD BILLING STATE
        // ==================================================

        await db
            .ref(`children/${childId}`)
            .update({

                billing: {

                    phone,

                    lastCheckoutId:
                        checkoutId,

                    lastPaymentStatus:
                        "PENDING"

                },

                subscription: {

                    status:
                        "PENDING",

                    premium:
                        false,

                    expiryDate:
                        0

                },

                meta: {

                    updatedAt:
                        now

                }

            });


        // ==================================================
        // SUCCESS
        // ==================================================

        console.log("================================");
        console.log("STK PUSH SENT");
        console.log("================================");

        console.log(
            "CheckoutRequestID:",
            checkoutId
        );

        console.log(
            "Amount:",
            planPrice
        );

        console.log(
            "Plan:",
            plan.name
        );


        return res.json({

    success: true,

    data: response,

    pricing: {

        planId,

        planName:
            plan.name,

        amountKES:
            planPrice,

        amountUSD:
            usdAmount,

        chargeCurrency:
            "KES",

        displayCurrency:
            "USD",

        fxRate,

        fxProvider,

        fxDate

    }

});


    } catch (error) {

        console.error(
            "STK ERROR:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "STK Push failed"

        });

    }

});

//====================== CALLBACK ======================
//======================================================
// M-PESA STK CALLBACK
//======================================================

app.post("/mpesa/callback", async (req, res) => {

    let checkoutId = null;
    let txRef = null;

    try {

        console.log("================================");
        console.log("M-PESA STK CALLBACK");
        console.log("================================");

        console.log(
            JSON.stringify(req.body, null, 2)
        );


        /*
        ==================================================
        PARSE CALLBACK
        ==================================================
        */

        const stkCallback =
            req.body?.Body?.stkCallback;


        if (!stkCallback) {

            console.log(
                "Invalid STK callback payload."
            );

            return res.json({
                ResultCode: 0,
                ResultDesc: "Accepted"
            });

        }


        /*
        ==================================================
        CALLBACK DATA
        ==================================================
        */

        checkoutId =
            stkCallback.CheckoutRequestID;

        const merchantRequestId =
            stkCallback.MerchantRequestID;

        const resultCode =
            Number(stkCallback.ResultCode);

        const resultDesc =
            stkCallback.ResultDesc || "";


        if (!checkoutId) {

            console.log(
                "STK callback missing CheckoutRequestID."
            );

            return res.json({
                ResultCode: 0,
                ResultDesc: "Accepted"
            });

        }


        console.log(
            "CheckoutRequestID:",
            checkoutId
        );

        console.log(
            "MerchantRequestID:",
            merchantRequestId
        );

        console.log(
            "ResultCode:",
            resultCode
        );

        console.log(
            "ResultDesc:",
            resultDesc
        );


        /*
        ==================================================
        TRANSACTION REFERENCE
        ==================================================
        */

        txRef =
            db
                .ref("transactions")
                .child(checkoutId);


        /*
        ==================================================
        FIRST: VERIFY TRANSACTION EXISTS
        ==================================================
        */

        const existingSnap =
            await txRef.once("value");


        if (!existingSnap.exists()) {

            console.error(
                "================================"
            );

            console.error(
                "TRANSACTION NOT FOUND"
            );

            console.error(
                "CheckoutRequestID:",
                checkoutId
            );

            console.error(
                "Expected Firebase path:",
                `transactions/${checkoutId}`
            );

            console.error(
                "================================"
            );


            return res.json({
                ResultCode: 0,
                ResultDesc: "Accepted"
            });

        }


        const existingTransaction =
            existingSnap.val();


        console.log(
            "TRANSACTION FOUND:"
        );

        console.log(
            JSON.stringify(
                existingTransaction,
                null,
                2
            )
        );


        /*
        ==================================================
        ALREADY PROCESSED
        ==================================================
        */

        if (
            existingTransaction.processed === true
        ) {

            console.log(
                "Transaction already processed:",
                checkoutId
            );

            return res.json({
                ResultCode: 0,
                ResultDesc: "Accepted"
            });

        }


        /*
        ==================================================
        ACQUIRE PROCESSING LOCK
        ==================================================
        */

        const lockResult =
            await txRef.transaction(transaction => {

                /*
                ------------------------------------------
                TRANSACTION DISAPPEARED
                ------------------------------------------
                */

                if (!transaction) {

                    return null;

                }


                /*
                ------------------------------------------
                ALREADY PROCESSED
                ------------------------------------------
                */

                if (
                    transaction.processed === true
                ) {

                    return null;

                }


                /*
                ------------------------------------------
                ANOTHER PROCESS WORKING
                ------------------------------------------
                */

                if (
                    transaction.processing === true
                ) {

                    const startedAt =
                        transaction.processingStartedAt || 0;

                    const age =
                        Date.now() - startedAt;


                    /*
                    Recover stale locks after 2 minutes.
                    */

                    if (age < 120000) {

                        return null;

                    }


                    console.log(
                        "Recovering stale transaction:",
                        checkoutId
                    );

                }


                /*
                ------------------------------------------
                ACQUIRE LOCK
                ------------------------------------------
                */

                transaction.processing = true;

                transaction.processingStartedAt =
                    Date.now();

                transaction.callbackReceivedAt =
                    Date.now();

                transaction.callbackResultCode =
                    resultCode;

                transaction.callbackResultDesc =
                    resultDesc;


                return transaction;

            });


        /*
        ==================================================
        CHECK LOCK
        ==================================================
        */

        if (!lockResult.committed) {

            console.log(
                "Transaction lock NOT acquired:",
                checkoutId
            );

            console.log(
                "Current transaction state:",
                JSON.stringify(
                    lockResult.snapshot?.val() || null,
                    null,
                    2
                )
            );

            return res.json({
                ResultCode: 0,
                ResultDesc: "Accepted"
            });

        }


        /*
        ==================================================
        LOAD LOCKED TRANSACTION
        ==================================================
        */

        const transaction =
            lockResult.snapshot.val();


        if (!transaction) {

            console.error(
                "Locked transaction snapshot is empty:",
                checkoutId
            );

            return res.json({
                ResultCode: 0,
                ResultDesc: "Accepted"
            });

        }


        /*
        ==================================================
        EXTRACT DATA
        ==================================================
        */

        const childId =
            transaction.childId;

        const phone =
            transaction.phone;

        const planId =
            transaction.planId;

        const amount =
            Number(transaction.amount || 0);


        console.log(
            "================================"
        );

        console.log(
            "LOCK ACQUIRED"
        );

        console.log(
            "Checkout:",
            checkoutId
        );

        console.log(
            "Child:",
            childId
        );

        console.log(
            "Plan:",
            planId
        );

        console.log(
            "Transaction Amount:",
            amount
        );

        console.log(
            "M-Pesa Result:",
            resultCode
        );

        console.log(
            "================================"
        );


        /*
        ==================================================
        VALIDATE TRANSACTION
        ==================================================
        */

        if (!childId) {

            await txRef.update({

                status: "FAILED",

                processed: true,

                processing: false,

                processingStartedAt: null,

                processedAt: Date.now(),

                completedAt: Date.now(),

                failureReason:
                    "MISSING_CHILD_ID"

            });

            return res.json({
                ResultCode: 0,
                ResultDesc: "Accepted"
            });

        }


        if (!planId) {

            await txRef.update({

                status: "FAILED",

                processed: true,

                processing: false,

                processingStartedAt: null,

                processedAt: Date.now(),

                completedAt: Date.now(),

                failureReason:
                    "MISSING_PLAN_ID"

            });

            return res.json({
                ResultCode: 0,
                ResultDesc: "Accepted"
            });

        }


        /*
        ==================================================
        LOAD PLAN
        ==================================================
        */

        const plan =
            await PlanManager.getPlan(planId);


        if (!plan) {

            console.error(
                "Invalid subscription plan:",
                planId
            );

            await txRef.update({

                status: "FAILED",

                processed: true,

                processing: false,

                processingStartedAt: null,

                processedAt: Date.now(),

                completedAt: Date.now(),

                failureReason:
                    "INVALID_PLAN"

            });

            return res.json({
                ResultCode: 0,
                ResultDesc: "Accepted"
            });

        }


        /*
        ==================================================
        LOAD CHILD
        ==================================================
        */

        const childRef =
            db
                .ref("children")
                .child(childId);


        const childSnap =
            await childRef.once("value");


        if (!childSnap.exists()) {

            console.error(
                "Child not found:",
                childId
            );

            await txRef.update({

                status: "FAILED",

                processed: true,

                processing: false,

                processingStartedAt: null,

                processedAt: Date.now(),

                completedAt: Date.now(),

                failureReason:
                    "CHILD_NOT_FOUND"

            });

            return res.json({
                ResultCode: 0,
                ResultDesc: "Accepted"
            });

        }


        const child =
            childSnap.val();


        const now =
            Date.now();


        /*
        ==================================================
        PAYMENT FAILED
        ==================================================
        */

        if (resultCode !== 0) {

            console.log(
                "================================"
            );

            console.log(
                "M-PESA PAYMENT FAILED"
            );

            console.log(
                "Child:",
                childId
            );

            console.log(
                "Plan:",
                planId
            );

            console.log(
                "ResultCode:",
                resultCode
            );

            console.log(
                "ResultDesc:",
                resultDesc
            );

            console.log(
                "================================"
            );


             await childRef
    .child("billing")
    .update({
        lastPaymentStatus: "FAILED",
        lastCheckoutId: checkoutId,
        lastPaymentError: resultDesc,
        lastPaymentResultCode: resultCode
    });


            await childRef
                .child("billing")
                .update({

                    lastPaymentStatus:
                        "FAILED",

                    lastCheckoutId:
                        checkoutId,

                    lastPaymentError:
                        resultDesc,

                    lastPaymentResultCode:
                        resultCode

                });


            await txRef.update({

                status: "FAILED",

                processed: true,

                processing: false,

                processingStartedAt: null,

                processedAt: now,

                completedAt: now,

                callbackResultCode:
                    resultCode,

                callbackResultDesc:
                    resultDesc

            });


            console.log(
                "Payment failure recorded."
            );


            return res.json({
                ResultCode: 0,
                ResultDesc: "Accepted"
            });

        }


        /*
        ==================================================
        PAYMENT SUCCESS
        ==================================================
        */

        console.log(
            "================================"
        );

        console.log(
            "M-PESA PAYMENT SUCCESS"
        );

        console.log(
            "Child:",
            childId
        );

        console.log(
            "Plan:",
            plan.name
        );

        console.log(
            "Expected Amount:",
            amount
        );

        console.log(
            "Checkout:",
            checkoutId
        );

        console.log(
            "================================"
        );


        /*
        ==================================================
        IMPORTANT:
        READ ACTUAL M-PESA PAYMENT METADATA
        ==================================================
        */

        const callbackItems =
            stkCallback.CallbackMetadata?.Item || [];


        const callbackMetadata = {};


        for (
            const item of callbackItems
        ) {

            if (
                item?.Name
            ) {

                callbackMetadata[item.Name] =
                    item.Value ?? null;

            }

        }


        const mpesaAmount =
            Number(
                callbackMetadata.Amount || 0
            );


        const mpesaReceipt =
            callbackMetadata.MpesaReceiptNumber ||
            "";


        const mpesaPhone =
            callbackMetadata.PhoneNumber ||
            "";


        const transactionDate =
            callbackMetadata.TransactionDate ||
            null;


        console.log(
            "Actual M-Pesa Amount:",
            mpesaAmount
        );

        console.log(
            "M-Pesa Receipt:",
            mpesaReceipt
        );

        console.log(
            "M-Pesa Phone:",
            mpesaPhone
        );

        console.log(
            "M-Pesa Transaction Date:",
            transactionDate
        );


        /*
==================================================
AMOUNT VALIDATION
==================================================
*/

const expectedAmount =
    Number(plan.price);

const receivedAmount =
    Number(mpesaAmount);

console.log(
    "================================"
);

console.log(
    "AMOUNT VALIDATION"
);

console.log(
    "Expected Plan Amount:",
    expectedAmount
);

console.log(
    "Transaction Amount:",
    amount
);

console.log(
    "Actual M-Pesa Amount:",
    receivedAmount
);

console.log(
    "Checkout:",
    checkoutId
);

console.log(
    "================================"
);


/*
--------------------------------------------------
TRANSACTION AMOUNT MUST MATCH PLAN PRICE
--------------------------------------------------
*/

if (
    !Number.isFinite(expectedAmount) ||
    expectedAmount <= 0 ||
    amount !== expectedAmount
) {

    console.error(
        "================================"
    );

    console.error(
        "TRANSACTION AMOUNT INVALID"
    );

    console.error(
        "Plan Price:",
        expectedAmount
    );

    console.error(
        "Transaction Amount:",
        amount
    );

    console.error(
        "Checkout:",
        checkoutId
    );

    console.error(
        "================================"
    );

    await txRef.update({

        status: "FAILED",

        processed: true,

        processing: false,

        processingStartedAt: null,

        processedAt: Date.now(),

        completedAt: Date.now(),

        failureReason:
            "TRANSACTION_AMOUNT_INVALID",

        expectedAmount,

        transactionAmount:
            amount,

        callbackResultCode:
            resultCode,

        callbackResultDesc:
            resultDesc
    });

    return res.json({
        ResultCode: 0,
        ResultDesc: "Accepted"
    });
}


/*
--------------------------------------------------
M-PESA AMOUNT MUST EXACTLY MATCH
--------------------------------------------------
*/

if (
    !Number.isFinite(receivedAmount) ||
    receivedAmount <= 0 ||
    receivedAmount !== expectedAmount
) {

    console.error(
        "================================"
    );

    console.error(
        "AMOUNT MISMATCH - PAYMENT REJECTED"
    );

    console.error(
        "Expected:",
        expectedAmount
    );

    console.error(
        "Received:",
        receivedAmount
    );

    console.error(
        "Receipt:",
        mpesaReceipt
    );

    console.error(
        "Phone:",
        mpesaPhone
    );

    console.error(
        "Checkout:",
        checkoutId
    );

    console.error(
        "================================"
    );


    /*
    ------------------------------------------------
    IMPORTANT:
    NEVER activate subscription.
    NEVER record commission.
    NEVER credit wallet.
    ------------------------------------------------
    */

    await txRef.update({

        status: "FAILED",

        processed: true,

        processing: false,

        processingStartedAt: null,

        processedAt: Date.now(),

        completedAt: Date.now(),

        failureReason:
            "AMOUNT_MISMATCH",

        expectedAmount,

        receivedAmount,

        mpesaReceipt,

        mpesaPhone,

        mpesaTransactionDate:
            transactionDate,

        callbackResultCode:
            resultCode,

        callbackResultDesc:
            resultDesc
    });


    /*
    ------------------------------------------------
    Record billing failure
    ------------------------------------------------
    */

    await childRef
        .child("billing")
        .update({

            lastCheckoutId:
                checkoutId,

            lastPaymentStatus:
                "FAILED",

            lastPaymentError:
                `Amount mismatch. Expected ${expectedAmount}, received ${receivedAmount}`,

            lastPaymentResultCode:
                resultCode,

            lastMpesaReceipt:
                mpesaReceipt
        });


    console.error(
        "Payment rejected because M-Pesa amount does not match plan price."
    );


    return res.json({
        ResultCode: 0,
        ResultDesc: "Accepted"
    });
}


        /*
        ==================================================
        FIND AGENT
        ==================================================
        */

        let agentId = null;


        if (child.parentId) {

            const parentSnap =
                await db
                    .ref("parents")
                    .child(child.parentId)
                    .once("value");


            if (parentSnap.exists()) {

                const parent =
                    parentSnap.val();


                agentId =
                    parent?.referral?.agentId ||
                    null;

            }

        }


        console.log(
            "Agent:",
            agentId || "NONE"
        );


        /*
        ==================================================
        ACTIVATE SUBSCRIPTION
        ==================================================
        */

        /*
==================================================
ACTIVATE SUBSCRIPTION
==================================================
*/

/*
----------------------------------------------
Always activate the child subscription
----------------------------------------------

This MUST remain because your child subscription
is used by the agent/customer/payment system.
*/

await SubscriptionManager.activate(
    childId,
    planId
);


/*
----------------------------------------------
FAMILY PLAN
----------------------------------------------

Additionally create/update the parent-level
Family entitlement.
*/

if (
    planId === "family" &&
    child.parentId
) {

    await SubscriptionManager.activateFamily(
        child.parentId,
        childId,
        planId
    );

}


        /*
        ==================================================
        BILLING
        ==================================================
        */

        await childRef
            .child("billing")
            .update({

                phone,

                lastCheckoutId:
                    checkoutId,

                lastPaymentStatus:
                    "SUCCESS",

                lastPaidAt:
                    now,

                lastPlanId:
                    planId,

                lastAmount:
                    mpesaAmount || amount,

                lastPaymentResultCode:
                    resultCode,

                lastMpesaReceipt:
                    mpesaReceipt,

                lastMpesaTransactionDate:
                    transactionDate

            });


        /*
        ==================================================
        PAYMENT HISTORY
        ==================================================
        */

        await childRef
            .child("payments")
            .child(checkoutId)
            .set({

                amount:
                    mpesaAmount || amount,

                expectedAmount:
                    amount,

                planId,

                checkoutId,

                mpesaReceipt,

                mpesaPhone,

                transactionDate,

                status:
                    "SUCCESS",

                paidAt:
                    now

            });


        /*
        ==================================================
        LEDGER
        ==================================================
        */

        await LedgerManager.record({

            type:
                LedgerTypes.SUBSCRIPTION_PAYMENT,

            direction:
                LedgerDirection.CREDIT,

            category:
                LedgerCategory.SUBSCRIPTION,

            amount:
                mpesaAmount || amount,

            parentId:
                child.parentId || "",

            childId,

            checkoutId,

            description:
                `${plan.name} subscription payment`,

            metadata: {

                planId,

                planName:
                    plan.name,

                phone,

                amount:
                    mpesaAmount || amount,

                expectedAmount:
                    amount,

                mpesaReceipt,

                paymentMethod:
                    "MPESA"

            }

        });


        /*
        ==================================================
        META
        ==================================================
        */

        await childRef
            .child("meta")
            .update({

                updatedAt:
                    now

            });


        /*
        ==================================================
        AGENT COMMISSION
        ==================================================
        */

        if (agentId) {

            await CommissionManager.recordCommission({

                agentId,

                childId,

                planId,

                checkoutId

            });


            /*
            ----------------------------------------------
            CACHE
            ----------------------------------------------
            */

            try {

                await CacheManager.refreshAgent(
                    agentId
                );

            }

            catch (cacheError) {

                console.error(
                    "Agent cache refresh failed:",
                    cacheError.message
                );

            }


            try {

                DashboardCache.clear(
                    agentId
                );

            }

            catch (cacheError) {

                console.error(
                    "Dashboard cache clear failed:",
                    cacheError.message
                );

            }

        }


        /*
        ==================================================
        MARK TRANSACTION COMPLETE
        ==================================================
        */

        await txRef.update({

            status:
                "SUCCESS",

            processed:
                true,

            processing:
                false,

            processingStartedAt:
                null,

            processedAt:
                now,

            completedAt:
                now,

            callbackResultCode:
                resultCode,

            callbackResultDesc:
                resultDesc,

            mpesaAmount,

            mpesaReceipt,

            mpesaPhone,

            mpesaTransactionDate:
                transactionDate

        });


        /*
        ==================================================
        FINAL LOG
        ==================================================
        */

        console.log(
            "================================"
        );

        console.log(
            "PAYMENT COMPLETED"
        );

        console.log(
            "Child:",
            childId
        );

        console.log(
            "Plan:",
            planId
        );

        console.log(
            "Amount:",
            mpesaAmount || amount
        );

        console.log(
            "Receipt:",
            mpesaReceipt
        );

        console.log(
            "Checkout:",
            checkoutId
        );

        console.log(
            "================================"
        );


        return res.json({
            ResultCode: 0,
            ResultDesc: "Accepted"
        });


    }

    catch (error) {

        console.log(
            "================================"
        );

        console.log(
            "CALLBACK FAILED"
        );

        console.log(
            "================================"
        );

        console.error(error);


        /*
        ==================================================
        UNLOCK TRANSACTION
        ==================================================
        */

        try {

            if (checkoutId) {

                await db
                    .ref("transactions")
                    .child(checkoutId)
                    .update({

                        processing:
                            false,

                        processingStartedAt:
                            null,

                        lastError:
                            error.message,

                        lastErrorAt:
                            Date.now()

                    });

            }

        }

        catch (unlockError) {

            console.error(
                "Failed to unlock transaction:",
                unlockError
            );

        }


        /*
        ==================================================
        ACKNOWLEDGE SAFARICOM
        ==================================================
        */

        return res.json({
            ResultCode: 0,
            ResultDesc: "Accepted"
        });

    }

});

//======================================================
// M-PESA B2C RESULT CALLBACK
//======================================================

app.post("/mpesa/b2c/result", async (req, res) => {

    console.log(
        "================================"
    );

    console.log(
        "B2C RESULT CALLBACK"
    );

    console.log(
        "================================"
    );


    console.log(
        JSON.stringify(
            req.body,
            null,
            2
        )
    );


    try {

        const result =
            req.body?.Result || {};


        /*
        ==================================================
        ORIGINATOR CONVERSATION ID
        ==================================================
        */

        const originatorConversationId =
            result.OriginatorConversationID;


        if (!originatorConversationId) {

            console.log(
                "B2C callback missing OriginatorConversationID."
            );


            return res.json({

                ResultCode: 0,

                ResultDesc:
                    "Accepted"

            });

        }


        /*
        ==================================================
        FIND PAYMENT
        ==================================================
        */

        const paymentQuery =
            await db
                .ref("payments")
                .orderByChild(
                    "originatorConversationId"
                )
                .equalTo(
                    originatorConversationId
                )
                .once("value");


        if (!paymentQuery.exists()) {

            console.log(
                "B2C payment not found:",
                originatorConversationId
            );


            return res.json({

                ResultCode: 0,

                ResultDesc:
                    "Accepted"

            });

        }


        /*
        ==================================================
        GET PAYMENT
        ==================================================
        */

        const paymentData =
            paymentQuery.val();


        const paymentKey =
            Object.keys(paymentData)[0];


        const paymentRef =
            db
                .ref("payments")
                .child(paymentKey);


        const payment =
            paymentData[paymentKey];


        /*
        ==================================================
        PREVENT DUPLICATE PROCESSING
        ==================================================
        */

        if (
            payment.status ===
            PaymentStatus.SUCCESS
        ) {

            console.log(
                "B2C payment already completed:",
                originatorConversationId
            );


            return res.json({

                ResultCode: 0,

                ResultDesc:
                    "Accepted"

            });

        }


        /*
        ==================================================
        B2C SUCCESS
        ==================================================
        */

        if (
            Number(result.ResultCode) === 0
        ) {

            console.log(
                "B2C SUCCESS"
            );


            await paymentRef.update({

                status:
                    PaymentStatus.SUCCESS,

                receipt:
                    result.TransactionID || "",

                providerReference:
                    result.ConversationID || "",

                completedAt:
                    Date.now(),

                callback:
                    req.body

            });


            /*
            ----------------------------------------------
            MARK WITHDRAWAL AS PAID
            ----------------------------------------------
            */

            if (payment.withdrawalId) {

                await WithdrawalManager.markAsPaid(

                    payment.withdrawalId,

                    result.TransactionID || ""

                );

            }

        }


        /*
        ==================================================
        B2C FAILURE
        ==================================================
        */

        else {

            console.log(
                "B2C FAILED"
            );


            await paymentRef.update({

                status:
                    PaymentStatus.FAILED,

                error:
                    result.ResultDesc || "B2C payment failed",

                resultCode:
                    result.ResultCode,

                completedAt:
                    Date.now(),

                callback:
                    req.body

            });


            /*
            ----------------------------------------------
            MARK WITHDRAWAL PAYMENT FAILED
            ----------------------------------------------
            */

            if (payment.withdrawalId) {

                await WithdrawalManager.markPaymentFailed(

                    payment.withdrawalId,

                    result.ResultDesc ||
                        "B2C payment failed"

                );

            }

        }


        /*
        ==================================================
        ACKNOWLEDGE SAFARICOM
        ==================================================
        */

        return res.json({

            ResultCode: 0,

            ResultDesc:
                "Accepted"

        });


    } catch (error) {

        console.error(
            "B2C callback processing failed:",
            error
        );


        /*
        IMPORTANT:
        Always acknowledge Safaricom.
        */

        return res.json({

            ResultCode: 0,

            ResultDesc:
                "Accepted"

        });

    }

});

/*
==========================================
B2C TIMEOUT CALLBACK
==========================================
*/

/*
==========================================
B2C TIMEOUT CALLBACK
==========================================
*/

app.post("/mpesa/b2c/timeout", async (req, res) => {

    console.log("================================");
    console.log("B2C TIMEOUT CALLBACK");
    console.log("================================");

    console.log(JSON.stringify(req.body, null, 2));

    try {

        const localOriginatorConversationId =
            req.body.OriginatorConversationID;

        if (!localOriginatorConversationId) {

            console.log("Missing OriginatorConversationID");

            return res.json({

                ResultCode: 0,

                ResultDesc: "Accepted"

            });

        }

        /*
        ======================================
        FIND PAYMENT USING OUR LOCAL ID
        ======================================
        */

        const paymentQuery =
            await db
                .ref("payments")
                .orderByChild("localOriginatorConversationId")
                .equalTo(localOriginatorConversationId)
                .once("value");

        if (!paymentQuery.exists()) {

            console.log(
                "Payment not found:",
                localOriginatorConversationId
            );

            return res.json({

                ResultCode: 0,

                ResultDesc: "Accepted"

            });

        }

        const paymentKey =
            Object.keys(paymentQuery.val())[0];

        const payment =
            paymentQuery.val()[paymentKey];

        const paymentRef =
            db.ref("payments").child(paymentKey);

        /*
        ======================================
        MARK PAYMENT FAILED
        ======================================
        */

        await paymentRef.update({

            status: PaymentStatus.FAILED,

            error: "TIMEOUT",

            completedAt: Date.now(),

            callback: req.body

        });

        /*
        ======================================
        MARK WITHDRAWAL FAILED
        ======================================
        */

        await WithdrawalManager.markPaymentFailed(

            payment.withdrawalId,

            "Timeout"

        );

        console.log(
            "Withdrawal marked as PAYMENT_FAILED:",
            payment.withdrawalId
        );

        return res.json({

            ResultCode: 0,

            ResultDesc: "Accepted"

        });

    }

    catch (e) {

        console.error("B2C Timeout Error:", e);

        return res.json({

            ResultCode: 0,

            ResultDesc: "Accepted"

        });

    }

});


//======================================================
// ENTITLEMENT CHECK
//======================================================

app.get("/entitlement/:childId", async (req, res) => {

    try {

        const { childId } = req.params;

        if (!childId) {

            return res.status(400).json({

                success: false,

                message: "childId is required."

            });

        }

        const entitlement =
            await EntitlementManager
                .getEntitlement(childId);

        return res.json({

            success: true,

            childId,

            ...entitlement

        });

    }

    catch (error) {

        console.error(
            "ENTITLEMENT ERROR:",
            error
        );

        return res.status(500).json({

            success: false,

            premium: false,

            status: "ERROR",

            message:
                error.message

        });

    }

});



//====================== PREMIUM CHECK ======================
app.get("/premium/:childId", async (req, res) => {
    try {
        const { childId } = req.params;

        const snap = await db.ref(`children/${childId}/subscription`).once("value");

        if (!snap.exists()) {
            return res.json({ premium: false, status: "NOT_FOUND" });
        }

        const sub = snap.val();
        const now = Date.now();

        if (!sub.expiryDate || now > sub.expiryDate) {

            await db.ref(`children/${childId}/subscription`).update({
                status: "EXPIRED",
                premium: false
            });

            return res.json({
                premium: false,
                status: "EXPIRED"
            });
        }

        return res.json({
            premium: true,
            status: "ACTIVE",
            expiryDate: sub.expiryDate
        });

    } catch (err) {
        return res.json({
            premium: false,
            status: "ERROR"
        });
    }
});


//======================================================
// TEMPORARY PARENTIQ SEARCH DATA RESET
//======================================================

app.post("/admin/reset-search-data", async (req, res) => {

    try {

        console.log("================================");
        console.log("PARENTIQ SEARCH DATA RESET");
        console.log("================================");

        /*
         * DELETE SEARCH HISTORY
         *
         * This removes:
         *
         * analytics_browsing/{childId}/...
         */

        await db
            .ref("analytics_browsing")
            .remove();

        console.log(
            "✅ analytics_browsing deleted"
        );


        /*
         * DELETE SEARCH CLASSIFICATION DATA
         *
         * This removes:
         *
         * search_categories/...
         */

        await db
            .ref("search_categories")
            .remove();

        console.log(
            "✅ search_categories deleted"
        );


        console.log("================================");
        console.log("SEARCH DATA RESET COMPLETE");
        console.log("================================");


        return res.json({

            success: true,

            message:
                "analytics_browsing and search_categories have been deleted."

        });

    }

    catch (error) {

        console.error(
            "❌ SEARCH DATA RESET FAILED:",
            error
        );

        return res.status(500).json({

            success: false,

            error:
                error.message

        });

    }

});



//====================== SERVER ======================
const PORT = process.env.PORT || 3000;



/*
==========================================
AGENT DASHBOARD
==========================================
*/

app.get(
    "/agent/dashboard/:agentId",

    async (req, res) => {

        try {

            const dashboard =
                await DashboardManager.getDashboard(

                    req.params.agentId

                );
                

            res.json({

    success: true,

    timestamp: Date.now(),

    version: "1.0.0",

    data: dashboard

});

        }

        catch (error) {

            res.status(400).json({

                success: false,

                message: error.message

            });

        }

    }

);

/*
==========================================
AGENT WITHDRAWAL HISTORY
==========================================
*/

app.get(
    "/agent/withdrawals/:agentId",

    async (req, res) => {

        try {

            const withdrawals =
                await WithdrawalManager.getAgentWithdrawals(
                    req.params.agentId
                );

            res.json({

                success: true,

                data: withdrawals

            });

        }

        catch (error) {

            res.status(400).json({

                success: false,

                message: error.message

            });

        }

    }

);

/*B2C BALANCE*/
app.get("/mpesa/account-balance", async (req, res) => {

    try {

        const result =
            await AccountBalanceManager.getBalance();

        res.json(result);

    }

    catch (e) {

        console.log(e.response?.data || e);

        res.status(500).json({

            success:false,

            error:e.response?.data || e.message

        });

    }

});

/*TIMEOUT*/
app.post("/mpesa/balance/timeout", (req, res) => {

    console.log("=======================");
    console.log("BALANCE TIMEOUT");
    console.log("=======================");

    console.log(req.body);

    res.sendStatus(200);

});

/*RESULT*/
app.post("/mpesa/balance/result", (req, res) => {

    console.log("=======================");
    console.log("BALANCE RESULT");
    console.log("=======================");

    console.log(

        JSON.stringify(req.body, null, 2)

    );

    res.sendStatus(200);

});





/*
==========================================
AGENT CUSTOMERS
==========================================
*/

app.get(
    "/agent/customers/:agentId",

    async (req, res) => {

        try {

            const customers =
                await CustomerManager.getCustomers(
                    req.params.agentId
                );

            res.json({

                success: true,

                timestamp: Date.now(),

                version: "1.0.0",

                count: customers.length,

                data: customers

            });

        }

        catch (error) {

            res.status(400).json({

                success: false,

                message: error.message

            });

        }

    }

);

/*
==========================================
AGENT CUSTOMER DETAILS
==========================================
*/

app.get(
    "/agent/customer/:agentId/:childId",

    async (req, res) => {

         console.log("Agent:", req.params.agentId);
         console.log("Child:", req.params.childId);


        try {

            const customer =
                await CustomerManager.getCustomer(

                    req.params.agentId,
                    req.params.childId

                );

            res.json({

                success: true,

                timestamp: Date.now(),

                version: "2.0.0",

                data: customer

            });

        }

        catch (error) {

            res.status(400).json({

                success: false,

                message: error.message

            });

        }

    }

);

/*
==========================================
ADD CUSTOMER ACTIVITY
==========================================
*/

app.post(
    "/agent/customer/:agentId/:childId/activity",

    async (req, res) => {

        console.log("========== ADD ACTIVITY ==========");

        console.log("Agent:", req.params.agentId);
        console.log("Child:", req.params.childId);
        console.log("Body:", req.body);

        try {

            await CustomerManager.addActivity(

    req.params.agentId,

    req.params.childId,

    req.body

);

            console.log("Activity Saved");

            res.json({

                success: true

            });

        }

        catch (e) {

            console.error(e);

            res.status(500).json({

                success: false,

                message: e.message

            });

        }

    }

);

/*
==========================================
ADMIN BOOTSTRAP STATUS
==========================================
*/

app.get(
    "/admin/bootstrap/status",

    async (req, res) => {

        try {

            const initialized =
                await AdminManager.isInitialized();

            res.json({

                success: true,

                initialized

            });

        }

        catch (error) {

            res.status(500).json({

                success: false,

                message: error.message

            });

        }

    }

);

app.get("/join/json", async (req, res) => {

    try {

        const ref = (req.query.ref || "")
            .trim()
            .toUpperCase();

        if (!ref) {

            return res.status(400).json({
                success: false,
                message: "Referral code missing."
            });

        }

        const result =
            await referralManager.createOrRecoverSession(ref);

        res.json({

            success: true,

            referralCode: ref,

            sessionId: result.session.sessionId,

            agentId: result.session.agentId,

            agentName: result.session.agentName,

            apk: "http://192.168.100.14:3000/apk/ParentIQParent.apk"

        });

    } catch (e) {

        console.error(e);

        res.status(500).json({

            success: false,

            message: e.message

        });

    }

});

/*
==========================================
CREATE INSTALL SESSION
==========================================
*/

app.get("/installer/session", async (req, res) => {

    try {

        const ref =
            (req.query.ref || "")
                .trim()
                .toUpperCase();

        if (!ref) {

            return res.status(400).json({

                success: false,

                message: "Referral code required."

            });

        }

        const result =
            await referralManager.createOrRecoverSession(ref);

        const installRef =
            db.ref("install_sessions").push();

        await installRef.set({

    referralCode: result.session.referralCode,

    sessionId: result.session.sessionId,

    agentId: result.session.agentId,

    agentName: result.session.agentName,

    createdAt: Date.now(),

    used: false

});

        res.json({

    success: true,

    installId: installRef.key,

    referralCode: result.session.referralCode,

    sessionId: result.session.sessionId,

    agentId: result.session.agentId,

    agentName: result.session.agentName,

    apk: "http://192.168.100.14:3000/apk/ParentIQInstaller.apk"

});

    } catch (e) {

        console.error(e);

        res.status(500).json({

            success: false,

            message: e.message

        });

    }

});

/*
==========================================
GET INSTALL SESSION
==========================================
*/

app.get("/installer/install/:installId", async (req, res) => {

    try {

        const snap = await db
            .ref("install_sessions")
            .child(req.params.installId)
            .get();

        if (!snap.exists()) {

            return res.status(404).json({

                success: false,

                message: "Install session not found."

            });

        }

        const session = snap.val();

        res.json({

            success: true,

            referralCode: session.referralCode,

            sessionId: session.sessionId,

            agentId: session.agentId,

            agentName: session.agentName,

            apk:
                "http://192.168.100.14:3000/apk/ParentIQParent.apk"

        });

    } catch (e) {

        res.status(500).json({

            success: false,

            message: e.message

        });

    }

});

app.get("/join", async (req, res) => {

    try {

        const ref =
            (req.query.ref || "")
                .trim()
                .toUpperCase();

        console.log("Referral:", ref);

        let session = null;

        if (ref) {

            const result =
                await referralManager.createOrRecoverSession(ref);

            session = result.session;

        }

        res.send(`
<!DOCTYPE html>
<html>

<head>

<meta charset="UTF-8">

<meta name="viewport"
      content="width=device-width, initial-scale=1.0">

<title>ParentIQ Invitation</title>

<style>

body{
    margin:0;
    padding:40px;
    font-family:Arial,Helvetica,sans-serif;
    background:#f5f7fb;
}

.card{

    max-width:500px;
    margin:auto;

    background:white;

    padding:35px;

    border-radius:20px;

    text-align:center;

    box-shadow:0 5px 20px rgba(0,0,0,.08);

}

h2{

    margin-top:0;

}

.code{

    margin:25px 0;

    font-size:32px;

    font-weight:bold;

    color:#2962FF;

}

button{

    padding:16px 34px;

    font-size:18px;

    border:none;

    border-radius:12px;

    background:#2962FF;

    color:white;

    cursor:pointer;

}

button:hover{

    opacity:.92;

}

.small{

    margin-top:20px;

    color:#777;

    font-size:14px;

}

</style>

</head>

<body>

<div class="card">

<h2>Welcome to ParentIQ</h2>

<p>You were invited by a ParentIQ Agent.</p>

<p>Your referral code is:</p>

<div class="code">${ref}</div>

<button onclick="openApp()">
Open ParentIQ
</button>

<p class="small">
If ParentIQ Installer is not installed, it will download automatically.
</p>

</div>

<script>

localStorage.setItem("referralCode","${ref}");

${
session
? `localStorage.setItem("referralSession","${session.sessionId}");`
: ""
}

function openApp() {

    localStorage.setItem("referralCode","${ref}");

    ${
        session
        ? `localStorage.setItem("referralSession","${session.sessionId}");`
        : ""
    }

    // Try opening the installer app
    window.location.href =
        "parentiqinstaller://install?ref=${ref}";

    // Download installer if it isn't installed
    setTimeout(function(){

        window.location.href =
            "/apk/ParentIQInstaller.apk";

    },1500);

}

</script>

</body>

</html>
        `);

    } catch (e) {

        console.error(e);

        res.status(400).send(e.message);

    }

});



/*
==========================================
RECOVER INSTALL REFERRAL
==========================================
*/

app.get("/installer/recover", async (req, res) => {

    try {

        const referralCode =
            (req.query.ref || "")
                .trim()
                .toUpperCase();

        if (!referralCode) {

            return res.status(400).json({

                success: false,
                message: "Referral code missing."

            });

        }

        const result =
            await referralManager.createOrRecoverSession(
                referralCode
            );

        res.json({

            success: true,

            session: result.session

        });

    } catch (e) {

        console.error(e);

        res.status(500).json({

            success: false,
            message: e.message

        });

    }

});

/*pop up*/
app.get("/activity/latest/:agentId", async (req, res) => {

    try {

        const activity = await ActivityManager.getLatest(
            req.params.agentId
        );

        if (!activity) {
            return res.json(null);
        }

        res.json(activity);

    } catch (e) {

        console.error(e);

        res.status(500).json({
            success: false,
            message: e.message
        });

    }

});


/*
==========================================
CREATE FIRST SUPER ADMIN
==========================================
*/

app.post(
    "/admin/bootstrap",

    async (req, res) => {

        try {

            const {

                fullName,
                email,
                password

            } = req.body;

            if (
                !fullName ||
                !email ||
                !password
            ) {

                return res.status(400).json({

                    success: false,

                    message: "Missing required fields."

                });

            }

            const adminUser =
                await AdminManager.bootstrap(

                    fullName,
                    email,
                    password

                );

            res.json({

                success: true,

                message: "Super Administrator created.",

                data: adminUser

            });

        }

        catch (error) {

            res.status(400).json({

                success: false,

                message: error.message

            });

        }

    }

);

/*
==========================================
SHOULD SHOW GROWTH SHEET
==========================================
*/
/*
==========================================
SHOULD SHOW GROWTH SHEET
==========================================
*/



/*
==========================================
PLAN PRICES
==========================================
*/

app.get(
    "/agent/growth/:agentId",

    async (req, res) => {

        try {

            const agentId =
                req.params.agentId;


            /*
            =====================================
            CHECK IF SHEET SHOULD SHOW
            =====================================
            */

            const decision =
                await AgentPreferenceManager
                    .shouldShowGrowthSheet(agentId);



            /*
            =====================================
            LOAD STATISTICS
            =====================================
            */

            const statisticsSnapshot =
                await db
                    .ref("agent_statistics")
                    .child(agentId)
                    .get();


            const stats =
                statisticsSnapshot.exists()
                    ? statisticsSnapshot.val()
                    : {};



            /*
            =====================================
            PLAN PRICES
            =====================================
            */

            const PREMIUM_PRICE = 750;

            const FAMILY_PRICE = 1800;



            /*
            =====================================
            CUSTOMER COUNTS
            =====================================
            */

            const premiumCustomers =
                Number(stats.premiumCustomers || 0);


            const familyCustomers =
                Number(stats.familyCustomers || 0);


            const freeCustomers =
                Number(stats.freeCustomers || 0);



            /*
            =====================================
            CURRENT BUSINESS VALUE
            =====================================
            */

            const currentMonthlyValue =

                (premiumCustomers * PREMIUM_PRICE) +

                (familyCustomers * FAMILY_PRICE);



            /*
            =====================================
            POTENTIAL BUSINESS VALUE
            =====================================

            If every free customer upgrades
            to Premium

            */

            const potentialMonthlyValue =

                currentMonthlyValue +

                (freeCustomers * PREMIUM_PRICE);



            const upgradeOpportunity =

                potentialMonthlyValue -
                currentMonthlyValue;



            /*
            =====================================
            COMMISSION
            =====================================
            */

            const currentCommission =

                Number(stats.commissionBalance || 0);



            /*
            =====================================
            COACH MESSAGE
            =====================================
            */

            let title =
                "Welcome to Growth Coach";


            let message =
                "Let's grow your ParentIQ business.";


            let tip =
                "Invite more parents and earn more commission.";


            let action =
                "Start Selling";



            /*
            =====================================
            EXPIRING CUSTOMERS
            =====================================
            */

            if (
                Number(stats.expiringSoon || 0) > 0
            ) {


                title =
                    `${stats.expiringSoon} subscription(s) expire soon`;


                message =
                    "Renewals are your fastest commissions.";


                tip =
                    "Contact parents before their subscriptions expire.";


                action =
                    "Renew Plans";


            }


            /*
            =====================================
            FREE CUSTOMER OPPORTUNITY
            =====================================
            */

            else if (
                freeCustomers > 0
            ) {


                title =
                    `Earn KES ${upgradeOpportunity.toLocaleString()} more monthly`;


                message =
                    `${freeCustomers} parents are still using the Free Plan.`;


                tip =
                    "Ask every parent how many children they want to protect. Multiple children usually benefit from Premium or Family plans.";


                action =
                    "Upgrade Customers";


            }


            /*
            =====================================
            FAMILY OPPORTUNITY
            =====================================
            */

            else if (
                premiumCustomers >= 2
            ) {


                title =
                    "Promote Family Plans";


                message =
                    "Some Premium parents may need protection for more children.";


                tip =
                    "Ask Premium parents how many children they have.";


                action =
                    "Offer Family Plan";


            }



            /*
            =====================================
            FINAL RESPONSE
            =====================================
            */


            res.json({

                success: true,

                show: decision.show,

                reason: decision.reason,


                title,


                message,


                tip,


                action,


                statistics: {


                    ...stats,


                    currentMonthlyValue,


                    potentialMonthlyValue,


                    upgradeOpportunity,


                    currentCommission

                }

            });


        }

        catch (e) {


            console.error(
                "Growth Coach Error:",
                e
            );


            res.status(500).json({

                success:false,

                message:e.message

            });


        }

    }

);


/*
==========================================
MARK GROWTH SHEET VIEWED
==========================================
*/

app.post(
    "/agent/growth-sheet/viewed",

    async (req, res) => {

        try {

            const { agentId } = req.body;

            await AgentPreferenceManager
                .markGrowthSheetShown(agentId);

            res.json({

                success: true

            });

        } catch (e) {

            res.status(500).json({

                success: false,

                message: e.message

            });

        }

    }

);

/*NOTIFY THE BOTTOM SHEET HAS BEEN SHOWN*/
app.post(
    "/agent/growth/:agentId/shown",

    async (req, res) => {

        try {

            await AgentPreferenceManager
                .markGrowthSheetShown(
                    req.params.agentId
                );

            res.json({

                success: true

            });

        } catch (e) {

            res.status(500).json({

                success: false,

                message: e.message

            });

        }

    }
);

app.get(
    "/admin/dashboard",

    async (req, res) => {

        try {

            const dashboard =
                await AdminDashboardManager
                    .getDashboard();

            res.json({

                success: true,

                timestamp: Date.now(),

                version: "1.0.0",

                data: dashboard

            });

        }

        catch (e) {

            res.status(500).json({

                success: false,

                message: e.message

            });

        }

    }

);


//===========PAYPAL===============
/*
==================================================
PAYPAL CREATE ORDER
==================================================
*/

app.post(
    "/paypal/create-order",
    async (req, res) => {

        try {

            const {
                uid,
                childId,
                planId
            } = req.body;


            if (
                !uid ||
                !childId ||
                !planId
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "uid, childId and planId are required."

                });

            }


            /*
            ==========================================
            VERIFY CHILD
            ==========================================
            */

            const childSnap =
                await db
                    .ref("children")
                    .child(childId)
                    .get();


            if (!childSnap.exists()) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Child not found."

                });

            }


            const child =
                childSnap.val();


            /*
            ==========================================
            VERIFY CHILD BELONGS TO PARENT
            ==========================================
            */

            if (
                child.parentId &&
                child.parentId !== uid
            ) {

                return res.status(403).json({

                    success: false,

                    message:
                        "Child does not belong to this account."

                });

            }


            /*
            ==========================================
            VALIDATE PLAN
            ==========================================
            */

            const plan =
    await PlanManager.getPlan(
        planId
    );


if (!plan) {

    return res.status(400).json({

        success: false,

        message:
            "Invalid subscription plan."

    });

}


if (plan.active !== true) {

    return res.status(400).json({

        success: false,

        message:
            "This subscription plan is currently unavailable."

    });

}


            /*
            ==========================================
            CREATE PAYPAL ORDER
            ==========================================
            */

            const paypalOrder =
                await PayPalManager.createOrder({

                    uid,

                    childId,

                    planId

                });


            /*
            ==========================================
            SAVE LOCAL TRANSACTION
            ==========================================
            */

            await db
                .ref("paypal_transactions")
                .child(
                    paypalOrder.orderId
                )
                .set({

                    orderId:
                        paypalOrder.orderId,

                    localReference:
                        paypalOrder.localReference,

                    uid,

                    childId,

                    planId,

                    amount:
                        Number(
                            paypalOrder.amount
                        ),

                    currency:
                        paypalOrder.currency,

                    status:
                        "CREATED",

                    provider:
                        "PAYPAL",

                    createdAt:
                        Date.now(),

                    updatedAt:
                        Date.now(),

                    capturedAt:
                        null

                });


            /*
            ==========================================
            RESPONSE
            ==========================================
            */

            return res.json({

                success: true,

                data:
                    paypalOrder

            });

        }

        catch (error) {

            console.error(
                "PayPal create order error:",
                error
            );

            return res.status(500).json({

                success: false,

                message:
                    error.message ||
                    "Failed to create PayPal order."

            });

        }

    }
);
/*
==================================================
PAYPAL CAPTURE ORDER
==================================================
*/

app.post(
    "/paypal/capture-order",
    async (req, res) => {

        const orderId =
            (req.body.orderId || "")
                .trim();


        if (!orderId) {

            return res.status(400).json({

                success: false,

                message:
                    "orderId is required."

            });

        }


        try {

            const result =
                await PayPalFulfillmentManager
                    .fulfillOrder(
                        orderId
                    );


            return res.json(
                result
            );

        }

        catch (error) {

            console.error(
                "PayPal capture error:",
                error
            );


            try {

                await db
                    .ref("paypal_transactions")
                    .child(orderId)
                    .update({

                        lastError:
                            error.message,

                        updatedAt:
                            Date.now()

                    });

            }

            catch (dbError) {

                console.error(
                    "Failed to save PayPal error:",
                    dbError.message
                );

            }


            return res.status(500).json({

                success: false,

                message:
                    error.message ||
                    "PayPal capture failed."

            });

        }

    }
);
/*
==================================================
PAYPAL CALLBACK
==================================================
*/

app.get(
    "/paypal/callback",
    async (req, res) => {

        try {

            const orderId =
                (req.query.token || "")
                    .trim();


            if (!orderId) {

                return res.status(400).send(
                    "PayPal order ID missing."
                );

            }


            /*
            ==========================================
            FULFILL PAYMENT
            ==========================================
            */

            const result =
                await PayPalFulfillmentManager
                    .fulfillOrder(
                        orderId
                    );


            /*
            ==========================================
            SUCCESS PAGE
            ==========================================
            */

            if (
                result.success &&
                result.status ===
                "SUCCESS"
            ) {

                return res.send(`
<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
>

<title>ParentIQ Payment</title>

<style>

body {

    font-family:
        Arial,
        sans-serif;

    background:
        #08101F;

    color:
        white;

    display:
        flex;

    align-items:
        center;

    justify-content:
        center;

    min-height:
        100vh;

    margin:
        0;

}

.card {

    width:
        90%;

    max-width:
        480px;

    background:
        #101B33;

    border-radius:
        20px;

    padding:
        35px;

    text-align:
        center;

    box-sizing:
        border-box;

}

.success {

    font-size:
        50px;

}

h1 {

    margin-bottom:
        10px;

}

p {

    color:
        #B9C4D8;

    line-height:
        1.6;

}

button {

    margin-top:
        20px;

    padding:
        14px 25px;

    border:
        none;

    border-radius:
        12px;

    background:
        #4CC9F0;

    color:
        #08101F;

    font-weight:
        bold;

    font-size:
        16px;

}

</style>

</head>

<body>

<div class="card">

<div class="success">
✓
</div>

<h1>
Payment Successful
</h1>

<p>
Your ParentIQ subscription has been activated.
</p>

<p>
You can now return to the ParentIQ app.
</p>

</div>

</body>

</html>
                `);

            }


            return res.status(400).send(
                "PayPal payment was not completed."
            );

        }

        catch (error) {

            console.error(
                "PayPal callback error:",
                error
            );

            return res.status(500).send(
                "PayPal payment processing failed."
            );

        }

    }
);
/*
==================================================
PAYPAL CANCEL
==================================================
*/

app.get(
    "/paypal/cancel",
    async (req, res) => {

        try {

            const orderId =
                (req.query.token || "").trim();


            /*
            ==========================================
            MARK TRANSACTION AS CANCELLED
            ==========================================
            */

            if (orderId) {

                const transactionRef =
                    db
                        .ref("paypal_transactions")
                        .child(orderId);


                const transactionSnap =
                    await transactionRef.get();


                /*
                ------------------------------------------
                ONLY MARK EXISTING NON-SUCCESSFUL
                TRANSACTIONS AS CANCELLED
                ------------------------------------------
                */

                if (transactionSnap.exists()) {

                    const transaction =
                        transactionSnap.val();


                    if (
                        transaction.status !==
                        "SUCCESS"
                    ) {

                        await transactionRef.update({

                            status:
                                "CANCELLED",

                            cancelledAt:
                                Date.now(),

                            updatedAt:
                                Date.now()

                        });

                    }

                }

            }


            /*
            ==========================================
            CANCELLED PAGE
            ==========================================
            */

            return res.send(`
<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
>

<title>ParentIQ Payment Cancelled</title>

<style>

body {

    font-family:
        Arial,
        sans-serif;

    background:
        #08101F;

    color:
        white;

    display:
        flex;

    align-items:
        center;

    justify-content:
        center;

    min-height:
        100vh;

    margin:
        0;

    padding:
        20px;

    box-sizing:
        border-box;

}

.card {

    width:
        90%;

    max-width:
        450px;

    background:
        #101B33;

    padding:
        35px;

    border-radius:
        20px;

    text-align:
        center;

    box-sizing:
        border-box;

}

.icon {

    font-size:
        50px;

    margin-bottom:
        15px;

}

h1 {

    margin:
        0 0 15px 0;

}

p {

    color:
        #B9C4D8;

    line-height:
        1.6;

}

</style>

</head>

<body>

<div class="card">

<div class="icon">
×
</div>

<h1>
Payment Cancelled
</h1>

<p>
Your ParentIQ subscription was not activated.
</p>

<p>
You can return to ParentIQ and try again.
</p>

</div>

</body>

</html>
        `);

        }

        catch (error) {

            console.error(
                "PayPal cancel error:",
                error
            );


            /*
            ==========================================
            EVEN IF DATABASE UPDATE FAILS,
            SHOW THE USER THE CANCELLED PAGE
            ==========================================
            */

            return res.send(`
<!DOCTYPE html>

<html>

<head>

<meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
>

<title>ParentIQ Payment Cancelled</title>

<style>

body {

    font-family:
        Arial,
        sans-serif;

    background:
        #08101F;

    color:
        white;

    display:
        flex;

    align-items:
        center;

    justify-content:
        center;

    min-height:
        100vh;

    margin:
        0;

    padding:
        20px;

    box-sizing:
        border-box;

}

.card {

    width:
        90%;

    max-width:
        450px;

    background:
        #101B33;

    padding:
        35px;

    border-radius:
        20px;

    text-align:
        center;

    box-sizing:
        border-box;

}

h1 {

    margin-bottom:
        15px;

}

p {

    color:
        #B9C4D8;

    line-height:
        1.6;

}

</style>

</head>

<body>

<div class="card">

<h1>
Payment Cancelled
</h1>

<p>
Your ParentIQ subscription was not activated.
</p>

<p>
You can return to ParentIQ and try again.
</p>

</div>

</body>

</html>
        `);

        }

    }
);


/*
==================================================
PAYPAL STATUS
==================================================
*/

app.get(
    "/paypal/status/:orderId",
    async (req, res) => {

        try {

            const orderId =
                (req.params.orderId || "").trim();

            const uid =
                (req.query.uid || "").trim();


            /*
            ==========================================
            VALIDATE ORDER ID
            ==========================================
            */

            if (!orderId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "orderId is required."

                });

            }


            /*
            ==========================================
            VALIDATE UID
            ==========================================
            */

            if (!uid) {

                return res.status(400).json({

                    success: false,

                    message:
                        "uid is required."

                });

            }


            /*
            ==========================================
            LOAD LOCAL TRANSACTION
            ==========================================
            */

            const transactionRef =
                db
                    .ref("paypal_transactions")
                    .child(orderId);


            const snap =
                await transactionRef.get();


            if (!snap.exists()) {

                return res.status(404).json({

                    success: false,

                    message:
                        "PayPal transaction not found."

                });

            }


            const transaction =
                snap.val();


            /*
            ==========================================
            VERIFY TRANSACTION OWNER
            ==========================================
            */

            if (
                transaction.uid !== uid
            ) {

                return res.status(403).json({

                    success: false,

                    message:
                        "You are not authorized to view this transaction."

                });

            }


            /*
            ==========================================
            RESPONSE
            ==========================================
            */

            return res.json({

                success: true,

                status:
                    transaction.status,

                orderId,

                planId:
                    transaction.planId,

                amount:
                    transaction.amount,

                currency:
                    transaction.currency,

                /*
                ------------------------------------------
                OPTIONAL PROCESSING INFORMATION
                ------------------------------------------
                */

                capturedAt:
                    transaction.capturedAt ||
                    null,

                completedAt:
                    transaction.completedAt ||
                    null,

                captureId:
                    transaction.captureId ||
                    null

            });

        }

        catch (error) {

            console.error(
                "PayPal status error:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    error.message ||
                    "Unable to retrieve PayPal status."

            });

        }

    }
);


//==================PAYSTACK================
app.post("/paystack/initialize", async (req, res) => {
    try {
        const {
            uid,
            childId,
            planId
        } = req.body;

        if (!uid || !childId || !planId) {
            return res.status(400).json({
                success: false,
                message: "uid, childId and planId are required"
            });
        }

        // Get the plan from your backend
        const plan = await PlanManager.getPlan(planId);

        if (!plan) {
            return res.status(404).json({
                success: false,
                message: "Plan not found"
            });
        }

        const amount = Number(plan.price);

        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid plan price"
            });
        }

        // Get parent information
        const parentSnapshot = await db.ref(`parents/${uid}`).once("value");

        if (!parentSnapshot.exists()) {
            return res.status(404).json({
                success: false,
                message: "Parent account not found"
            });
        }

        const parent = parentSnapshot.val();

        if (!parent.email) {
            return res.status(400).json({
                success: false,
                message: "Parent email is required for card payment"
            });
        }

        // Verify child exists
        const childSnapshot = await db.ref(`children/${childId}`).once("value");

        if (!childSnapshot.exists()) {
            return res.status(404).json({
                success: false,
                message: "Child not found"
            });
        }

        const child = childSnapshot.val();

        if (child.parentId !== uid) {
            return res.status(403).json({
                success: false,
                message: "Child does not belong to this parent"
            });
        }

        // Generate our own unique reference
        const reference =
            `PI_${childId}_${Date.now()}_${Math.random()
                .toString(36)
                .substring(2, 8)}`;

        const callbackUrl =
            process.env.PAYSTACK_CALLBACK_URL ||
            "https://parentiq-backend.onrender.com/paystack/callback";

        const response =
            await PaystackManager.initializeTransaction({
                email: parent.email,
                amount,
                reference,
                callbackUrl,
                metadata: {
                    uid,
                    childId,
                    planId,
                    planName: plan.name,
                    amount,
                    paymentMethod: "PAYSTACK_CARD"
                }
            });

        if (!response.status) {
            return res.status(400).json({
                success: false,
                message: response.message || "Paystack initialization failed"
            });
        }

        // Store transaction BEFORE sending checkout URL to the app
        await db.ref(`paystack_transactions/${reference}`).set({
            reference,
            uid,
            childId,
            planId,
            planName: plan.name,
            amount,
            currency: "KES",
            email: parent.email,
            status: "PENDING",
            processed: false,
            createdAt: Date.now()
        });

        return res.json({
            success: true,
            message: "Paystack transaction initialized",
            data: {
                authorization_url: response.data.authorization_url,
                access_code: response.data.access_code,
                reference: response.data.reference
            }
        });

    } catch (error) {
        console.error(
            "Paystack initialization error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Unable to initialize Paystack payment",
            error: error.message
        });
    }
});

app.get("/paystack/callback", async (req, res) => {
    try {
        const { reference } = req.query;

        if (!reference) {
            return res.status(400).send(
                "Missing Paystack transaction reference"
            );
        }

        console.log(
            "Paystack callback received:",
            reference
        );

        return res.send(`
            <html>
                <head>
                    <title>ParentIQ Payment</title>
                </head>
                <body>
                    <h2>Payment processing</h2>
                    <p>You can return to the ParentIQ app.</p>
                </body>
            </html>
        `);

    } catch (error) {
        console.error(
            "Paystack callback error:",
            error
        );

        return res.status(500).send(
            "Payment callback error"
        );
    }
});



//======================================================
// PAYSTACK WEBHOOK
//======================================================

app.post("/paystack/webhook", async (req, res) => {

    try {

        console.log("================================");
        console.log("PAYSTACK WEBHOOK");
        console.log("================================");

        /*
        ==================================================
        VERIFY PAYSTACK SIGNATURE
        ==================================================
        */

        const signature =
            req.headers["x-paystack-signature"];

        if (!signature || !req.rawBody) {

            console.error(
                "Missing Paystack signature or raw body."
            );

            return res.sendStatus(400);
        }

        const expectedSignature =
            crypto
                .createHmac(
                    "sha512",
                    process.env.PAYSTACK_SECRET_KEY
                )
                .update(req.rawBody)
                .digest("hex");


        /*
        ==================================================
        SIGNATURE MUST MATCH
        ==================================================
        */

        if (signature !== expectedSignature) {

            console.error(
                "INVALID PAYSTACK WEBHOOK SIGNATURE"
            );

            return res.sendStatus(401);
        }


        /*
        ==================================================
        WEBHOOK EVENT
        ==================================================
        */

        const event =
            req.body;


        console.log(
            "Paystack Event:",
            event.event
        );


        /*
        ==================================================
        ONLY PROCESS SUCCESSFUL PAYMENTS
        ==================================================
        */

        if (
            event.event !==
            "charge.success"
        ) {

            console.log(
                "Paystack event ignored:",
                event.event
            );

            return res.sendStatus(200);
        }


        /*
        ==================================================
        PAYSTACK PAYMENT DATA
        ==================================================
        */

        const data =
            event.data || {};


        const reference =
            data.reference;


        if (!reference) {

            console.error(
                "Paystack webhook missing reference."
            );

            return res.sendStatus(200);
        }


        console.log(
            "Paystack Reference:",
            reference
        );


        /*
        ==================================================
        LOAD OUR TRANSACTION
        ==================================================
        */

        const transactionRef =
            db
                .ref("paystack_transactions")
                .child(reference);


        const transactionSnapshot =
            await transactionRef.once("value");


        if (!transactionSnapshot.exists()) {

            console.error(
                "Paystack transaction not found:",
                reference
            );

            return res.sendStatus(200);
        }


        const transaction =
            transactionSnapshot.val();


        console.log(
            "Paystack Transaction:",
            JSON.stringify(
                transaction,
                null,
                2
            )
        );


        /*
        ==================================================
        PREVENT DUPLICATE PROCESSING
        ==================================================
        */

        if (
            transaction.processed === true
        ) {

            console.log(
                "Paystack transaction already processed:",
                reference
            );

            return res.sendStatus(200);
        }


        /*
        ==================================================
        EXTRACT OUR DATA
        ==================================================
        */

        const childId =
            transaction.childId;

        const uid =
            transaction.uid;

        const planId =
            transaction.planId;

        const transactionAmount =
            Number(
                transaction.amount || 0
            );


        /*
        ==================================================
        VALIDATE CHILD
        ==================================================
        */

        if (!childId) {

            await transactionRef.update({

                status: "FAILED",

                processed: true,

                failureReason:
                    "MISSING_CHILD_ID",

                processedAt:
                    Date.now()

            });

            return res.sendStatus(200);
        }


        /*
        ==================================================
        VALIDATE PLAN
        ==================================================
        */

        if (!planId) {

            await transactionRef.update({

                status: "FAILED",

                processed: true,

                failureReason:
                    "MISSING_PLAN_ID",

                processedAt:
                    Date.now()

            });

            return res.sendStatus(200);
        }


        /*
        ==================================================
        LOAD PLAN
        ==================================================
        */

        const plan =
            await PlanManager.getPlan(
                planId
            );


        if (!plan) {

            console.error(
                "Paystack plan not found:",
                planId
            );

            await transactionRef.update({

                status: "FAILED",

                processed: true,

                failureReason:
                    "INVALID_PLAN",

                processedAt:
                    Date.now()

            });

            return res.sendStatus(200);
        }


        /*
        ==================================================
        VALIDATE AMOUNT
        ==================================================
        */

        const expectedAmount =
            Number(plan.price);


        const paidAmount =
            Number(data.amount || 0) / 100;


        console.log(
            "================================"
        );

        console.log(
            "PAYSTACK AMOUNT VALIDATION"
        );

        console.log(
            "Expected:",
            expectedAmount
        );

        console.log(
            "Transaction:",
            transactionAmount
        );

        console.log(
            "Paystack:",
            paidAmount
        );

        console.log(
            "================================"
        );


        /*
        --------------------------------------------------
        OUR STORED TRANSACTION MUST MATCH PLAN
        --------------------------------------------------
        */

        if (
            !Number.isFinite(expectedAmount) ||
            expectedAmount <= 0 ||
            transactionAmount !== expectedAmount
        ) {

            console.error(
                "PAYSTACK TRANSACTION AMOUNT INVALID"
            );

            await transactionRef.update({

                status: "FAILED",

                processed: true,

                failureReason:
                    "TRANSACTION_AMOUNT_INVALID",

                expectedAmount,

                transactionAmount,

                processedAt:
                    Date.now()

            });

            return res.sendStatus(200);
        }


        /*
        --------------------------------------------------
        PAYSTACK ACTUAL AMOUNT MUST MATCH PLAN
        --------------------------------------------------
        */

        if (
            !Number.isFinite(paidAmount) ||
            paidAmount <= 0 ||
            paidAmount !== expectedAmount
        ) {

            console.error(
                "PAYSTACK AMOUNT MISMATCH"
            );

            await transactionRef.update({

                status: "FAILED",

                processed: true,

                failureReason:
                    "AMOUNT_MISMATCH",

                expectedAmount,

                receivedAmount:
                    paidAmount,

                paystackTransactionId:
                    data.id,

                processedAt:
                    Date.now()

            });


            return res.sendStatus(200);
        }


        /*
        ==================================================
        LOAD CHILD
        ==================================================
        */

        const childRef =
            db
                .ref("children")
                .child(childId);


        const childSnapshot =
            await childRef.once("value");


        if (!childSnapshot.exists()) {

            console.error(
                "Paystack child not found:",
                childId
            );

            await transactionRef.update({

                status: "FAILED",

                processed: true,

                failureReason:
                    "CHILD_NOT_FOUND",

                processedAt:
                    Date.now()

            });

            return res.sendStatus(200);
        }


        const child =
            childSnapshot.val();


        const now =
            Date.now();


        /*
        ==================================================
        ACTIVATE SUBSCRIPTION
        ==================================================
        */

        await SubscriptionManager.activate(
            childId,
            planId
        );


        /*
        ==================================================
        FAMILY PLAN
        ==================================================
        */

        if (
            planId === "family" &&
            child.parentId
        ) {

            await SubscriptionManager.activateFamily(
                child.parentId,
                childId,
                planId
            );

        }


        /*
        ==================================================
        BILLING
        ==================================================
        */

        await childRef
            .child("billing")
            .update({

                lastPaymentStatus:
                    "SUCCESS",

                lastPaymentMethod:
                    "PAYSTACK_CARD",

                lastPaymentReference:
                    reference,

                lastPaymentAmount:
                    paidAmount,

                lastPaidAt:
                    now,

                lastPlanId:
                    planId

            });


        /*
        ==================================================
        PAYMENT HISTORY
        ==================================================
        */

        await childRef
            .child("payments")
            .child(reference)
            .set({

                reference,

                amount:
                    paidAmount,

                expectedAmount,

                planId,

                planName:
                    plan.name,

                status:
                    "SUCCESS",

                paymentMethod:
                    "PAYSTACK_CARD",

                paystackTransactionId:
                    data.id,

                customerEmail:
                    data.customer?.email || "",

                currency:
                    data.currency || "KES",

                paidAt:
                    now

            });


        /*
        ==================================================
        LEDGER
        ==================================================
        */

        await LedgerManager.record({

            type:
                LedgerTypes.SUBSCRIPTION_PAYMENT,

            direction:
                LedgerDirection.CREDIT,

            category:
                LedgerCategory.SUBSCRIPTION,

            amount:
                paidAmount,

            parentId:
                child.parentId ||
                uid ||
                "",

            childId,

            checkoutId:
                reference,

            description:
                `${plan.name} subscription payment`,

            metadata: {

                planId,

                planName:
                    plan.name,

                amount:
                    paidAmount,

                expectedAmount,

                paymentMethod:
                    "PAYSTACK_CARD",

                paystackReference:
                    reference,

                paystackTransactionId:
                    data.id,

                currency:
                    data.currency || "KES"

            }

        });


        /*
        ==================================================
        UPDATE CHILD META
        ==================================================
        */

        await childRef
            .child("meta")
            .update({

                updatedAt:
                    now

            });


        /*
        ==================================================
        FIND AGENT
        ==================================================
        */

        let agentId =
            null;


        const parentId =
            child.parentId ||
            uid;


        if (parentId) {

            const parentSnapshot =
                await db
                    .ref("parents")
                    .child(parentId)
                    .once("value");


            if (
                parentSnapshot.exists()
            ) {

                const parent =
                    parentSnapshot.val();


                agentId =
                    parent?.referral?.agentId ||
                    null;

            }

        }


        /*
        ==================================================
        AGENT COMMISSION
        ==================================================
        */

        if (agentId) {

            await CommissionManager.recordCommission({

                agentId,

                childId,

                planId,

                checkoutId:
                    reference

            });


            /*
            ----------------------------------------------
            REFRESH AGENT CACHE
            ----------------------------------------------
            */

            try {

                await CacheManager.refreshAgent(
                    agentId
                );

            } catch (cacheError) {

                console.error(
                    "Agent cache refresh failed:",
                    cacheError.message
                );

            }


            /*
            ----------------------------------------------
            CLEAR DASHBOARD CACHE
            ----------------------------------------------
            */

            try {

                DashboardCache.clear(
                    agentId
                );

            } catch (cacheError) {

                console.error(
                    "Dashboard cache clear failed:",
                    cacheError.message
                );

            }

        }


        /*
        ==================================================
        MARK PAYSTACK TRANSACTION COMPLETE
        ==================================================
        */

        await transactionRef.update({

            status:
                "SUCCESS",

            processed:
                true,

            processedAt:
                now,

            completedAt:
                now,

            paidAmount,

            expectedAmount,

            paystackTransactionId:
                data.id,

            channel:
                data.channel || "card",

            currency:
                data.currency || "KES",

            customerEmail:
                data.customer?.email || "",

            gatewayResponse:
                data.gateway_response || "",

            paidAt:
                data.paid_at || null

        });


        /*
        ==================================================
        FINAL LOG
        ==================================================
        */

        console.log(
            "================================"
        );

        console.log(
            "PAYSTACK PAYMENT COMPLETED"
        );

        console.log(
            "Child:",
            childId
        );

        console.log(
            "Plan:",
            planId
        );

        console.log(
            "Amount:",
            paidAmount
        );

        console.log(
            "Reference:",
            reference
        );

        console.log(
            "================================"
        );


        return res.sendStatus(200);

    }

    catch (error) {

        console.error(
            "PAYSTACK WEBHOOK ERROR:",
            error
        );

        /*
        IMPORTANT:
        Paystack should receive HTTP 200
        after the webhook has been received.
        */

        return res.sendStatus(200);
    }

});


app.get("/paypal/test-connection", async (req, res) => {
    try {
        const axios = require("axios");

        const clientId = process.env.PAYPAL_CLIENT_ID;
        const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            return res.status(500).json({
                success: false,
                message: "PayPal Sandbox credentials are missing."
            });
        }

        const baseUrl =
            process.env.PAYPAL_ENVIRONMENT === "live"
                ? "https://api-m.paypal.com"
                : "https://api-m.sandbox.paypal.com";

        const response = await axios.post(
            `${baseUrl}/v1/oauth2/token`,
            "grant_type=client_credentials",
            {
                auth: {
                    username: clientId,
                    password: clientSecret
                },
                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded"
                },
                timeout: 15000
            }
        );

        res.json({
            success: true,
            message: "PayPal Sandbox connection successful.",
            environment:
                process.env.PAYPAL_ENVIRONMENT,
            tokenType: response.data.token_type,
            expiresIn: response.data.expires_in
        });

    } catch (error) {

        console.error(
            "PAYPAL SANDBOX CONNECTION ERROR:",
            error.response?.data || error.message
        );

        res.status(500).json({
            success: false,
            message: "PayPal Sandbox connection failed.",
            error:
                error.response?.data ||
                error.message
        });
    }
});



const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);

    startAppClassificationWorker();
    startDomainClassificationWorker();
    startSearchClassificationWorker();
});



server.on("error", (err) => {

    console.error("SERVER ERROR:", err);

});

process.on("exit", (code) => {

    console.log("Node process exited with code:", code);

});

process.on("uncaughtException", (err) => {

    console.error("UNCAUGHT EXCEPTION:", err);

});

process.on("unhandledRejection", (err) => {

    console.error("UNHANDLED REJECTION:", err);

});