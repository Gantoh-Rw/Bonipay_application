const { sequelize } = require('../config/config');
const User = require('../models/User');
const Account = require('../models/Account');
const Wallet = require('../models/Wallet');

async function migrateExistingData() {
    const transaction = await sequelize.transaction();
    
    try {
        console.log('🔄 Starting migration of existing data...');
        console.log('📊 This will:');
        console.log('   1. Create wallets from existing account balances');
        console.log('   2. Update account numbers to new format (USD/CDF prefix)');
        console.log('   3. Create missing CDF accounts for users');
        console.log('   4. Preserve all existing balance data');
        console.log('');
        
        // Get all users with role 'user' (exclude admins)
        const users = await User.findAll({
            where: { role: 'user' },
            transaction
        });
        
        if (users.length === 0) {
            console.log('❌ No regular users found to migrate.');
            await transaction.commit();
            return;
        }
        
        console.log(`👥 Found ${users.length} user(s) to migrate`);
        console.log('');
        
        let migratedUsers = 0;
        let walletsCreated = 0;
        let accountsUpdated = 0;
        let cdfAccountsCreated = 0;
        
        for (const user of users) {
            console.log(`📧 Processing: ${user.email} (ID: ${user.id})`);
            
            // Get existing accounts for this user
            const existingAccounts = await Account.findAll({
                where: { userId: user.id },
                transaction
            });
            
            if (existingAccounts.length === 0) {
                console.log('   ⚠️  No accounts found - skipping');
                continue;
            }
            
            console.log(`   📋 Found ${existingAccounts.length} existing account(s)`);
            
            // Process each existing account
            for (const account of existingAccounts) {
                const oldAccountNumber = account.accountNumber;
                const currentBalance = parseFloat(account.balance) || 0;
                
                console.log(`   💳 ${account.currency} Account: ${oldAccountNumber} (Balance: ${currentBalance})`);
                
                // Create or update wallet with existing balance
                const [wallet, walletCreated] = await Wallet.findOrCreate({
                    where: { 
                        userid: user.id, 
                        currency: account.currency 
                    },
                    defaults: {
                        userid: user.id,
                        currency: account.currency,
                        balance: currentBalance,
                        available_balance: currentBalance,
                        reserved_balance: 0,
                        status: 'active'
                    },
                    transaction
                });
                
                if (walletCreated) {
                    console.log(`   ✅ Created ${account.currency} wallet with balance: ${currentBalance}`);
                    walletsCreated++;
                } else {
                    // Update existing wallet balance if needed
                    if (wallet.balance !== currentBalance) {
                        await wallet.update({
                            balance: currentBalance,
                            available_balance: currentBalance
                        }, { transaction });
                        console.log(`   🔄 Updated ${account.currency} wallet balance to: ${currentBalance}`);
                    } else {
                        console.log(`   ✅ ${account.currency} wallet already exists with correct balance`);
                    }
                }
                
                // Update account number to new format if needed
                const shouldUpdateAccountNumber = !account.accountNumber.startsWith(account.currency);
                
                if (shouldUpdateAccountNumber) {
                    const newAccountNumber = `${account.currency}${user.id}${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
                    
                    await account.update({
                        accountNumber: newAccountNumber
                    }, { transaction });
                    
                    console.log(`   🔄 Updated account number: ${oldAccountNumber} → ${newAccountNumber}`);
                    accountsUpdated++;
                } else {
                    console.log(`   ✅ Account number already in correct format: ${account.accountNumber}`);
                }
            }
            
            // Check if user needs both USD and CDF accounts
            const currencies = existingAccounts.map(acc => acc.currency);
            const hasUSD = currencies.includes('USD');
            const hasCDF = currencies.includes('CDF');
            
            // Create missing CDF account if user only has USD
            if (hasUSD && !hasCDF) {
                const cdfAccountNumber = `CDF${user.id}${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
                
                // Create CDF account
                await Account.create({
                    userId: user.id,
                    accountNumber: cdfAccountNumber,
                    accountType: 'checking',
                    currency: 'CDF',
                    status: 'active'
                }, { transaction });
                
                // Create CDF wallet with zero balance
                await Wallet.create({
                    userid: user.id,
                    currency: 'CDF',
                    balance: 0,
                    available_balance: 0,
                    reserved_balance: 0,
                    status: 'active'
                }, { transaction });
                
                console.log(`   ➕ Created missing CDF account: ${cdfAccountNumber}`);
                console.log(`   ➕ Created CDF wallet with zero balance`);
                cdfAccountsCreated++;
                walletsCreated++;
            }
            
            // Create missing USD account if user only has CDF (edge case)
            if (hasCDF && !hasUSD) {
                const usdAccountNumber = `USD${user.id}${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
                
                await Account.create({
                    userId: user.id,
                    accountNumber: usdAccountNumber,
                    accountType: 'checking',
                    currency: 'USD',
                    status: 'active'
                }, { transaction });
                
                await Wallet.create({
                    userid: user.id,
                    currency: 'USD',
                    balance: 0,
                    available_balance: 0,
                    reserved_balance: 0,
                    status: 'active'
                }, { transaction });
                
                console.log(`   ➕ Created missing USD account: ${usdAccountNumber}`);
                console.log(`   ➕ Created USD wallet with zero balance`);
                walletsCreated++;
            }
            
            migratedUsers++;
            console.log(`   ✅ User migration completed\n`);
        }
        
        await transaction.commit();
        
        console.log('🎉 Migration completed successfully!');
        console.log('');
        console.log('📊 Migration Summary:');
        console.log(`   👥 Users migrated: ${migratedUsers}`);
        console.log(`   💰 Wallets created/updated: ${walletsCreated}`);
        console.log(`   💳 Account numbers updated: ${accountsUpdated}`);
        console.log(`   🆕 CDF accounts created: ${cdfAccountsCreated}`);
        console.log('');
        console.log('✅ All existing balances have been preserved');
        console.log('✅ All users now have both USD and CDF accounts');
        console.log('✅ All account numbers follow new format');
        console.log('✅ Wallet-based balance management is now active');
        console.log('');
        console.log('🚀 Your system is ready for the new architecture!');
        
        // Show final summary
        const finalUsers = await User.findAll({ where: { role: 'user' } });
        const finalAccounts = await Account.findAll({
            where: { userId: finalUsers.map(u => u.id) }
        });
        const finalWallets = await Wallet.findAll({
            where: { userid: finalUsers.map(u => u.id) }
        });
        
        console.log('');
        console.log('📋 Final System State:');
        console.log(`   Users: ${finalUsers.length}`);
        console.log(`   Accounts: ${finalAccounts.length}`);
        console.log(`   Wallets: ${finalWallets.length}`);
        
        process.exit(0);
        
    } catch (error) {
        await transaction.rollback();
        console.error('❌ Migration failed:', error);
        console.error('');
        console.error('💡 The database has been rolled back to its original state.');
        console.error('💡 No data was lost. You can fix the issue and run the migration again.');
        process.exit(1);
    }
}

// Add safety check
async function checkBeforeMigration() {
    try {
        console.log('🔍 Pre-migration checks...');
        
        // Check if models are accessible
        const userCount = await User.count();
        const accountCount = await Account.count();
        
        console.log(`📊 Current database state:`);
        console.log(`   Users: ${userCount}`);
        console.log(`   Accounts: ${accountCount}`);
        
        if (userCount === 0) {
            console.log('⚠️  No users found. Migration not needed.');
            process.exit(0);
        }
        
        console.log('✅ Pre-migration checks passed');
        console.log('');
        
        // Start migration
        await migrateExistingData();
        
    } catch (error) {
        console.error('❌ Pre-migration check failed:', error);
        console.error('💡 Please ensure your database is running and models are properly configured.');
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    checkBeforeMigration();
}

module.exports = migrateExistingData;