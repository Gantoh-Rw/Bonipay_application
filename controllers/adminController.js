const { sequelize } = require('../config/config');
const User = require('../models/User');
const kyc = require('../models/kyc');
const Account = require('../models/Account');
const { Op } = require('sequelize');
const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');
const FloatAccount = require('../models/FloatAccount');
const MpesaWebhook = require('../models/MpesaWebhook');
const WalletMovement = require('../models/WalletMovement');
const SystemConfig = require('../models/SystemConfig');


const getMobileMoneyStats = async (req, res) => {
    try {
        // Get basic stats
        const totalUsers = await User.count();
        const activeWallets = await Wallet.count({ where: { status: 'active' } });
        
        // Transaction stats
        const totalTransactions = await Transaction.count();
        const completedTransactions = await Transaction.count({ where: { status: 'completed' } });
        const pendingTransactions = await Transaction.count({ where: { status: 'pending' } });
        const failedTransactions = await Transaction.count({ where: { status: 'failed' } });
        
        // Transaction types breakdown
        const deposits = await Transaction.count({ where: { type: 'deposit' } });
        const withdrawals = await Transaction.count({ where: { type: 'withdrawal' } });
        const transfers = await Transaction.count({ where: { type: 'transfer' } });
        
        // Revenue from fees (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const feeRevenue = await Transaction.sum('fees', {
            where: {
                status: 'completed',
                createdat: { [Op.gte]: thirtyDaysAgo }
            }
        });
        
        // Total money in system (all wallet balances) - Fixed sequelize reference
        const totalWalletBalance = await sequelize.query(`
            SELECT 
                currency,
                SUM(balance) as total_balance,
                SUM(available_balance) as total_available,
                SUM(reserved_balance) as total_reserved
            FROM wallets 
            WHERE status = 'active'
            GROUP BY currency
        `, { type: sequelize.QueryTypes.SELECT });
        
        // Float account status
        const floatAccounts = await FloatAccount.findAll({
            attributes: ['currency_code', 'current_balance', 'reserved_balance', 'low_balance_threshold', 'status']
        });
        
        // Recent webhook activity
        const recentWebhooks = await MpesaWebhook.count({
            where: {
                createdAt: { [Op.gte]: thirtyDaysAgo }
            }
        });
        
        const failedWebhooks = await MpesaWebhook.count({
            where: {
                status: 'failed',
                createdAt: { [Op.gte]: thirtyDaysAgo }
            }
        });

        res.json({
            success: true,
            data: {
                // Basic stats
                totalUsers,
                activeWallets,
                
                // Transaction stats
                transactions: {
                    total: totalTransactions,
                    completed: completedTransactions,
                    pending: pendingTransactions,
                    failed: failedTransactions,
                    success_rate: totalTransactions > 0 ? ((completedTransactions / totalTransactions) * 100).toFixed(2) : 0
                },
                
                // Transaction types
                transactionTypes: {
                    deposits,
                    withdrawals,
                    transfers
                },
                
                // Financial data
                revenue: {
                    fee_revenue_30_days: feeRevenue || 0,
                    currency: 'USD' // You might want to make this dynamic
                },
                
                // System balances
                walletBalances: totalWalletBalance,
                floatAccounts,
                
                // System health
                webhooks: {
                    recent_count: recentWebhooks,
                    failed_count: failedWebhooks,
                    success_rate: recentWebhooks > 0 ? (((recentWebhooks - failedWebhooks) / recentWebhooks) * 100).toFixed(2) : 100
                }
            }
        });
    } catch (error) {
        console.error('Error fetching mobile money stats:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching mobile money statistics'
        });
    }
};

const getUsers = async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = {role: 'user'};
    
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
        'lastLoginAt','emailVerified', 'createdAt', 'updatedAt'
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

