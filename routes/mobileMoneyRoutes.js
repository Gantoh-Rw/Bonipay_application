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

// Routes
router.post('/deposit', validateDeposit, handleValidationErrors, MobileMoneyController.initiateDeposit);
router.post('/transfer', validateTransfer, handleValidationErrors, MobileMoneyController.processInternalTransfer);
router.get('/transactions', MobileMoneyController.getTransactionHistory);
router.get('/balance/:currency', MobileMoneyController.getWalletBalance);

module.exports = router;