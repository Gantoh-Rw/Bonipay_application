const { sequelize } = require('../config/config');
const FloatAccount = require('../models/FloatAccount');
const SystemConfig = require('../models/SystemConfig');

async function seedMobileMoneyData() {
    try {
        console.log('🌱 Seeding mobile money data...');
        
        // Create float accounts (replace with your actual M-Pesa details)
        const floatAccounts = await FloatAccount.bulkCreate([
            {
                currency_code: 'USD',
                account_type: 'mpesa_usd',
                paybill_number: '123456', // ← Replace with your actual USD paybill
                current_balance: 10000.00,
                low_balance_threshold: 1000.00,
                status: 'active'
            },
            {
                currency_code: 'CDF',
                account_type: 'mpesa_cdf',
                paybill_number: '654321', // ← Replace with your actual CDF paybill
                current_balance: 25000000.00,
                low_balance_threshold: 1000000.00,
                status: 'active'
            }
        ], {
            ignoreDuplicates: true
        });
        
        // Create system configurations
        const systemConfigs = await SystemConfig.bulkCreate([
            {
                config_key: 'deposit_fee_percentage',
                config_value: '1.0',
                config_type: 'number',
                description: 'Percentage fee for deposits'
            },
            {
                config_key: 'withdrawal_fee_flat',
                config_value: '0.50',
                config_type: 'number',
                description: 'Flat fee for withdrawals'
            },
            {
                config_key: 'withdrawal_fee_percentage',
                config_value: '1.0',
                config_type: 'number',
                description: 'Percentage fee for withdrawals'
            },
            {
                config_key: 'transfer_fee_flat',
                config_value: '0.10',
                config_type: 'number',
                description: 'Flat fee for internal transfers'
            },
            {
                config_key: 'fx_spread_percentage',
                config_value: '2.0',
                config_type: 'number',
                description: 'FX spread percentage'
            },
            {
                config_key: 'max_daily_withdrawal',
                config_value: '1000.00',
                config_type: 'number',
                description: 'Maximum daily withdrawal limit'
            },
            {
                config_key: 'max_daily_deposit',
                config_value: '5000.00',
                config_type: 'number',
                description: 'Maximum daily deposit limit'
            },
            {
                config_key: 'max_transfer_amount',
                config_value: '10000.00',
                config_type: 'number',
                description: 'Maximum transfer amount per transaction'
            }
        ], {
            ignoreDuplicates: true
        });
        
        console.log('✅ Mobile money data seeded successfully');
        console.log(`📊 Created/verified ${floatAccounts.length} float accounts`);
        console.log(`⚙️ Created/verified ${systemConfigs.length} system configurations`);
        
        // Display the created float accounts
        const allFloatAccounts = await FloatAccount.findAll();
        console.log('\n🏦 Float Accounts:');
        allFloatAccounts.forEach(acc => {
            console.log(`  ${acc.currency_code}: Paybill ${acc.paybill_number} (Balance: ${acc.current_balance})`);
        });
        
        console.log('\n🎯 Next steps:');
        console.log('1. Update paybill numbers with your actual M-Pesa account details');
        console.log('2. Test the mobile money API endpoints');
        console.log('3. Configure M-Pesa webhooks');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding mobile money data:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    seedMobileMoneyData();
}

module.exports = seedMobileMoneyData;