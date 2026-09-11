const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
require("./events/CacheEventListener");

const SubscriptionManager = require("./subscriptions/SubscriptionManager");
const CommissionManager = require("./commissions/CommissionManager");

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
app.use(express.json());




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

                /*
                 * Store exactly the same amount
                 * sent to M-Pesa.
                 */

                amount:
                    planPrice,

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

            data: response

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

//======================================================
// ONE-TIME PARENTIQ SEARCH DATA RESET
//======================================================

//======================================================
// ONE-TIME PARENTIQ SEARCH DATA RESET
//======================================================

async function resetSearchDataOnce() {

    console.log("================================");
    console.log("PARENTIQ SEARCH DATA RESET");
    console.log("================================");

    /*
     * analytics_browsing is too large to delete
     * with one Firebase request.
     *
     * Delete each child separately instead.
     */

    const analyticsSnapshot =
        await db
            .ref("analytics_browsing")
            .once("value");

    const childIds =
        analyticsSnapshot.exists()
            ? Object.keys(analyticsSnapshot.val())
            : [];

    console.log(
        `👶 ANALYTICS CHILDREN TO DELETE: ${childIds.length}`
    );

    let deletedChildren = 0;

    for (const childId of childIds) {

        await db
            .ref(`analytics_browsing/${childId}`)
            .remove();

        deletedChildren++;

        console.log(
            `🗑️ DELETED ANALYTICS CHILD: ${childId} (${deletedChildren}/${childIds.length})`
        );
    }

    console.log(
        `✅ analytics_browsing reset complete: ${deletedChildren} children deleted`
    );


    /*
     * search_categories should be much smaller,
     * but delete its records individually as well
     * so we never depend on one large Firebase write.
     */

    const searchSnapshot =
        await db
            .ref("search_categories")
            .once("value");

    const searchKeys =
        searchSnapshot.exists()
            ? Object.keys(searchSnapshot.val())
            : [];

    console.log(
        `🔎 SEARCH CATEGORIES TO DELETE: ${searchKeys.length}`
    );

    let deletedSearchCategories = 0;

    for (const searchKey of searchKeys) {

        await db
            .ref(`search_categories/${searchKey}`)
            .remove();

        deletedSearchCategories++;

        console.log(
            `🗑️ DELETED SEARCH CATEGORY: ${searchKey} (${deletedSearchCategories}/${searchKeys.length})`
        );
    }

    console.log(
        `✅ search_categories reset complete: ${deletedSearchCategories} records deleted`
    );


    console.log("================================");
    console.log("SEARCH DATA RESET COMPLETE");
    console.log("================================");
}

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

/*
====================================================
PAY WITHDRAWAL
====================================================
*/
app.post("/withdrawals/:id/pay", async (req, res) => {

    try {

        const withdrawalId =
            req.params.id;

        console.log("================================");
        console.log("PAY WITHDRAWAL");
        console.log("ID:", withdrawalId);
        console.log("================================");

        /*
        ======================================
        LOAD WITHDRAWAL
        ======================================
        */

        const withdrawal =
            await WithdrawalManager
                .getWithdrawalDetails(withdrawalId);

        if (

    withdrawal.status !== "approved" &&
    withdrawal.status !== "payment_failed"

) {

    return res.status(400).json({

        success: false,

        message:
            "Withdrawal cannot be paid."

    });

}

   

        /*
        ======================================
        SEND MONEY
        ======================================
        */

        const payment =
    await MpesaB2CManager.sendMoney(withdrawal);

    console.log("PaymentResult:", payment);

    console.log("Payment object:");
console.log(payment);


      if (payment.success) {

    await WithdrawalManager.markProcessing(

        withdrawalId,

        payment.conversationId,

        payment.originatorConversationId

    );

    console.log("Withdrawal marked as PROCESSING");

}    

       /*
======================================
REQUEST ACCEPTED?
======================================
*/

if (!payment.success) {

    await WithdrawalManager
        .markPaymentFailed(

            withdrawalId,

            payment.message

        );

    console.log("B2C request failed.");

}
else {

    console.log(
        "B2C request accepted by Safaricom."
    );

    console.log(
        "Waiting for callback..."
    );

}
        /*
        ======================================
        RESPONSE
        ======================================
        */

        res.json({

    success: payment.success,

    payment

});

    }

    catch (e) {

        console.error(e);

        /*
        ======================================
        IF AN EXCEPTION OCCURS AFTER
        PROCESSING STARTED
        ======================================
        */

        try {

            await WithdrawalManager
                .markPaymentFailed(

                    req.params.id,

                    e.message

                );

        } catch (err) {

            console.error(
                "Failed to mark payment failed:",
                err.message
            );

        }

        res.status(500).json({

            success: false,

            message: e.message

        });

    }

});

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


const server = app.listen(PORT, async () => {

    console.log(`Server running on port ${PORT}`);

    try {

        await resetSearchDataOnce();

        console.log(
            "🚀 STARTING PARENTIQ WORKERS AFTER RESET"
        );

        startAppClassificationWorker();

        startDomainClassificationWorker();

        startSearchClassificationWorker();

    } catch (error) {

        console.error(
            "❌ SEARCH DATA RESET FAILED:",
            error
        );

    }

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