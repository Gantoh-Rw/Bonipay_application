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
    static async initiateDeposit(userId, amount, currency, idempotencyKey = null) {
        const transaction = await sequelize.transaction();
        
        try {
            // Auto-generate idempotency key if not provided
            if (!idempotencyKey) {
                idempotencyKey = this.generateIdempotencyKey('deposit', userId);
                console.log('Auto-generated deposit idempotency key:', idempotencyKey);
            }
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
                idempotency_key: idempotencyKey,
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
                idempotency_key: idempotencyKey,
                instructions: `Send ${amount} ${currency} to paybill ${floatAccount.paybill_number} with reference ${transactionRef}`
            };

        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    // Process internal transfer with reserved balance logic
     static async processInternalTransfer(senderId, receiverId, amount, currency, idempotencyKey = null) {
        const transaction = await sequelize.transaction();
        
        try {
            // Auto-generate idempotency key if not provided
            if (!idempotencyKey) {
                idempotencyKey = this.generateIdempotencyKey('transfer', senderId, receiverId);
                console.log('🔄 Service auto-generated idempotency key:', idempotencyKey);
            }

            // Check for existing transaction with this idempotency key
            const existingTransaction = await TransactionModel.findOne({
                where: { idempotency_key: idempotencyKey },
                transaction
            });

            if (existingTransaction) {
                console.log('♻️ Found existing transaction with this idempotency key');
                return {
                    success: true,
                    transaction: existingTransaction,
                    message: 'Transaction already processed',
                    was_duplicate: true
                };
            }

            console.log('✨ Processing new transfer with idempotency key:', idempotencyKey);

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

            if (senderWallet.status !== 'active' || receiverWallet.status !== 'active') {
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
                idempotency_key: idempotencyKey, // Use the provided or generated key
                metadata: {
                    transfer_type: 'internal',
                    sender_wallet_id: senderWallet.id,
                    receiver_wallet_id: receiverWallet.id,
                    auto_generated_key: !idempotencyKey // Track if key was auto-generated
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
                balanceafter: parseFloat(senderWallet.balance) - totalAmount
            }, { transaction });

            // Log wallet movements
            await WalletMovement.bulkCreate([
                {
                    transaction_id: transferTransaction.id,
                    wallet_id: senderWallet.id,
                    movement_type: 'debit',
                    amount: totalAmount,
                    balance_before: parseFloat(senderBalanceBefore),
                    balance_after: parseFloat(senderWallet.balance) - totalAmount,
                    description: `Transfer to user ${receiverId} (Amount: ${amount}, Fee: ${transferFee})`
                },
                {
                    transaction_id: transferTransaction.id,
                    wallet_id: receiverWallet.id,
                    movement_type: 'credit',
                    amount: parseFloat(amount),
                    balance_before: parseFloat(receiverBalanceBefore),
                    balance_after: parseFloat(receiverWallet.balance),
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
                total_amount: totalAmount,
                idempotency_key: idempotencyKey,
                was_duplicate: false
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

    // Initiate withdrawal (wallet to mobile)
static async initiateWithdrawal(userId, amount, currency, phoneNumber, idempotencyKey) {
    const transaction = await sequelize.transaction();
    
    try {
        // Get user and verify
        const user = await User.findByPk(userId, { transaction });
        if (!user) {
            throw new Error('User not found');
        }
        if (user.role === 'admin') {
            throw new Error('Admins cannot use mobile money features');
        }

        // Check transaction limits
        const canProcess = await user.canProcessTransaction(amount, 'withdrawal');
        if (!canProcess) {
            throw new Error('Amount exceeds daily withdrawal limit');
        }

        // Get user wallet
        const wallet = await Wallet.findOne({
            where: { userid: userId, currency, status: 'active' },
            transaction,
            lock: true
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

        // Get withdrawal fee
        const withdrawalFeeFlat = await SystemConfig.getValue('withdrawal_fee_flat', 0.50);
        const withdrawalFeePercentage = await SystemConfig.getValue('withdrawal_fee_percentage', 1.0);
        
        const percentageFee = (parseFloat(amount) * withdrawalFeePercentage) / 100;
        const totalFee = withdrawalFeeFlat + percentageFee;
        const totalAmount = parseFloat(amount) + totalFee;

        // Check if wallet has sufficient funds and reserve them
        if (!wallet.canReserve(totalAmount)) {
            throw new Error('Insufficient funds for withdrawal');
        }

        // Reserve funds (amount + fees)
        await wallet.reserveFunds(totalAmount, transaction);

        // Generate transaction reference
        const transactionRef = this.generateTransactionRef('WTH');

        // Create withdrawal transaction record
        const withdrawalTransaction = await TransactionModel.create({
            userid: userId,
            type: 'withdrawal',
            amount: amount,
            currency: currency,
            referencenumber: transactionRef,
            transaction_ref: transactionRef,
            status: 'processing', // Will change to completed after M-Pesa processes
            walletid: wallet.id,
            float_account_id: floatAccount.id,
            fees: totalFee,
            initiated_at: new Date(),
            idempotency_key: idempotencyKey,
            metadata: {
                withdrawal_type: 'b2c',
                currency: currency,
                phone_number: phoneNumber,
                fee_breakdown: {
                    flat_fee: withdrawalFeeFlat,
                    percentage_fee: percentageFee,
                    total_fee: totalFee
                }
            }
        }, { transaction });

        // In real implementation, here you would call M-Pesa B2C API
        // For simulation, we'll return success immediately
        
        await transaction.commit();

        return {
            success: true,
            transaction_id: withdrawalTransaction.id,
            transaction_ref: transactionRef,
            amount: amount,
            fees: totalFee,
            total_amount: totalAmount,
            currency: currency,
            phone_number: phoneNumber,
            status: 'processing',
            instructions: `Withdrawal of ${amount} ${currency} to ${phoneNumber} is being processed. You will receive an SMS confirmation shortly.`,
            simulation_note: 'This is a simulated withdrawal. In production, M-Pesa B2C API would be called here.'
        };

    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

// Simulate B2C completion (like we did for C2B webhooks)
static async processB2CCompletion(withdrawalData) {
    const transaction = await sequelize.transaction();
    
    try {
        // Find the pending transaction
        const pendingTransaction = await TransactionModel.findOne({
            where: {
                referencenumber: withdrawalData.transaction_ref,
                status: 'processing'
            },
            transaction
        });

        if (!pendingTransaction) {
            throw new Error('No matching transaction found');
        }

        // Get wallet and float account
        const wallet = await Wallet.findByPk(pendingTransaction.walletid, { transaction });
        const floatAccount = await FloatAccount.findByPk(pendingTransaction.float_account_id, { transaction });

        if (!wallet || !floatAccount) {
            throw new Error('Wallet or Float account not found');
        }

        const totalAmount = parseFloat(pendingTransaction.amount) + parseFloat(pendingTransaction.fees);

        // Complete the transaction - deduct from reserved balance
        await wallet.completeFundsDeduction(totalAmount, transaction);

        // Update float account (decrease balance - money going out)
        const currentFloatBalance = parseFloat(floatAccount.current_balance) || 0;
        const newFloatBalance = currentFloatBalance - parseFloat(pendingTransaction.amount);

        await floatAccount.update({
            current_balance: newFloatBalance
        }, { transaction });

        // Update transaction status
        await pendingTransaction.update({
            status: 'completed',
            completed_at: new Date(),
            processedat: new Date(),
            balanceafter: wallet.balance,
            external_ref: withdrawalData.mpesa_transaction_id || `SIM${Date.now()}`,
            metadata: {
                ...pendingTransaction.metadata,
                completion_time: new Date(),
                simulated: true,
                mpesa_transaction_id: withdrawalData.mpesa_transaction_id
            }
        }, { transaction });

        // Log wallet movement
        const recipientInfo = pendingTransaction.metadata?.recipient_phone || 'Unknown recipient';
        const transactionType = pendingTransaction.metadata?.transaction_type || 'withdrawal';
        
        await WalletMovement.create({
            transaction_id: pendingTransaction.id,
            wallet_id: wallet.id,
            movement_type: 'debit',
            amount: totalAmount,
            balance_before: parseFloat(wallet.balance) + totalAmount,
            balance_after: wallet.balance,
            description: transactionType === 'send_money' 
                ? `Money sent to ${recipientInfo} - ${withdrawalData.mpesa_transaction_id || 'SIMULATED'}`
                : `M-Pesa withdrawal to ${recipientInfo} - ${withdrawalData.mpesa_transaction_id || 'SIMULATED'}`
        }, { transaction });

        await transaction.commit();

        return {
            success: true,
            transaction_id: pendingTransaction.id,
            mpesa_transaction_id: withdrawalData.mpesa_transaction_id || `SIM${Date.now()}`,
            amount: pendingTransaction.amount,
            recipient_phone: pendingTransaction.metadata?.recipient_phone,
            transaction_type: pendingTransaction.metadata?.transaction_type || 'withdrawal'
        };

    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}
    static async sendMoneyToAnyone(userId, amount, currency, phoneNumber, idempotencyKey, recipientName = null, purpose = null) {
    const transaction = await sequelize.transaction();
    
    try {
        // Get user and verify
        const user = await User.findByPk(userId, { transaction });
        if (!user) {
            throw new Error('User not found');
        }
        if (user.role === 'admin') {
            throw new Error('Admins cannot use mobile money features');
        }

        // Check transaction limits
        const canProcess = await user.canProcessTransaction(amount, 'withdrawal');
        if (!canProcess) {
            throw new Error('Amount exceeds daily sending limit');
        }

        // Get user wallet
        const wallet = await Wallet.findOne({
            where: { userid: userId, currency, status: 'active' },
            transaction,
            lock: true
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

        // Calculate fees for sending money
        const sendingFeeFlat = await SystemConfig.getValue('transfer_fee_flat', 0.50);
        const sendingFeePercentage = await SystemConfig.getValue('withdrawal_fee_percentage', 1.5);
        
        const percentageFee = (parseFloat(amount) * sendingFeePercentage) / 100;
        const totalFee = sendingFeeFlat + percentageFee;
        const totalAmount = parseFloat(amount) + totalFee;

        // Check if wallet has sufficient funds and reserve them
        if (!wallet.canReserve(totalAmount)) {
            throw new Error('Insufficient funds to send money');
        }

        // Reserve funds (amount + fees)
        await wallet.reserveFunds(totalAmount, transaction);

        // Generate transaction reference
        const transactionRef = this.generateTransactionRef('SEND');

        // Create send money transaction record
        const sendTransaction = await TransactionModel.create({
            userid: userId,
            type: 'withdrawal', // Using withdrawal type for sending money
            amount: amount,
            currency: currency,
            referencenumber: transactionRef,
            transaction_ref: transactionRef,
            status: 'processing',
            walletid: wallet.id,
            float_account_id: floatAccount.id,
            fees: totalFee,
            initiated_at: new Date(),
            idempotency_key: idempotencyKey,
            description: purpose || `Money sent to ${phoneNumber}`,
            metadata: {
                transaction_type: 'send_money',
                recipient_phone: phoneNumber,
                recipient_name: recipientName,
                purpose: purpose,
                currency: currency,
                fee_breakdown: {
                    flat_fee: sendingFeeFlat,
                    percentage_fee: percentageFee,
                    total_fee: totalFee
                },
                sender_info: {
                    name: `${user.firstName} ${user.surname}`,
                    phone: user.phoneNumber
                }
            }
        }, { transaction });

        await transaction.commit();

        return {
            success: true,
            transaction_id: sendTransaction.id,
            transaction_ref: transactionRef,
            amount: amount,
            fees: totalFee,
            total_amount: totalAmount,
            currency: currency,
            recipient: {
                phone_number: phoneNumber,
                name: recipientName || 'Unknown'
            },
            status: 'processing',
            purpose: purpose,
            instructions: `Sending ${amount} ${currency} to ${phoneNumber}${recipientName ? ` (${recipientName})` : ''}. The recipient will receive an SMS notification.`,
            simulation_note: 'In production, this would trigger M-Pesa B2C API to send money directly to the recipient\'s mobile money account.'
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