const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id, {
      attributes: [
        'id', 'email', 'firstName', 'surname', 'phoneNumber', 
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
      include: [
        {
          model: User,
          attributes: ['id', 'email', 'firstName', 'surname', 'phoneNumber'],
          required: true
        },
        {
          model: Wallet,
          attributes: ['balance', 'currency'],
          required: false,
          where: { status: 'active' }
        }
      ],
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

// Get all transactions with filtering
const getTransactions = async (req, res) => {
    try {
        const { page = 1, limit = 20, status, type, currency, user_id, date_from, date_to } = req.query;
        const offset = (page - 1) * limit;

        let whereClause = {};
        
        // Apply filters
        if (status && status !== 'all') whereClause.status = status;
        if (type && type !== 'all') whereClause.type = type;
        if (currency && currency !== 'all') whereClause.currency = currency;
        if (user_id) whereClause.userid = user_id;
        
        // Date range filter
        if (date_from || date_to) {
            whereClause.createdat = {};
            if (date_from) whereClause.createdat[Op.gte] = new Date(date_from);
            if (date_to) whereClause.createdat[Op.lte] = new Date(date_to);
        }

        const { count, rows: transactions } = await Transaction.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: User,
                    attributes: ['id', 'email', 'firstName', 'surname'],
                    required: false
                }
            ],
            order: [['createdat', 'DESC']],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        res.json({
            success: true,
            data: {
                transactions,
                pagination: {
                    total: count,
                    page: parseInt(page),
                    pages: Math.ceil(count / limit),
                    limit: parseInt(limit)
                }
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

// Get wallet movements (transaction details)
const getWalletMovements = async (req, res) => {
    try {
        const { page = 1, limit = 20, wallet_id, transaction_id, movement_type } = req.query;
        const offset = (page - 1) * limit;

        let whereClause = {};
        if (wallet_id) whereClause.wallet_id = wallet_id;
        if (transaction_id) whereClause.transaction_id = transaction_id;
        if (movement_type && movement_type !== 'all') whereClause.movement_type = movement_type;

        const { count, rows: movements } = await WalletMovement.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: Transaction,
                    attributes: ['id', 'referencenumber', 'type', 'amount', 'status'],
                    include: [
                        {
                            model: User,
                            attributes: ['id', 'email', 'firstName', 'surname']
                        }
                    ]
                },
                {
                    model: Wallet,
                    attributes: ['id', 'userid', 'currency', 'status'],
                    include: [
                        {
                            model: User,
                            attributes: ['id', 'email', 'firstName', 'surname']
                        }
                    ]
                }
            ],
            order: [['createdAt', 'DESC']],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        res.json({
            success: true,
            data: {
                movements,
                pagination: {
                    total: count,
                    page: parseInt(page),
                    pages: Math.ceil(count / limit),
                    limit: parseInt(limit)
                }
            }
        });
    } catch (error) {
        console.error('Error fetching wallet movements:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching wallet movements'
        });
    }
};

// Get float account status and management
const getFloatAccountsStatus = async (req, res) => {
    try {
        const floatAccounts = await FloatAccount.findAll({
            order: [['currency_code', 'ASC']]
        });

        // Calculate float utilization and alerts
        const floatStatus = floatAccounts.map(account => {
            const utilizationPercent = account.reserved_balance > 0 
                ? ((account.reserved_balance / account.current_balance) * 100).toFixed(2)
                : 0;
            
            const isLowBalance = account.current_balance <= account.low_balance_threshold;
            
            return {
                ...account.toJSON(),
                utilization_percent: utilizationPercent,
                is_low_balance: isLowBalance,
                available_balance: account.current_balance - account.reserved_balance
            };
        });

        res.json({
            success: true,
            data: { floatAccounts: floatStatus }
        });
    } catch (error) {
        console.error('Error fetching float accounts:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching float account status'
        });
    }
};

// Update float account balance (manual adjustment)
const updateFloatAccountBalance = async (req, res) => {
    try {
        const { id } = req.params;
        const { current_balance, reason } = req.body;

        if (!current_balance || current_balance < 0) {
            return res.status(400).json({
                success: false,
                message: 'Valid current balance is required'
            });
        }

        const floatAccount = await FloatAccount.findByPk(id);
        if (!floatAccount) {
            return res.status(404).json({
                success: false,
                message: 'Float account not found'
            });
        }

        const oldBalance = floatAccount.current_balance;
        
        await floatAccount.update({
            current_balance: parseFloat(current_balance)
        });

        // Log the manual adjustment (you might want to create an audit log table)
        console.log(`Float account ${id} balance updated by admin ${req.admin?.id}: ${oldBalance} -> ${current_balance}. Reason: ${reason}`);

        res.json({
            success: true,
            message: 'Float account balance updated successfully',
            data: {
                old_balance: oldBalance,
                new_balance: current_balance,
                difference: parseFloat(current_balance) - parseFloat(oldBalance)
            }
        });
    } catch (error) {
        console.error('Error updating float account balance:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating float account balance'
        });
    }
};

