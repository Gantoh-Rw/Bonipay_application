const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/config');

/**
 * MpesaWebhook model
 *
 * Maps to the `webhook_logs` table in the database.
 * The DB status column is a Postgres ENUM: enum_mpesa_webhooks_status
 *
 * IMPORTANT: only write status values that exist in that enum.
 * Safe confirmed values: 'received', 'processed', 'failed'
 * Risky value:           'unmatched' — see note in processC2BCallback / processB2CCallback
 */
const MpesaWebhook = sequelize.define('MpesaWebhook', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    webhook_type: {
        type: DataTypes.STRING(50),
        allowNull: false
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
        type: DataTypes.STRING,
        defaultValue: 'received'
    },
    processing_error: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    retry_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    // Kept for DB compatibility 
    flutterwave_transaction_id: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    webhook_source: {
        type: DataTypes.STRING(20),
        defaultValue: 'vodacom_drc'
    },
    event_type: {
        type: DataTypes.STRING(50),
        allowNull: true
    }
}, {
    tableName: 'webhook_logs',   
    timestamps: true             
});

module.exports = MpesaWebhook;