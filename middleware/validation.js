const { body, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errors.array()
        });
    }
    next();
};

const registerValidation = [
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Please provide a valid email'),
    body('password')
        .isLength({ min: 6 })
        .withMessage('Password must be at least 6 characters long'),
     body('firstName')
        .trim()
        .isLength({ min: 1, max: 50 })
        .withMessage('First name must be between 1 and 50 characters'),
    body('surname')
        .trim()
        .isLength({ min: 1, max: 50 })
        .withMessage('Surname must be between 1 and 50 characters'),
    body('otherNames')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('Other names must be less than 100 characters'),
    body('phoneNumber')
        .optional()
        .isMobilePhone()
        .withMessage('Please provide a valid phone number')
];

const loginValidation = [
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Please provide a valid email'),
    body('password')
        .notEmpty()
        .withMessage('Password is required')
];
const updateProfileValidation = [
    body('firstName')
        .optional()
        .trim()
        .isLength({ min: 1, max: 50 })
        .withMessage('First name must be between 1 and 50 characters'),
    body('surname')
        .optional()
        .trim()
        .isLength({ min: 1, max: 50 })
        .withMessage('Surname must be between 1 and 50 characters'),
    body('otherNames')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('Other names must be less than 100 characters'),
    body('phoneNumber')
        .optional()
        .isMobilePhone()
        .withMessage('Please provide a valid phone number')
];

module.exports = {
    handleValidationErrors,
    registerValidation,
    loginValidation,
    updateProfileValidation
};