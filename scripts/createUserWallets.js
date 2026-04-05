const { sequelize } = require('../config/config');
const User = require('../models/User');
const Account = require('../models/Account');

async function createUserWallets() {
    try {
        console.log('🏦 Creating wallets for regular users only...');
        
        // Get only users with role 'user' (exclude admins)
        const users = await User.findAll({
            where: {
                role: 'user'
            }
        });
        
        if (users.length === 0) {
            console.log('❌ No regular users found. Only admins exist.');
            console.log('💡 Wallets are only created for users with role="user", not admins.');
            return;
        }
        
        console.log(`📊 Found ${users.length} regular user(s) to process...`);
        
        for (const user of users) {
            console.log(`\nCreating wallets for user: ${user.email} (ID: ${user.id}, Role: ${user.role})`);
            
            // Create USD wallet
            const [usdWallet, usdCreated] = await Account.findOrCreate({
                where: { 
                    userId: user.id, 
                    currency: 'USD' 
                },
                defaults: {
                    userId: user.id,
                    accountNumber: `USD${user.id}${Date.now()}`,
                    accountType: 'checking',
                    balance: 0.00,
                    currency: 'USD',
                    status: 'active'
                }
            });
            
            // Create KES wallet
            const [kesWallet, kesCreated] = await Account.findOrCreate({
                where: { 
                    userId: user.id, 
                    currency: 'KES' 
                },
                defaults: {
                    userId: user.id,
                    accountNumber: `KES${user.id}${Date.now()}`,
                    accountType: 'checking',
                    balance: 0.00,
                    currency: 'KES',
                    status: 'active'
                }
            });
            
            console.log(`  ✅ USD Wallet: ${usdCreated ? 'Created' : 'Already exists'} (ID: ${usdWallet.id})`);
            console.log(`  ✅ KES Wallet: ${kesCreated ? 'Created' : 'Already exists'} (ID: ${kesWallet.id})`);
        }
        
        // FIXED: Show final wallet summary WITHOUT associations
        const allUsers = await User.findAll({
            where: { role: 'user' },
            attributes: ['id', 'email', 'role']
        });
        
        const userWallets = await Account.findAll({
            where: {
                userId: allUsers.map(user => user.id)
            },
            order: [['userId', 'ASC'], ['currency', 'ASC']]
        });
        
        console.log('\n🏦 Wallet Summary (Users Only):');
        if (userWallets.length === 0) {
            console.log('  No wallets found for regular users.');
        } else {
            userWallets.forEach(wallet => {
                const user = allUsers.find(u => u.id === wallet.userId);
                console.log(`  📧 ${user?.email || 'Unknown'} | ${wallet.currency} Wallet (ID: ${wallet.id}) | Balance: ${wallet.balance}`);
            });
        }
        
        // Show admin summary (no wallets)
        const admins = await User.findAll({
            where: { role: 'admin' },
            attributes: ['id', 'email', 'role']
        });
        
        if (admins.length > 0) {
            console.log('\n👨‍💼 Admin Users (No Wallets Created):');
            admins.forEach(admin => {
                console.log(`  📧 ${admin.email} (ID: ${admin.id}) - Admin role`);
            });
        }
        
        console.log('\n✅ Wallet creation completed!');
        console.log('💡 Note: Only regular users (role="user") have wallets. Admins manage the system but don\'t transact.');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error creating wallets:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    createUserWallets();
}

module.exports = createUserWallets;