const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/config');

const kyc = sequelize.define('kyc', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true, // One KYC record per user
        references: {
            model: 'users',
            key: 'id'
        }
    },
    fullName: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            len: [2, 200]
        }
    },
    nationality: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
            len: [2, 100]
        }
    },
    gender: {
        type: DataTypes.ENUM('male', 'female', 'other'),
        allowNull: true
    },
    dateOfBirth: {
        type: DataTypes.DATEONLY,
        allowNull: true
    },
    identityType: {
        type: DataTypes.ENUM('national_id', 'passport', 'driver_license'),
        allowNull: true
    },
    identityNumber: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
            len: [3, 50]
        }
    },
    documentPath: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Path to uploaded document image'
    },
    verificationStatus: {
        type: DataTypes.ENUM('pending', 'verified', 'rejected', 'incomplete'),
        defaultValue: 'incomplete'
    },
    rejectionReason: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    verifiedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    verifiedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Admin user ID who verified'
    }
}, {
    tableName: 'kyc_records',
    timestamps: true,
    indexes: [
        {
            fields: ['userId']
        },
        {
            fields: ['verificationStatus']
        }
    ]
});

module.exports = kyc;