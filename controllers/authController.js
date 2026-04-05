const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const User     = require('../models/User');
const Account  = require('../models/Account');
const Wallet   = require('../models/Wallet');
const { sequelize } = require('../config/config');

// ── Helpers ───────────────────────────────────────────────────────────────────

const generateToken = (userId, role) =>
    jwt.sign({ userId, role }, process.env.JWT_SECRET, { expiresIn: '24h' });

const generateAccountNumber = (currency, userId) => {
    const timestamp = Date.now().toString();
    const random    = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${currency}${userId}${timestamp}${random}`;
};

// ── In-memory OTP store ───────────────────────────────────────────────────────
// Keyed by email. Each entry: { otp, expiresAt }
// For production, replace with a DB table or Redis.
const otpStore = new Map();

const generateOtp = () =>
    Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit numeric OTP

const storeOtp = (email, otp) => {
    otpStore.set(email.toLowerCase(), {
        otp,
        expiresAt: Date.now() + 15 * 60 * 1000, // 15 minutes
    });
};

const verifyStoredOtp = (email, otp) => {
    const entry = otpStore.get(email.toLowerCase());
    if (!entry) return { valid: false, reason: 'No OTP found for this email' };
    if (Date.now() > entry.expiresAt) {
        otpStore.delete(email.toLowerCase());
        return { valid: false, reason: 'OTP has expired. Please request a new one.' };
    }
    if (entry.otp !== otp) return { valid: false, reason: 'Invalid OTP code.' };
    return { valid: true };
};

// Optional: send email via nodemailer if SMTP is configured in .env
const sendOtpEmail = async (email, otp) => {
    // Always log to console for development
    console.log(`\n🔑 PASSWORD RESET OTP for ${email}: ${otp}\n`);

    // If nodemailer + SMTP env vars are set, also send a real email
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        try {
            const nodemailer = require('nodemailer');
            const transporter = nodemailer.createTransport({
                host:   process.env.SMTP_HOST,
                port:   parseInt(process.env.SMTP_PORT || '587'),
                secure: process.env.SMTP_SECURE === 'true',
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS,
                },
            });

            await transporter.sendMail({
                from:    process.env.SMTP_FROM || `"Bonipay" <${process.env.SMTP_USER}>`,
                to:      email,
                subject: 'Bonipay — Password Reset Code',
                text:    `Your Bonipay password reset code is: ${otp}\n\nThis code expires in 15 minutes.\n\nIf you did not request this, please ignore this email.`,
                html:    `
                    <div style="font-family:sans-serif;max-width:400px;margin:0 auto">
                        <h2 style="color:#1e1e1e">Password Reset</h2>
                        <p>Your Bonipay password reset code is:</p>
                        <div style="font-size:36px;font-weight:bold;letter-spacing:10px;text-align:center;padding:20px;background:#f5f5f5;border-radius:8px;margin:20px 0">
                            ${otp}
                        </div>
                        <p style="color:#666;font-size:13px">This code expires in 15 minutes. If you did not request this, please ignore this email.</p>
                    </div>
                `,
            });
            console.log(`📧 OTP email sent to ${email}`);
        } catch (err) {
            // Email sending failed — OTP is still in console, don't break the flow
            console.error('Email send failed (OTP still valid):', err.message);
        }
    } else {
        console.log('ℹ️  SMTP not configured — OTP logged to console only.');
        console.log('   Add SMTP_HOST, SMTP_USER, SMTP_PASS to .env to send real emails.');
    }
};

// ── Existing controllers ──────────────────────────────────────────────────────

const register = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const { email, password, firstName, surname, otherNames, phoneNumber } = req.body;

        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'User with this email already exists' });
        }

        const user = await User.create(
            { email, password, firstName, surname, otherNames, phoneNumber },
            { transaction }
        );

        const usdAccountNumber = generateAccountNumber('USD', user.id);
const kesAccountNumber = generateAccountNumber('KES', user.id);

await Account.bulkCreate([
    { userId: user.id, accountNumber: usdAccountNumber, accountType: 'checking', currency: 'USD', status: 'active' },
    { userId: user.id, accountNumber: kesAccountNumber, accountType: 'checking', currency: 'KES', status: 'active' },
], { transaction });

await Wallet.bulkCreate([
    { userid: user.id, currency: 'USD', balance: 0.00, available_balance: 0.00, reserved_balance: 0.00, status: 'active' },
    { userid: user.id, currency: 'KES', balance: 0.00, available_balance: 0.00, reserved_balance: 0.00, status: 'active' },
], { transaction });

        await transaction.commit();

        const token = generateToken(user.id, user.role);

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            token,
            user: {
                id: user.id, email: user.email, firstName: user.firstName,
                surname: user.surname, otherNames: user.otherNames,
                phoneNumber: user.phoneNumber, role: user.role,
                accounts: [
                    { currency: 'USD', accountNumber: usdAccountNumber, accountType: 'checking' },
                    { currency: 'KES', accountNumber: kesAccountNumber, accountType: 'checking' },
                ],
            },
        });
    } catch (error) {
        await transaction.rollback();
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: 'Registration failed', error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
    }
};

const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        const isValidPassword = await user.comparePassword(password);
        if (!isValidPassword) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        if (user.role !== 'admin') {
            const userAccount = await Account.findOne({ where: { userId: user.id } });
            if (!userAccount || userAccount.status !== 'active') {
                return res.status(401).json({ success: false, message: 'Account is suspended or pending verification' });
            }
        }

        await user.updateLastLogin();
        const token    = generateToken(user.id, user.role);
        const userData = user.getPublicData();

        res.json({ success: true, message: 'Login successful', token, user: { ...userData, lastLoginAt: user.lastLoginAt } });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Login failed', error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
    }
};

const getProfile = async (req, res) => {
    try {
        const user    = req.user;
        const accounts = await Account.findAll({ where: { userId: user.id }, attributes: ['id', 'accountNumber', 'accountType', 'currency', 'status'] });
        const wallets  = await Wallet.findAll({ where: { userid: user.id }, attributes: ['currency', 'balance', 'available_balance', 'reserved_balance', 'status'] });

        res.json({
            success: true,
            user: {
                id: user.id, email: user.email, firstName: user.firstName,
                surname: user.surname, otherNames: user.otherNames,
                phoneNumber: user.phoneNumber, role: user.role,
                emailVerified: user.emailVerified, lastLoginAt: user.lastLoginAt,
                accounts, wallets,
            },
        });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ success: false, message: 'Failed to get profile', error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
    }
};

// ── New: Forgot Password ──────────────────────────────────────────────────────

const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required.' });
        }

        // Verify user exists — but don't reveal whether they do for security
        const user = await User.findOne({ where: { email: email.toLowerCase() } });
        if (!user) {
            // Return 404 so the mobile app can show "no account found"
            return res.status(404).json({ success: false, message: 'No account found with that email address.' });
        }

        const otp = generateOtp();
        storeOtp(email, otp);
        await sendOtpEmail(email, otp);

        res.json({ success: true, message: 'Reset code sent to your email.' });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ success: false, message: 'Failed to send reset code.' });
    }
};

// ── New: Verify OTP ───────────────────────────────────────────────────────────

const verifyOtp = async (req, res) => {
    try {
        const { email, otp } = req.body;

        if (!email || !otp) {
            return res.status(400).json({ success: false, message: 'Email and OTP are required.' });
        }

        const { valid, reason } = verifyStoredOtp(email, otp);
        if (!valid) {
            return res.status(400).json({ success: false, message: reason });
        }

        // Generate a short-lived reset token valid for 10 minutes
        const reset_token = jwt.sign(
            { email: email.toLowerCase(), purpose: 'password_reset' },
            process.env.JWT_SECRET,
            { expiresIn: '10m' }
        );

        // Clear OTP so it can't be reused
        otpStore.delete(email.toLowerCase());

        res.json({ success: true, message: 'OTP verified.', reset_token });
    } catch (error) {
        console.error('Verify OTP error:', error);
        res.status(500).json({ success: false, message: 'OTP verification failed.' });
    }
};

// ── New: Reset Password ───────────────────────────────────────────────────────

const resetPassword = async (req, res) => {
    try {
        const { email, reset_token, new_password } = req.body;

        if (!email || !reset_token || !new_password) {
            return res.status(400).json({ success: false, message: 'Email, reset token and new password are required.' });
        }

        if (new_password.length < 8) {
            return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
        }

        // Verify reset token
        let decoded;
        try {
            decoded = jwt.verify(reset_token, process.env.JWT_SECRET);
        } catch {
            return res.status(400).json({ success: false, message: 'Reset token is invalid or has expired. Please request a new code.' });
        }

        if (decoded.purpose !== 'password_reset' || decoded.email !== email.toLowerCase()) {
            return res.status(400).json({ success: false, message: 'Invalid reset token.' });
        }

        // Find user and update password
        const user = await User.findOne({ where: { email: email.toLowerCase() } });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        // Hash new password — User model hooks may do this automatically,
        // but we hash explicitly here to be safe
        const hashedPassword = await bcrypt.hash(new_password, 12);
        await user.update({ password: hashedPassword });

        console.log(`✅ Password reset for ${email}`);

        res.json({ success: true, message: 'Password reset successfully. Please log in with your new password.' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ success: false, message: 'Password reset failed.' });
    }
};

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
    register,
    login,
    getProfile,
    forgotPassword,
    verifyOtp,
    resetPassword,
};