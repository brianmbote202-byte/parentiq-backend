const express = require("express");

const {
    resolveSender
} = require("../services/SmsBrandResolver");

const router =
    express.Router();


// ======================================================
// RESOLVE SMS BRAND
// ======================================================

router.get(
    "/resolve",
    async (req, res) => {

        try {

            const sender =
                String(
                    req.query.sender || ""
                )
                    .trim();


            if (!sender) {

                return res.status(400).json({

                    status:
                        "ERROR",

                    message:
                        "sender is required.",

                    brandName: "",

                    logoUrl: "",

                    faviconUrl: "",

                    confidence: 0,

                    verified: false

                });

            }


            /*
            ------------------------------------------
            Limit unreasonable sender input.
            ------------------------------------------
            */

            if (
                sender.length > 120
            ) {

                return res.status(400).json({

                    status:
                        "ERROR",

                    message:
                        "sender is too long.",

                    brandName: "",

                    logoUrl: "",

                    faviconUrl: "",

                    confidence: 0,

                    verified: false

                });

            }


            const result =
                await resolveSender(
                    sender
                );


            return res.json(
                result
            );

        }

        catch (error) {

            console.error(
                "[SMS BRAND ROUTE] Error:",
                error
            );


            return res.status(500).json({

                status:
                    "ERROR",

                message:
                    "Unable to resolve SMS brand.",

                brandName: "",

                logoUrl: "",

                faviconUrl: "",

                confidence: 0,

                verified: false

            });

        }

    }
);


module.exports = router;