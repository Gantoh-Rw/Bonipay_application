const MobileMoneyService = require('../services/mobileMoneyService');
const { validationResult } = require('express-validator');
const CurrencyExchangeService = require('../services/CurrencyExchangeService');

class MobileMoneyController {
    // Initiate deposit
    static async initiateDeposit(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors: errors.array()
                });
            }

            const { amount, currency } = req.body;
            const userId = req.user.id;

            // Check if user's KYC is verified
            const kyc = await req.user.getKyc();
            if (!kyc || kyc.verificationStatus !== 'verified') {
                return res.status(400).json({
                    success: false,
                    message: 'KYC verification required',
                    kyc_status: kyc?.verificationStatus || 'incomplete'
                });
            }

            // Get idempotency key from header OR auto-generate
            let idempotencyKey = req.headers['idempotency-key'];
            if (!idempotencyKey) {
                idempotencyKey = `deposit_${userId}_${Date.now()}`;
            }

            const result = await MobileMoneyService.initiateDeposit(userId, amount, currency, idempotencyKey);

            res.status(200).json({
                success: true,
                message: 'Deposit initiated successfully',
                data: result
            });
        } catch (error) {
            console.error('Deposit initiation failed:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    // Process internal transfer
    static async processInternalTransfer(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors: errors.array()
                });
            }

            const { receiver_id, amount, currency } = req.body;
            const senderId = req.user.id;
            const idempotencyKey = req.headers['idempotency-key'] || `transfer_${senderId}_${Date.now()}`;

            // Prevent self-transfer
            if (senderId === receiver_id) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot transfer to yourself'
                });
            }

            const result = await MobileMoneyService.processInternalTransfer(
                senderId, receiver_id, amount, currency, idempotencyKey
            );

            res.status(200).json({
                success: true,
                message: 'Transfer processed successfully',
                data: result
            });
        } catch (error) {
            console.error('Internal transfer failed:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    static async initiateWithdrawal(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors: errors.array()
                });
            }

            const { amount, currency, phone_number } = req.body;
            const userId = req.user.id;

            // Check if user's KYC is verified
            const kyc = await req.user.getKyc();
            if (!kyc || kyc.verificationStatus !== 'verified') {
                return res.status(400).json({
                    success: false,
                    message: 'KYC verification required for withdrawals',
                    kyc_status: kyc?.verificationStatus || 'incomplete'
                });
            }

            // Get idempotency key from header OR auto-generate
            const idempotencyKey = req.headers['idempotency-key'] || `withdraw_${userId}_${Date.now()}`;

            const result = await MobileMoneyService.initiateWithdrawal(userId, amount, currency, phone_number, idempotencyKey);

            res.status(200).json({
                success: true,
                message: 'Withdrawal initiated successfully',
                data: result
            });
        } catch (error) {
            console.error('Withdrawal initiation failed:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    static async sendMoneyToAnyone(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors: errors.array()
                });
            }

            const { amount, currency, phone_number, recipient_name, purpose } = req.body;
            const userId = req.user.id;

            // Check if user's KYC is verified
            const kyc = await req.user.getKyc();
            if (!kyc || kyc.verificationStatus !== 'verified') {
                return res.status(400).json({
                    success: false,
                    message: 'KYC verification required to send money',
                    kyc_status: kyc?.verificationStatus || 'incomplete'
                });
            }

            // Get idempotency key from header OR auto-generate
            const idempotencyKey = req.headers['idempotency-key'] || `send_${userId}_${Date.now()}`;

            const result = await MobileMoneyService.sendMoneyToAnyone(
                userId, 
                amount, 
                currency, 
                phone_number, 
                idempotencyKey,
                recipient_name,
                purpose
            );

            res.status(200).json({
                success: true,
                message: 'Money sent successfully',
                data: result
            });
        } catch (error) {
            console.error('Send money failed:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    // Get transaction history
    static async getTransactionHistory(req, res) {
        try {
            const userId = req.user.id;
            const limit = parseInt(req.query.limit) || 50;
            const offset = parseInt(req.query.offset) || 0;

            const transactions = await MobileMoneyService.getTransactionHistory(userId, limit, offset);

            res.status(200).json({
                success: true,
                data: transactions,
                pagination: {
                    limit,
                    offset,
                    total: transactions.length
                }
            });
        } catch (error) {
            console.error('Get transaction history failed:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    // Get wallet balance
    static async getWalletBalance(req, res) {
        try {
            const userId = req.user.id;
            const { currency } = req.params;

            const balance = await MobileMoneyService.getWalletBalance(userId, currency);

            res.status(200).json({
                success: true,
                data: balance
            });
        } catch (error) {
            console.error('Get wallet balance failed:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    // === FX FUNCTIONS ===
    static async exchangeCurrency(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors: errors.array()
                });
            }

            const { amount, from_currency, to_currency } = req.body;
            const userId = req.user.id;

            // Check if user's KYC is verified
            const kyc = await req.user.getKyc();
            if (!kyc || kyc.verificationStatus !== 'verified') {
                return res.status(400).json({
                    success: false,
                    message: 'KYC verification required for currency exchange',
                    kyc_status: kyc?.verificationStatus || 'incomplete'
                });
            }

            // Get idempotency key from header OR auto-generate
            const idempotencyKey = req.headers['idempotency-key'] || `exchange_${userId}_${Date.now()}`;

            const result = await CurrencyExchangeService.processCurrencyExchange(
                userId, amount, from_currency, to_currency, idempotencyKey
            );

            res.status(200).json({
                success: true,
                message: 'Currency exchange completed successfully',
                data: result
            });
        } catch (error) {
            console.error('Currency exchange failed:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    static async getExchangeRates(req, res) {
        try {
            const rates = await CurrencyExchangeService.getCurrentRates();

            res.status(200).json({
                success: true,
                data: rates
            });
        } catch (error) {
            console.error('Get exchange rates failed:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    static async previewExchange(req, res) {
        try {
            const { amount, from_currency, to_currency } = req.query;

            if (!amount || !from_currency || !to_currency) {
                return res.status(400).json({
                    success: false,
                    message: 'amount, from_currency, and to_currency are required'
                });
            }

            const preview = await CurrencyExchangeService.calculateExchange(
                parseFloat(amount), from_currency, to_currency
            );

            if (!preview.success) {
                return res.status(400).json({
                    success: false,
                    message: preview.error
                });
            }

            res.status(200).json({
                success: true,
                data: preview
            });
        } catch (error) {
            console.error('Exchange preview failed:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
}


module.exports = MobileMoneyController;