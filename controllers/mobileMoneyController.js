const MobileMoneyService = require('../services/mobileMoneyService');
const { validationResult } = require('express-validator');

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

            const result = await MobileMoneyService.initiateDeposit(userId, amount, currency);

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
}

module.exports = MobileMoneyController;