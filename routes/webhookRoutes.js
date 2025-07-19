const express = require('express');
const WebhookController = require('../controllers/webhookController');

const router = express.Router();

// M-Pesa webhook endpoints (no authentication required)
router.post('/mpesa/c2b', WebhookController.handleC2BConfirmation);
router.post('/mpesa/timeout', WebhookController.handleTimeout);

module.exports = router;