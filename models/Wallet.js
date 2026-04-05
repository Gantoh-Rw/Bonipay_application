const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/config');

const Wallet = sequelize.define('Wallet', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userid: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        validate: {
            isIn: [['USD', 'KES']]
        }
    },
    balance: {
        type: DataTypes.DECIMAL(15, 2),
        defaultValue: 0.00,
        allowNull: false,
        validate: {
            min: 0
        }
    },
    available_balance: {
        type: DataTypes.DECIMAL(15, 2),
        defaultValue: 0.00,
        allowNull: false,
        validate: {
            min: 0
        }
    },
    reserved_balance: {
        type: DataTypes.DECIMAL(15, 2),
        defaultValue: 0.00,
        allowNull: false,
        validate: {
            min: 0
        }
    },
    version: {
        type: DataTypes.INTEGER,
        defaultValue: 1
    },
    status: {
        type: DataTypes.ENUM('active', 'frozen', 'suspended', 'closed'),
        defaultValue: 'active'
    },
    last_transaction_at: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'wallets',
    timestamps: true,
    createdAt: 'createdat',
    updatedAt: 'updatedat',
    indexes: [
        {
            unique: true,
            fields: ['userid', 'currency']
        },
        {
            fields: ['status']
        }
    ]
});

// Instance methods for balance management
Wallet.prototype.getAvailableBalance = function() {
    return parseFloat(this.available_balance) || 0;
};

Wallet.prototype.getReservedBalance = function() {
    return parseFloat(this.reserved_balance) || 0;
};

Wallet.prototype.getTotalBalance = function() {
    return this.getAvailableBalance() + this.getReservedBalance();
};

Wallet.prototype.canReserve = function(amount) {
    return this.getAvailableBalance() >= parseFloat(amount);
};

// Reserve funds for transaction - FIXED VERSION
Wallet.prototype.reserveFunds = async function(amount, transaction = null) {
    const amountToReserve = parseFloat(amount);
    
    if (!this.canReserve(amountToReserve)) {
        throw new Error('Insufficient available balance to reserve funds');
    }
    
    // Parse DECIMAL fields properly
    const currentAvailable = parseFloat(this.available_balance) || 0;
    const currentReserved = parseFloat(this.reserved_balance) || 0;
    
    await this.update({
        available_balance: currentAvailable - amountToReserve,
        reserved_balance: currentReserved + amountToReserve,  
        version: this.version + 1
    }, { transaction });
};

// Release reserved funds (rollback)
Wallet.prototype.releaseFunds = async function(amount, transaction = null) {
    const amountToRelease = parseFloat(amount);
    
    if (this.getReservedBalance() < amountToRelease) {
        throw new Error('Insufficient reserved balance to release');
    }
    
    await this.update({
        available_balance: this.available_balance + amountToRelease,
        reserved_balance: this.reserved_balance - amountToRelease,
        version: this.version + 1
    }, { transaction });
};

// Complete transaction (deduct from reserved)
Wallet.prototype.completeFundsDeduction = async function(amount, transaction = null) {
    const amountToDeduct = parseFloat(amount);
    
    if (this.getReservedBalance() < amountToDeduct) {
        throw new Error('Insufficient reserved balance to complete deduction');
    }
    
    await this.update({
        balance: this.balance - amountToDeduct,
        reserved_balance: this.reserved_balance - amountToDeduct,
        last_transaction_at: new Date(),
        version: this.version + 1
    }, { transaction });
};

// Credit wallet (direct addition)
Wallet.prototype.creditFunds = async function(amount, transaction = null) {
    const amountToCredit = parseFloat(amount);
    
    
    const currentBalance = parseFloat(this.balance) || 0;
    const currentAvailableBalance = parseFloat(this.available_balance) || 0;
    
    const newBalance = currentBalance + amountToCredit;
    const newAvailableBalance = currentAvailableBalance + amountToCredit;
    
    await this.update({
        balance: newBalance,
        available_balance: newAvailableBalance,
        last_transaction_at: new Date(),
        version: this.version + 1
    }, { transaction });
};

module.exports = Wallet;