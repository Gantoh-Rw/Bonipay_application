const axios = require('axios');
const SystemConfig = require('../models/SystemConfig');
const { sequelize } = require('../config/config');

class ExternalExchangeService {
    // Fetch rates from external APIs
    static async fetchRatesFromAPI() {
        try {
            console.log('🌐 Fetching exchange rates from external API...');
            
            // Try exchangerate.host first (free, no API key needed)
            try {
                const response = await axios.get('https://api.exchangerate-api.com/v4/latest/USD', {
                    timeout: 10000
                });
                
                if (response.data && response.data.rates && response.data.rates.KES) {
                    const usdToKes = parseFloat(response.data.rates.KES);
                    const kesToUsd = 1 / usdToKes;
                    
                    return {
                        success: true,
                        rates: {
                            USD_to_KES: usdToKes,
                            KES_to_USD: kesToUsd
                        },
                        provider: 'exchangerate-api.com',
                        timestamp: new Date()
                    };
                }
            } catch (apiError) {
                console.log('⚠️ Primary API failed, trying backup...');
            }
            
            // Backup: Use fixer.io (requires free API key)
            const fixerApiKey = process.env.FIXER_API_KEY;
            if (fixerApiKey) {
                try {
                    const response = await axios.get(`http://data.fixer.io/api/latest?access_key=${fixerApiKey}&base=USD&symbols=KES`, {
                        timeout: 10000
                    });
                    
                    if (response.data && response.data.rates && response.data.rates.KES) {
                        const usdToKes = parseFloat(response.data.rates.KES);
                        const kesToUsd = 1 / usdToKes;
                        
                        return {
                            success: true,
                            rates: {
                                USD_to_KES: usdToKes,
                                KES_to_USD: kesToUsd
                            },
                            provider: 'fixer.io',
                            timestamp: new Date()
                        };
                    }
                } catch (fixerError) {
                    console.log('⚠️ Fixer.io API also failed');
                }
            }
            
            // If all APIs fail, return error
            throw new Error('All exchange rate APIs failed');
            
        } catch (error) {
            console.error('❌ External rate fetch failed:', error.message);
            return {
                success: false,
                error: error.message,
                rates: null
            };
        }
    }
    
    // Update exchange rates in database
    static async updateExchangeRates() {
        const transaction = await sequelize.transaction();
        
        try {
            // Check if live rates are enabled
            const useLiveRates = await SystemConfig.getValue('use_live_exchange_rates', true);
            if (!useLiveRates) {
                return {
                    success: false,
                    message: 'Live exchange rates are disabled by admin'
                };
            }
            
            // Fetch rates from external API
            const apiResult = await this.fetchRatesFromAPI();
            
            if (!apiResult.success) {
                // Use fallback rates if API fails
                const fallbackUsdToKes = await SystemConfig.getValue('fallback_usd_to_kes', 2800.00);
                const fallbackKesToUsd = 1 / fallbackUsdToKes;
                
                apiResult.rates = {
                    USD_to_KES: fallbackUsdToKes,
                    KES_to_USD: fallbackKesToUsd
                };
                apiResult.provider = 'fallback';
                apiResult.success = true;
            }
            
            // Update rates in fx_rates table
            await sequelize.query(`
                INSERT INTO fx_rates (sourcecurrency, targetcurrency, rate, updatedat, provider)
                VALUES 
                    ('USD', 'KES', :usd_to_kes, NOW(), :provider),
                    ('KES', 'USD', :kes_to_usd, NOW(), :provider)
                ON CONFLICT (sourcecurrency, targetcurrency) 
                DO UPDATE SET 
                    rate = EXCLUDED.rate,
                    updatedat = EXCLUDED.updatedat,
                    provider = EXCLUDED.provider
            `, {
                type: sequelize.QueryTypes.INSERT,
                replacements: {
                    usd_to_kes: apiResult.rates.USD_to_KES,
                    kes_to_usd: apiResult.rates.KES_to_USD,
                    provider: apiResult.provider || 'external'
                },
                transaction
            });
            
            await transaction.commit();
            
            console.log('✅ Exchange rates updated successfully');
            console.log(`💱 USD → KES: ${apiResult.rates.USD_to_KES.toFixed(2)}`);
            console.log(`💱 KES → USD: ${apiResult.rates.KES_to_USD.toFixed(6)}`);
            
            return {
                success: true,
                rates: apiResult.rates,
                provider: apiResult.provider,
                updated_at: new Date()
            };
            
        } catch (error) {
            await transaction.rollback();
            console.error('❌ Rate update failed:', error.message);
            throw error;
        }
    }
    
