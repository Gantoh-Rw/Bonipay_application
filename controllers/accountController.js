const User = require('../models/User');
const Account = require('../models/Account');
const Wallet = require('../models/Wallet'); // Add this import

const getBalance = async (req, res) => {
    try {
        const userId = req.user.id;

        // Get wallets for actual balance information
        const wallets = await Wallet.findAll({
            where: { userid: userId, status: 'active' },
            attributes: ['currency', 'balance', 'available_balance', 'reserved_balance']
        });

        // Get accounts for identification/display
        const accounts = await Account.findAll({
            where: { userId },
            attributes: ['accountNumber', 'accountType', 'currency', 'status']
        });

        // Format for user display
        const userBalances = wallets.map(wallet => {
            const account = accounts.find(acc => acc.currency === wallet.currency);
            return {
                currency: wallet.currency,
                balance: wallet.balance, // Total money they own
                available: wallet.available_balance, // Money they can spend now
                accountNumber: account?.accountNumber,
                accountType: account?.accountType,
                status: account?.status,
                // Only show reserved balance to admins
                ...(req.user.role === 'admin' && { 
                    reserved: wallet.reserved_balance 
                })
            };
        });

        // Calculate total balance across all currencies (in their base amounts)
        const totalBalance = wallets.reduce((sum, wallet) => {
            return sum + parseFloat(wallet.balance);
        }, 0);

        res.json({
            success: true,
            totalBalance: totalBalance.toFixed(2),
            balances: userBalances
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
        const { firstName, surname, otherNames, phoneNumber } = req.body;

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        await user.update({
            firstName: firstName || user.firstName,
            surname: surname || user.surname,
            otherNames: otherNames || user.otherNames,
            phoneNumber: phoneNumber || user.phoneNumber
        });

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                surname: user.surname,
                otherNames: user.otherNames,
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