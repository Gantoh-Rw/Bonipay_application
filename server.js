const express = require('express');
const cors = require('cors');
const {sequelize} = require('./config/config');
require('dotenv').config();

// Import existing models
const User = require('./models/User');
const Account = require('./models/Account');
const kyc = require('./models/kyc');
const Wallet = require('./models/Wallet');

// Import NEW mobile money models
const FloatAccount = require('./models/FloatAccount');
const MpesaWebhook = require('./models/MpesaWebhook');
const WalletMovement = require('./models/WalletMovement');
const SystemConfig = require('./models/SystemConfig');
const Transaction = require('./models/Transaction');


// Import existing routes
const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/account');
const kycRoutes = require('./routes/kyc');
const adminRoutes = require('./routes/admin');

// Import NEW mobile money routes
const mobileMoneyRoutes = require('./routes/mobileMoneyRoutes');
const webhookRoutes = require('./routes/webhookRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS Configuration
const corsOptions = {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Existing routes
app.use('/api/auth', authRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/admin', adminRoutes);


// NEW mobile money routes
app.use('/api/mobile-money', mobileMoneyRoutes);
app.use('/api/webhooks', webhookRoutes);

// Health check
app.get('/', (req, res) => {
    res.json({
        message: 'Money Transfer API with Mobile Money is running!',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        features: ['Mobile Money', 'M-Pesa Integration', 'Webhooks']
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// Database connection and server start
async function startServer() {
    try {
        // Test database connection
        await sequelize.authenticate();
        console.log('✅ Database connected successfully');
        
       // User associations
       User.hasMany(Account, { foreignKey: 'userId' });
       User.hasMany(Wallet, { foreignKey: 'userid' });
       User.hasMany(Transaction, { foreignKey: 'userid' });
       User.hasOne(kyc, { foreignKey: 'userId' });

       // Account associations (for discovery/search only)
       Account.belongsTo(User, { foreignKey: 'userId' });
       Account.hasMany(Wallet, { foreignKey: 'userid', sourceKey: 'userId' });

       // Wallet associations (for balance management)
       Wallet.belongsTo(User, { foreignKey: 'userid' });
       Wallet.hasMany(WalletMovement, { foreignKey: 'wallet_id' });

       // Transaction associations
       Transaction.belongsTo(User, { foreignKey: 'userid' });
       Transaction.belongsTo(Wallet, { foreignKey: 'walletid' });
       Transaction.belongsTo(FloatAccount, { foreignKey: 'float_account_id' });
       Transaction.hasMany(WalletMovement, { foreignKey: 'transaction_id' });
       Transaction.hasMany(MpesaWebhook, { foreignKey: 'transaction_id' });
    

       // Other associations
       kyc.belongsTo(User, { foreignKey: 'userId' });
       FloatAccount.hasMany(Transaction, { foreignKey: 'float_account_id' });
       MpesaWebhook.belongsTo(Transaction, { foreignKey: 'transaction_id' });
       WalletMovement.belongsTo(Transaction, { foreignKey: 'transaction_id' });
       WalletMovement.belongsTo(Wallet, { foreignKey: 'wallet_id' });
        
        // Start server
        app.listen(PORT, () => {
            console.log(`🚀 Server is running on port ${PORT}`);
            console.log(`📱 API URL: http://localhost:${PORT}`);
            console.log(`🏥 Health check: http://localhost:${PORT}/`);
            console.log(`💰 Mobile Money API: http://localhost:${PORT}/api/mobile-money`);
            console.log(`🔗 Webhooks: http://localhost:${PORT}/api/webhooks`);
            console.log(`🌐 CORS enabled for: http://localhost:5173`);
        });
    } catch (error) {
        console.error('❌ Unable to start server:', error);
        process.exit(1);
    }
}

startServer();