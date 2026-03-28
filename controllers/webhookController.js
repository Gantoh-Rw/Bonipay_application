const MobileMoneyService = require('../services/mobileMoneyService');
const TransactionModel   = require('../models/Transaction');

/**
 * WebhookController
 *
 * Handles inbound callbacks from Vodacom DRC M-Pesa and
 * provides simulation helpers for end-to-end testing.
 */
class WebhookController {

    // ─────────────────────────────────────────────
    // LIVE CALLBACKS
    // ─────────────────────────────────────────────

    /**
     * POST /api/webhooks/vodacom/c2b
     * Vodacom calls this when a C2B (deposit) payment completes or fails.
     *
     * Expected body (Vodacom sandbox format):
     * {
     *   "output_TransactionID":        "MP2109260001",
     *   "output_ConversationID":       "A0000000000001",
     *   "output_ThirdPartyReference":  "DEP1234567890",   ← our transaction_ref
     *   "output_ResponseCode":         "INS-0",           ← INS-0 = success
     *   "output_ResponseDesc":         "Request processed successfully",
     *   "output_CustomerMSISDN":       "243XXXXXXXXX",
     *   "output_Amount":               "100"
     * }
     */
    static async handleC2BCallback(req, res) {
        try {
            const raw = req.body;
            console.log('📩 Vodacom C2B callback received:', JSON.stringify(raw, null, 2));

            // Normalise Vodacom field names to our internal shape
            const callbackData = {
                transactionRef:   raw.output_ThirdPartyReference,
                transactionId:    raw.output_TransactionID,
                conversationId:   raw.output_ConversationID,
                status:           raw.output_ResponseCode === 'INS-0' ? 'successful' : 'failed',
                amount:           raw.output_Amount,
                msisdn:           raw.output_CustomerMSISDN,
                resultDesc:       raw.output_ResponseDesc,
                event:            'c2b.completed',
                rawPayload:       raw
            };

            const result = await MobileMoneyService.processC2BCallback(callbackData);

            // Vodacom expects a 200 with a specific acknowledgement body
            return res.status(200).json({
                output_ResponseCode: 'INS-0',
                output_ResponseDesc: 'Acknowledged'
            });

        } catch (error) {
            console.error('❌ C2B callback processing error:', error.message);
            // Still return 200 so Vodacom does not keep retrying on our internal errors
            return res.status(200).json({
                output_ResponseCode: 'INS-0',
                output_ResponseDesc: 'Acknowledged'
            });
        }
    }

    /**
     * POST /api/webhooks/vodacom/b2c
     * Vodacom calls this when a B2C (withdrawal / send-money) completes or fails.
     *
     * Expected body:
     * {
     *   "output_TransactionID":        "MP2109260002",
     *   "output_ConversationID":       "A0000000000002",
     *   "output_ThirdPartyReference":  "WTH1234567890",   ← our transaction_ref
     *   "output_ResponseCode":         "INS-0",
     *   "output_ResponseDesc":         "Request processed successfully",
     *   "output_CustomerMSISDN":       "243XXXXXXXXX",
     *   "output_Amount":               "50"
     * }
     */
    static async handleB2CCallback(req, res) {
        try {
            const raw = req.body;
            console.log('📩 Vodacom B2C callback received:', JSON.stringify(raw, null, 2));

            const callbackData = {
                transactionRef:   raw.output_ThirdPartyReference,
                transactionId:    raw.output_TransactionID,
                conversationId:   raw.output_ConversationID,
                status:           raw.output_ResponseCode === 'INS-0' ? 'SUCCESSFUL' : 'FAILED',
                amount:           raw.output_Amount,
                msisdn:           raw.output_CustomerMSISDN,
                resultDesc:       raw.output_ResponseDesc,
                event:            'b2c.completed',
                rawPayload:       raw
            };

            await MobileMoneyService.processB2CCallback(callbackData);

            return res.status(200).json({
                output_ResponseCode: 'INS-0',
                output_ResponseDesc: 'Acknowledged'
            });

        } catch (error) {
            console.error('❌ B2C callback processing error:', error.message);
            return res.status(200).json({
                output_ResponseCode: 'INS-0',
                output_ResponseDesc: 'Acknowledged'
            });
        }
    }

    // ─────────────────────────────────────────────
    // SIMULATION HELPERS
    // ─────────────────────────────────────────────

