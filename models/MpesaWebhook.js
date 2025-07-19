const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/config');

const MpesaWebhook = sequelize.define('MpesaWebhook', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    webhook_type: {
        type: DataTypes.STRING(50),
        allowNull: false,
        validate: {
            isIn: [['c2b_confirmation', 'b2c_result', 'balance_inquiry', 'timeout', 'reversal']]
        }
    },
    transaction_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'transactions',
            key: 'id'
        }
    },
    mpesa_transaction_id: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    raw_payload: {
        type: DataTypes.JSONB,
        allowNull: false
    },
    signature: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    processed_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    status: {
        type: DataTypes.ENUM('received', 'processed', 'failed', 'duplicate'),
        defaultValue: 'received'
    },
    processing_error: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    retry_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    }
}, {
    tableName: 'mpesa_webhooks',
    timestamps: true,
    indexes: [
        {
            fields: ['mpesa_transaction_id']
        },
        {
            fields: ['status']
        }
    ]
});

module.exports = MpesaWebhook;