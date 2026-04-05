const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/config');

const Transaction = sequelize.define('Transaction', {
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
    type: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
            isIn: [['deposit', 'withdrawal', 'transfer', 'school_payment', 'fx_conversion']]
        }
    },
    amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: {
            min: 0
        }
    },
    currency: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
            isIn: [['USD', 'KES']]
        }
    },
    referencenumber: {
        type: DataTypes.STRING,
        allowNull: true
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'pending',
        validate: {
            isIn: [['pending', 'processing', 'completed', 'failed', 'cancelled', 'expired']]
        }
    },
    relateduserid: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    walletid: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'wallets',
            key: 'id'
        }
    },
    balanceafter: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true
    },
    fees: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0.00,
        validate: {
            min: 0
        }
    },
    processedat: {
        type: DataTypes.DATE,
        allowNull: true
    },
    failurereason: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    fromcurrency: {
        type: DataTypes.STRING,
        allowNull: true
    },
    tocurrency: {
        type: DataTypes.STRING,
        allowNull: true
    },
    exchangerate: {
        type: DataTypes.DECIMAL(10, 6),
        allowNull: true
    },
    // New mobile money fields 
    transaction_ref: {
        type: DataTypes.STRING(50),
        allowNull: true,
        unique: true
    },
    external_ref: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    mpesa_transaction_id: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    mpesa_receipt_number: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    float_account_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'float_accounts',
            key: 'id'
        }
    },
    idempotency_key: {
        type: DataTypes.STRING(100),
        allowNull: true,
        unique: true
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: true
    },
    initiated_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    completed_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    failed_at: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'transactions',
    timestamps: true,
    createdAt: 'createdat',    
    updatedAt: 'updatedat'     
});

// Instance methods
Transaction.prototype.isCompleted = function() {
    return this.status === 'completed';
};

Transaction.prototype.isPending = function() {
    return this.status === 'pending';
};

Transaction.prototype.canBeProcessed = function() {
    return ['pending', 'processing'].includes(this.status);
};

Transaction.associate = function(models) {
    // Association with User (sender)
    Transaction.belongsTo(models.User, {
        foreignKey: 'userid',
        as: 'sender'
    });
    
    // Association with User (receiver) 
    Transaction.belongsTo(models.User, {
        foreignKey: 'relateduserid',
        as: 'receiver'
    });
    
    // Association with Wallet
    Transaction.belongsTo(models.Wallet, {
        foreignKey: 'walletid',
        as: 'wallet'
    });
    
    // Association with FloatAccount 
    Transaction.belongsTo(models.FloatAccount, {
        foreignKey: 'float_account_id',
        as: 'floatAccount'
    });
};

module.exports = Transaction;