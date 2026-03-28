const express = require('express');
const WebhookController = require('../controllers/webhookController');

const router = express.Router();

/**
 * Vodacom DRC M-Pesa Webhook Endpoints
 *
 * These URLs must be registered with Vodacom as your callback URLs:
 *   C2B: POST /api/webhooks/vodacom/c2b
 *   B2C: POST /api/webhooks/vodacom/b2c
 *
 * For simulation testing you can also trigger them manually via:
 *   POST /api/webhooks/simulate/deposit-success
 *   POST /api/webhooks/simulate/withdrawal-success
 *   POST /api/webhooks/simulate/failure
 */

// ── Live Vodacom callbacks ────────────────────────────────────────────────────
router.post('/vodacom/c2b', WebhookController.handleC2BCallback);   // deposit confirmations
router.post('/vodacom/b2c', WebhookController.handleB2CCallback);   // withdrawal / send-money confirmations

// ── Simulation triggers (development / sandbox only) ─────────────────────────
router.post('/simulate/deposit-success',    WebhookController.simulateDepositSuccess);
router.post('/simulate/withdrawal-success', WebhookController.simulateWithdrawalSuccess);
router.post('/simulate/failure',            WebhookController.simulateFailure);

module.exports = router;