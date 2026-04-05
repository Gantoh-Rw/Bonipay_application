const express = require('express');
const cors    = require('cors');
const { sequelize } = require('./config/config');
const ExternalExchangeService = require('./services/ExternalExchangeService');
require('dotenv').config();

// ── Models ────────────────────────────────────────────────────────────────────
const User           = require('./models/User');
const Account        = require('./models/Account');
const kyc            = require('./models/kyc');
const Wallet         = require('./models/Wallet');
const FloatAccount   = require('./models/FloatAccount');
const MpesaWebhook   = require('./models/MpesaWebhook');
const WalletMovement = require('./models/WalletMovement');
const SystemConfig   = require('./models/SystemConfig');
const Transaction    = require('./models/Transaction');

// ── Routes ────────────────────────────────────────────────────────────────────
const authRoutes        = require('./routes/auth');
const accountRoutes     = require('./routes/account');
const kycRoutes         = require('./routes/kyc');
const adminRoutes       = require('./routes/admin');
const mobileMoneyRoutes = require('./routes/mobileMoneyRoutes');
const webhookRoutes     = require('./routes/webhookRoutes');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://192.168.43.223:8081', 'http://localhost:8081'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key']
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Static files (KYC documents) ─────────────────────────────────────────────
// Serves uploaded KYC documents so the admin dashboard can display them.
// e.g. GET http://localhost:3000/uploads/kyc-documents/kyc-12-xxx.png
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',         authRoutes);
app.use('/api/account',      accountRoutes);
app.use('/api/kyc',          kycRoutes);
app.use('/api/admin',        adminRoutes);
app.use('/api/mobile-money', mobileMoneyRoutes);
app.use('/api/webhooks',     webhookRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.json({
        message:     'Bonipay API – SAFARICOM KEN M-Pesa',
        version:     '2.0.0',
        timestamp:   new Date().toISOString(),
        provider:    'Safaricom KENYA',
        currencies:  ['USD', 'KES'],
        simulation:  process.env.MPESA_SIMULATION === 'true',
        endpoints: {
            deposit:    'POST /api/mobile-money/deposit',
            withdraw:   'POST /api/mobile-money/withdraw',
            send_money: 'POST /api/mobile-money/send-money',
            transfer:   'POST /api/mobile-money/transfer',
            exchange:   'POST /api/mobile-money/exchange',
            balance:    'GET  /api/mobile-money/balance/:currency',
            history:    'GET  /api/mobile-money/transactions'
        }
    });
});

// ── Error handlers ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
});

app.use('*', (req, res) => {
    res.status(404).json({ success: false, message: 'Route not found' });
});

// ── Database + associations + server start ────────────────────────────────────
async function startServer() {
    try {
        await sequelize.authenticate();
        

        console.log('✅ Database connected');

        // Associations
        User.hasMany(Account,     { foreignKey: 'userId' });
        User.hasMany(Wallet,      { foreignKey: 'userid' });
        User.hasMany(Transaction, { foreignKey: 'userid' });
        User.hasOne(kyc,          { foreignKey: 'userId' });

        Account.belongsTo(User,   { foreignKey: 'userId' });
        Account.hasMany(Wallet,   { foreignKey: 'userid', sourceKey: 'userId' });

        Wallet.belongsTo(User,                 { foreignKey: 'userid' });
        Wallet.hasMany(WalletMovement,          { foreignKey: 'wallet_id' });

        Transaction.belongsTo(User,            { foreignKey: 'userid' });
        Transaction.belongsTo(Wallet,          { foreignKey: 'walletid' });
        Transaction.belongsTo(FloatAccount,    { foreignKey: 'float_account_id' });
        Transaction.hasMany(WalletMovement,    { foreignKey: 'transaction_id' });
        Transaction.hasMany(MpesaWebhook,      { foreignKey: 'transaction_id' });

        kyc.belongsTo(User,                    { foreignKey: 'userId' });
        FloatAccount.hasMany(Transaction,      { foreignKey: 'float_account_id' });
        MpesaWebhook.belongsTo(Transaction,    { foreignKey: 'transaction_id' });
        WalletMovement.belongsTo(Transaction,  { foreignKey: 'transaction_id' });
        WalletMovement.belongsTo(Wallet,       { foreignKey: 'wallet_id' });

        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`💳 Provider  : Safaricom KENYA M-Pesa`);
            console.log(`💱 Currencies: USD, KES`);
            console.log(`🧪 Simulation: ${process.env.MPESA_SIMULATION === 'true' ? 'ON' : 'OFF'}`);
            console.log(`📡 Webhooks  : http://localhost:${PORT}/api/webhooks`);
            console.log(`💰 Money API : http://localhost:${PORT}/api/mobile-money`);
        });
         ExternalExchangeService.scheduleRateUpdate();
        await ExternalExchangeService.updateExchangeRates();
        

    } catch (error) {
        console.error('❌ Startup failed:', error);
        process.exit(1);
    }
}

startServer();