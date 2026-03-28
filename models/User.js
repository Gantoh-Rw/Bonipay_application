const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/config');
const bcrypt = require('bcryptjs');

const User = sequelize.define('User', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
            isEmail: true,
            len: [1, 255]
        }
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            len: [6, 255]
        }
    },
    firstName: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            len: [2, 100]
        }
    },
    surname: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            len: [2, 100]
        }
    },
    otherNames: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
            len: [2, 100]
        }
    },
    phoneNumber: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
            len: [10, 20]
        }
    },
    role: {
        type: DataTypes.STRING(10),
        defaultValue: 'user',
        validate: {
            isIn: [['user', 'admin']]
        }
    },
    emailVerified: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    lastLoginAt: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'users',
    timestamps: true,
    hooks: {
        beforeCreate: async (user) => {
            if (user.password) {
                user.password = await bcrypt.hash(user.password, 12);
            }
        },
        beforeUpdate: async (user) => {
            if (user.changed('password')) {
                user.password = await bcrypt.hash(user.password, 12);
            }
        }
    }
});

// ── Instance methods ──────────────────────────────────────────────────────────

User.prototype.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

User.prototype.updateLastLogin = async function() {
    this.lastLoginAt = new Date();
    await this.save();
};

User.prototype.getPublicData = function() {
    return {
        id:            this.id,
        email:         this.email,
        firstName:     this.firstName,
        surname:       this.surname,
        otherNames:    this.otherNames,
        phoneNumber:   this.phoneNumber,
        role:          this.role,
        emailVerified: this.emailVerified,
        lastLoginAt:   this.lastLoginAt
    };
};

// ── Transaction limits ────────────────────────────────────────────────────────

/**
 * Returns per-currency daily limits based on KYC status.
 *
 * Unverified users get tight limits.
 * Verified users get full limits.
 *
 * CDF limits = USD limits × USD_TO_CDF_RATE (2800 from system_configs).
 * This means 50,000 CDF (~$18) passes the same check as $18 USD — correct.
 */
User.prototype.getTransactionLimits = async function() {
    const kyc = await this.getKyc();
    const isVerified = kyc && kyc.verificationStatus === 'verified';

    // USD limits
    const USD_DEPOSIT_LIMIT    = isVerified ? 5000   : 100;
    const USD_WITHDRAWAL_LIMIT = isVerified ? 1000   : 50;
    const USD_MONTHLY_LIMIT    = isVerified ? 50000  : 1000;

    // CDF rate from your system_configs (fallback 2800 if not set)
    // We read it inline here to keep User model self-contained
    const SystemConfig = require('./SystemConfig');
    const rate = await SystemConfig.getValue('fallback_usd_to_cdf', 2800);

    // CDF limits = USD limits × rate
    const CDF_DEPOSIT_LIMIT    = USD_DEPOSIT_LIMIT    * rate;
    const CDF_WITHDRAWAL_LIMIT = USD_WITHDRAWAL_LIMIT * rate;
    const CDF_MONTHLY_LIMIT    = USD_MONTHLY_LIMIT    * rate;

    return {
        USD: {
            daily_deposit_limit:    USD_DEPOSIT_LIMIT,
            daily_withdrawal_limit: USD_WITHDRAWAL_LIMIT,
            monthly_limit:          USD_MONTHLY_LIMIT
        },
        CDF: {
            daily_deposit_limit:    CDF_DEPOSIT_LIMIT,
            daily_withdrawal_limit: CDF_WITHDRAWAL_LIMIT,
            monthly_limit:          CDF_MONTHLY_LIMIT
        }
    };
};

/**
 * Check whether a transaction amount is within the user's daily limit.
 *
 * @param {number} amount    - Transaction amount
 * @param {string} type      - 'deposit' | 'withdrawal'
 * @param {string} currency  - 'USD' | 'CDF'  (defaults to 'USD' for backward compat)
 */
User.prototype.canProcessTransaction = async function(amount, type, currency = 'USD') {
    const limits = await this.getTransactionLimits();

    // Fall back to USD limits if an unknown currency is passed
    const currencyLimits = limits[currency] || limits['USD'];

    switch (type) {
        case 'deposit':
            return parseFloat(amount) <= currencyLimits.daily_deposit_limit;
        case 'withdrawal':
            return parseFloat(amount) <= currencyLimits.daily_withdrawal_limit;
        default:
            return true;
    }
};

module.exports = User;