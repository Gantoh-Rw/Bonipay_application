const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/config');

// Consider renaming this to WebhookLog for better generalization
const WebhookLog = sequelize.define('WebhookLog', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    webhook_type: {
        type: DataTypes.STRING(50),
        allowNull: false,
        validate: {
            isIn: [[
                // M-Pesa types (keep for backward compatibility)
                'c2b_confirmation', 'b2c_result', 'balance_inquiry', 'timeout', 'reversal',
                // Flutterwave types
                'flutterwave_callback', 'flutterwave_transfer', 'flutterwave_collection',
                'vodacom_callback', 'vodacom_b2c_result'
            ]]
        }
    },
    webhook_source: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'mpesa',
        validate: {
            isIn: [['mpesa', 'flutterwave', 'vodacom', 'system']]
        }
    },
    event_type: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: 'Specific event type from the webhook provider'
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
        allowNull: true,
        comment: 'Legacy M-Pesa transaction ID'
    },
    flutterwave_transaction_id: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'Flutterwave transaction ID'
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
        type: DataTypes.ENUM('received', 'processed', 'failed', 'duplicate', 'pending'),
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
    tableName: 'webhook_logs', // Keep existing table name for now, or change to 'webhook_logs'
    timestamps: true,
    indexes: [
        {
            fields: ['mpesa_transaction_id']
        },
        {
            fields: ['flutterwave_transaction_id']
        },
        {
            fields: ['status']
        },
        {
            fields: ['webhook_source']
        },
        {
            fields: ['event_type']
        }
    ]
});

module.exports = WebhookLog;