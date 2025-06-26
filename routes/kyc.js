// routes/kyc.js
const express = require('express');
const { getKYCStatus, updateKYCDetails, uploadIdentityDocument, submitKYCForVerification, upload } = require('../controllers/kycController');
const { authenticateToken } = require('../middleware/auth');
const { body } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');

const router = express.Router();

// All KYC routes require authentication
router.use(authenticateToken);

// Get KYC status and data
router.get('/status', getKYCStatus);

// Update KYC personal details
router.put('/details', [
    body('nationality')
        .optional()
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Nationality must be between 2 and 100 characters'),
    body('gender')
        .optional()
        .isIn(['male', 'female', 'other'])
        .withMessage('Gender must be male, female, or other'),
    body('dateOfBirth')
        .optional()
        .isISO8601()
        .withMessage('Date of birth must be a valid date (YYYY-MM-DD)')
], handleValidationErrors, updateKYCDetails);

// Upload identity document
router.post('/upload-document', upload.single('document'), [
    body('identityType')
        .isIn(['national_id', 'passport', 'driver_license'])
        .withMessage('Identity type must be national_id, passport, or driver_license'),
    body('identityNumber')
        .trim()
        .isLength({ min: 3, max: 50 })
        .withMessage('Identity number must be between 3 and 50 characters')
], handleValidationErrors, uploadIdentityDocument);

// Submit KYC for verification
router.post('/submit', submitKYCForVerification);

module.exports = router;