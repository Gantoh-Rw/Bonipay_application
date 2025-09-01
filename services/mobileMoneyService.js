const { Transaction } = require('sequelize');
const { Op } = require('sequelize');
const {sequelize} = require('../config/config');
const User = require('../models/User');
const Account = require('../models/Account');
const Wallet = require('../models/Wallet');
const TransactionModel = require('../models/Transaction');
const FloatAccount = require('../models/FloatAccount');
const MpesaWebhook = require('../models/MpesaWebhook');
const WalletMovement = require('../models/WalletMovement');
const SystemConfig = require('../models/SystemConfig');
const FlutterwaveService = require('./FlutterwaveService');

class MobileMoneyService {
    // Generate unique transaction reference
    static generateTransactionRef(prefix = 'TXN') {
        return `${prefix}${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
    }
    static generateIdempotencyKey(type, userId, receiverId = null) {
    const base = `${type}_${userId}${receiverId ? `_${receiverId}` : ''}_${Date.now()}`;
    return base;
}
    
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
                       deposit_type: 'flutterwave_collection',
                       currency: currency,
                       user_phone: user.phoneNumber
                      }
        }, { transaction });

        await transaction.commit();

        try {
    const flutterwave = new FlutterwaveService();
    
    const collectionResult = await flutterwave.initiateMobileMoneyCollection(
        user.phoneNumber,
        amount,
        currency,
        transactionRef,
        `Deposit to ${user.firstName} ${user.surname} ${currency} wallet`,
        'vodacom'
    );

    if (collectionResult.success) {
        // Update transaction with Flutterwave details
        await depositTransaction.update({
            external_ref: collectionResult.flw_ref,
            metadata: {
                ...depositTransaction.metadata,
                deposit_type: 'flutterwave_collection',
                flutterwave_transaction_id: collectionResult.transactionID,
                flw_ref: collectionResult.flw_ref,
                payment_link: collectionResult.payment_link,
                collection_initiated: true
            }
        });

        return {
            success: true,
            transaction_id: depositTransaction.id,
            transaction_ref: transactionRef,
            amount: amount,
            currency: currency,
            flw_ref: collectionResult.flw_ref,
            payment_link: collectionResult.payment_link,
            instructions: `Please complete payment using the provided link or check your phone ${user.phoneNumber} for mobile money prompt to complete the deposit of ${amount} ${currency}`,
            idempotency_key: idempotencyKey
        };
    } else {
        throw new Error(`Collection initiation failed: ${collectionResult.responseDescription}`);
    }

    } catch (flutterwaveError) {
    console.error('Flutterwave Collection failed:', flutterwaveError.message);
    
    // Update transaction as failed
    await depositTransaction.update({
        status: 'failed',
        failurereason: `Collection failed: ${flutterwaveError.message}`,
        failed_at: new Date()
    });

    throw new Error(`Deposit initiation failed: ${flutterwaveError.message}`);
   }

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
static async processFlutterwaveCallback(callbackData) {
    const transaction = await sequelize.transaction();
    
    try {
        const webhookRecord = await WebhookLog.create({
              webhook_type: 'flutterwave_callback',
              webhook_source: 'flutterwave',
              event_type: callbackData.event || 'charge.completed',
              raw_payload: callbackData,
              flutterwave_transaction_id: callbackData.id,
              status: 'received'
            }, { transaction });

        // Find matching transaction by tx_ref
        const pendingTransaction = await TransactionModel.findOne({
            where: {
                transaction_ref: callbackData.tx_ref,
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

        if (callbackData.status === 'successful') {
            // Payment successful - process the deposit
            const paidAmount = parseFloat(callbackData.amount);

            // Verify amount matches
            if (paidAmount !== parseFloat(pendingTransaction.amount)) {
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

            // Update transaction as completed
            await pendingTransaction.update({
                status: 'completed',
                external_ref: callbackData.flw_ref,
                completed_at: new Date(),
                processedat: new Date(),
                balanceafter: parseFloat(wallet.balance) + paidAmount,
                metadata: {
                    ...pendingTransaction.metadata,
                    flutterwave_transaction_id: callbackData.id,
                    payment_completed: true,
                    processor_response: callbackData.processor_response
                }
            }, { transaction });

            // Credit wallet
            await wallet.creditFunds(paidAmount, transaction);

            // Update float account balance
            const currentFloatBalance = parseFloat(floatAccount.current_balance) || 0;
            const newFloatBalance = currentFloatBalance + paidAmount;

            await floatAccount.update({
                current_balance: newFloatBalance
            }, { transaction });

            // Log wallet movement
            await WalletMovement.create({
                transaction_id: pendingTransaction.id,
                wallet_id: wallet.id,
                movement_type: 'credit',
                amount: paidAmount,
                balance_before: balanceBefore,
                balance_after: wallet.balance,
                description: `Flutterwave ${pendingTransaction.currency} deposit - ${callbackData.id}`
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
                flutterwave_transaction_id: callbackData.id,
                amount: paidAmount
            };

        } else {
            // Payment failed
            const errorMessage = callbackData.processor_response || 'Payment failed';
            
            await pendingTransaction.update({
                status: 'failed',
                failurereason: errorMessage,
                failed_at: new Date()
            }, { transaction });

            await webhookRecord.update({
                status: 'processed',
                processed_at: new Date(),
                transaction_id: pendingTransaction.id,
                processing_error: errorMessage
            }, { transaction });

            await transaction.commit();

            return {
                success: false,
                error: errorMessage,
                transaction_id: pendingTransaction.id
            };
        }

    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

static async processFlutterwaveTransferCallback(callbackData) {
    const transaction = await sequelize.transaction();
    
    try {
        // Find matching transaction by reference
        const pendingTransaction = await TransactionModel.findOne({
            where: {
                transaction_ref: callbackData.reference,
                status: 'processing'
            },
            transaction
        });
        if (!pendingTransaction) {
            await transaction.commit();
            return { success: false, error: 'No matching transaction' };
        }

        if (callbackData.status === 'SUCCESSFUL') {
            // Transfer successful
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
                metadata: {
                    ...pendingTransaction.metadata,
                    flutterwave_transaction_id: callbackData.id,
                    payment_completed: true
                }
            }, { transaction });

            // Log wallet movement
            const recipientInfo = pendingTransaction.metadata?.recipient_phone || pendingTransaction.metadata?.phone_number || 'Unknown recipient';
            const transactionType = pendingTransaction.metadata?.transaction_type || 'withdrawal';
            
            await WalletMovement.create({
                transaction_id: pendingTransaction.id,
                wallet_id: wallet.id,
                movement_type: 'debit',
                amount: totalAmount,
                balance_before: parseFloat(wallet.balance) + totalAmount,
                balance_after: wallet.balance,
                description: transactionType === 'send_money' 
                    ? `Money sent to ${recipientInfo} via Flutterwave - ${callbackData.id}`
                    : `Flutterwave ${pendingTransaction.currency} withdrawal to ${recipientInfo} - ${callbackData.id}`
            }, { transaction });

            await transaction.commit();

            return {
                success: true,
                transaction_id: pendingTransaction.id,
                flutterwave_transaction_id: callbackData.id,
                amount: pendingTransaction.amount
            };

        } else {
            // Transfer failed - unreserve funds
            const wallet = await Wallet.findByPk(pendingTransaction.walletid, { transaction });
            if (wallet) {
                const totalAmount = parseFloat(pendingTransaction.amount) + parseFloat(pendingTransaction.fees);
                await wallet.releaseFunds(totalAmount, transaction);
            }

            const errorMessage = callbackData.complete_message || 'Transfer failed';
            
            await pendingTransaction.update({
                status: 'failed',
                failurereason: errorMessage,
                failed_at: new Date(),
                metadata: {
                    ...pendingTransaction.metadata,
                    failure_reason: errorMessage,
                    response_code: callbackData.status
                }
            }, { transaction });

            await transaction.commit();

            return {
                success: false,
                error: errorMessage,
                transaction_id: pendingTransaction.id
            };
        }

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
            status: 'processing',
            walletid: wallet.id,
            float_account_id: floatAccount.id,
            fees: totalFee,
            initiated_at: new Date(),
            idempotency_key: idempotencyKey,
            metadata: {
                       withdrawal_type: 'flutterwave_transfer', 
                       currency: currency,
                       phone_number: phoneNumber,
            fee_breakdown: {
                            flat_fee: withdrawalFeeFlat,
                            percentage_fee: percentageFee,
                            total_fee: totalFee
                           }
}
        }, { transaction });

        await transaction.commit();

        // === FLUTTERWAVE TRANSFER API CALL ===
try {
    const flutterwave = new FlutterwaveService();
    
    const transferResult = await flutterwave.initiateTransfer(
        phoneNumber,
        amount,
        currency,
        transactionRef,
        `Withdrawal for ${user.firstName} ${user.surname}`,
        `Withdrawal ${amount} ${currency}`
    );

    if (transferResult.success) {
        // Update transaction with Flutterwave details
        await withdrawalTransaction.update({
            external_ref: transferResult.reference,
            metadata: {
                ...withdrawalTransaction.metadata,
                withdrawal_type: 'flutterwave_transfer',
                flutterwave_transfer_id: transferResult.transferID,
                transfer_reference: transferResult.reference,
                transfer_initiated: true
            }
        });

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
            transfer_reference: transferResult.reference,
            instructions: `Withdrawal of ${amount} ${currency} to ${phoneNumber} is being processed. You will receive money via mobile money shortly.`
        };
    } else {
        throw new Error(`Transfer initiation failed: ${transferResult.responseDescription}`);
    }

} catch (flutterwaveError) {
    console.error('Flutterwave Transfer failed:', flutterwaveError.message);
    
    // Unreserve funds since withdrawal failed
    await wallet.releaseFunds(totalAmount);
    
    // Update transaction as failed
    await withdrawalTransaction.update({
        status: 'failed',
        failurereason: `Transfer failed: ${flutterwaveError.message}`,
        failed_at: new Date()
    });

    throw new Error(`Withdrawal initiation failed: ${flutterwaveError.message}`);
   }

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

        // === FLUTTERWAVE TRANSFER API CALL ===
try {
    const flutterwave = new FlutterwaveService();
    
    const transferResult = await flutterwave.initiateTransfer(
        phoneNumber,
        amount,
        currency,
        transactionRef,
        `Money from ${user.firstName} ${user.surname}${purpose ? ` - ${purpose}` : ''}`,
        `Send money ${amount} ${currency}`
    );

    if (transferResult.success) {
        // Update transaction with Flutterwave details
        await sendTransaction.update({
            external_ref: transferResult.reference,
            metadata: {
                ...sendTransaction.metadata,
                flutterwave_transfer_id: transferResult.transferID,
                transfer_reference: transferResult.reference,
                transfer_initiated: true
            }
        });

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
            transfer_reference: transferResult.reference,
            instructions: `Sending ${amount} ${currency} to ${phoneNumber}${recipientName ? ` (${recipientName})` : ''}. The recipient will receive money via mobile money shortly.`
        };
    } else {
        throw new Error(`Transfer initiation failed: ${transferResult.responseDescription}`);
    }

} catch (flutterwaveError) {
    console.error('Flutterwave Transfer failed:', flutterwaveError.message);
    
    // Unreserve funds since send money failed
    await wallet.releaseFunds(totalAmount);
    
    // Update transaction as failed
    await sendTransaction.update({
        status: 'failed',
        failurereason: `Transfer failed: ${flutterwaveError.message}`,
        failed_at: new Date()
    });

    throw new Error(`Send money failed: ${flutterwaveError.message}`);
      }

    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

    // Get transaction history with user names for UI display
static async getTransactionHistory(userId, limit = 50, offset = 0) {
    try {
        const transactions = await TransactionModel.findAll({
    where: {
        [Op.or]: [
            { userid: userId },
            { relateduserid: userId }
        ]
    }, 
    order: [['createdat', 'DESC']],
    limit,
    offset
    });

        // Enrich transactions with user names for UI display
        const enrichedTransactions = await Promise.all(
            transactions.map(async (transaction) => {
                const txData = transaction.toJSON();
                
                // Determine user's role in this transaction
                const isUserSender = txData.userid === userId;
                const isUserReceiver = txData.relateduserid === userId;
                
                let displayData = {
                    id: txData.id,
                    type: txData.type,
                    amount: parseFloat(txData.amount),
                    currency: txData.currency,
                    status: txData.status,
                    date: txData.createdat || txData.initiated_at,
                    transaction_ref: txData.transaction_ref || txData.referencenumber,
                    fees: parseFloat(txData.fees || 0),
                    user_role: isUserSender ? 'sender' : 'receiver',
                    display_name: null,
                    profile_picture: null, // TODO: Implement when DP is ready
                    description: txData.description || null,
                    transaction_direction: null,
                    other_party: null,
                    metadata: txData.metadata
                };
                
                // Handle different transaction types
                switch (txData.type) {
                    case 'deposit':
                         displayData.display_name = 'Flutterwave Mobile Money';
                         displayData.description = displayData.description || 'Money deposited from mobile money';
                         displayData.transaction_direction = 'received';
                         displayData.profile_picture = '/images/flutterwave-logo.png';
                    break;
                        
                    case 'withdrawal':
    // Check if it's a regular withdrawal or send money
    const isMoneyTransfer = txData.metadata && txData.metadata.transaction_type === 'send_money';
    
                if (isMoneyTransfer) {
                     const recipientPhone = txData.metadata.recipient_phone || txData.metadata.phone_number;
                     const recipientName = txData.metadata.recipient_name;
                     displayData.display_name = recipientName || recipientPhone || 'Unknown Recipient';
                     displayData.description = displayData.description || `Money sent to ${displayData.display_name}`;
                     displayData.transaction_direction = 'sent';
                } else {
                      const phoneNumber = txData.metadata?.phone_number;
                      displayData.display_name = phoneNumber || 'Mobile Money';
                      displayData.description = displayData.description || `Withdrawal to ${phoneNumber || 'mobile money'}`;
                      displayData.transaction_direction = 'sent';
                      displayData.profile_picture = '/images/flutterwave-logo.png';
                      }
                    break;
                        
                    case 'transfer':
                        // Internal wallet-to-wallet transfer
                        if (isUserSender) {
                            // User sent money - get receiver's name
                            const receiver = await User.findByPk(txData.relateduserid, {
                                attributes: ['id', 'firstName', 'surname', 'phoneNumber']
                            });
                            if (receiver) {
                                displayData.display_name = `${receiver.firstName} ${receiver.surname}`;
                                displayData.other_party = {
                                    id: receiver.id,
                                    name: displayData.display_name,
                                    phone: receiver.phoneNumber
                                };
                            } else {
                                displayData.display_name = 'Unknown User';
                            }
                            displayData.description = displayData.description || `Transfer to ${displayData.display_name}`;
                            displayData.transaction_direction = 'sent';
                        } else {
                            // User received money - get sender's name
                            const sender = await User.findByPk(txData.userid, {
                                attributes: ['id', 'firstName', 'surname', 'phoneNumber']
                            });
                            if (sender) {
                                displayData.display_name = `${sender.firstName} ${sender.surname}`;
                                displayData.other_party = {
                                    id: sender.id,
                                    name: displayData.display_name,
                                    phone: sender.phoneNumber
                                };
                            } else {
                                displayData.display_name = 'Unknown User';
                            }
                            displayData.description = displayData.description || `Transfer from ${displayData.display_name}`;
                            displayData.transaction_direction = 'received';
                        }
                        break;
                        
                    case 'fx_conversion':
                        displayData.display_name = 'Currency Exchange';
                        displayData.description = displayData.description || `${txData.fromcurrency} to ${txData.tocurrency} conversion`;
                        displayData.transaction_direction = 'exchange';
                        displayData.profile_picture = '/images/exchange-icon.png';
                        break;
                        
                    case 'school_payment':
                        displayData.display_name = 'School Payment';
                        displayData.description = displayData.description || 'School fees payment';
                        displayData.transaction_direction = 'sent';
                        displayData.profile_picture = '/images/school-icon.png';
                        break;
                        
                    default:
                        displayData.display_name = 'System';
                        displayData.description = displayData.description || `${txData.type} transaction`;
                        displayData.transaction_direction = isUserSender ? 'sent' : 'received';
                }
                
                return displayData;
            })
        );

        return enrichedTransactions;
    } catch (error) {
        console.error('Transaction history error:', error);
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