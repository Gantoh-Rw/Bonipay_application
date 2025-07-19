const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Account = require('../models/Account');

const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Access token required'
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findByPk(decoded.userId);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'user not found'
            });
        }

        // Check account status for non-admin users
        if (user.role !== 'admin') {
            const userAccount = await Account.findOne({ where: { userId: user.id } });
            if (!userAccount || userAccount.status !== 'active') {
                return res.status(401).json({
                    success: false,
                    message: 'Account is suspended'
                });
            }
        }

        req.user = user;
        next();
    } catch (error) {
        return res.status(403).json({
            success: false,
            message: 'Invalid or expired token'
        });
    }
};

module.exports = { authenticateToken };