const { sequelize } = require('../config/config');

async function dropAccountBalance() {
    try {
        console.log('🗑️ Dropping balance column from accounts table...');
        console.log('💡 This ensures only wallets table handles money');
        console.log('');
        
        // Check if balance column exists first
        const columnExists = await sequelize.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'accounts' 
            AND column_name = 'balance'
        `, { type: sequelize.QueryTypes.SELECT });
        
        if (columnExists.length === 0) {
            console.log('✅ Balance column already doesn\'t exist in accounts table');
            console.log('🎉 Accounts table is clean - only handles discovery/identification');
            return;
        }
        
        console.log('📋 Found balance column in accounts table');
        console.log('⚠️ This should be removed to prevent confusion');
        console.log('');
        
        // Show current accounts structure
        console.log('📊 Current accounts table structure:');
        const accountsStructure = await sequelize.query(`
            SELECT column_name, data_type, is_nullable, column_default 
            FROM information_schema.columns 
            WHERE table_name = 'accounts' 
            ORDER BY ordinal_position
        `, { type: sequelize.QueryTypes.SELECT });
        
        accountsStructure.forEach(col => {
            const highlight = col.column_name === 'balance' ? '👉 ' : '   ';
            console.log(`${highlight}${col.column_name}: ${col.data_type}`);
        });
        
        console.log('');
        console.log('🔧 Dropping balance column...');
        
        // Drop the balance column
        await sequelize.query(`ALTER TABLE accounts DROP COLUMN balance`);
        
        console.log('✅ Balance column dropped successfully!');
        console.log('');
        
        // Verify the column is gone
        const verifyDrop = await sequelize.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'accounts' 
            AND column_name = 'balance'
        `, { type: sequelize.QueryTypes.SELECT });
        
        if (verifyDrop.length === 0) {
            console.log('🎉 Verification successful - balance column removed');
        } else {
            console.log('❌ Something went wrong - balance column still exists');
        }
        
        // Show new clean structure
        console.log('');
        console.log('📊 New accounts table structure (clean):');
        const newStructure = await sequelize.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'accounts' 
            ORDER BY ordinal_position
        `, { type: sequelize.QueryTypes.SELECT });
        
        newStructure.forEach(col => {
            console.log(`   ${col.column_name}: ${col.data_type}`);
        });
        
        console.log('');
        console.log('✅ Perfect! Now:');
        console.log('   📋 accounts = user discovery (account numbers, etc.)');
        console.log('   💰 wallets = money management (balances, transactions)');
        console.log('');
        console.log('🚀 Try your webhook test again - it should work now!');
        
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Error dropping balance column:', error);
        console.error('');
        console.error('💡 You can also run this SQL command manually:');
        console.error('   ALTER TABLE accounts DROP COLUMN balance;');
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    dropAccountBalance();
}

module.exports = dropAccountBalance;