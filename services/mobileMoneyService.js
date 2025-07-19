const { Transaction } = require('sequelize');
const {sequelize} = require('../config/config');
const User = require('../models/User');
const Account = require('../models/Account');
const Wallet = require('../models/Wallet');
const TransactionModel = require('../models/Transaction');
const FloatAccount = require('../models/FloatAccount');
const MpesaWebhook = require('../models/MpesaWebhook');
const WalletMovement = require('../models/WalletMovement');
const SystemConfig = require('../models/SystemConfig');

class MobileMoneyService {
    // Generate unique transaction reference
    static generateTransactionRef(prefix = 'TXN') {
        return `${prefix}${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
    }

    // Initiate deposit
    static async initiateDeposit(userId, amount, currency) {
        const transaction = await sequelize.transaction();
        
        try {
            // Get user and verify KYC
            const user = await User.findByPk(userId, { transaction });
            if (!user) {
                throw new Error('User not found');
            }
            if (user.role === 'admin') {
                throw new Error('Admins cannot use mobile money features');
            }

            // Check transaction limits
            const canProcess = await user.canProcessTransaction(amount, 'deposit');
            if (!canProcess) {
                throw new Error('Amount exceeds daily deposit limit');
            }

            // Get user wallet
            const wallet = await Wallet.findOne({
                where: { userid: userId, currency, status: 'active' },
                transaction
            });
            
            if (!wallet) {
                throw new Error('Wallet not found');
            }

            // Get float account
            const floatAccount = await FloatAccount.findOne({
                where: { 
                    currency_code: currency, 
                    status: 'active' 
                },
                transaction
            });

            if (!floatAccount) {
                throw new Error('Float account not found');
            }

            // Generate transaction reference
            const transactionRef = this.generateTransactionRef('DEP');

            // Create transaction record
            const depositTransaction = await TransactionModel.create({
                userid: userId,
                type: 'deposit',
                amount: amount,
                currency: currency,
                referencenumber: transactionRef,
                transaction_ref: transactionRef,
                status: 'pending',
                walletid: wallet.id,
                float_account_id: floatAccount.id,
                initiated_at: new Date(),
                idempotency_key: `deposit_${userId}_${Date.now()}`,
                metadata: {
                    deposit_type: 'c2b',
                    currency: currency
                }
            }, { transaction });

            await transaction.commit();

            return {
                success: true,
                transaction_id: depositTransaction.id,
                transaction_ref: transactionRef,
                paybill_number: floatAccount.paybill_number,
                amount: amount,
                currency: currency,
                reference: transactionRef,
                instructions: `Send ${amount} ${currency} to paybill ${floatAccount.paybill_number} with reference ${transactionRef}`
            };

        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    // Process internal transfer with reserved balance logic
    static async processInternalTransfer(senderId, receiverId, amount, currency, idempotencyKey) {
        const transaction = await sequelize.transaction();
        
        try {
            // Check for existing transaction
            const existingTransaction = await TransactionModel.findOne({
                where: { idempotency_key: idempotencyKey },
                transaction
            });

            if (existingTransaction) {
                return {
                    success: true,
                    transaction: existingTransaction,
                    message: 'Transaction already processed'
                };
            }

            // Get sender and receiver wallets
            const senderWallet = await Wallet.findOne({
                where: { userid: senderId, currency, status: 'active' },
                transaction,
                lock: true // Add row-level locking for concurrency
            });

            const receiverWallet = await Wallet.findOne({
                where: { userid: receiverId, currency, status: 'active' },
                transaction
            });

            if (!senderWallet || !receiverWallet) {
                throw new Error('Wallet not found');
            }

            if (!senderWallet.isActive() || !receiverWallet.isActive()) {
                throw new Error('One or both wallets are not active');
            }

            // Get transfer fee
            const transferFee = await SystemConfig.getValue('transfer_fee_flat', 0.10);
            const totalAmount = parseFloat(amount) + transferFee;

            // Check balance and reserve funds
            if (!senderWallet.canReserve(totalAmount)) {
                throw new Error('Insufficient funds');
            }

            // Reserve funds from sender (STEP 1 - Reserve)
            await senderWallet.reserveFunds(totalAmount, transaction);

            // Generate transaction reference
            const transactionRef = this.generateTransactionRef('TRF');

            // Create transaction record
            const transferTransaction = await TransactionModel.create({
                userid: senderId,
                type: 'transfer',
                amount: amount,
                currency: currency,
                referencenumber: transactionRef,
                transaction_ref: transactionRef,
                status: 'processing',
                relateduserid: receiverId,
                walletid: senderWallet.id,
                fees: transferFee,
                initiated_at: new Date(),
                idempotency_key: idempotencyKey,
                metadata: {
                    transfer_type: 'internal',
                    sender_wallet_id: senderWallet.id,
                    receiver_wallet_id: receiverWallet.id
                }
            }, { transaction });

            // Get balances before changes for wallet movements
            const senderBalanceBefore = senderWallet.balance;
            const receiverBalanceBefore = receiverWallet.balance;

            // Complete the transfer (STEP 2 - Execute)
            await senderWallet.completeFundsDeduction(totalAmount, transaction);
            await receiverWallet.creditFunds(parseFloat(amount), transaction);

            // Update transaction status
            await transferTransaction.update({
                status: 'completed',
                completed_at: new Date(),
                balanceafter: senderWallet.balance - totalAmount
            }, { transaction });

            // Log wallet movements
            await WalletMovement.bulkCreate([
                {
                    transaction_id: transferTransaction.id,
                    wallet_id: senderWallet.id,
                    movement_type: 'debit',
                    amount: totalAmount,
                    balance_before: senderBalanceBefore,
                    balance_after: senderWallet.balance - totalAmount,
                    description: `Transfer to user ${receiverId} (Amount: ${amount}, Fee: ${transferFee})`
                },
                {
                    transaction_id: transferTransaction.id,
                    wallet_id: receiverWallet.id,
                    movement_type: 'credit',
                    amount: parseFloat(amount),
                    balance_before: receiverBalanceBefore,
                    balance_after: receiverWallet.balance + parseFloat(amount),
                    description: `Transfer from user ${senderId}`
                }
            ], { transaction });

            await transaction.commit();

            return {
                success: true,
                transaction_id: transferTransaction.id,
                transaction_ref: transactionRef,
                amount: amount,
                fee: transferFee,
                total_amount: totalAmount
            };

        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    // Process C2B webhook
    static async processC2BWebhook(webhookData) {
        const transaction = await sequelize.transaction();
        
        try {
            // Log webhook receipt
            const webhookRecord = await MpesaWebhook.create({
                webhook_type: 'c2b_confirmation',
                raw_payload: webhookData,
                mpesa_transaction_id: webhookData.TransID,
                status: 'received'
            }, { transaction });

            // Find matching transaction
            const pendingTransaction = await TransactionModel.findOne({
                where: {
                    referencenumber: webhookData.BillRefNumber,
                    status: 'pending'
                },
                transaction
            });

            if (!pendingTransaction) {
                await webhookRecord.update({
                    status: 'failed',
                    processing_error: 'No matching transaction found'
                }, { transaction });
                
                await transaction.commit();
                return { success: false, error: 'No matching transaction' };
            }

            // Verify amount
            if (parseFloat(pendingTransaction.amount) !== parseFloat(webhookData.TransAmount)) {
                await pendingTransaction.update({
                    status: 'failed',
                    failurereason: 'Amount mismatch',
                    failed_at: new Date()
                }, { transaction });
                
                await transaction.commit();
                return { success: false, error: 'Amount mismatch' };
            }

            // Get wallet and float account
            const wallet = await Wallet.findByPk(pendingTransaction.walletid, { transaction });
            const floatAccount = await FloatAccount.findByPk(pendingTransaction.float_account_id, { transaction });

            if (!wallet || !floatAccount) {
                throw new Error('Wallet or Float account not found');
            }

            // Get balance before credit for wallet movement
            const balanceBefore = wallet.balance;

            // Update transaction
            await pendingTransaction.update({
                status: 'completed',
                mpesa_transaction_id: webhookData.TransID,
                mpesa_receipt_number: webhookData.TransID,
                completed_at: new Date(),
                processedat: new Date(),
                balanceafter: wallet.balance + parseFloat(webhookData.TransAmount)
            }, { transaction });

            // Credit wallet using the wallet method
            await wallet.creditFunds(parseFloat(webhookData.TransAmount), transaction);

            // Update float account balance (liquidity management)
            const currentFloatBalance = parseFloat(floatAccount.current_balance) || 0;
            const depositAmount = parseFloat(webhookData.TransAmount);
            const newFloatBalance = currentFloatBalance + depositAmount;

            await floatAccount.update({
              current_balance: newFloatBalance
            }, { transaction });

            // Log wallet movement
            await WalletMovement.create({
                transaction_id: pendingTransaction.id,
                wallet_id: wallet.id,
                movement_type: 'credit',
                amount: parseFloat(webhookData.TransAmount),
                balance_before: balanceBefore,
                balance_after: wallet.balance,
                description: `M-Pesa C2B deposit - ${webhookData.TransID}`
            }, { transaction });

            // Mark webhook as processed
            await webhookRecord.update({
                status: 'processed',
                processed_at: new Date(),
                transaction_id: pendingTransaction.id
            }, { transaction });

            await transaction.commit();

            return {
                success: true,
                transaction_id: pendingTransaction.id,
                mpesa_transaction_id: webhookData.TransID,
                amount: webhookData.TransAmount
            };

        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    // Get transaction history
    static async getTransactionHistory(userId, limit = 50, offset = 0) {
        try {
            const transactions = await TransactionModel.findAll({
                where: {
                    [sequelize.Op.or]: [
                        { userid: userId },
                        { relateduserid: userId }
                    ]
                },
                include: [
                    {
                        model: User,
                        as: 'sender',
                        attributes: ['id', 'firstName', 'surname']
                    },
                    {
                        model: User,
                        as: 'receiver', 
                        attributes: ['id', 'firstName', 'surname']
                    },
                    {
                        model: Wallet,
                        as: 'wallet',
                        attributes: ['currency', 'status']
                    }
                ],
                order: [['createdat', 'DESC']],
                limit,
                offset
            });

            return transactions;
        } catch (error) {
            throw error;
        }
    }

    // Get wallet balance
    static async getWalletBalance(userId, currency) {
        try {
            const wallet = await Wallet.findOne({
                where: { userid: userId, currency, status: 'active' }
            });

            if (!wallet) {
                throw new Error('Wallet not found');
            }

            return {
                balance: wallet.balance,
                available_balance: wallet.available_balance,
                reserved_balance: wallet.reserved_balance,
                currency: wallet.currency,
                status: wallet.status
            };
        } catch (error) {
            throw error;
        }
    }

    // Get all wallet balances for a user
    static async getAllWalletBalances(userId) {
        try {
            const wallets = await Wallet.findAll({
                where: { userid: userId, status: 'active' },
                attributes: ['currency', 'balance', 'available_balance', 'reserved_balance', 'status', 'last_transaction_at']
            });

            return wallets.map(wallet => ({
                currency: wallet.currency,
                balance: wallet.balance,
                available_balance: wallet.available_balance,
                reserved_balance: wallet.reserved_balance,
                status: wallet.status,
                last_transaction_at: wallet.last_transaction_at
            }));
        } catch (error) {
            throw error;
        }
    }

    // Search accounts for wallet-to-wallet transfers 
    static async searchAccounts(searchTerm, currentUserId) {
        try {
            const accounts = await Account.findAll({
                where: {
                    [sequelize.Op.and]: [
                        {
                            userId: {
                                [sequelize.Op.ne]: currentUserId // Exclude current user
                            }
                        },
                        {
                            [sequelize.Op.or]: [
                                { accountNumber: { [sequelize.Op.iLike]: `%${searchTerm}%` } }
                            ]
                        },
                        { status: 'active' }
                    ]
                },
                include: [
                    {
                        model: User,
                        attributes: ['firstName', 'surname', 'phoneNumber']
                    }
                ],
                attributes: ['id', 'userId', 'accountNumber', 'accountType', 'currency'],
                limit: 10
            });

            return accounts.map(account => ({
                userId: account.userId,
                accountNumber: account.accountNumber,
                accountType: account.accountType,
                currency: account.currency,
                user: {
                    firstName: account.User.firstName,
                    surname: account.User.surname,
                    phoneNumber: account.User.phoneNumber
                }
            }));
        } catch (error) {
            throw error;
        }
    }
}

module.exports = MobileMoneyService;