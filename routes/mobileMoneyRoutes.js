const express = require('express');
const MobileMoneyController = require('../controllers/mobileMoneyController');
const { authenticateToken } = require('../middleware/auth'); // Your existing auth
const { body, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation'); // Your existing validation

const router = express.Router();

// All mobile money routes require authentication
router.use(authenticateToken);

// Validation middleware
const validateDeposit = [
    body('amount')
        .isFloat({ min: 1 })
        .withMessage('Amount must be greater than 0'),
    body('currency')
        .isIn(['USD', 'CDF'])
        .withMessage('Currency must be USD or CDF')
];

const validateTransfer = [
    body('receiver_id')
        .isInt()
        .withMessage('Receiver ID must be a valid integer'),
    body('amount')
        .isFloat({ min: 0.01 })
        .withMessage('Amount must be greater than 0'),
    body('currency')
        .isIn(['USD', 'CDF'])
        .withMessage('Currency must be USD or CDF')
];

const validateWithdrawal = [
    body('amount')
        .isFloat({ min: 1 })
        .withMessage('Amount must be greater than 0'),
    body('currency')
        .isIn(['USD', 'CDF'])
        .withMessage('Currency must be USD or CDF'),
    body('phone_number')
        .isMobilePhone()
        .withMessage('Valid phone number required'),
    body('recipient_name')
        .optional()
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Recipient name must be between 2 and 100 characters'),
    body('purpose')
        .optional()
        .trim()
        .isLength({ max: 200 })
        .withMessage('Purpose must be less than 200 characters')
];
const validateExchange = [
    body('amount')
        .isFloat({ min: 0.01 })
        .withMessage('Amount must be greater than 0'),
    body('from_currency')
        .isIn(['USD', 'CDF'])
        .withMessage('From currency must be USD or CDF'),
    body('to_currency')
        .isIn(['USD', 'CDF'])
        .withMessage('To currency must be USD or CDF')
        .custom((value, { req }) => {
            if (value === req.body.from_currency) {
                throw new Error('From and to currency cannot be the same');
            }
            return true;
        })
];

// Exchange preview validation
const validateExchangePreview = [
    query('amount')
        .isFloat({ min: 0.01 })
        .withMessage('Amount must be greater than 0'),
    query('from_currency')
        .isIn(['USD', 'CDF'])
        .withMessage('From currency must be USD or CDF'),
    query('to_currency')
        .isIn(['USD', 'CDF'])
        .withMessage('To currency must be USD or CDF')
];
// Currency exchange routes
router.post('/exchange', validateExchange, handleValidationErrors, MobileMoneyController.exchangeCurrency);

// Exchange rate information
router.get('/exchange-rates', MobileMoneyController.getExchangeRates);
router.get('/exchange-preview', validateExchangePreview, handleValidationErrors, MobileMoneyController.previewExchange);


router.post('/send-money', validateWithdrawal, handleValidationErrors, MobileMoneyController.sendMoneyToAnyone);
router.post('/withdraw', validateWithdrawal, handleValidationErrors, MobileMoneyController.initiateWithdrawal);

// Routes
router.post('/deposit', validateDeposit, handleValidationErrors, MobileMoneyController.initiateDeposit);
router.post('/transfer', validateTransfer, handleValidationErrors, MobileMoneyController.processInternalTransfer);
router.get('/transactions', MobileMoneyController.getTransactionHistory);
router.get('/balance/:currency', MobileMoneyController.getWalletBalance);
router.post('/withdraw', validateWithdrawal, handleValidationErrors, MobileMoneyController.initiateWithdrawal);


module.exports = router;