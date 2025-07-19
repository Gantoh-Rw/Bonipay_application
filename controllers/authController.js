const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Account = require('../models/Account');
const Wallet = require('../models/Wallet'); // Add this import
const { sequelize } = require('../config/config'); // Add this import

const generateToken = (userId, role) => {
    return jwt.sign({ userId, role }, process.env.JWT_SECRET, { expiresIn: '24h' });
};

const generateAccountNumber = (currency, userId) => {
    const timestamp = Date.now().toString();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${currency}${userId}${timestamp}${random}`;
};

const register = async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
        const { email, password, firstName, surname, otherNames, phoneNumber } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'User with this email already exists'
            });
        }

        // Create user
        const user = await User.create({
            email,
            password,
            firstName,
            surname,
            otherNames,
            phoneNumber
        }, { transaction });

        // Generate account numbers for both currencies
        const usdAccountNumber = generateAccountNumber('USD', user.id);
        const cdfAccountNumber = generateAccountNumber('CDF', user.id);

        // Create accounts for discovery/identification (no balance field)
        const accounts = await Account.bulkCreate([
            {
                userId: user.id,
                accountNumber: usdAccountNumber,
                accountType: 'checking',
                currency: 'USD',
                status: 'active'
            },
            {
                userId: user.id,
                accountNumber: cdfAccountNumber,
                accountType: 'checking',
                currency: 'CDF',
                status: 'active'
            }
        ], { transaction });

        // Create wallets for actual money management
        await Wallet.bulkCreate([
            {
                userid: user.id,
                currency: 'USD',
                balance: 0.00,
                available_balance: 0.00,
                reserved_balance: 0.00,
                status: 'active'
            },
            {
                userid: user.id,
                currency: 'CDF',
                balance: 0.00,
                available_balance: 0.00,
                reserved_balance: 0.00,
                status: 'active'
            }
        ], { transaction });

        await transaction.commit();

        // Generate token
        const token = generateToken(user.id, user.role);

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            token,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                surname: user.surname,
                otherNames: user.otherNames,
                phoneNumber: user.phoneNumber,
                role: user.role,
                status: user.status,
                accounts: [
                    { 
                        currency: 'USD', 
                        accountNumber: usdAccountNumber,
                        accountType: 'checking'
                    },
                    { 
                        currency: 'CDF', 
                        accountNumber: cdfAccountNumber,
                        accountType: 'checking'
                    }
                ]
            }
        });
    } catch (error) {
        await transaction.rollback();
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Registration failed',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Keep your existing login and getProfile functions unchanged
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user by email
        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        // Check password
        const isValidPassword = await user.comparePassword(password);
        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        // Check account status - different logic for admin vs regular users
        if (user.role === 'admin') {
            
        } else {
            // For regular users: check if account is active
            const userAccount = await Account.findOne({ where: { userId: user.id } });
            if (!userAccount || userAccount.status !== 'active') {
                return res.status(401).json({
                    success: false,
                    message: 'Account is suspended or pending verification'
                });
            }
        }

        // Update last login
        await user.updateLastLogin();

        // Generate token with role
        const token = generateToken(user.id, user.role);  

        // Use the getPublicData method to get appropriate user data
        const userData = user.getPublicData();

        res.json({
            success: true,
            message: 'Login successful',
            token,
            user: {
                ...userData,
                lastLoginAt: user.lastLoginAt
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Login failed',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

const getProfile = async (req, res) => {
    try {
        const user = req.user; // From auth middleware

        // Get user's accounts (for identification)
        const accounts = await Account.findAll({
            where: { userId: user.id },
            attributes: ['id', 'accountNumber', 'accountType', 'currency', 'status']
        });

        // Get user's wallets (for balance info)
        const wallets = await Wallet.findAll({
            where: { userid: user.id },
            attributes: ['currency', 'balance', 'available_balance', 'reserved_balance', 'status']
        });

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                surname: user.surname,
                otherNames: user.otherNames,
                phoneNumber: user.phoneNumber,
                role: user.role,
                status: user.status,
                emailVerified: user.emailVerified,
                lastLoginAt: user.lastLoginAt,
                accounts,
                wallets
            }
        });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get profile',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

module.exports = {
    register,
    login,
    getProfile
};