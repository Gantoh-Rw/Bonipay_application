const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/config');

const FloatAccount = sequelize.define('FloatAccount', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    currency_code: {
        type: DataTypes.STRING(3),
        allowNull: false,
        validate: {
            isIn: [['USD', 'KES']]
        }
    },
    account_type: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: {
            isIn: [['mpesa_usd', 'mpesa_kes']]
        }
    },
    paybill_number: {
        type: DataTypes.STRING(20),
        allowNull: true
    },
    till_number: {
        type: DataTypes.STRING(20),
        allowNull: true
    },
    shortcode: {
        type: DataTypes.STRING(20),
        allowNull: true
    },
    current_balance: {
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
    low_balance_threshold: {
        type: DataTypes.DECIMAL(15, 2),
        defaultValue: 1000.00,
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM('active', 'inactive', 'maintenance'),
        defaultValue: 'active'
    }
    
}, {
    tableName: 'float_accounts',
    timestamps: true,
    indexes: [
        {
            unique: true,
            fields: ['currency_code', 'account_type']
        }
    ]
});

module.exports = FloatAccount;