// Get webhook logs
const getWebhookLogs = async (req, res) => {
    try {
        const { page = 1, limit = 20, status, webhook_type, date_from, date_to } = req.query;
        const offset = (page - 1) * limit;

        let whereClause = {};
        if (status && status !== 'all') whereClause.status = status;
        if (webhook_type && webhook_type !== 'all') whereClause.webhook_type = webhook_type;
        
        if (date_from || date_to) {
            whereClause.createdAt = {};
            if (date_from) whereClause.createdAt[Op.gte] = new Date(date_from);
            if (date_to) whereClause.createdAt[Op.lte] = new Date(date_to);
        }

        const { count, rows: webhooks } = await MpesaWebhook.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: Transaction,
                    attributes: ['id', 'referencenumber', 'amount', 'currency', 'status'],
                    required: false
                }
            ],
            order: [['createdAt', 'DESC']],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        res.json({
            success: true,
            data: {
                webhooks,
                pagination: {
                    total: count,
                    page: parseInt(page),
                    pages: Math.ceil(count / limit),
                    limit: parseInt(limit)
                }
            }
        });
    } catch (error) {
        console.error('Error fetching webhook logs:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching webhook logs'
        });
    }
};

// Get system configuration
const getSystemConfigs = async (req, res) => {
    try {
        const configs = await SystemConfig.findAll({
            order: [['config_key', 'ASC']]
        });

        res.json({
            success: true,
            data: { configs }
        });
    } catch (error) {
        console.error('Error fetching system configs:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching system configurations'
        });
    }
};

// Update system configuration
const updateSystemConfig = async (req, res) => {
    try {
        const { id } = req.params;
        const { config_value, is_active } = req.body;

        const config = await SystemConfig.findByPk(id);
        if (!config) {
            return res.status(404).json({
                success: false,
                message: 'Configuration not found'
            });
        }

        await config.update({
            config_value: config_value !== undefined ? config_value : config.config_value,
            is_active: is_active !== undefined ? is_active : config.is_active
        });

        res.json({
            success: true,
            message: 'Configuration updated successfully',
            data: { config }
        });
    } catch (error) {
        console.error('Error updating system config:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating configuration'
        });
    }
};

// Retry failed transaction
const retryFailedTransaction = async (req, res) => {
    try {
        const { id } = req.params;
        
        const transaction = await Transaction.findByPk(id);
        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }

        if (transaction.status !== 'failed') {
            return res.status(400).json({
                success: false,
                message: 'Only failed transactions can be retried'
            });
        }

        // Reset transaction to pending for retry
        await transaction.update({
            status: 'pending',
            failed_at: null,
            failurereason: null
        });

        res.json({
            success: true,
            message: 'Transaction queued for retry',
            data: { transaction }
        });
    } catch (error) {
        console.error('Error retrying transaction:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrying transaction'
        });
    }
};
const getRevenueAnalytics = async (req, res) => {
    try {
        const { period = 'daily', date_from, date_to, currency = 'all' } = req.query;
        
        // Set default date range (last 30 days if not specified)
        const endDate = date_to ? new Date(date_to) : new Date();
        const startDate = date_from ? new Date(date_from) : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        
        let dateFormat, groupBy;
        switch (period) {
            case 'weekly':
                dateFormat = 'YYYY-"W"WW'; // Year-Week format
                groupBy = 'week';
                break;
            case 'monthly':
                dateFormat = 'YYYY-MM';
                groupBy = 'month';
                break;
            default: // daily
                dateFormat = 'YYYY-MM-DD';
                groupBy = 'day';
        }
        
        let currencyFilter = '';
        if (currency !== 'all') {
            currencyFilter = `AND currency = '${currency}'`;
        }
        
        const revenueData = await sequelize.query(`
            SELECT 
                TO_CHAR(createdat, '${dateFormat}') as period,
                currency,
                COUNT(*) as transaction_count,
                SUM(amount) as total_amount,
                SUM(fees) as total_fees,
                AVG(fees) as avg_fee_per_transaction
            FROM transactions 
            WHERE status = 'completed' 
            AND createdat >= :startDate 
            AND createdat <= :endDate
            ${currencyFilter}
            GROUP BY TO_CHAR(createdat, '${dateFormat}'), currency
            ORDER BY period DESC, currency
        `, {
            type: sequelize.QueryTypes.SELECT,
            replacements: { startDate, endDate }
        });
        
        // Calculate totals
        const totalRevenue = revenueData.reduce((sum, row) => sum + parseFloat(row.total_fees || 0), 0);
        const totalTransactions = revenueData.reduce((sum, row) => sum + parseInt(row.transaction_count || 0), 0);
        const avgRevenuePerTransaction = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
        
        res.json({
            success: true,
            data: {
                period_type: period,
                date_range: { start: startDate, end: endDate },
                currency_filter: currency,
                summary: {
                    total_revenue: totalRevenue.toFixed(2),
                    total_transactions: totalTransactions,
                    avg_revenue_per_transaction: avgRevenuePerTransaction.toFixed(4)
                },
                details: revenueData
            }
        });
    } catch (error) {
        console.error('Error fetching revenue analytics:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching revenue analytics'
        });
    }
};

