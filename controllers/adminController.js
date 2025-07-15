const User = require('../models/User');
const { Op } = require('sequelize');

// Get dashboard statistics
const getDashboardStats = async (req, res) => {
  try {
    const totalUsers = await User.count();
    const activeUsers = await User.count({ where: { status: 'active' } });
    const pendingUsers = await User.count({ where: { status: 'pending' } });
    const suspendedUsers = await User.count({ where: { status: 'suspended' } });
    const pendingKyc = await User.count({ 
      where: { 
        status: 'pending',
        documentPath: { [Op.ne]: null }
      } 
    });

    // Get recent registrations (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentUsers = await User.count({
      where: {
        createdAt: {
          [Op.gte]: thirtyDaysAgo
        }
      }
    });

    res.json({
      success: true,
      data: {
        totalUsers,
        activeUsers,
        pendingUsers,
        suspendedUsers,
        pendingKyc,
        recentUsers
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard statistics'
    });
  }
};

// Get all users with pagination and filtering
const getUsers = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, search } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = {};
    
    // Filter by status if provided
    if (status && status !== 'all') {
      whereClause.status = status;
    }

    // Search by email, firstName, or surname
    if (search) {
      whereClause[Op.or] = [
        { email: { [Op.iLike]: `%${search}%` } },
        { firstName: { [Op.iLike]: `%${search}%` } },
        { surname: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const { count, rows: users } = await User.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      attributes: [
        'id', 'email', 'firstName', 'surname', 'phoneNumber', 
        'status', 'balance', 'kycStatus', 'lastLoginAt', 
        'createdAt', 'updatedAt'
      ],
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      data: {
        users,
        totalUsers: count,
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching users'
    });
  }
};

// Get user by ID
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id, {
      attributes: [
        'id', 'email', 'firstName', 'surname', 'phoneNumber', 
        'status', 'balance', 'kycStatus', 'documentPath',
        'documentType', 'lastLoginAt', 'createdAt', 'updatedAt'
      ]
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: { user }
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user details'
    });
  }
};

// Update user status
const updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'suspended', 'pending'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be active, suspended, or pending'
      });
    }

    const user = await User.findByPk(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    await user.update({ status });

    res.json({
      success: true,
      message: `User status updated to ${status}`,
      data: { user }
    });
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating user status'
    });
  }
};

// Get KYC requests
const getKycRequests = async (req, res) => {
  try {
    const { page = 1, limit = 10, VerificationStatus = 'pending' } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = {
      documentPath: { [Op.ne]: null }
    };

    if (VerificationStatus !== 'all') {
      whereClause.kycStatus = VerificationStatus;
    }

    const { count, rows: kycRequests } = await User.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      attributes: [
        'id', 'email', 'firstName', 'surname', 'phoneNumber',
        'kycStatus', 'documentPath', 'documentPath',
        'createdAt', 'updatedAt'
      ],
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      data: {
        kycRequests,
        totalRequests: count,
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching KYC requests:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching KYC requests'
    });
  }
};

// Update KYC status
const updateKycStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { kycStatus, rejectionReason } = req.body;

    if (!['pending', 'verified', 'rejected', 'incomplete'].includes(kycStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid KYC status. Must be pending, approved, or rejected'
      });
    }

    const user = await User.findByPk(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const updateData = { kycStatus };
    if (kycStatus === 'rejected' && rejectionReason) {
      updateData.kyc_rejection_reason = rejectionReason;
    }

    await user.update(updateData);

    res.json({
      success: true,
      message: `KYC status updated to ${kycStatus}`,
      data: { user }
    });
  } catch (error) {
    console.error('Error updating KYC status:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating KYC status'
    });
  }
};

// Get transactions (placeholder for now)
const getTransactions = async (req, res) => {
  try {
    // This would be implemented when you have transaction models
    // For now, returning mock data structure
    res.json({
      success: true,
      data: {
        transactions: [],
        totalTransactions: 0,
        currentPage: 1,
        totalPages: 0
      }
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching transactions'
    });
  }
};

// Get accounts data (placeholder for now)
const getAccountsData = async (req, res) => {
  try {
    // This would be implemented when you have account models
    // For now, returning mock data structure
    res.json({
      success: true,
      data: {
        accounts: [],
        totalAccounts: 0,
        currentPage: 1,
        totalPages: 0
      }
    });
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching accounts'
    });
  }
};

module.exports = {
  getDashboardStats,
  getUsers,
  getUserById,
  updateUserStatus,
  getKycRequests,
  updateKycStatus,
  getTransactions,
  getAccountsData
};