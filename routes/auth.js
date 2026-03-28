const express = require('express');
const {
    register,
    login,
    getProfile,
    forgotPassword,
    verifyOtp,
    resetPassword,
} = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');
const {
    registerValidation,
    loginValidation,
    handleValidationErrors,
} = require('../middleware/validation');

const router = express.Router();

// ── Public routes ─────────────────────────────────────────────────────────────
router.post('/register', registerValidation, handleValidationErrors, register);
router.post('/login',    loginValidation,    handleValidationErrors, login);

// ── Password reset flow ───────────────────────────────────────────────────────
router.post('/forgot-password', forgotPassword); // Step 1: send OTP
router.post('/verify-otp',      verifyOtp);      // Step 2: verify OTP → get reset_token
router.post('/reset-password',  resetPassword);  // Step 3: submit new password

// ── Protected routes ──────────────────────────────────────────────────────────
router.get('/profile', authenticateToken, getProfile);

module.exports = router;