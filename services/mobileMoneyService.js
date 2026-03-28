const { Op } = require('sequelize');
const { sequelize } = require('../config/config');
const User = require('../models/User');
const Account = require('../models/Account');
const Wallet = require('../models/Wallet');
const TransactionModel = require('../models/Transaction');
const FloatAccount = require('../models/FloatAccount');
const MpesaWebhook = require('../models/MpesaWebhook');
const WalletMovement = require('../models/WalletMovement');
const SystemConfig = require('../models/SystemConfig');
const VodacomMpesaService = require('./VodacomMpesaService');

class MobileMoneyService {

    // ─────────────────────────────────────────────
    // UTILITIES
    // ─────────────────────────────────────────────

    static generateTransactionRef(prefix = 'TXN') {
        return `${prefix}${Date.now()}${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    }

    static generateIdempotencyKey(type, userId, receiverId = null) {
        const base = `${type}_${userId}${receiverId ? `_${receiverId}` : ''}_${Date.now()}`;
        return base;
    }

    // ─────────────────────────────────────────────
    // DEPOSIT  (C2B — Customer pays into wallet)
    // ─────────────────────────────────────────────

    static async initiateDeposit(userId, amount, currency, idempotencyKey = null) {
        const dbTx = await sequelize.transaction();

        try {
            if (!idempotencyKey) {
                idempotencyKey = this.generateIdempotencyKey('deposit', userId);
            }

            // ── User
            const user = await User.findByPk(userId, { transaction: dbTx });
            if (!user) throw new Error('User not found');
            if (user.role === 'admin') throw new Error('Admins cannot use mobile money features');

            const canProcess = await user.canProcessTransaction(amount, 'deposit', currency);
            if (!canProcess) throw new Error('Amount exceeds daily deposit limit');

            // ── Wallet
            const wallet = await Wallet.findOne({
                where: { userid: userId, currency, status: 'active' },
                transaction: dbTx
            });
            if (!wallet) throw new Error(`No active ${currency} wallet found`);

            // ── Float account
            const floatAccount = await FloatAccount.findOne({
                where: { currency_code: currency, status: 'active' },
                transaction: dbTx
            });
            if (!floatAccount) throw new Error(`No active float account for ${currency}`);

            // ── Create pending transaction record
            const transactionRef = this.generateTransactionRef('DEP');

            const depositTx = await TransactionModel.create({
                userid:           userId,
                type:             'deposit',
                amount:           amount,
                currency:         currency,
                referencenumber:  transactionRef,
                transaction_ref:  transactionRef,
                status:           'pending',
                walletid:         wallet.id,
                float_account_id: floatAccount.id,
                initiated_at:     new Date(),
                idempotency_key:  idempotencyKey,
                metadata: {
                    deposit_type: 'vodacom_c2b',
                    currency,
                    user_phone: user.phoneNumber
                }
            }, { transaction: dbTx });

            await dbTx.commit();

            // ── Call Vodacom (outside DB transaction — network call)
            try {
                const mpesa  = new VodacomMpesaService();
                const result = await mpesa.initiateC2BPayment(
                    user.phoneNumber,
                    amount,
                    currency,
                    transactionRef,
                    `Deposit to ${user.firstName} ${user.surname} ${currency} wallet`
                );

                if (!result.success) {
                    throw new Error(result.responseDescription || 'C2B initiation failed');
                }

                await depositTx.update({
                    external_ref: result.transactionID,
                    metadata: {
                        ...depositTx.metadata,
                        vodacom_transaction_id:  result.transactionID,
                        vodacom_conversation_id: result.conversationID,
                        collection_initiated:    true,
                        simulated:               result.simulated || false
                    }
                });

                return {
                    success:          true,
                    transaction_id:   depositTx.id,
                    transaction_ref:  transactionRef,
                    amount,
                    currency,
                    status:           'pending',
                    instructions:     `Check your phone (${user.phoneNumber}) for a Vodacom M-Pesa prompt to complete the deposit of ${amount} ${currency}.`,
                    idempotency_key:  idempotencyKey,
                    simulated:        result.simulated || false
                };

            } catch (mpesaError) {
                console.error('❌ Vodacom C2B failed:', mpesaError.message);

                await depositTx.update({
                    status:        'failed',
                    failurereason: `Vodacom C2B failed: ${mpesaError.message}`,
                    failed_at:     new Date()
                });

                throw new Error(`Deposit initiation failed: ${mpesaError.message}`);
            }

        } catch (error) {
            // Only rollback if still open
            if (dbTx.finished !== 'commit') await dbTx.rollback();
            throw error;
        }
    }

    // ─────────────────────────────────────────────
    // WITHDRAWAL  (B2C — wallet pays out to mobile)
    // ─────────────────────────────────────────────

    static async initiateWithdrawal(userId, amount, currency, phoneNumber, idempotencyKey = null) {
        const dbTx = await sequelize.transaction();

        try {
            if (!idempotencyKey) {
                idempotencyKey = this.generateIdempotencyKey('withdrawal', userId);
            }

            // ── User
            const user = await User.findByPk(userId, { transaction: dbTx });
            if (!user) throw new Error('User not found');
            if (user.role === 'admin') throw new Error('Admins cannot use mobile money features');

            const canProcess = await user.canProcessTransaction(amount, 'withdrawal', currency);
            if (!canProcess) throw new Error('Amount exceeds daily withdrawal limit');

            // ── Wallet (with row-level lock)
            const wallet = await Wallet.findOne({
                where: { userid: userId, currency, status: 'active' },
                transaction: dbTx,
                lock: true
            });
            if (!wallet) throw new Error(`No active ${currency} wallet found`);

            // ── Float account
            const floatAccount = await FloatAccount.findOne({
                where: { currency_code: currency, status: 'active' },
                transaction: dbTx
            });
            if (!floatAccount) throw new Error(`No active float account for ${currency}`);

            // ── Fees
            const feeFlat        = await SystemConfig.getValue('withdrawal_fee_flat', 0.50);
            const feePercentage  = await SystemConfig.getValue('withdrawal_fee_percentage', 1.0);
            const percentageFee  = (parseFloat(amount) * feePercentage) / 100;
            const totalFee       = feeFlat + percentageFee;
            const totalAmount    = parseFloat(amount) + totalFee;

            if (!wallet.canReserve(totalAmount)) throw new Error('Insufficient funds for withdrawal');

            // ── Reserve funds
            await wallet.reserveFunds(totalAmount, dbTx);

            // ── Create processing transaction record
            const transactionRef = this.generateTransactionRef('WTH');

            const withdrawalTx = await TransactionModel.create({
                userid:           userId,
                type:             'withdrawal',
                amount:           amount,
                currency:         currency,
                referencenumber:  transactionRef,
                transaction_ref:  transactionRef,
                status:           'processing',
                walletid:         wallet.id,
                float_account_id: floatAccount.id,
                fees:             totalFee,
                initiated_at:     new Date(),
                idempotency_key:  idempotencyKey,
                metadata: {
                    withdrawal_type: 'vodacom_b2c',
                    currency,
                    phone_number:    phoneNumber,
                    fee_breakdown: {
                        flat_fee:       feeFlat,
                        percentage_fee: percentageFee,
                        total_fee:      totalFee
                    }
                }
            }, { transaction: dbTx });

            await dbTx.commit();

            // ── Call Vodacom
            try {
                const mpesa  = new VodacomMpesaService();
                const result = await mpesa.initiateB2CPayment(
                    phoneNumber,
                    amount,
                    currency,
                    transactionRef,
                    `Withdrawal for ${user.firstName} ${user.surname}`
                );

                if (!result.success) {
                    throw new Error(result.responseDescription || 'B2C initiation failed');
                }

                await withdrawalTx.update({
                    external_ref: result.transactionID,
                    metadata: {
                        ...withdrawalTx.metadata,
                        vodacom_transaction_id:  result.transactionID,
                        vodacom_conversation_id: result.conversationID,
                        transfer_initiated:      true,
                        simulated:               result.simulated || false
                    }
                });

                return {
                    success:          true,
                    transaction_id:   withdrawalTx.id,
                    transaction_ref:  transactionRef,
                    amount,
                    fees:             totalFee,
                    total_deducted:   totalAmount,
                    currency,
                    phone_number:     phoneNumber,
                    status:           'processing',
                    instructions:     `Withdrawal of ${amount} ${currency} to ${phoneNumber} is being processed. You will receive an M-Pesa notification shortly.`,
                    idempotency_key:  idempotencyKey,
                    simulated:        result.simulated || false
                };

            } catch (mpesaError) {
                console.error('❌ Vodacom B2C failed:', mpesaError.message);

                // Release reserved funds
                await wallet.releaseFunds(totalAmount);

                await withdrawalTx.update({
                    status:        'failed',
                    failurereason: `Vodacom B2C failed: ${mpesaError.message}`,
                    failed_at:     new Date()
                });

                throw new Error(`Withdrawal initiation failed: ${mpesaError.message}`);
            }

        } catch (error) {
            if (dbTx.finished !== 'commit') await dbTx.rollback();
            throw error;
        }
    }

    // ─────────────────────────────────────────────
    // SEND MONEY TO ANYONE  (B2C to any mobile number)
    // ─────────────────────────────────────────────

    static async sendMoneyToAnyone(userId, amount, currency, phoneNumber, idempotencyKey = null, recipientName = null, purpose = null) {
        const dbTx = await sequelize.transaction();

        try {
            if (!idempotencyKey) {
                idempotencyKey = this.generateIdempotencyKey('send', userId);
            }

            // ── User
            const user = await User.findByPk(userId, { transaction: dbTx });
            if (!user) throw new Error('User not found');
            if (user.role === 'admin') throw new Error('Admins cannot use mobile money features');

            const canProcess = await user.canProcessTransaction(amount, 'withdrawal', currency);
            if (!canProcess) throw new Error('Amount exceeds daily sending limit');

            // ── Wallet (with row-level lock)
            const wallet = await Wallet.findOne({
                where: { userid: userId, currency, status: 'active' },
                transaction: dbTx,
                lock: true
            });
            if (!wallet) throw new Error(`No active ${currency} wallet found`);

            // ── Float account
            const floatAccount = await FloatAccount.findOne({
                where: { currency_code: currency, status: 'active' },
                transaction: dbTx
            });
            if (!floatAccount) throw new Error(`No active float account for ${currency}`);

            // ── Fees — uses withdrawal fee keys (consistent with withdraw flow)
            // To set different rates for send-money, add send_fee_flat / send_fee_percentage
            // rows to system_configs. Falls back to withdrawal keys if not present.
            const feeFlat       = await SystemConfig.getValue('withdrawal_fee_flat', 0.50);
            const feePercentage = await SystemConfig.getValue('withdrawal_fee_percentage', 1.0);
            const percentageFee = (parseFloat(amount) * feePercentage) / 100;
            const totalFee      = feeFlat + percentageFee;
            const totalAmount   = parseFloat(amount) + totalFee;

            if (!wallet.canReserve(totalAmount)) throw new Error('Insufficient funds to send money');

            await wallet.reserveFunds(totalAmount, dbTx);

            const transactionRef = this.generateTransactionRef('SEND');

            const sendTx = await TransactionModel.create({
                userid:           userId,
                type:             'withdrawal',       // accounting type
                amount:           amount,
                currency:         currency,
                referencenumber:  transactionRef,
                transaction_ref:  transactionRef,
                status:           'processing',
                walletid:         wallet.id,
                float_account_id: floatAccount.id,
                fees:             totalFee,
                initiated_at:     new Date(),
                idempotency_key:  idempotencyKey,
                description:      purpose || `Money sent to ${phoneNumber}`,
                metadata: {
                    transaction_type: 'send_money',
                    recipient_phone:  phoneNumber,
                    recipient_name:   recipientName,
                    purpose,
                    currency,
                    fee_breakdown: {
                        flat_fee:       feeFlat,
                        percentage_fee: percentageFee,
                        total_fee:      totalFee
                    },
                    sender_info: {
                        name:  `${user.firstName} ${user.surname}`,
                        phone: user.phoneNumber
                    }
                }
            }, { transaction: dbTx });

            await dbTx.commit();

            // ── Call Vodacom
            try {
                const mpesa  = new VodacomMpesaService();
                const result = await mpesa.initiateB2CPayment(
                    phoneNumber,
                    amount,
                    currency,
                    transactionRef,
                    `Money from ${user.firstName} ${user.surname}${purpose ? ` – ${purpose}` : ''}`
                );

                if (!result.success) {
                    throw new Error(result.responseDescription || 'B2C initiation failed');
                }

                await sendTx.update({
                    external_ref: result.transactionID,
                    metadata: {
                        ...sendTx.metadata,
                        vodacom_transaction_id:  result.transactionID,
                        vodacom_conversation_id: result.conversationID,
                        transfer_initiated:      true,
                        simulated:               result.simulated || false
                    }
                });

                return {
                    success:         true,
                    transaction_id:  sendTx.id,
                    transaction_ref: transactionRef,
                    amount,
                    fees:            totalFee,
                    total_deducted:  totalAmount,
                    currency,
                    recipient: {
                        phone_number: phoneNumber,
                        name:         recipientName || 'Unknown'
                    },
                    status:          'processing',
                    purpose,
                    instructions:    `Sending ${amount} ${currency} to ${phoneNumber}${recipientName ? ` (${recipientName})` : ''}. The recipient will receive an M-Pesa notification shortly.`,
                    idempotency_key: idempotencyKey,
                    simulated:       result.simulated || false
                };

            } catch (mpesaError) {
                console.error('❌ Vodacom B2C (send) failed:', mpesaError.message);

                await wallet.releaseFunds(totalAmount);

                await sendTx.update({
                    status:        'failed',
                    failurereason: `Vodacom B2C failed: ${mpesaError.message}`,
                    failed_at:     new Date()
                });

                throw new Error(`Send money failed: ${mpesaError.message}`);
            }

        } catch (error) {
            if (dbTx.finished !== 'commit') await dbTx.rollback();
            throw error;
        }
    }

    // ─────────────────────────────────────────────
    // INTERNAL WALLET-TO-WALLET TRANSFER
    // ─────────────────────────────────────────────

    static async processInternalTransfer(senderId, receiverId, amount, currency, idempotencyKey = null) {
        const dbTx = await sequelize.transaction();

        try {
            if (!idempotencyKey) {
                idempotencyKey = this.generateIdempotencyKey('transfer', senderId, receiverId);
            }

            // Idempotency check
            const existing = await TransactionModel.findOne({
                where: { idempotency_key: idempotencyKey },
                transaction: dbTx
            });

            if (existing) {
                await dbTx.commit();
                return {
                    success:       true,
                    transaction:   existing,
                    message:       'Transaction already processed',
                    was_duplicate: true
                };
            }

            // ── Wallets
            const senderWallet = await Wallet.findOne({
                where: { userid: senderId, currency, status: 'active' },
                transaction: dbTx,
                lock: true
            });
            const receiverWallet = await Wallet.findOne({
                where: { userid: receiverId, currency, status: 'active' },
                transaction: dbTx
            });

            if (!senderWallet)   throw new Error('Sender wallet not found');
            if (!receiverWallet) throw new Error('Receiver wallet not found');

            // ── Fee & balance check
            const transferFee = await SystemConfig.getValue('transfer_fee_flat', 0.10);
            const totalAmount = parseFloat(amount) + transferFee;

            if (!senderWallet.canReserve(totalAmount)) throw new Error('Insufficient funds');

            // ── Reserve → deduct → credit (atomic)
            await senderWallet.reserveFunds(totalAmount, dbTx);

            const transactionRef = this.generateTransactionRef('TRF');

            const transferTx = await TransactionModel.create({
                userid:          senderId,
                type:            'transfer',
                amount,
                currency,
                referencenumber: transactionRef,
                transaction_ref: transactionRef,
                status:          'processing',
                relateduserid:   receiverId,
                walletid:        senderWallet.id,
                fees:            transferFee,
                initiated_at:    new Date(),
                idempotency_key: idempotencyKey,
                metadata: {
                    transfer_type:      'internal',
                    sender_wallet_id:   senderWallet.id,
                    receiver_wallet_id: receiverWallet.id
                }
            }, { transaction: dbTx });

            const senderBalanceBefore   = parseFloat(senderWallet.balance);
            const receiverBalanceBefore = parseFloat(receiverWallet.balance);

            await senderWallet.completeFundsDeduction(totalAmount, dbTx);
            await receiverWallet.creditFunds(parseFloat(amount), dbTx);

            await transferTx.update({
                status:       'completed',
                completed_at: new Date(),
                balanceafter: parseFloat(senderWallet.balance) - totalAmount
            }, { transaction: dbTx });

            // ── Wallet movements audit trail
            await WalletMovement.bulkCreate([
                {
                    transaction_id: transferTx.id,
                    wallet_id:      senderWallet.id,
                    movement_type:  'debit',
                    amount:         totalAmount,
                    balance_before: senderBalanceBefore,
                    balance_after:  senderBalanceBefore - totalAmount,
                    description:    `Transfer to user ${receiverId} (amount: ${amount}, fee: ${transferFee})`
                },
                {
                    transaction_id: transferTx.id,
                    wallet_id:      receiverWallet.id,
                    movement_type:  'credit',
                    amount:         parseFloat(amount),
                    balance_before: receiverBalanceBefore,
                    balance_after:  receiverBalanceBefore + parseFloat(amount),
                    description:    `Transfer from user ${senderId}`
                }
            ], { transaction: dbTx });

            await dbTx.commit();

            return {
                success:         true,
                transaction_id:  transferTx.id,
                transaction_ref: transactionRef,
                amount,
                fee:             transferFee,
                total_deducted:  totalAmount,
                currency,
                idempotency_key: idempotencyKey,
                was_duplicate:   false
            };

        } catch (error) {
            if (dbTx.finished !== 'commit') await dbTx.rollback();
            throw error;
        }
    }

    // ─────────────────────────────────────────────
    // WEBHOOK CALLBACKS
    // ─────────────────────────────────────────────

    /**
     * Process a Vodacom C2B callback (deposit confirmation).
     * callbackData shape:
     *   { transactionRef, transactionId, status, amount, msisdn, ... }
     * status: 'successful' | 'failed'
     */
    static async processC2BCallback(callbackData) {
        const dbTx = await sequelize.transaction();

        try {
            // ── Log the webhook
            const webhookRecord = await MpesaWebhook.create({
                webhook_type:        'c2b_callback',
                webhook_source:      'vodacom_drc',
                event_type:          callbackData.event || 'c2b.completed',
                raw_payload:         callbackData,
                mpesa_transaction_id: callbackData.transactionId,
                status:              'received'
            }, { transaction: dbTx });

            // ── Match pending deposit
            const pendingTx = await TransactionModel.findOne({
                where: {
                    transaction_ref: callbackData.transactionRef,
                    status:          'pending',
                    type:            'deposit'
                },
                transaction: dbTx
            });

            if (!pendingTx) {
                await webhookRecord.update({
                    status:           'duplicate',
                    processing_error: 'No matching pending deposit — possible Vodacom retry'
                }, { transaction: dbTx });

                await dbTx.commit();
                return { success: false, error: 'No matching transaction' };
            }

            if (callbackData.status === 'successful') {
                const paidAmount = parseFloat(callbackData.amount);

                // Amount sanity check
                if (Math.abs(paidAmount - parseFloat(pendingTx.amount)) > 0.01) {
                    await pendingTx.update({
                        status:        'failed',
                        failurereason: `Amount mismatch: expected ${pendingTx.amount}, got ${paidAmount}`,
                        failed_at:     new Date()
                    }, { transaction: dbTx });

                    await dbTx.commit();
                    return { success: false, error: 'Amount mismatch' };
                }

                const wallet      = await Wallet.findByPk(pendingTx.walletid,         { transaction: dbTx });
                const floatAcct   = await FloatAccount.findByPk(pendingTx.float_account_id, { transaction: dbTx });

                if (!wallet || !floatAcct) throw new Error('Wallet or float account not found');

                const balanceBefore = parseFloat(wallet.balance);

                // Credit wallet
                await wallet.creditFunds(paidAmount, dbTx);

                // Update float balance (money now held on behalf of user)
                await floatAcct.update({
                    current_balance: parseFloat(floatAcct.current_balance || 0) + paidAmount
                }, { transaction: dbTx });

                // Complete the transaction
                await pendingTx.update({
                    status:       'completed',
                    external_ref: callbackData.transactionId,
                    completed_at: new Date(),
                    processedat:  new Date(),
                    balanceafter: balanceBefore + paidAmount,
                    metadata: {
                        ...pendingTx.metadata,
                        vodacom_transaction_id: callbackData.transactionId,
                        payment_completed:      true
                    }
                }, { transaction: dbTx });

                // Wallet movement audit
                await WalletMovement.create({
                    transaction_id: pendingTx.id,
                    wallet_id:      wallet.id,
                    movement_type:  'credit',
                    amount:         paidAmount,
                    balance_before: balanceBefore,
                    balance_after:  balanceBefore + paidAmount,
                    description:    `Vodacom DRC C2B deposit – ${callbackData.transactionId}`
                }, { transaction: dbTx });

                await webhookRecord.update({
                    status:         'processed',
                    processed_at:   new Date(),
                    transaction_id: pendingTx.id
                }, { transaction: dbTx });

                await dbTx.commit();

                return {
                    success:        true,
                    transaction_id: pendingTx.id,
                    amount:         paidAmount
                };

            } else {
                // Payment failed / cancelled
                const reason = callbackData.resultDesc || callbackData.responseDescription || 'Payment failed or cancelled';

                await pendingTx.update({
                    status:        'failed',
                    failurereason: reason,
                    failed_at:     new Date()
                }, { transaction: dbTx });

                await webhookRecord.update({
                    status:           'processed',
                    processed_at:     new Date(),
                    transaction_id:   pendingTx.id,
                    processing_error: reason
                }, { transaction: dbTx });

                await dbTx.commit();
                return { success: false, error: reason, transaction_id: pendingTx.id };
            }

        } catch (error) {
            if (dbTx.finished !== 'commit') await dbTx.rollback();
            throw error;
        }
    }

    /**
     * Process a Vodacom B2C callback (withdrawal / send-money confirmation).
     * callbackData shape:
     *   { transactionRef, transactionId, status, amount, ... }
     * status: 'SUCCESSFUL' | 'FAILED'
     */
    static async processB2CCallback(callbackData) {
        const dbTx = await sequelize.transaction();

        try {
            const webhookRecord = await MpesaWebhook.create({
                webhook_type:         'b2c_callback',
                webhook_source:       'vodacom_drc',
                event_type:           callbackData.event || 'b2c.completed',
                raw_payload:          callbackData,
                mpesa_transaction_id: callbackData.transactionId,
                status:               'received'
            }, { transaction: dbTx });

            // Match processing withdrawal/send
            const pendingTx = await TransactionModel.findOne({
                where: {
                    transaction_ref: callbackData.transactionRef,
                    status:          'processing',
                    type:            'withdrawal'
                },
                transaction: dbTx
            });

            if (!pendingTx) {
                await webhookRecord.update({
                    status:           'duplicate',
                    processing_error: 'No matching processing withdrawal — possible Vodacom retry'
                }, { transaction: dbTx });

                await dbTx.commit();
                return { success: false, error: 'No matching transaction' };
            }

            const wallet    = await Wallet.findByPk(pendingTx.walletid,              { transaction: dbTx });
            const floatAcct = await FloatAccount.findByPk(pendingTx.float_account_id, { transaction: dbTx });

            if (!wallet || !floatAcct) throw new Error('Wallet or float account not found');

            const totalAmount = parseFloat(pendingTx.amount) + parseFloat(pendingTx.fees || 0);

            if (callbackData.status === 'SUCCESSFUL') {
                // Deduct reserved funds permanently
                await wallet.completeFundsDeduction(totalAmount, dbTx);

                // Float balance goes down (money left the business)
                await floatAcct.update({
                    current_balance: Math.max(0, parseFloat(floatAcct.current_balance || 0) - parseFloat(pendingTx.amount))
                }, { transaction: dbTx });

                const recipientInfo = pendingTx.metadata?.recipient_phone
                    || pendingTx.metadata?.phone_number
                    || 'unknown recipient';

                await pendingTx.update({
                    status:       'completed',
                    external_ref: callbackData.transactionId,
                    completed_at: new Date(),
                    processedat:  new Date(),
                    balanceafter: parseFloat(wallet.balance),
                    metadata: {
                        ...pendingTx.metadata,
                        vodacom_transaction_id: callbackData.transactionId,
                        payment_completed:      true
                    }
                }, { transaction: dbTx });

                const isSendMoney = pendingTx.metadata?.transaction_type === 'send_money';

                await WalletMovement.create({
                    transaction_id: pendingTx.id,
                    wallet_id:      wallet.id,
                    movement_type:  'debit',
                    amount:         totalAmount,
                    balance_before: parseFloat(wallet.balance) + totalAmount,
                    balance_after:  parseFloat(wallet.balance),
                    description:    isSendMoney
                        ? `Money sent to ${recipientInfo} via Vodacom DRC – ${callbackData.transactionId}`
                        : `Vodacom DRC withdrawal to ${recipientInfo} – ${callbackData.transactionId}`
                }, { transaction: dbTx });

                await webhookRecord.update({
                    status:         'processed',
                    processed_at:   new Date(),
                    transaction_id: pendingTx.id
                }, { transaction: dbTx });

                await dbTx.commit();

                return {
                    success:        true,
                    transaction_id: pendingTx.id,
                    amount:         pendingTx.amount
                };

            } else {
                // Transfer failed — release reserved funds back to available balance
                await wallet.releaseFunds(totalAmount, dbTx);

                const reason = callbackData.resultDesc || callbackData.responseDescription || 'Transfer failed';

                await pendingTx.update({
                    status:        'failed',
                    failurereason: reason,
                    failed_at:     new Date(),
                    metadata: {
                        ...pendingTx.metadata,
                        failure_reason: reason,
                        response_code:  callbackData.status
                    }
                }, { transaction: dbTx });

                await webhookRecord.update({
                    status:           'processed',
                    processed_at:     new Date(),
                    transaction_id:   pendingTx.id,
                    processing_error: reason
                }, { transaction: dbTx });

                await dbTx.commit();
                return { success: false, error: reason, transaction_id: pendingTx.id };
            }

        } catch (error) {
            if (dbTx.finished !== 'commit') await dbTx.rollback();
            throw error;
        }
    }

    // ─────────────────────────────────────────────
    // TRANSACTION HISTORY
    // ─────────────────────────────────────────────

    static async getTransactionHistory(userId, limit = 50, offset = 0) {
        try {
            const transactions = await TransactionModel.findAll({
                where: {
                    [Op.or]: [
                        { userid: userId },
                        { relateduserid: userId }
                    ]
                },
                order:  [['createdat', 'DESC']],
                limit,
                offset
            });

            const enriched = await Promise.all(
                transactions.map(async (tx) => {
                    const t = tx.toJSON();
                    const isSender   = t.userid       === userId;
                    const isReceiver = t.relateduserid === userId;

                    const display = {
                        id:                    t.id,
                        type:                  t.type,
                        amount:                parseFloat(t.amount),
                        currency:              t.currency,
                        status:                t.status,
                        date:                  t.createdat || t.initiated_at,
                        transaction_ref:       t.transaction_ref || t.referencenumber,
                        fees:                  parseFloat(t.fees || 0),
                        user_role:             isSender ? 'sender' : 'receiver',
                        display_name:          null,
                        profile_picture:       null,
                        description:           t.description || null,
                        transaction_direction: null,
                        other_party:           null,
                        metadata:              t.metadata
                    };

                    switch (t.type) {
                        case 'deposit':
                            display.display_name          = 'Vodacom M-Pesa';
                            display.description           = display.description || 'Mobile money deposit';
                            display.transaction_direction = 'received';
                            display.profile_picture       = '/images/mpesa-logo.png';
                            break;

                        case 'withdrawal': {
                            const isSendMoney = t.metadata?.transaction_type === 'send_money';
                            if (isSendMoney) {
                                const recipientName  = t.metadata?.recipient_name;
                                const recipientPhone = t.metadata?.recipient_phone;
                                display.display_name          = recipientName || recipientPhone || 'Unknown Recipient';
                                display.description           = display.description || `Money sent to ${display.display_name}`;
                                display.transaction_direction = 'sent';
                            } else {
                                const phone = t.metadata?.phone_number;
                                display.display_name          = phone || 'Mobile Money';
                                display.description           = display.description || `Withdrawal to ${phone || 'mobile money'}`;
                                display.transaction_direction = 'sent';
                                display.profile_picture       = '/images/mpesa-logo.png';
                            }
                            break;
                        }

                        case 'transfer':
                            if (isSender) {
                                const receiver = await User.findByPk(t.relateduserid, {
                                    attributes: ['id', 'firstName', 'surname', 'phoneNumber']
                                });
                                display.display_name          = receiver ? `${receiver.firstName} ${receiver.surname}` : 'Unknown User';
                                display.other_party           = receiver ? { id: receiver.id, name: display.display_name, phone: receiver.phoneNumber } : null;
                                display.description           = display.description || `Transfer to ${display.display_name}`;
                                display.transaction_direction = 'sent';
                            } else {
                                const sender = await User.findByPk(t.userid, {
                                    attributes: ['id', 'firstName', 'surname', 'phoneNumber']
                                });
                                display.display_name          = sender ? `${sender.firstName} ${sender.surname}` : 'Unknown User';
                                display.other_party           = sender ? { id: sender.id, name: display.display_name, phone: sender.phoneNumber } : null;
                                display.description           = display.description || `Transfer from ${display.display_name}`;
                                display.transaction_direction = 'received';
                            }
                            break;

                        case 'fx_conversion':
                            display.display_name          = 'Currency Exchange';
                            display.description           = display.description || `${t.fromcurrency} → ${t.tocurrency} conversion`;
                            display.transaction_direction = 'exchange';
                            display.profile_picture       = '/images/exchange-icon.png';
                            break;

                        default:
                            display.display_name          = 'System';
                            display.description           = display.description || `${t.type} transaction`;
                            display.transaction_direction = isSender ? 'sent' : 'received';
                    }

                    return display;
                })
            );

            return enriched;
        } catch (error) {
            console.error('Transaction history error:', error);
            throw error;
        }
    }

    // ─────────────────────────────────────────────
    // WALLET BALANCE QUERIES
    // ─────────────────────────────────────────────

    static async getWalletBalance(userId, currency) {
        const wallet = await Wallet.findOne({
            where: { userid: userId, currency, status: 'active' }
        });
        if (!wallet) throw new Error(`No active ${currency} wallet found`);

        return {
            balance:           parseFloat(wallet.balance),
            available_balance: parseFloat(wallet.available_balance),
            reserved_balance:  parseFloat(wallet.reserved_balance),
            currency:          wallet.currency,
            status:            wallet.status
        };
    }

    static async getAllWalletBalances(userId) {
        const wallets = await Wallet.findAll({
            where:      { userid: userId, status: 'active' },
            attributes: ['currency', 'balance', 'available_balance', 'reserved_balance', 'status', 'last_transaction_at']
        });

        return wallets.map(w => ({
            currency:           w.currency,
            balance:            parseFloat(w.balance),
            available_balance:  parseFloat(w.available_balance),
            reserved_balance:   parseFloat(w.reserved_balance),
            status:             w.status,
            last_transaction_at: w.last_transaction_at
        }));
    }

    // ─────────────────────────────────────────────
    // ACCOUNT SEARCH (wallet-to-wallet transfers)
    // ─────────────────────────────────────────────

    static async searchAccounts(searchTerm, currentUserId) {
        const accounts = await Account.findAll({
            where: {
                [Op.and]: [
                    { userId: { [Op.ne]: currentUserId } },
                    {
                        [Op.or]: [
                            { accountNumber: { [Op.iLike]: `%${searchTerm}%` } }
                        ]
                    },
                    { status: 'active' }
                ]
            },
            include: [{
                model:      User,
                attributes: ['firstName', 'surname', 'phoneNumber']
            }],
            attributes: ['id', 'userId', 'accountNumber', 'accountType', 'currency'],
            limit: 10
        });

        return accounts.map(a => ({
            userId:        a.userId,
            accountNumber: a.accountNumber,
            accountType:   a.accountType,
            currency:      a.currency,
            user: {
                firstName:   a.User.firstName,
                surname:     a.User.surname,
                phoneNumber: a.User.phoneNumber
            }
        }));
    }
}

module.exports = MobileMoneyService;