// Transaction trends analytics
const getTransactionTrends = async (req, res) => {
    try {
        const { period = 'daily', type = 'all', date_from, date_to } = req.query;
        
        const endDate = date_to ? new Date(date_to) : new Date();
        const startDate = date_from ? new Date(date_from) : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        
        let dateFormat;
        switch (period) {
            case 'weekly':
                dateFormat = 'YYYY-"W"WW';
                break;
            case 'monthly':
                dateFormat = 'YYYY-MM';
                break;
            default:
                dateFormat = 'YYYY-MM-DD';
        }
        
        let typeFilter = '';
        if (type !== 'all') {
            typeFilter = `AND type = '${type}'`;
        }
        
        const trendsData = await sequelize.query(`
            SELECT 
                TO_CHAR(createdat, '${dateFormat}') as period,
                type,
                status,
                currency,
                COUNT(*) as count,
                SUM(amount) as total_amount,
                AVG(amount) as avg_amount
            FROM transactions 
            WHERE createdat >= :startDate 
            AND createdat <= :endDate
            ${typeFilter}
            GROUP BY TO_CHAR(createdat, '${dateFormat}'), type, status, currency
            ORDER BY period DESC, type, status
        `, {
            type: sequelize.QueryTypes.SELECT,
            replacements: { startDate, endDate }
        });
        
        // Calculate success rates by period
        const successRatesByPeriod = {};
        trendsData.forEach(row => {
            if (!successRatesByPeriod[row.period]) {
                successRatesByPeriod[row.period] = { total: 0, completed: 0 };
            }
            successRatesByPeriod[row.period].total += parseInt(row.count);
            if (row.status === 'completed') {
                successRatesByPeriod[row.period].completed += parseInt(row.count);
            }
        });
        
        Object.keys(successRatesByPeriod).forEach(period => {
            const data = successRatesByPeriod[period];
            data.success_rate = data.total > 0 ? ((data.completed / data.total) * 100).toFixed(2) : 0;
        });
        
        res.json({
            success: true,
            data: {
                period_type: period,
                transaction_type_filter: type,
                date_range: { start: startDate, end: endDate },
                success_rates_by_period: successRatesByPeriod,
                detailed_trends: trendsData
            }
        });
    } catch (error) {
        console.error('Error fetching transaction trends:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching transaction trends'
        });
    }
};

