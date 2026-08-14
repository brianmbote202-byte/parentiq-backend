const axios = require("axios");
require("dotenv").config();



/**
 * GET ACCESS TOKEN
 */
const getAccessToken = async () => {

    const auth = Buffer.from(
        `${process.env.CONSUMER_KEY}:${process.env.CONSUMER_SECRET}`
    ).toString("base64");


    const response = await axios.get(
        `${process.env.BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
        {
            headers: {
                Authorization: `Basic ${auth}`,
            },
        }
    );


    return response.data.access_token;
};




/**
 * STK PUSH
 * 
 * amount is optional for now
 * later:
 * premium = 750
 * family = 1499
 */
const stkPush = async (
    phone,
    amount = 1,
    plan = "test"
) => {


    try {


        const token = await getAccessToken();



        // format phone
        let formattedPhone = phone.trim();

if (formattedPhone.startsWith("+254")) {

    formattedPhone =
        formattedPhone.substring(1);

} else if (formattedPhone.startsWith("0")) {

    formattedPhone =
        "254" + formattedPhone.substring(1);

}




        // timestamp
        const now = new Date();

        const timestamp =
            now.getFullYear().toString() +
            String(now.getMonth() + 1).padStart(2,"0") +
            String(now.getDate()).padStart(2,"0") +
            String(now.getHours()).padStart(2,"0") +
            String(now.getMinutes()).padStart(2,"0") +
            String(now.getSeconds()).padStart(2,"0");



        const shortcode =
            String(process.env.SHORTCODE).trim();


        const passkey =
            String(process.env.PASSKEY).trim();



        const password =
            Buffer.from(
                shortcode +
                passkey +
                timestamp
            ).toString("base64");





        const payload = {


            BusinessShortCode: shortcode,

            Password: password,

            Timestamp: timestamp,


            // keep this until you get Till
            TransactionType:
                "CustomerPayBillOnline",



            // dynamic but defaults to KSh 1
            Amount: amount,



            PartyA:
                formattedPhone,


            PartyB:
                shortcode,


            PhoneNumber:
                formattedPhone,



            CallBackURL:
                 `${process.env.CALLBACK_BASE_URL}/mpesa/callback`,



            AccountReference:
                `ParentIQ-${plan}`,



            TransactionDesc:
                 `ParentIQ ${plan} Subscription`

        };





        console.log(
            "====== STK PAYLOAD ======"
        );

        console.log(payload);

        console.log("Callback URL:", payload.CallBackURL);




     const response = await axios.post(

    `${process.env.BASE_URL}/mpesa/stkpush/v1/processrequest`,

    payload,

    {

        timeout: 30000, // Wait up to 30 seconds

        headers: {

            Authorization: `Bearer ${token}`,

            "Content-Type": "application/json"

        }

    }

);




        console.log(
            "====== STK SUCCESS ======"
        );


        console.log(response.data);



        return response.data;



    } catch(error){


        console.log(
            "====== DARAJA ERROR ======"
        );


        if(error.response){

            console.log(
                "STATUS:",
                error.response.status
            );


            console.log(
                "DATA:",
                error.response.data
            );


        }else{

            console.log(
                error.message
            );

        }


        throw error;
    }

};



module.exports = {
    stkPush
};