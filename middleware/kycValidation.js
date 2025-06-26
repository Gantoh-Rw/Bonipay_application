// middleware/kycValidation.js
const { body } = require('express-validator');

const kycDetailsValidation = [
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
        .custom((value) => {
            const date = new Date(value);
            const today = new Date();
            const age = today.getFullYear() - date.getFullYear();
            if (age < 18 || age > 120) {
                throw new Error('Age must be between 18 and 120 years');
            }
            return true;
        })
];

const documentUploadValidation = [
    body('identityType')
        .isIn(['national_id', 'passport', 'driver_license'])
        .withMessage('Identity type must be national_id, passport, or driver_license'),
    body('identityNumber')
        .trim()
        .isLength({ min: 3, max: 50 })
        .withMessage('Identity number must be between 3 and 50 characters')
        .matches(/^[a-zA-Z0-9\-\/]+$/)
        .withMessage('Identity number can only contain letters, numbers, hyphens, and forward slashes')
];

module.exports = {
    kycDetailsValidation,
    documentUploadValidation
};