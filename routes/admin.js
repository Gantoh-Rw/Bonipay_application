const express = require('express');
const { 
  getUsers, 
  getUserById, 
  updateUserStatus, 
  getDashboardStats,
  getKycRequests,
  updateKycStatus,
  getTransactions,
  getAccountsData
} = require('../controllers/adminController');
const authController = require('../controllers/authController');
const { authenticateAdmin } = require('../middleware/adminAuth');
const router = express.Router();

// Auth routes (no middleware needed for login)
router.post('/auth/login', authController.login);

// Middleware to authenticate admin for all routes below
router.use(authenticateAdmin);

// Dashboard routes
router.get('/dashboard-stats', getDashboardStats);

// User management routes
router.get('/users', getUsers);
router.get('/users/:id', getUserById);
router.put('/users/:id/status', updateUserStatus);

// KYC management routes
router.get('/kyc/requests', getKycRequests);
router.put('/kyc/:id/status', updateKycStatus);

// Transaction management routes
router.get('/transactions', getTransactions);

// Account management routes
router.get('/accounts', getAccountsData);

module.exports = router;