// Real-time system health check
const getSystemHealth = async (req, res) => {
    try {
        // Check recent transaction processing times
        const recentTransactions = await Transaction.findAll({
            where: {
                status: 'completed',
                createdat: {
                    [Op.gte]: new Date(Date.now() - 60 * 60 * 1000) // Last hour
                }
            },
            limit: 100,
            order: [['createdat', 'DESC']]
        });
        
        // Calculate average processing time
        let totalProcessingTime = 0;
        let processedCount = 0;
        
        recentTransactions.forEach(tx => {
            if (tx.completed_at && tx.initiated_at) {
                const processingTime = new Date(tx.completed_at) - new Date(tx.initiated_at);
                totalProcessingTime += processingTime;
                processedCount++;
            }
        });
        
        const avgProcessingTime = processedCount > 0 ? totalProcessingTime / processedCount : 0;
        
        // Check float account health
        const floatAccounts = await FloatAccount.findAll();
        const lowBalanceAlerts = floatAccounts.filter(account => 
            account.current_balance <= account.low_balance_threshold
        );
        
        // Check recent webhook failures
        const recentWebhookFailures = await MpesaWebhook.count({
            where: {
                status: 'failed',
                createdAt: {
                    [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
                }
            }
        });
        
        // Check pending transactions (might indicate system issues)
        const oldPendingTransactions = await Transaction.count({
            where: {
                status: 'pending',
                createdat: {
                    [Op.lte]: new Date(Date.now() - 60 * 60 * 1000) // Older than 1 hour
                }
            }
        });
        
        // Determine overall health status
        let healthStatus = 'healthy';
        const issues = [];
        
        if (lowBalanceAlerts.length > 0) {
            healthStatus = 'warning';
            issues.push(`${lowBalanceAlerts.length} float account(s) have low balance`);
        }
        
        if (recentWebhookFailures > 5) {
            healthStatus = 'critical';
            issues.push(`${recentWebhookFailures} webhook failures in last 24 hours`);
        }
        
        if (oldPendingTransactions > 10) {
            healthStatus = 'warning';
            issues.push(`${oldPendingTransactions} transactions pending for over 1 hour`);
        }
        
        if (avgProcessingTime > 300000) { // 5 minutes
            healthStatus = 'warning';
            issues.push('Average transaction processing time is high');
        }
        
        res.json({
            success: true,
            data: {
                overall_status: healthStatus,
                issues: issues,
                metrics: {
                    avg_processing_time_ms: Math.round(avgProcessingTime),
                    recent_transactions_count: recentTransactions.length,
                    low_balance_accounts: lowBalanceAlerts.length,
                    recent_webhook_failures: recentWebhookFailures,
                    old_pending_transactions: oldPendingTransactions
                },
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error checking system health:', error);
        res.status(500).json({
            success: false,
            message: 'Error checking system health',
            data: {
                overall_status: 'critical',
                issues: ['System health check failed'],
                metrics: {},
                timestamp: new Date().toISOString()
            }
        });
    }
};

// User wallet overview for admin
const getUserWalletOverview = async (req, res) => {
    try {
        const { userId } = req.params;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }
        
        // Get user info
        const user = await User.findByPk(userId, {
            attributes: ['id', 'email', 'firstName', 'surname', 'phoneNumber', 'role', 'status']
        });
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        // Get user's wallets
        const wallets = await Wallet.findAll({
            where: { userid: userId },
            attributes: ['id', 'currency', 'balance', 'available_balance', 'reserved_balance', 'status', 'last_transaction_at']
        });
        
        // Get user's recent transactions
        const recentTransactions = await Transaction.findAll({
            where: {
                [Op.or]: [
                    { userid: userId },
                    { relateduserid: userId }
                ]
            },
            order: [['createdat', 'DESC']],
            limit: 10,
            attributes: ['id', 'type', 'amount', 'currency', 'status', 'fees', 'createdat', 'referencenumber']
        });
        
        // Get transaction summary
        const transactionSummary = await Transaction.findAll({
            where: { userid: userId },
            attributes: [
                'type',
                'status',
                'currency',
                [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
                [sequelize.fn('SUM', sequelize.col('amount')), 'total_amount'],
                [sequelize.fn('SUM', sequelize.col('fees')), 'total_fees']
            ],
            group: ['type', 'status', 'currency'],
            raw: true
        });
        
        res.json({
            success: true,
            data: {
                user,
                wallets,
                recent_transactions: recentTransactions,
                transaction_summary: transactionSummary
            }
        });
    } catch (error) {
        console.error('Error fetching user wallet overview:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching user wallet overview'
        });
    }
};

// Bulk operations for admin
const bulkUpdateTransactionStatus = async (req, res) => {
    try {
        const { transaction_ids, new_status, reason } = req.body;
        
        if (!transaction_ids || !Array.isArray(transaction_ids) || transaction_ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Transaction IDs array is required'
            });
        }
        
        if (!['pending', 'processing', 'completed', 'failed', 'cancelled'].includes(new_status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status'
            });
        }
        
        const updateData = { status: new_status };
        if (new_status === 'failed' && reason) {
            updateData.failurereason = reason;
            updateData.failed_at = new Date();
        } else if (new_status === 'completed') {
            updateData.completed_at = new Date();
            updateData.processedat = new Date();
        }
        
        const [updatedCount] = await Transaction.update(updateData, {
            where: {
                id: { [Op.in]: transaction_ids }
            }
        });
        
        // Log admin action
        console.log(`Admin ${req.admin?.id} bulk updated ${updatedCount} transactions to status: ${new_status}. Reason: ${reason}`);
        
        res.json({
            success: true,
            message: `Successfully updated ${updatedCount} transaction(s)`,
            data: {
                updated_count: updatedCount,
                new_status,
                reason
            }
        });
    } catch (error) {
        console.error('Error bulk updating transactions:', error);
        res.status(500).json({
            success: false,
            message: 'Error bulk updating transactions'
        });
    }
};

module.exports = {
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
};