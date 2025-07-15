const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
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
    balance: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true, // Made nullable for admin users
        defaultValue: null, // No default for admin
        validate: {
            min: 0,
            // Custom validator to ensure balance is set for regular users
            balanceRequired(value) {
                if (this.role === 'user' && (value === null || value === undefined)) {
                    throw new Error('Balance is required for regular users');
                }
            }
        }
    },
    status: {
        type: DataTypes.ENUM('active', 'suspended', 'pending'),
        allowNull: true, // Made nullable for admin users
        defaultValue: null, // No default for admin
        validate: {
            // Custom validator to ensure status is set for regular users
            statusRequired(value) {
                if (this.role === 'user' && !value) {
                    throw new Error('Status is required for regular users');
                }
            }
        }
    },
    role: {
        type: DataTypes.ENUM('user', 'admin'),
        defaultValue: 'user'
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
            
            // Set defaults based on role
            if (user.role === 'user') {
                if (user.balance === null) user.balance = 0.00;
                if (user.status === null) user.status = 'active';
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

    // Add user-specific fields only for regular users
    if (this.role === 'user') {
        return {
            ...baseData,
            balance: this.balance,
            status: this.status
        };
    }

    return baseData;
};

module.exports = User;