const express = require('express');
const WebhookController = require('../controllers/webhookController');

const router = express.Router();

// M-Pesa webhook endpoints (no authentication required)
router.post('/mpesa/c2b', WebhookController.handleC2BConfirmation);
router.post('/mpesa/timeout', WebhookController.handleTimeout);
router.post('/mpesa/b2c-complete', WebhookController.simulateB2CCompletion);

module.exports = router;