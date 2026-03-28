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

            const kyc = await req.user.getKyc();
            if (!kyc || kyc.verificationStatus !== 'verified') {
                return res.status(400).json({
                    success: false,
                    message: 'KYC verification required before making deposits',
                    kyc_status: kyc?.verificationStatus || 'incomplete'
                });
            }

            const idempotencyKey = req.headers['idempotency-key'] || null;

            const result = await MobileMoneyService.initiateDeposit(userId, amount, currency, idempotencyKey);

            return res.status(200).json({
                success: true,
                message: `Deposit of ${amount} ${currency} initiated. Check your phone for the M-Pesa prompt.`,
                data: result
            });

        } catch (error) {
            console.error('Deposit initiation failed:', error);
            return res.status(500).json({ success: false, message: error.message });
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

            if (parseInt(senderId) === parseInt(receiver_id)) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot transfer to yourself'
                });
            }

            const idempotencyKey = req.headers['idempotency-key'] || null;

            const result = await MobileMoneyService.processInternalTransfer(
                senderId, receiver_id, amount, currency, idempotencyKey
            );

            return res.status(200).json({
                success: true,
                message: result.was_duplicate
                    ? 'Duplicate request — original transfer returned'
                    : `Transfer of ${amount} ${currency} completed successfully`,
                data: result
            });

        } catch (error) {
            console.error('Internal transfer failed:', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Initiate withdrawal
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

            const kyc = await req.user.getKyc();
            if (!kyc || kyc.verificationStatus !== 'verified') {
                return res.status(400).json({
                    success: false,
                    message: 'KYC verification required before making withdrawals',
                    kyc_status: kyc?.verificationStatus || 'incomplete'
                });
            }

            const idempotencyKey = req.headers['idempotency-key'] || null;

            const result = await MobileMoneyService.initiateWithdrawal(
                userId, amount, currency, phone_number, idempotencyKey
            );

            return res.status(200).json({
                success: true,
                message: `Withdrawal of ${amount} ${currency} to ${phone_number} is being processed. Awaiting Vodacom confirmation.`,
                data: result
            });

        } catch (error) {
            console.error('Withdrawal initiation failed:', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Send money to anyone
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

            const kyc = await req.user.getKyc();
            if (!kyc || kyc.verificationStatus !== 'verified') {
                return res.status(400).json({
                    success: false,
                    message: 'KYC verification required before sending money',
                    kyc_status: kyc?.verificationStatus || 'incomplete'
                });
            }

            const idempotencyKey = req.headers['idempotency-key'] || null;

            const result = await MobileMoneyService.sendMoneyToAnyone(
                userId, amount, currency, phone_number,
                idempotencyKey, recipient_name, purpose
            );

            // Message reflects reality: initiated and processing, NOT completed yet.
            // Completion happens when Vodacom posts the B2C callback.
            return res.status(200).json({
                success: true,
                message: `Sending ${amount} ${currency} to ${recipient_name || phone_number} — awaiting Vodacom confirmation.`,
                data: result
            });

        } catch (error) {
            console.error('Send money failed:', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Get transaction history
    static async getTransactionHistory(req, res) {
        try {
            const userId = req.user.id;
            const limit  = parseInt(req.query.limit)  || 50;
            const offset = parseInt(req.query.offset) || 0;

            const transactions = await MobileMoneyService.getTransactionHistory(userId, limit, offset);

            return res.status(200).json({
                success: true,
                data: transactions,
                pagination: { limit, offset, total: transactions.length }
            });

        } catch (error) {
            console.error('Get transaction history failed:', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Get single wallet balance
    static async getWalletBalance(req, res) {
        try {
            const userId   = req.user.id;
            const { currency } = req.params;

            const balance = await MobileMoneyService.getWalletBalance(userId, currency);

            return res.status(200).json({ success: true, data: balance });

        } catch (error) {
            console.error('Get wallet balance failed:', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // ── FX ────────────────────────────────────────────────────────────────────

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

            const kyc = await req.user.getKyc();
            if (!kyc || kyc.verificationStatus !== 'verified') {
                return res.status(400).json({
                    success: false,
                    message: 'KYC verification required for currency exchange',
                    kyc_status: kyc?.verificationStatus || 'incomplete'
                });
            }

            const idempotencyKey = req.headers['idempotency-key'] || null;

            const result = await CurrencyExchangeService.processCurrencyExchange(
                userId, amount, from_currency, to_currency, idempotencyKey
            );

            return res.status(200).json({
                success: true,
                message: `Exchanged ${amount} ${from_currency} to ${to_currency} successfully`,
                data: result
            });

        } catch (error) {
            console.error('Currency exchange failed:', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    static async getExchangeRates(req, res) {
        try {
            const rates = await CurrencyExchangeService.getCurrentRates();
            return res.status(200).json({ success: true, data: rates });
        } catch (error) {
            console.error('Get exchange rates failed:', error);
            return res.status(500).json({ success: false, message: error.message });
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
                return res.status(400).json({ success: false, message: preview.error });
            }

            return res.status(200).json({ success: true, data: preview });

        } catch (error) {
            console.error('Exchange preview failed:', error);
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

module.exports = MobileMoneyController;