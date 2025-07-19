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
        allowNull: false,
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

// Instance methods
User.prototype.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

User.prototype.updateLastLogin = async function() {
    this.lastLoginAt = new Date();
    await this.save();
};

// Method to get clean user data based on role
User.prototype.getPublicData = function() {
    const baseData = {
        id: this.id,
        email: this.email,
        firstName: this.firstName,
        surname: this.surname,
        otherNames: this.otherNames,
        phoneNumber: this.phoneNumber,
        role: this.role,
        emailVerified: this.emailVerified,
        lastLoginAt: this.lastLoginAt
    };

    return baseData
};


// Add mobile money methods
User.prototype.getTransactionLimits = async function() {
    const kyc = await this.getKyc();
    
    if (!kyc || kyc.verificationStatus !== 'verified') {
        return {
            daily_deposit_limit: 100,
            daily_withdrawal_limit: 50,
            monthly_limit: 1000
        };
    }
    
    return {
        daily_deposit_limit: 10000,
        daily_withdrawal_limit: 5000,
        monthly_limit: 50000
    };
};

User.prototype.canProcessTransaction = async function(amount, type) {
    const limits = await this.getTransactionLimits();
    
    switch (type) {
        case 'deposit':
            return amount <= limits.daily_deposit_limit;
        case 'withdrawal':
            return amount <= limits.daily_withdrawal_limit;
        default:
            return true;
    }
};

module.exports = User;