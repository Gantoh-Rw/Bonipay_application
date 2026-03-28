require('dotenv').config();
const { Sequelize } = require('sequelize');

// ── Sequelize CLI config (used by `sequelize-cli db:migrate` etc.) ─────────────
const config = {
    development: {
        use_env_variable: 'DATABASE_URL',
        dialect: 'postgres',
        dialectOptions: {
            ssl: { require: true, rejectUnauthorized: false }
        },
        logging: console.log,
        pool: { max: 5, min: 0, acquire: 30000, idle: 10000 }
    },
    test: {
        use_env_variable: 'DATABASE_URL',
        dialect: 'postgres',
        dialectOptions: {
            ssl: { require: true, rejectUnauthorized: false }
        },
        logging: false,
        pool: { max: 5, min: 0, acquire: 30000, idle: 10000 }
    },
    production: {
        use_env_variable: 'DATABASE_URL',
        dialect: 'postgres',
        dialectOptions: {
            ssl: { require: true, rejectUnauthorized: false }
        },
        logging: false,
        pool: { max: 5, min: 0, acquire: 30000, idle: 10000 }
    }
};

// ── Runtime Sequelize instance (used by models and services) ───────────────────
const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: {
        ssl: { require: true, rejectUnauthorized: false }
    },
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: { max: 5, min: 0, acquire: 30000, idle: 10000 }
});

// Export both so `require('../config/config')` works for the CLI
// and `const { sequelize } = require('../config/config')` works everywhere else
module.exports = config;
module.exports.sequelize = sequelize;