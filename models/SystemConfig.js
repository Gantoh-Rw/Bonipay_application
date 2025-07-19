const { DataTypes } = require('sequelize');
const {sequelize} = require('../config/config');

const SystemConfig = sequelize.define('SystemConfig', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    config_key: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true
    },
    config_value: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    config_type: {
        type: DataTypes.ENUM('string', 'number', 'boolean', 'json'),
        defaultValue: 'string'
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    tableName: 'system_configs',
    timestamps: true
});

// Helper method to get config value
SystemConfig.getValue = async function(key, defaultValue = null) {
    try {
        const config = await this.findOne({
            where: { config_key: key, is_active: true }
        });
        
        if (!config) return defaultValue;
        
        switch (config.config_type) {
            case 'number':
                return parseFloat(config.config_value);
            case 'boolean':
                return config.config_value === 'true';
            case 'json':
                return JSON.parse(config.config_value);
            default:
                return config.config_value;
        }
    } catch (error) {
        console.error('Error getting config value:', error);
        return defaultValue;
    }
};

module.exports = SystemConfig;