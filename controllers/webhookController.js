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

    static async handleFlutterwaveCallback(req, res) {
    try {
        const callbackData = req.body;
        console.log('📱 Flutterwave Callback received:', JSON.stringify(callbackData, null, 2));
        
        // Verify webhook signature (if enabled)
        const signature = req.headers['verif-hash'];
        if (signature && process.env.FLUTTERWAVE_SECRET_HASH) {
            const hash = crypto
                .createHash('sha256')
                .update(JSON.stringify(callbackData) + process.env.FLUTTERWAVE_SECRET_HASH)
                .digest('hex');
                
            if (signature !== hash) {
                console.log('❌ Invalid webhook signature');
                return res.status(401).json({
                    status: 'error',
                    message: 'Invalid signature'
                });
            }
        }
        
        // Process Flutterwave callback
        const result = await MobileMoneyService.processFlutterwaveCallback(callbackData);
        
        if (result.success) {
            console.log('✅ Flutterwave callback processed successfully');
            res.status(200).json({
                status: 'success',
                message: 'Webhook processed successfully'
            });
        } else {
            console.log('⚠️ Flutterwave callback processing failed:', result.error);
            res.status(200).json({
                status: 'error',
                message: result.error || 'Processing failed'
            });
        }
    } catch (error) {
        console.error('❌ Flutterwave callback processing failed:', error);
        
        res.status(200).json({
            status: 'error',
            message: 'Processing failed'
        });
    }
}
    // Generic webhook handler for future providers
static async handleGenericWebhook(req, res) {
    try {
        const webhookData = req.body;
        const provider = req.query.provider || 'unknown';
        
        console.log(`📡 Generic webhook received from ${provider}:`, webhookData);
        
        // Log the webhook for debugging
        await MpesaWebhook.create({
            webhook_type: 'generic_webhook',
            webhook_source: provider,
            raw_payload: webhookData,
            status: 'received'
        });
        
        res.status(200).json({
            status: 'success',
            message: 'Webhook received and logged'
        });
        
    } catch (error) {
        console.error('Generic webhook error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Webhook processing failed'
        });
    }
}
    static async handleFlutterwaveTransferCallback(req, res) {
    try {
        const callbackData = req.body;
        console.log('💸 Flutterwave Transfer Callback received:', JSON.stringify(callbackData, null, 2));
        
        // Verify webhook signature (if enabled)
        const signature = req.headers['verif-hash'];
        if (signature && process.env.FLUTTERWAVE_SECRET_HASH) {
            const hash = crypto
                .createHash('sha256')
                .update(JSON.stringify(callbackData) + process.env.FLUTTERWAVE_SECRET_HASH)
                .digest('hex');
                
            if (signature !== hash) {
                console.log('❌ Invalid webhook signature');
                return res.status(401).json({
                    status: 'error',
                    message: 'Invalid signature'
                });
            }
        }
        
        // Process transfer callback
        const result = await MobileMoneyService.processFlutterwaveTransferCallback(callbackData);
        
        if (result.success) {
            console.log('✅ Flutterwave transfer callback processed successfully');
            res.status(200).json({
                status: 'success',
                message: 'Transfer webhook processed successfully'
            });
        } else {
            console.log('⚠️ Flutterwave transfer callback processing failed:', result.error);
            res.status(200).json({
                status: 'error',
                message: result.error || 'Processing failed'
            });
        }
    } catch (error) {
        console.error('❌ Flutterwave transfer callback processing failed:', error);
        
        res.status(200).json({
            status: 'error',
            message: 'Processing failed'
        });
    }
  }
}

module.exports = WebhookController;