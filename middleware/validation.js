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
const validateCustomRate = [
    body('from_currency')
        .isIn(['USD', 'CDF'])
        .withMessage('From currency must be USD or CDF'),
    body('to_currency')
        .isIn(['USD', 'CDF'])
        .withMessage('To currency must be USD or CDF'),
    body('rate')
        .isFloat({ min: 0.0001 })
        .withMessage('Rate must be a positive number'),
    body('reason')
        .optional()
        .trim()
        .isLength({ max: 200 })
        .withMessage('Reason must be less than 200 characters')
];

const validateSpreadUpdate = [
    body('spread_percentage')
        .isFloat({ min: 0, max: 20 })
        .withMessage('Spread percentage must be between 0 and 20')
];

const validateToggleLiveRates = [
    body('enabled')
        .isBoolean()
        .withMessage('enabled field must be a boolean')
];

module.exports = {
     handleValidationErrors,
    registerValidation,
    loginValidation,
    updateProfileValidation,
    validateCustomRate,        
    validateSpreadUpdate,      
    validateToggleLiveRates 
};