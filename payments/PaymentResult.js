class PaymentResult {

    constructor({

        success = false,

        paymentId = "",

        status = "",

        provider = "",

        providerReference = "",

        conversationId = "",

        originatorConversationId = "",

        receipt = "",

        message = ""

    }) {

        this.success = success;

        this.paymentId = paymentId;

        this.status = status;

        this.provider = provider;

        this.providerReference = providerReference;

        this.conversationId = conversationId;

        this.originatorConversationId = originatorConversationId;

        this.receipt = receipt;

        this.message = message;

    }

}

module.exports = PaymentResult;