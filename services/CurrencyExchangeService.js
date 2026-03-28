const { sequelize } = require('../config/config');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const TransactionModel = require('../models/Transaction');
const WalletMovement = require('../models/WalletMovement');
const SystemConfig = require('../models/SystemConfig');
const ExternalExchangeService = require('./ExternalExchangeService');

// ── Helper: round to 2 decimal places (fixes JS floating point e.g. 26.249999996)
const r2 = (n) => Math.round(parseFloat(n) * 100) / 100;
// ── Helper: round to 6 decimal places (for exchange rates)
const r6 = (n) => Math.round(parseFloat(n) * 1000000) / 1000000;

class CurrencyExchangeService {

    static generateExchangeRef() {
        return `FX${Date.now()}${Math.random().toString(36).substr(2, 6)}`;
    }

    // ── Calculate exchange with fees ──────────────────────────────────────────
    static async calculateExchange(amount, fromCurrency, toCurrency) {
        try {
            if (fromCurrency === toCurrency) {
                throw new Error('Cannot exchange same currencies');
            }

            const rates = await ExternalExchangeService.getCurrentRatesWithSpread();

            const exchangeFeeFlat       = await SystemConfig.getValue('fx_fee_flat',       2.00);
            const exchangeFeePercentage = await SystemConfig.getValue('fx_fee_percentage',  0.5);

            let convertedAmount, exchangeRate;

            if (fromCurrency === 'USD' && toCurrency === 'CDF') {
                exchangeRate    = rates.USD_to_CDF.customer_rate;
                convertedAmount = r2(parseFloat(amount) * exchangeRate);
            } else if (fromCurrency === 'CDF' && toCurrency === 'USD') {
                exchangeRate    = rates.CDF_to_USD.customer_rate;
                convertedAmount = r2(parseFloat(amount) * exchangeRate);
            } else {
                throw new Error('Unsupported currency pair');
            }

            const percentageFee     = r2((parseFloat(amount) * exchangeFeePercentage) / 100);
            const totalFee          = r2(exchangeFeeFlat + percentageFee);
            const totalSourceAmount = r2(parseFloat(amount) + totalFee);

            return {
                success:             true,
                from_currency:       fromCurrency,
                to_currency:         toCurrency,
                source_amount:       r2(parseFloat(amount)),
                converted_amount:    convertedAmount,
                exchange_rate:       exchangeRate,
                fees: {
                    flat_fee:       exchangeFeeFlat,
                    percentage_fee: percentageFee,
                    total_fee:      totalFee
                },
                total_source_amount:  totalSourceAmount,
                net_converted_amount: convertedAmount,
                rate_info: {
                    base_rate:          fromCurrency === 'USD' ? rates.USD_to_CDF.base_rate : rates.CDF_to_USD.base_rate,
                    customer_rate:      exchangeRate,
                    spread_percentage:  rates.USD_to_CDF.spread_percentage
                }
            };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // ── Process currency exchange ─────────────────────────────────────────────
    static async processCurrencyExchange(userId, amount, fromCurrency, toCurrency, idempotencyKey = null) {
        const dbTx = await sequelize.transaction();

        try {
            if (!idempotencyKey) {
                idempotencyKey = `fx_${userId}_${Date.now()}`;
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
                    message:       'Exchange already processed',
                    was_duplicate: true
                };
            }

            const user = await User.findByPk(userId, { transaction: dbTx });
            if (!user)              throw new Error('User not found');
            if (user.role === 'admin') throw new Error('Admins cannot use exchange features');

            const maxExchangeAmount = await SystemConfig.getValue('max_exchange_amount', 5000.00);
            if (parseFloat(amount) > maxExchangeAmount) {
                throw new Error(`Amount exceeds maximum exchange limit of ${maxExchangeAmount}`);
            }

            const sourceWallet = await Wallet.findOne({
                where: { userid: userId, currency: fromCurrency, status: 'active' },
                transaction: dbTx,
                lock: true
            });
            const targetWallet = await Wallet.findOne({
                where: { userid: userId, currency: toCurrency, status: 'active' },
                transaction: dbTx
            });

            if (!sourceWallet || !targetWallet) throw new Error('Required wallets not found');

            const calc = await this.calculateExchange(amount, fromCurrency, toCurrency);
            if (!calc.success) throw new Error(calc.error);

            if (!sourceWallet.canReserve(calc.total_source_amount)) {
                throw new Error('Insufficient funds for exchange');
            }

            await sourceWallet.reserveFunds(calc.total_source_amount, dbTx);

            const transactionRef = this.generateExchangeRef();

            const exchangeTx = await TransactionModel.create({
                userid:          userId,
                type:            'fx_conversion',
                amount:          amount,
                currency:        fromCurrency,
                referencenumber: transactionRef,
                transaction_ref: transactionRef,
                status:          'processing',
                walletid:        sourceWallet.id,
                fees:            calc.fees.total_fee,
                initiated_at:    new Date(),
                idempotency_key: idempotencyKey,
                fromcurrency:    fromCurrency,
                tocurrency:      toCurrency,
                exchangerate:    r6(calc.exchange_rate),
                convertedamount: calc.converted_amount,
                metadata: {
                    exchange_type:    'currency_conversion',
                    source_wallet_id: sourceWallet.id,
                    target_wallet_id: targetWallet.id,
                    calculation:      calc,
                    exchange_details: {
                        base_rate:     calc.rate_info.base_rate,
                        customer_rate: calc.rate_info.customer_rate,
                        spread:        calc.rate_info.spread_percentage
                    }
                }
            }, { transaction: dbTx });

            // Capture balances BEFORE mutation for accurate reporting
            const sourceBalanceBefore = r2(sourceWallet.balance);
            const targetBalanceBefore = r2(targetWallet.balance);

            // Execute exchange
            await sourceWallet.completeFundsDeduction(calc.total_source_amount, dbTx);
            await targetWallet.creditFunds(calc.converted_amount, dbTx);

            // Compute new balances explicitly — don't trust stale in-memory values
            const sourceBalanceAfter = r2(sourceBalanceBefore - calc.total_source_amount);
            const targetBalanceAfter = r2(targetBalanceBefore + calc.converted_amount);

            // ── Credit FX fee to source currency float account ────────────────
            // The fee leaves the user's wallet but belongs to the company.
            // We credit it to the float so the books balance.
            const FloatAccount = require('../models/FloatAccount');
            const sourceFloat = await FloatAccount.findOne({
                where: { currency_code: fromCurrency, status: 'active' },
                transaction: dbTx
            });
            if (sourceFloat) {
                const floatBalanceBefore = r2(parseFloat(sourceFloat.current_balance) || 0);
                await sourceFloat.update({
                    current_balance: r2(floatBalanceBefore + calc.fees.total_fee)
                }, { transaction: dbTx });
            }

            await exchangeTx.update({
                status:       'completed',
                completed_at: new Date(),
                balanceafter: sourceBalanceAfter
            }, { transaction: dbTx });

            await WalletMovement.bulkCreate([
                {
                    transaction_id: exchangeTx.id,
                    wallet_id:      sourceWallet.id,
                    movement_type:  'debit',
                    amount:         calc.total_source_amount,
                    balance_before: sourceBalanceBefore,
                    balance_after:  sourceBalanceAfter,
                    description:    `Exchange: ${calc.source_amount} ${fromCurrency} → ${calc.converted_amount} ${toCurrency} (rate: ${calc.exchange_rate}, fee: ${calc.fees.total_fee})`
                },
                {
                    transaction_id: exchangeTx.id,
                    wallet_id:      targetWallet.id,
                    movement_type:  'credit',
                    amount:         calc.converted_amount,
                    balance_before: targetBalanceBefore,
                    balance_after:  targetBalanceAfter,
                    description:    `Exchange received: ${calc.source_amount} ${fromCurrency} → ${calc.converted_amount} ${toCurrency}`
                }
            ], { transaction: dbTx });

            await dbTx.commit();

            return {
                success:         true,
                transaction_id:  exchangeTx.id,
                transaction_ref: transactionRef,
                exchange_details: {
                    from_amount:   calc.source_amount,
                    from_currency: fromCurrency,
                    to_amount:     calc.converted_amount,
                    to_currency:   toCurrency,
                    exchange_rate: calc.exchange_rate,
                    fees:          calc.fees.total_fee,
                    total_debited: calc.total_source_amount
                },
                wallet_balances: {
                    [fromCurrency]: {
                        previous_balance: sourceBalanceBefore,
                        new_balance:      sourceBalanceAfter
                    },
                    [toCurrency]: {
                        previous_balance: targetBalanceBefore,
                        new_balance:      targetBalanceAfter
                    }
                },
                idempotency_key: idempotencyKey
            };

        } catch (error) {
            if (dbTx.finished !== 'commit') await dbTx.rollback();
            throw error;
        }
    }

    // ── Get current rates for display ─────────────────────────────────────────
    static async getCurrentRates() {
        try {
            const rates = await ExternalExchangeService.getCurrentRatesWithSpread();
            return {
                success: true,
                rates: {
                    USD_to_CDF: {
                        rate:      rates.USD_to_CDF.customer_rate,
                        formatted: `1 USD = ${rates.USD_to_CDF.customer_rate.toFixed(2)} CDF`
                    },
                    CDF_to_USD: {
                        rate:      rates.CDF_to_USD.customer_rate,
                        formatted: `1 CDF = ${rates.CDF_to_USD.customer_rate.toFixed(6)} USD`
                    }
                },
                last_updated: rates.last_updated,
                spread_info:  `Rates include ${rates.USD_to_CDF.spread_percentage}% spread`
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

module.exports = CurrencyExchangeService;