    // Get current rates with spread applied
    static async getCurrentRatesWithSpread() {
        try {
            // Get base rates from database
            const baseRates = await sequelize.query(`
                SELECT sourcecurrency, targetcurrency, rate, updatedat, provider
                FROM fx_rates 
                WHERE sourcecurrency IN ('USD', 'KES') 
                AND targetcurrency IN ('USD', 'KES')
                ORDER BY updatedat DESC
            `, {
                type: sequelize.QueryTypes.SELECT
            });
            
            if (baseRates.length === 0) {
                // No rates in database, fetch fresh ones
                await this.updateExchangeRates();
                return await this.getCurrentRatesWithSpread();
            }
            
            // Get spread percentage from config
            const spreadPercentage = await SystemConfig.getValue('fx_spread_percentage', 2.5);
            const spreadMultiplier = spreadPercentage / 100;
            
            // Find USD->KES and KES->USD rates
            const usdToKesRate = baseRates.find(r => r.sourcecurrency === 'USD' && r.targetcurrency === 'KES');
            const kesToUsdRate = baseRates.find(r => r.sourcecurrency === 'KES' && r.targetcurrency === 'USD');
            
            if (!usdToKesRate || !kesToUsdRate) {
                throw new Error('Exchange rates not found in database');
            }
            
            // Apply spread (customers get slightly worse rates)
            const usdToKesCustomer = parseFloat(usdToKesRate.rate) * (1 - spreadMultiplier);
            const kesToUsdCustomer = parseFloat(kesToUsdRate.rate) * (1 - spreadMultiplier);
            
            return {
                USD_to_KES: {
                    base_rate: parseFloat(usdToKesRate.rate),
                    customer_rate: usdToKesCustomer,
                    spread_percentage: spreadPercentage
                },
                KES_to_USD: {
                    base_rate: parseFloat(kesToUsdRate.rate),
                    customer_rate: kesToUsdCustomer,
                    spread_percentage: spreadPercentage
                },
                last_updated: usdToKesRate.updatedat,
                provider: usdToKesRate.provider,
                live_rates_enabled: await SystemConfig.getValue('use_live_exchange_rates', true)
            };
            
        } catch (error) {
            console.error('❌ Get rates with spread failed:', error.message);
            throw error;
        }
    }
    
    // Set custom rate (admin override)
    static async setCustomRate(fromCurrency, toCurrency, rate, adminUserId) {
        const transaction = await sequelize.transaction();
        
        try {
            // Disable live rates when admin sets custom rate
            await SystemConfig.update(
                { config_value: 'false' },
                { where: { config_key: 'use_live_exchange_rates' } },
                { transaction }
            );
            
            // Insert custom rate
            await sequelize.query(`
                INSERT INTO fx_rates (sourcecurrency, targetcurrency, rate, updatedat, provider, updated_by)
                VALUES (:from_currency, :to_currency, :rate, NOW(), 'admin_override', :admin_id)
                ON CONFLICT (sourcecurrency, targetcurrency) 
                DO UPDATE SET 
                    rate = EXCLUDED.rate,
                    updatedat = EXCLUDED.updatedat,
                    provider = EXCLUDED.provider,
                    updated_by = EXCLUDED.updated_by
            `, {
                type: sequelize.QueryTypes.INSERT,
                replacements: {
                    from_currency: fromCurrency,
                    to_currency: toCurrency,
                    rate: parseFloat(rate),
                    admin_id: adminUserId
                },
                transaction
            });
            
            // Also set the reverse rate
            if (fromCurrency === 'USD' && toCurrency === 'KES') {
                const reverseRate = 1 / parseFloat(rate);
                await sequelize.query(`
                    INSERT INTO fx_rates (sourcecurrency, targetcurrency, rate, updatedat, provider, updated_by)
                    VALUES ('KES', 'USD', :reverse_rate, NOW(), 'admin_override', :admin_id)
                    ON CONFLICT (sourcecurrency, targetcurrency) 
                    DO UPDATE SET 
                        rate = EXCLUDED.rate,
                        updatedat = EXCLUDED.updatedat,
                        provider = EXCLUDED.provider,
                        updated_by = EXCLUDED.updated_by
                `, {
                    type: sequelize.QueryTypes.INSERT,
                    replacements: {
                        reverse_rate: reverseRate,
                        admin_id: adminUserId
                    },
                    transaction
                });
            }
            
            await transaction.commit();
            
            console.log(`📝 Admin ${adminUserId} set custom rate: ${fromCurrency}→${toCurrency} = ${rate}`);
            
            return {
                success: true,
                from_currency: fromCurrency,
                to_currency: toCurrency,
                rate: parseFloat(rate),
                set_by: adminUserId,
                set_at: new Date()
            };
            
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    }
    
    // Schedule automatic rate updates
    static scheduleRateUpdate() {
        const updateInterval = parseInt(process.env.RATE_UPDATE_INTERVAL_MINUTES || 30) * 60 * 1000;
        
        setInterval(async () => {
            try {
                console.log('🔄 Scheduled exchange rate update...');
                await this.updateExchangeRates();
            } catch (error) {
                console.error('❌ Scheduled rate update failed:', error.message);
            }
        }, updateInterval);
        
        console.log(`⏰ Exchange rate updates scheduled every ${updateInterval / 60000} minutes`);
    }
}

module.exports = ExternalExchangeService;