const express = require('express');
const { getBalance, updateProfile, changePassword } = require('../controllers/accountController');
const { authenticateToken } = require('../middleware/auth');
const { body } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');

const router = express.Router();

// All account routes require authentication
router.use(authenticateToken);

router.get('/balance', getBalance);

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