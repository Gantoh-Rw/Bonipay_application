const User = require('../models/User');
const Account = require('../models/Account');

const getBalance = async (req, res) => {
    try {
        const userId = req.user.id;

        const accounts = await Account.findAll({
            where: { userId },
            attributes: ['id', 'accountNumber', 'accountType', 'balance', 'currency', 'status']
        });

        const totalBalance = accounts.reduce((sum, account) => {
            return sum + parseFloat(account.balance);
        }, 0);

        res.json({
            success: true,
            totalBalance: totalBalance.toFixed(2),
            accounts
        });
    } catch (error) {
        console.error('Get balance error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get balance',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

const updateProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { firstName,surname,otherNames, phoneNumber } = req.body;

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        await user.update({
            firstName: firstName || user.firstName,
            surname:surname || user.surname,
            otherNames:otherNames || user.otherNames,
            phoneNumber: phoneNumber || user.phoneNumber
        });

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: {
                id: user.id,
                email: user.email,
                firstName:user.firstName,
                surname:user.surname,
                otherNames,
                phoneNumber: user.phoneNumber,
                status: user.status
            }
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update profile',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

const changePassword = async (req, res) => {
    try {
        const userId = req.user.id;
        const { currentPassword, newPassword } = req.body;

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'New password must be at least 6 characters long'
            });
        }

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Verify current password
        const isValidPassword = await user.comparePassword(currentPassword);
        if (!isValidPassword) {
            return res.status(400).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }

        // Update password
        await user.update({ password: newPassword });

        res.json({
            success: true,
            message: 'Password changed successfully'
        });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to change password',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

module.exports = {
    getBalance,
    updateProfile,
    changePassword
};