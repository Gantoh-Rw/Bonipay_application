const express = require('express');
const MobileMoneyController = require('../controllers/mobileMoneyController');
const { authenticateToken } = require('../middleware/auth'); // Your existing auth
const { body } = require('express-validator');
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

router.post('/send-money', validateWithdrawal, handleValidationErrors, MobileMoneyController.sendMoneyToAnyone);
router.post('/withdraw', validateWithdrawal, handleValidationErrors, MobileMoneyController.initiateWithdrawal);

// Routes
router.post('/deposit', validateDeposit, handleValidationErrors, MobileMoneyController.initiateDeposit);
router.post('/transfer', validateTransfer, handleValidationErrors, MobileMoneyController.processInternalTransfer);
router.get('/transactions', MobileMoneyController.getTransactionHistory);
router.get('/balance/:currency', MobileMoneyController.getWalletBalance);
router.post('/withdraw', validateWithdrawal, handleValidationErrors, MobileMoneyController.initiateWithdrawal);


module.exports = router;