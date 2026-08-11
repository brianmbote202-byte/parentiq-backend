const axios = require("axios");

class AccountBalanceManager {

    async getAccessToken() {

        const auth = Buffer.from(
            `${process.env.CONSUMER_KEY}:${process.env.CONSUMER_SECRET}`
        ).toString("base64");

        const response = await axios.get(

            `${process.env.BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,

            {
                headers: {
                    Authorization: `Basic ${auth}`
                }
            }

        );

        return response.data.access_token;
    }

    async getBalance() {

        const token = await this.getAccessToken();

        const payload = {

            Initiator:

                process.env.INITIATOR_NAME,

            SecurityCredential:

                process.env.SECURITY_CREDENTIAL,

            CommandID:

                "AccountBalance",

            PartyA:

                process.env.SHORTCODE,

            IdentifierType:

                "4",

            Remarks:

                "ParentIQ Balance",

            QueueTimeOutURL:

                `${process.env.CALLBACK_BASE_URL}/mpesa/balance/timeout`,

            ResultURL:

                `${process.env.CALLBACK_BASE_URL}/mpesa/balance/result`

        };

        const response = await axios.post(

            `${process.env.BASE_URL}/mpesa/accountbalance/v1/query`,

            payload,

            {

                headers: {

                    Authorization: `Bearer ${token}`,

                    "Content-Type": "application/json"

                }

            }

        );

        return response.data;

    }

}

module.exports = new AccountBalanceManager();