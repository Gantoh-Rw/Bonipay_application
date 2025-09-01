const express = require('express');
const WebhookController = require('../controllers/webhookController');

const router = express.Router();

// Flutterwave webhook endpoints (primary)
router.post('/flutterwave/callback', WebhookController.handleFlutterwaveCallback);
router.post('/flutterwave/transfer', WebhookController.handleFlutterwaveTransferCallback);

// Legacy M-Pesa endpoints (keep for backward compatibility if needed)
// router.post('/mpesa/c2b', WebhookController.handleC2BConfirmation);
// router.post('/mpesa/timeout', WebhookController.handleTimeout);
// router.post('/mpesa/b2c-complete', WebhookController.simulateB2CCompletion);

// Generic webhook endpoint (optional)
router.post('/generic', WebhookController.handleGenericWebhook);

module.exports = router;