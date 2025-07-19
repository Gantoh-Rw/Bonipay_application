const MobileMoneyService = require('../services/mobileMoneyService');
const crypto = require('crypto');

class WebhookController {
    // Verify webhook signature
    static verifyWebhookSignature(payload, signature) {
        const expectedSignature = crypto
            .createHmac('sha256', process.env.WEBHOOK_SECRET)
            .update(payload)
            .digest('hex');
        
        return crypto.timingSafeEqual(
            Buffer.from(signature, 'hex'),
            Buffer.from(expectedSignature, 'hex')
        );
    }

    // Handle C2B confirmation
    static async handleC2BConfirmation(req, res) {
        try {
            const webhookData = req.body;
            console.log('C2B Webhook received:', webhookData);
            
            // Verify webhook signature (if enabled)
            const signature = req.headers['x-signature'];
            if (signature && process.env.WEBHOOK_SECRET) {
                if (!this.verifyWebhookSignature(JSON.stringify(webhookData), signature)) {
                    return res.status(401).json({
                        ResultCode: 1,
                        ResultDesc: 'Invalid signature'
                    });
                }
            }
            
            // Process webhook
            const result = await MobileMoneyService.processC2BWebhook(webhookData);
            
            if (result.success) {
                res.status(200).json({
                    ResultCode: 0,
                    ResultDesc: 'Accepted'
                });
            } else {
                res.status(200).json({
                    ResultCode: 1,
                    ResultDesc: result.error || 'Processing failed'
                });
            }
        } catch (error) {
            console.error('C2B webhook processing failed:', error);
            
            res.status(200).json({
                ResultCode: 1,
                ResultDesc: 'Processing failed'
            });
        }
    }

    // Handle timeout
    static async handleTimeout(req, res) {
        try {
            const webhookData = req.body;
            console.log('Timeout received:', webhookData);
            
            // Log timeout - you might want to mark transaction as failed
            
            res.status(200).json({
                ResultCode: 0,
                ResultDesc: 'Timeout logged'
            });
        } catch (error) {
            console.error('Timeout handling failed:', error);
            res.status(200).json({
                ResultCode: 1,
                ResultDesc: 'Timeout processing failed'
            });
        }
    }
}

module.exports = WebhookController;