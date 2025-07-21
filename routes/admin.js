const express = require('express');
const { 
  getUsers, 
  getUserById, 
  getKycRequests,
  updateKycStatus,
  getTransactions,
  getAccountsData,
  updateAccountStatus,
  getMobileMoneyStats,
  getWalletMovements,
  getFloatAccountsStatus,
  updateFloatAccountBalance,
  getWebhookLogs,
  getSystemConfigs,
  updateSystemConfig,
  retryFailedTransaction,
  getRevenueAnalytics,
  getTransactionTrends,
  getSystemHealth,
  getUserWalletOverview,
  bulkUpdateTransactionStatus
} = require('../controllers/adminController');
const authController = require('../controllers/authController');
const { authenticateAdmin } = require('../middleware/adminAuth');
const { body, query, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const router = express.Router();

// Auth routes (no middleware needed for login)
router.post('/auth/login', [
  body('email').isEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], handleValidationErrors, authController.login);

// Middleware to authenticate admin for all routes below
router.use(authenticateAdmin);

// Dashboard routes
router.get('/mobile-money/stats', getMobileMoneyStats);

// User management routes
router.get('/users', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().trim().isLength({ max: 255 })
], handleValidationErrors, getUsers);

router.get('/users/:id', [
  param('id').isInt().withMessage('Valid user ID required')
], handleValidationErrors, getUserById);

router.get('/users/:userId/wallet-overview', [
  param('userId').isInt().withMessage('Valid user ID required')
], handleValidationErrors, getUserWalletOverview);

// KYC management routes
router.get('/kyc/requests', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('verificationStatus').optional().isIn(['all', 'pending', 'verified', 'rejected', 'incomplete'])
], handleValidationErrors, getKycRequests);

router.put('/kyc/:id/status', [
  param('id').isInt().withMessage('Valid KYC ID required'),
  body('verificationStatus').isIn(['pending', 'verified', 'rejected', 'incomplete']).withMessage('Valid verification status required'),
  body('rejectionReason').optional().trim().isLength({ max: 500 })
], handleValidationErrors, updateKycStatus);

// Transaction Management Routes
router.get('/transactions', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['all', 'pending', 'processing', 'completed', 'failed', 'cancelled']),
  query('type').optional().isIn(['all', 'deposit', 'withdrawal', 'transfer']),
  query('currency').optional().isIn(['all', 'USD', 'CDF']),
  query('user_id').optional().isInt(),
  query('date_from').optional().isISO8601(),
  query('date_to').optional().isISO8601()
], handleValidationErrors, getTransactions);

router.post('/transactions/:id/retry', [
  param('id').isInt().withMessage('Valid transaction ID required'),
  body('reason').optional().trim().isLength({ max: 500 })
], handleValidationErrors, retryFailedTransaction);

router.post('/transactions/bulk-update', [
  body('transaction_ids').isArray({ min: 1 }).withMessage('Transaction IDs array required'),
  body('transaction_ids.*').isInt().withMessage('All transaction IDs must be integers'),
  body('new_status').isIn(['pending', 'processing', 'completed', 'failed', 'cancelled']).withMessage('Valid status required'),
  body('reason').optional().trim().isLength({ max: 500 })
], handleValidationErrors, bulkUpdateTransactionStatus);

// Wallet Movement Routes
router.get('/wallet-movements', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('wallet_id').optional().isInt(),
  query('transaction_id').optional().isInt(),
  query('movement_type').optional().isIn(['all', 'credit', 'debit', 'hold', 'release'])
], handleValidationErrors, getWalletMovements);

// Account management routes
router.get('/accounts', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['all', 'active', 'frozen', 'closed']),
  query('accountType').optional().isIn(['all', 'savings', 'current', 'mobile_money']),
  query('search').optional().trim().isLength({ max: 255 })
], handleValidationErrors, getAccountsData);

router.put('/accounts/:id/status', [
  param('id').isInt().withMessage('Valid account ID required'),
  body('status').isIn(['active', 'frozen', 'closed']).withMessage('Valid status required')
], handleValidationErrors, updateAccountStatus);

// Float Account Management Routes
router.get('/float-accounts', getFloatAccountsStatus);

router.put('/float-accounts/:id/balance', [
  param('id').isInt().withMessage('Valid float account ID required'),
  body('current_balance')
    .isFloat({ min: 0 })
    .withMessage('Current balance must be a positive number'),
  body('reason')
    .notEmpty()
    .trim()
    .isLength({ min: 5, max: 500 })
    .withMessage('Reason is required and must be between 5-500 characters')
], handleValidationErrors, updateFloatAccountBalance);

// Webhook Management Routes
router.get('/webhooks', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['all', 'received', 'processed', 'failed']),
  query('webhook_type').optional().isIn(['all', 'c2b_confirmation', 'b2c_result', 'timeout']),
  query('date_from').optional().isISO8601(),
  query('date_to').optional().isISO8601()
], handleValidationErrors, getWebhookLogs);

// System Configuration Routes
router.get('/system-configs', getSystemConfigs);

router.put('/system-configs/:id', [
  param('id').isInt().withMessage('Valid config ID required'),
  body('config_value')
    .notEmpty()
    .withMessage('Config value is required'),
  body('is_active')
    .optional()
    .isBoolean()
    .withMessage('is_active must be a boolean')
], handleValidationErrors, updateSystemConfig);

// Advanced Analytics Routes
router.get('/analytics/revenue', [
  query('period').optional().isIn(['daily', 'weekly', 'monthly']),
  query('date_from').optional().isISO8601(),
  query('date_to').optional().isISO8601(),
  query('currency').optional().isIn(['USD', 'CDF', 'all'])
], handleValidationErrors, getRevenueAnalytics);

router.get('/analytics/transaction-trends', [
  query('period').optional().isIn(['daily', 'weekly', 'monthly']),
  query('type').optional().isIn(['deposit', 'withdrawal', 'transfer', 'all']),
  query('date_from').optional().isISO8601(),
  query('date_to').optional().isISO8601()
], handleValidationErrors, getTransactionTrends);

// System Health Route
router.get('/system/health', getSystemHealth);

module.exports = router;