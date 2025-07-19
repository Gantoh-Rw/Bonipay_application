const { DataTypes } = require('sequelize');
const {sequelize} = require('../config/config');

const WalletMovement = sequelize.define('WalletMovement', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    transaction_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'transactions',
            key: 'id'
        }
    },
    wallet_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'wallets',
            key: 'id'
        }
    },
    movement_type: {
        type: DataTypes.ENUM('debit', 'credit', 'hold', 'release'),
        allowNull: false
    },
    amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false
    },
    balance_before: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false
    },
    balance_after: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    }
}, {
    tableName: 'wallet_movements',
    timestamps: true,
    indexes: [
        {
            fields: ['wallet_id']
        },
        {
            fields: ['transaction_id']
        }
    ]
});

module.exports = WalletMovement;