    /**
     * POST /api/webhooks/simulate/deposit-success
     * Body: { "transaction_ref": "DEP…" }
     *
     * Simulates Vodacom confirming a C2B deposit as successful.
     */
    static async simulateDepositSuccess(req, res) {
        try {
            if (process.env.NODE_ENV === 'production') {
                return res.status(403).json({
                    success: false,
                    message: 'Simulation endpoints are disabled in production'
                });
            }

            const { transaction_ref } = req.body;
            if (!transaction_ref) {
                return res.status(400).json({
                    success: false,
                    message: 'transaction_ref is required'
                });
            }

            // Look up the pending transaction to get the amount
            const pendingTx = await TransactionModel.findOne({
                where: { transaction_ref, status: 'pending', type: 'deposit' }
            });

            if (!pendingTx) {
                return res.status(404).json({
                    success: false,
                    message: 'No pending deposit found with that reference'
                });
            }

            const fakeCallback = {
                transactionRef:  transaction_ref,
                transactionId:   `SIM_C2B_${Date.now()}`,
                conversationId:  `SIM_CONV_${Date.now()}`,
                status:          'successful',
                amount:          String(pendingTx.amount),
                msisdn:          pendingTx.metadata?.user_phone || '243000000000',
                resultDesc:      '[SIMULATION] Payment confirmed',
                event:           'c2b.completed'
            };

            console.log('🧪 Simulating C2B success for:', transaction_ref);
            const result = await MobileMoneyService.processC2BCallback(fakeCallback);

            return res.status(200).json({
                success: true,
                message: 'Deposit simulation processed',
                result
            });

        } catch (error) {
            console.error('Simulation error:', error.message);
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * POST /api/webhooks/simulate/withdrawal-success
     * Body: { "transaction_ref": "WTH…" | "SEND…" }
     *
     * Simulates Vodacom confirming a B2C withdrawal/send as successful.
     */
    static async simulateWithdrawalSuccess(req, res) {
        try {
            if (process.env.NODE_ENV === 'production') {
                return res.status(403).json({
                    success: false,
                    message: 'Simulation endpoints are disabled in production'
                });
            }

            const { transaction_ref } = req.body;
            if (!transaction_ref) {
                return res.status(400).json({
                    success: false,
                    message: 'transaction_ref is required'
                });
            }

            const processingTx = await TransactionModel.findOne({
                where: { transaction_ref, status: 'processing', type: 'withdrawal' }
            });

            if (!processingTx) {
                return res.status(404).json({
                    success: false,
                    message: 'No processing withdrawal/send found with that reference'
                });
            }

            const fakeCallback = {
                transactionRef:  transaction_ref,
                transactionId:   `SIM_B2C_${Date.now()}`,
                conversationId:  `SIM_CONV_${Date.now()}`,
                status:          'SUCCESSFUL',
                amount:          String(processingTx.amount),
                msisdn:          processingTx.metadata?.phone_number || processingTx.metadata?.recipient_phone || '243000000000',
                resultDesc:      '[SIMULATION] Transfer confirmed',
                event:           'b2c.completed'
            };

            console.log('🧪 Simulating B2C success for:', transaction_ref);
            const result = await MobileMoneyService.processB2CCallback(fakeCallback);

            return res.status(200).json({
                success: true,
                message: 'Withdrawal simulation processed',
                result
            });

        } catch (error) {
            console.error('Simulation error:', error.message);
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * POST /api/webhooks/simulate/failure
     * Body: { "transaction_ref": "DEP…|WTH…|SEND…", "reason": "optional message" }
     *
     * Simulates Vodacom reporting a failed transaction (either C2B or B2C).
     */
    static async simulateFailure(req, res) {
        try {
            if (process.env.NODE_ENV === 'production') {
                return res.status(403).json({
                    success: false,
                    message: 'Simulation endpoints are disabled in production'
                });
            }

            const { transaction_ref, reason } = req.body;
            if (!transaction_ref) {
                return res.status(400).json({
                    success: false,
                    message: 'transaction_ref is required'
                });
            }

            // Detect type by prefix or by looking it up
            const tx = await TransactionModel.findOne({
                where: { transaction_ref }
            });

            if (!tx) {
                return res.status(404).json({
                    success: false,
                    message: 'Transaction not found'
                });
            }

            const failReason = reason || '[SIMULATION] Payment failed or cancelled by user';
            let result;

            if (tx.type === 'deposit') {
                result = await MobileMoneyService.processC2BCallback({
                    transactionRef: transaction_ref,
                    transactionId:  `SIM_FAIL_${Date.now()}`,
                    status:         'failed',
                    amount:         String(tx.amount),
                    resultDesc:     failReason,
                    event:          'c2b.failed'
                });
            } else {
                result = await MobileMoneyService.processB2CCallback({
                    transactionRef: transaction_ref,
                    transactionId:  `SIM_FAIL_${Date.now()}`,
                    status:         'FAILED',
                    amount:         String(tx.amount),
                    resultDesc:     failReason,
                    event:          'b2c.failed'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Failure simulation processed',
                result
            });

        } catch (error) {
            console.error('Simulation error:', error.message);
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

module.exports = WebhookController;