const express = require('express');
const { body, query } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');
const MobileMoneyController = require('../controllers/mobileMoneyController');

const router = express.Router();

// ── All routes require a valid JWT ────────────────────────────────────────────
router.use(authenticateToken);

// ── Validation rules ──────────────────────────────────────────────────────────

const validateDeposit = [
    body('amount')
        .isFloat({ min: 1 })
        .withMessage('Amount must be at least 1'),
    body('currency')
        .isIn(['USD', 'KES'])
        .withMessage('Currency must be USD or KES')
];

const validateTransfer = [
    body('receiver_id')
        .isInt({ min: 1 })
        .withMessage('Receiver ID must be a positive integer'),
    body('amount')
        .isFloat({ min: 0.01 })
        .withMessage('Amount must be greater than 0'),
    body('currency')
        .isIn(['USD', 'KES'])
        .withMessage('Currency must be USD or KES')
];

const validateWithdrawal = [
    body('amount')
        .isFloat({ min: 1 })
        .withMessage('Amount must be at least 1'),
    body('currency')
        .isIn(['USD', 'KES'])
        .withMessage('Currency must be USD or KES'),
    body('phone_number')
    .trim()
    .matches(/^\+?[1-9]\d{7,14}$/)
    .withMessage('A valid phone number is required'),
    body('recipient_name')
        .optional()
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Recipient name must be 2–100 characters'),
    body('purpose')
        .optional()
        .trim()
        .isLength({ max: 200 })
        .withMessage('Purpose must be under 200 characters')
];

const validateExchange = [
    body('amount')
        .isFloat({ min: 0.01 })
        .withMessage('Amount must be greater than 0'),
    body('from_currency')
        .isIn(['USD', 'KES'])
        .withMessage('from_currency must be USD or KES'),
    body('to_currency')
        .isIn(['USD', 'KES'])
        .withMessage('to_currency must be USD or KES')
        .custom((value, { req }) => {
            if (value === req.body.from_currency) {
                throw new Error('from_currency and to_currency cannot be the same');
            }
            return true;
        })
];

const validateExchangePreview = [
    query('amount')
        .isFloat({ min: 0.01 })
        .withMessage('Amount must be greater than 0'),
    query('from_currency')
        .isIn(['USD', 'KES'])
        .withMessage('from_currency must be USD or KES'),
    query('to_currency')
        .isIn(['USD', 'KES'])
        .withMessage('to_currency must be USD or KES')
];

// ── Money-flow routes ─────────────────────────────────────────────────────────

// Deposit: user triggers a Vodacom C2B prompt → funds arrive in wallet
router.post('/deposit',  validateDeposit,   handleValidationErrors, MobileMoneyController.initiateDeposit);

// Internal transfer: wallet-to-wallet between two Bonipay users
router.post('/transfer', validateTransfer,  handleValidationErrors, MobileMoneyController.processInternalTransfer);

// Withdrawal: wallet → user's own mobile money number (B2C)
router.post('/withdraw', validateWithdrawal, handleValidationErrors, MobileMoneyController.initiateWithdrawal);

// Send money: wallet → any mobile money number (B2C)
router.post('/send-money', validateWithdrawal, handleValidationErrors, MobileMoneyController.sendMoneyToAnyone);

// ── FX routes ─────────────────────────────────────────────────────────────────

router.post('/exchange',        validateExchange,        handleValidationErrors, MobileMoneyController.exchangeCurrency);
router.get('/exchange-rates',                                                    MobileMoneyController.getExchangeRates);
router.get('/exchange-preview', validateExchangePreview, handleValidationErrors, MobileMoneyController.previewExchange);

// ── Read routes ───────────────────────────────────────────────────────────────

router.get('/transactions',      MobileMoneyController.getTransactionHistory);
router.get('/balance/:currency', MobileMoneyController.getWalletBalance);

module.exports = router;