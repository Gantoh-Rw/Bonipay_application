const User = require('../models/User');
const kyc = require('../models/kyc');
const Account = require('../models/Account');
const Wallet =require('../models/Wallet');
const { Op } = require('sequelize');

// Get dashboard statistics
const getDashboardStats = async (req, res) => {
  try {
    const totalUsers = await User.count();
    const activeUsers = await Account.count({ where: { status: 'active' } });
    const pendingUsers = await Account.count({ where: { status: 'pending' } });
    const suspendedUsers = await Account.count({ where: { status: 'suspended' } });
    const pendingKyc = await kyc.count({ 
      where: { 
        verificationStatus: 'pending',
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

    let whereClause = {role: 'user'};
    
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
        'status', 'balance', 'lastLoginAt','emailVerified', 
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
        'status', 'balance',
         'lastLoginAt', 'createdAt', 'updatedAt','emailVerified'
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

// Get KYC requests - FIXED VERSION
const getKycRequests = async (req, res) => {
  try {
    const { page = 1, limit = 10, verificationStatus = 'pending' } = req.query;
    const offset = (page - 1) * limit;

    // Build where clause for KYC table only
    const kycWhereClause = {
      documentPath: { [Op.ne]: null }
    };

    if (verificationStatus !== 'all') {
      kycWhereClause.verificationStatus = verificationStatus;
    }

    const { count, rows: kycRequests } = await kyc.findAndCountAll({
      where: kycWhereClause,
      include: [{
        model: User,
        where: { role: 'user' }, // Filter users by role in the include
        attributes: ['email', 'firstName', 'surname', 'phoneNumber'],
        required: true // This ensures we only get KYC records with valid user relationships
      }],
      limit: parseInt(limit),
      offset: parseInt(offset),
      attributes: [
        'id', 'userId', 'fullName', 'nationality', 'gender',
        'dateOfBirth', 'identityType', 'identityNumber', 'documentPath',
        'verificationStatus', 'rejectionReason', 'verifiedAt',
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
    const { verificationStatus, rejectionReason } = req.body;

    if (!['pending', 'verified', 'rejected', 'incomplete'].includes(verificationStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification status. Must be pending, verified, rejected, or incomplete'
      });
    }

    const kycRecord = await kyc.findByPk(id);

    if (!kycRecord) {
      return res.status(404).json({
        success: false,
        message: 'KYC record not found'
      });
    }

    const updateData = { verificationStatus };
    
    if (verificationStatus === 'verified') {
      updateData.verifiedAt = new Date();
      // Check if req.admin exists before using it
      if (req.admin && req.admin.id) {
        updateData.verifiedBy = req.admin.id;
      }
    }
    
    if (verificationStatus === 'rejected' && rejectionReason) {
      updateData.rejectionReason = rejectionReason;
    }

    await kycRecord.update(updateData);

    // Include user data in response
    const updatedRecord = await kyc.findByPk(id, {
      include: [{
        model: User,
        attributes: ['email', 'firstName', 'surname']
      }]
    });

    res.json({
      success: true,
      message: `KYC status updated to ${verificationStatus}`,
      data: { kycRecord: updatedRecord }
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

const getAccountsData = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, accountType, search } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = {};
    
    // Filter by status if provided
    if (status && status !== 'all') {
      whereClause.status = status;
    }

    // Filter by account type if provided
    if (accountType && accountType !== 'all') {
      whereClause.accountType = accountType;
    }

    // Search by account number
    if (search) {
      whereClause.accountNumber = { [Op.iLike]: `%${search}%` };
    }

    const { count, rows: accounts } = await Account.findAndCountAll({
      where: whereClause,
      include: [{
        model: User,
        attributes: ['id', 'email', 'firstName', 'surname', 'phoneNumber'],
        required: true
      }],
      limit: parseInt(limit),
      offset: parseInt(offset),
      attributes: [
        'id', 'userId', 'accountNumber', 'accountType',  
        'currency', 'status', 'createdAt', 'updatedAt'
      ],
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      data: {
        accounts,
        totalAccounts: count,
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit)
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

// Update account status
const updateAccountStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'frozen', 'closed'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be active, frozen, or closed'
      });
    }

    const account = await Account.findByPk(id);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    await account.update({ status });

    // Get updated account with user data
    const updatedAccount = await Account.findByPk(id, {
      include: [{
        model: User,
        attributes: ['email', 'firstName', 'surname']
      }]
    });

    res.json({
      success: true,
      message: `Account status updated to ${status}`,
      data: { account: updatedAccount }
    });
  } catch (error) {
    console.error('Error updating account status:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating account status'
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
  getAccountsData,
  updateAccountStatus
};