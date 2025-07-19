const express = require('express');
const { getBalance, updateProfile, changePassword } = require('../controllers/accountController');
const { authenticateToken } = require('../middleware/auth');
const { body } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const MobileMoneyService = require('../services/mobileMoneyService');

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

module.exports = router;