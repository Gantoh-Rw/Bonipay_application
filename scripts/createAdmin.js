// scripts/createAdmin.js
const User = require('../models/User');
const sequelize = require('../config/database');

const createAdmin = async () => {
    try {
        // Ensure database connection
        await sequelize.authenticate();
        
        // Sync the model 
        await User.sync();

        const adminData = {
            email: 'admin@bonipay.com',
            password: 'AdminPassword123!',
            firstName: 'Admin',
            surname: 'User',
            otherNames: 'System',
            phoneNumber: '0712345678',
            role: 'admin',
            emailVerified: true,
            // Note: balance and status are null for admin users
        };

        // Check if admin already exists
        const existingAdmin = await User.findOne({ 
            where: { email: adminData.email } 
        });

        if (existingAdmin) {
            // Update without password to avoid re-hashing
            const { password, ...updateData } = adminData;
            await existingAdmin.update(updateData);
            console.log('Admin user updated successfully!');
            console.log('Email:', existingAdmin.email);
            console.log('Role:', existingAdmin.role);
            console.log('ID:', existingAdmin.id);
        } else {
            // Create new admin user (password will be hashed)
            const admin = await User.create(adminData);
            console.log('Admin user created successfully!');
            console.log('Email:', admin.email);
            console.log('Role:', admin.role);
            console.log('ID:', admin.id);
        }
        
    } catch (error) {
        console.error('Error creating/updating admin user:', error);
    } finally {
        await sequelize.close();
    }
};

// Run the script
createAdmin();
