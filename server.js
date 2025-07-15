const express = require('express');
const cors = require('cors');
const sequelize = require('./config/database');
require('dotenv').config();

// Import models
const User = require('./models/User');
const Account = require('./models/Account');
const kyc = require('./models/kyc');

// Import routes
const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/account');
const kycRoutes = require('./routes/kyc');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS Configuration - THIS IS THE FIX
const corsOptions = {
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'], // Your frontend URLs
  credentials: true, // Allow cookies/credentials
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Middleware
app.use(cors(corsOptions)); // Use the configured CORS options
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/', (req, res) => {
    res.json({
        message: 'Money Transfer API is running!',
        version: '1.0.0',
        timestamp: new Date().toISOString()
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
        
        // Define model associations (important for queries to work properly)
        User.hasMany(Account, { foreignKey: 'userId' });
        Account.belongsTo(User, { foreignKey: 'userId' });
        User.hasOne(kyc, { foreignKey: 'userId' });
        kyc.belongsTo(User, { foreignKey: 'userId' });
        
        // Start server
        app.listen(PORT, () => {
            console.log(`🚀 Server is running on port ${PORT}`);
            console.log(`📱 API URL: http://localhost:${PORT}`);
            console.log(`🏥 Health check: http://localhost:${PORT}/`);
            console.log(`🌐 CORS enabled for: http://localhost:5173`);
            console.log('📋 Note: Tables should be created manually in Supabase');
        });
    } catch (error) {
        console.error('❌ Unable to start server:', error);
        process.exit(1);
    }
}

startServer();