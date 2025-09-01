const { sequelize } = require('../config/config');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const TransactionModel = require('../models/Transaction');
const WalletMovement = require('../models/WalletMovement');
const SystemConfig = require('../models/SystemConfig');
const ExternalExchangeService = require('./ExternalExchangeService');

class CurrencyExchangeService {
    // Generate transaction reference for exchanges
    static generateExchangeRef() {
        return `FX${Date.now()}${Math.random().toString(36).substr(2, 6)}`;
    }
    
    // Calculate exchange with fees
    static async calculateExchange(amount, fromCurrency, toCurrency) {
        try {
            if (fromCurrency === toCurrency) {
                throw new Error('Cannot exchange same currencies');
            }
            
            // Get current rates with spread
            const rates = await ExternalExchangeService.getCurrentRatesWithSpread();
            
            // Get exchange fee
            const exchangeFeeFlat = await SystemConfig.getValue('fx_fee_flat', 2.00);
            const exchangeFeePercentage = await SystemConfig.getValue('fx_fee_percentage', 0.5);
            
            // Calculate conversion
            let convertedAmount;
            let exchangeRate;
            
            if (fromCurrency === 'USD' && toCurrency === 'CDF') {
                exchangeRate = rates.USD_to_CDF.customer_rate;
                convertedAmount = parseFloat(amount) * exchangeRate;
            } else if (fromCurrency === 'CDF' && toCurrency === 'USD') {
                exchangeRate = rates.CDF_to_USD.customer_rate;
                convertedAmount = parseFloat(amount) * exchangeRate;
            } else {
                throw new Error('Unsupported currency pair');
            }
            
            // Calculate fees (charged in source currency)
            const percentageFee = (parseFloat(amount) * exchangeFeePercentage) / 100;
            const totalFee = exchangeFeeFlat + percentageFee;
            const totalSourceAmount = parseFloat(amount) + totalFee;
            
            return {
                success: true,
                from_currency: fromCurrency,
                to_currency: toCurrency,
                source_amount: parseFloat(amount),
                converted_amount: convertedAmount,
                exchange_rate: exchangeRate,
                fees: {
                    flat_fee: exchangeFeeFlat,
                    percentage_fee: percentageFee,
                    total_fee: totalFee
                },
                total_source_amount: totalSourceAmount,
                net_converted_amount: convertedAmount,
                rate_info: {
                    base_rate: fromCurrency === 'USD' ? rates.USD_to_CDF.base_rate : rates.CDF_to_USD.base_rate,
                    customer_rate: exchangeRate,
                    spread_percentage: rates.USD_to_CDF.spread_percentage
                }
            };
            
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // Process currency exchange transaction
    static async processCurrencyExchange(userId, amount, fromCurrency, toCurrency, idempotencyKey = null) {
        const transaction = await sequelize.transaction();
        
        try {
            // Generate idempotency key if not provided
            if (!idempotencyKey) {
                idempotencyKey = `fx_${userId}_${Date.now()}`;
            }
            
            // Check for existing transaction
            const existingTransaction = await TransactionModel.findOne({
                where: { idempotency_key: idempotencyKey },
                transaction
            });
            
            if (existingTransaction) {
                await transaction.rollback();
                return {
                    success: true,
                    transaction: existingTransaction,
                    message: 'Exchange already processed',
                    was_duplicate: true
                };
            }
            
            // Get user
            const user = await User.findByPk(userId, { transaction });
            if (!user) {
                throw new Error('User not found');
            }
            
            if (user.role === 'admin') {
                throw new Error('Admins cannot use exchange features');
            }
            
            // Check transaction limits
            const maxExchangeAmount = await SystemConfig.getValue('max_exchange_amount', 5000.00);
            if (parseFloat(amount) > maxExchangeAmount) {
                throw new Error(`Amount exceeds maximum exchange limit of ${maxExchangeAmount}`);
            }
            
            // Get both wallets
            const sourceWallet = await Wallet.findOne({
                where: { userid: userId, currency: fromCurrency, status: 'active' },
                transaction,
                lock: true
            });
            
            const targetWallet = await Wallet.findOne({
                where: { userid: userId, currency: toCurrency, status: 'active' },
                transaction
            });
            
            if (!sourceWallet || !targetWallet) {
                throw new Error('Required wallets not found');
            }
            
            // Calculate exchange
            const calculation = await this.calculateExchange(amount, fromCurrency, toCurrency);
            if (!calculation.success) {
                throw new Error(calculation.error);
            }
            
            // Check source wallet balance and reserve funds
            if (!sourceWallet.canReserve(calculation.total_source_amount)) {
                throw new Error('Insufficient funds for exchange');
            }
            
            // Reserve funds from source wallet
            await sourceWallet.reserveFunds(calculation.total_source_amount, transaction);
            
            // Generate transaction reference
            const transactionRef = this.generateExchangeRef();
            
            // Create exchange transaction record
            const exchangeTransaction = await TransactionModel.create({
                userid: userId,
                type: 'fx_conversion',
                amount: amount,
                currency: fromCurrency,
                referencenumber: transactionRef,
                transaction_ref: transactionRef,
                status: 'processing',
                walletid: sourceWallet.id,
                fees: calculation.fees.total_fee,
                initiated_at: new Date(),
                idempotency_key: idempotencyKey,
                fromcurrency: fromCurrency,
                tocurrency: toCurrency,
                exchangerate: calculation.exchange_rate,
                convertedamount: calculation.converted_amount,
                metadata: {
                    exchange_type: 'currency_conversion',
                    source_wallet_id: sourceWallet.id,
                    target_wallet_id: targetWallet.id,
                    calculation: calculation,
                    exchange_details: {
                        base_rate: calculation.rate_info.base_rate,
                        customer_rate: calculation.rate_info.customer_rate,
                        spread: calculation.rate_info.spread_percentage
                    }
                }
            }, { transaction });
            
            // Get balances before changes
            const sourceBalanceBefore = sourceWallet.balance;
            const targetBalanceBefore = targetWallet.balance;
            
            // Execute the exchange
            await sourceWallet.completeFundsDeduction(calculation.total_source_amount, transaction);
            await targetWallet.creditFunds(calculation.converted_amount, transaction);
            
            // Update transaction status
            await exchangeTransaction.update({
                status: 'completed',
                completed_at: new Date(),
                balanceafter: sourceWallet.balance
            }, { transaction });
            
            // Log wallet movements
            await WalletMovement.bulkCreate([
                {
                    transaction_id: exchangeTransaction.id,
                    wallet_id: sourceWallet.id,
                    movement_type: 'debit',
                    amount: calculation.total_source_amount,
                    balance_before: parseFloat(sourceBalanceBefore),
                    balance_after: parseFloat(sourceWallet.balance),
                    description: `Currency exchange: ${calculation.source_amount} ${fromCurrency} → ${calculation.converted_amount} ${toCurrency} (Rate: ${calculation.exchange_rate.toFixed(6)}, Fee: ${calculation.fees.total_fee})`
                },
                {
                    transaction_id: exchangeTransaction.id,
                    wallet_id: targetWallet.id,
                    movement_type: 'credit',
                    amount: calculation.converted_amount,
                    balance_before: parseFloat(targetBalanceBefore),
                    balance_after: parseFloat(targetWallet.balance),
                    description: `Currency exchange received: ${calculation.source_amount} ${fromCurrency} → ${calculation.converted_amount} ${toCurrency}`
                }
            ], { transaction });
            
            await transaction.commit();
            
            return {
                success: true,
                transaction_id: exchangeTransaction.id,
                transaction_ref: transactionRef,
                exchange_details: {
                    from_amount: calculation.source_amount,
                    from_currency: fromCurrency,
                    to_amount: calculation.converted_amount,
                    to_currency: toCurrency,
                    exchange_rate: calculation.exchange_rate,
                    fees: calculation.fees.total_fee,
                    total_debited: calculation.total_source_amount
                },
                wallet_balances: {
                    [fromCurrency]: {
                        previous_balance: parseFloat(sourceBalanceBefore),
                        new_balance: parseFloat(sourceWallet.balance)
                    },
                    [toCurrency]: {
                        previous_balance: parseFloat(targetBalanceBefore),
                        new_balance: parseFloat(targetWallet.balance)
                    }
                },
                idempotency_key: idempotencyKey
            };
            
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    }
    
    // Get current exchange rates for users
    static async getCurrentRates() {
        try {
            const rates = await ExternalExchangeService.getCurrentRatesWithSpread();
            
            // Return user-friendly format
            return {
                success: true,
                rates: {
                    USD_to_CDF: {
                        rate: rates.USD_to_CDF.customer_rate,
                        formatted: `1 USD = ${rates.USD_to_CDF.customer_rate.toFixed(2)} CDF`
                    },
                    CDF_to_USD: {
                        rate: rates.CDF_to_USD.customer_rate,
                        formatted: `1 CDF = ${rates.CDF_to_USD.customer_rate.toFixed(6)} USD`
                    }
                },
                last_updated: rates.last_updated,
                spread_info: `Rates include ${rates.USD_to_CDF.spread_percentage}% spread`
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = CurrencyExchangeService;