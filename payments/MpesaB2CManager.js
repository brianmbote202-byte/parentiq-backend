const { db } = require("../firebase");

const axios = require("axios");



const PaymentStatus =
    require("./PaymentStatus");

const PaymentResult =
    require("./PaymentResult");

class MpesaB2CManager {

    /*
    =====================================
    SEND MONEY
    =====================================
    */

    async sendMoney(withdrawal) {

    console.log("======================================");
    console.log("MPESA B2C PAYMENT");
    console.log("======================================");

    console.log("Withdrawal :", withdrawal.id);
    console.log("Reference  :", withdrawal.reference);
    console.log("Agent      :", withdrawal.agentId);
    console.log("Phone      :", withdrawal.phone);
    console.log("Amount     :", withdrawal.amount);

    /*
    =====================================
    CREATE PAYMENT RECORD
    =====================================
    */

    const paymentRef = db.ref("payments").push();

    const paymentId = paymentRef.key;

    // This is OUR identifier
    const localOriginatorConversationId =
        `PARENTIQ_${Date.now()}`;

    const now = Date.now();

    await paymentRef.set({

        id: paymentId,

        withdrawalId: withdrawal.id,

        withdrawalReference: withdrawal.reference,

        agentId: withdrawal.agentId,

        phone: withdrawal.phone,

        amount: withdrawal.amount,

        provider: "MPESA",

        type: "B2C",

        status: PaymentStatus.PENDING,

        providerReference: "",

        conversationId: "",

        // What WE generated
        localOriginatorConversationId,

        // What Safaricom returns later
        originatorConversationId: "",

        receipt: "",

        createdAt: now,

        updatedAt: now

    });

    console.log("Payment created:", paymentId);

    /*
    =====================================
    FORMAT PHONE
    =====================================
    */

    let phone = String(withdrawal.phone || "").trim();

    phone = phone.replace(/\s+/g, "");

    if (phone.startsWith("+")) {

        phone = phone.substring(1);

    }

    phone = phone.replace(/\D/g, "");

    if (!/^\d{10,15}$/.test(phone)) {

        throw new Error(`Invalid phone number: ${phone}`);

    }

    console.log("Formatted Phone:", phone);

    /*
    =====================================
    ACCESS TOKEN
    =====================================
    */

    const token = await this.getAccessToken();

    if (

        !process.env.INITIATOR_NAME ||
        !process.env.SECURITY_CREDENTIAL ||
        !process.env.SHORTCODE

    ) {

        throw new Error(
            "Missing B2C environment configuration."
        );

    }

    /*
    =====================================
    BUILD PAYLOAD
    =====================================
    */

    const payload = {

        OriginatorConversationID:
            localOriginatorConversationId,

        InitiatorName:
            process.env.INITIATOR_NAME,

        SecurityCredential:
            process.env.SECURITY_CREDENTIAL,

        CommandID:
            "BusinessPayment",

        Amount:
            withdrawal.amount,

        PartyA:
            process.env.SHORTCODE,

        PartyB:
            phone,

        Remarks:
            "ParentIQ Withdrawal",

        QueueTimeOutURL:
            `${process.env.CALLBACK_BASE_URL}/mpesa/b2c/timeout`,

        ResultURL:
            `${process.env.CALLBACK_BASE_URL}/mpesa/b2c/result`,

        Occasion:
            "Withdrawal"

    };

    try {

        console.log("========== B2C PAYLOAD ==========");
        console.log(payload);

        const response = await axios.post(

            `${process.env.BASE_URL}/mpesa/b2c/v1/paymentrequest`,

            payload,

            {

                timeout: 30000,

                headers: {

                    Authorization: `Bearer ${token}`,

                    "Content-Type": "application/json"

                }

            }

        );

        console.log("========== B2C RESPONSE ==========");
        console.log(response.data);

        await paymentRef.update({

    providerReference:
        response.data.ConversationID,

    conversationId:
        response.data.ConversationID,

    localOriginatorConversationId:
        response.data.OriginatorConversationID,

    originatorConversationId:
        response.data.OriginatorConversationID,

    responseCode:
        response.data.ResponseCode,

    responseDescription:
        response.data.ResponseDescription,

    rawResponse:
        response.data,

    status:
        PaymentStatus.PENDING,

    updatedAt:
        Date.now()

});
        return new PaymentResult({

            success: true,

            paymentId,

            provider: "MPESA",

            status: PaymentStatus.PENDING,

            providerReference:
                response.data.ConversationID,

            conversationId:
                response.data.ConversationID,

            originatorConversationId:
                response.data.OriginatorConversationID,

            receipt: "",

            message:
                response.data.ResponseDescription

        });

    }

    catch (error) {

        console.log("========== B2C ERROR ==========");

        let message = error.message;

        if (error.response) {

            console.log("HTTP:", error.response.status);
            console.log(error.response.data);

            message = JSON.stringify(error.response.data);

        }
        else {

            console.log(error.message);

        }

        await paymentRef.update({

            status: PaymentStatus.FAILED,

            error: message,

            updatedAt: Date.now()

        });

        return new PaymentResult({

            success: false,

            paymentId,

            provider: "MPESA",

            status: PaymentStatus.FAILED,

            message

        });

    }

}
/*
=====================================
GET ACCESS TOKEN
=====================================
*/

async getAccessToken() {

    const auth = Buffer.from(

        `${process.env.CONSUMER_KEY}:${process.env.CONSUMER_SECRET}`

    ).toString("base64");

    console.log("Getting B2C Access Token...");

    const response = await axios.get(

        `${process.env.BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,

        {

            headers: {

                Authorization: `Basic ${auth}`

            }

        }

    );
    console.log("B2C Access Token Generated");
    

    return response.data.access_token;

}

}

module.exports =
    new MpesaB2CManager();