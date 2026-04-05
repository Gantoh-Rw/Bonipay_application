const express = require('express');
const { getBalance, updateProfile, changePassword } = require('../controllers/accountController');
const { authenticateToken } = require('../middleware/auth');
const { body } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const MobileMoneyService = require('../services/mobileMoneyService');
const CurrencyExchangeService = require('../services/CurrencyExchangeService');
const ExternalExchangeService = require('../services/ExternalExchangeService');
const BlockchainService = require('../services/BlockchainService');

const router = express.Router();

// All account routes require authentication
router.use(authenticateToken);

router.get('/wallets', async (req, res) => {
    try {
        const userId = req.user.id;
        const wallets = await MobileMoneyService.getAllWalletBalances(userId);
        res.json({ success: true, wallets });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/search/:searchTerm', async (req, res) => {
    try {
        const { searchTerm } = req.params;
        const userId = req.user.id;
        const accounts = await MobileMoneyService.searchAccounts(searchTerm, userId);
        res.json({ success: true, accounts });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.put('/profile', [
    body('firstName').optional().trim().isLength({ min: 2, max: 100 }),
    body('surname').optional().trim().isLength({ min: 2, max: 100 }),
    body('otherNames').optional().trim().isLength({ min: 2, max: 100 }),
    body('phoneNumber').optional().isMobilePhone()
], handleValidationErrors, updateProfile);

router.put('/change-password', [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters long')
], handleValidationErrors, changePassword);

router.get('/exchange/quote', async (req, res) => {
    try {
        const { amount, from, to } = req.query;
        if (!amount || !from || !to) {
            return res.status(400).json({ success: false, message: 'amount, from, to are required' });
        }
        const calc = await CurrencyExchangeService.calculateExchange(parseFloat(amount), from.toUpperCase(), to.toUpperCase());
        if (!calc.success) return res.status(400).json({ success: false, message: calc.error });

        res.json({
            success: true,
            transparency: {
                you_send:         `${calc.source_amount} ${calc.from_currency}`,
                they_receive:     `${calc.converted_amount} ${calc.to_currency}`,
                exchange_rate:    `1 ${calc.from_currency} = ${calc.exchange_rate} ${calc.to_currency}`,
                market_rate:      `1 ${calc.from_currency} = ${calc.rate_info.base_rate} ${calc.to_currency}`,
                spread:           `${calc.rate_info.spread_percentage}%`,
                flat_fee:         calc.fees.flat_fee,
                percentage_fee:   calc.fees.percentage_fee,
                total_fees:       calc.fees.total_fee,
                total_you_pay:    calc.total_source_amount,
                cost_of_spread:   parseFloat((calc.rate_info.base_rate - calc.rate_info.customer_rate).toFixed(6))
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
router.get('/transaction/verify/:ref', async (req, res) => {
    try {
        const result = await BlockchainService.verifyTransaction(req.params.ref);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;