const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/config');

const Account = sequelize.define('Account', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    accountNumber: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    accountType: {
        type: DataTypes.ENUM('checking', 'savings', 'business'),
        defaultValue: 'checking'
    },
    currency: {
        type: DataTypes.STRING(3),
        defaultValue: 'KES'
    },
    status: {
        type: DataTypes.ENUM('active', 'frozen', 'closed'),
        defaultValue: 'active'
    }
}, {
    tableName: 'accounts',
    timestamps: true,
    hooks: {
        beforeCreate: async (account) => {
            // Generate account number if not provided
            if (!account.accountNumber) {
                const timestamp = Date.now().toString();
                const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
                // Use currency prefix instead of generic "ACC"
                const prefix = account.currency || 'ACC';
                account.accountNumber = `${prefix}${account.userId || ''}${timestamp}${random}`;
            }
        }
    }
});

module.exports = Account;