const bcrypt = require('bcrypt');
const {sequelize} = require('../config/config');
const User = require('../models/User');

async function createAdmin() {
    try {
        await sequelize.authenticate();
        console.log('✅ Database connected');

        // Admin credentials
        const adminEmail = 'admin@bonipay.com';  // CHANGE THIS
        const adminPassword = 'Admin1234';       // CHANGE THIS
        const adminPhone = '+254794053256';      // CHANGE THIS (optional)

        // Check if admin already exists
        const existingAdmin = await User.findOne({
            where: { email: adminEmail }
        });

        if (existingAdmin) {
            console.log('⚠️ Admin user already exists!');
            console.log('Email:', existingAdmin.email);
            console.log('Role:', existingAdmin.role);
            process.exit(0);
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(adminPassword, 10);

        // Create admin user
        const admin = await User.create({
            email: adminEmail,
            password: hashedPassword,
            phoneNumber: adminPhone,
            emailVerified: true,
            firstName: 'System',
            surname: 'Administrator',
            role: 'admin'
        });

        console.log('✅ Admin user created successfully!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📧 Email:', adminEmail);
        console.log('🔑 Password:', adminPassword);
        console.log('👤 Role:', admin.role);
        console.log('🆔 User ID:', admin.id);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('⚠️ IMPORTANT: Change the password after first login!');

        process.exit(0);

    } catch (error) {
        console.error('❌ Error creating admin:', error);
        process.exit(1);
    }
}

createAdmin();