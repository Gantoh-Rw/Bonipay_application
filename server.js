const express = require('express');
const cors = require('cors');
const sequelize = require('./config/database');
require('dotenv').config();

// Import models
const User = require('./models/User');
const Account = require('./models/Account');

// Import routes
const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/account');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/account', accountRoutes);

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
        
        // Start server
        app.listen(PORT, () => {
            console.log(`🚀 Server is running on port ${PORT}`);
            console.log(`📱 API URL: http://localhost:${PORT}`);
            console.log(`🏥 Health check: http://localhost:${PORT}/`);
            console.log('📋 Note: Tables should be created manually in Supabase');
        });
    } catch (error) {
        console.error('❌ Unable to start server:', error);
        process.exit(1);
    }
}

startServer();