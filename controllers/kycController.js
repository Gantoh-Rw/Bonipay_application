// controllers/kycController.js
const User = require('../models/User');
const KYC = require('../models/kyc');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'uploads/kyc-documents';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `kyc-${req.user.id}-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Only JPEG, PNG, and JPG files are allowed'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// Get KYC status and data
const getKYCStatus = async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Get user data for full name
        const user = await User.findByPk(userId, {
            attributes: ['firstName', 'surname', 'otherNames']
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Construct full name
        const fullName = `${user.firstName} ${user.surname}${user.otherNames ? ' ' + user.otherNames : ''}`.trim();

        // Get existing KYC record
        let kycRecord = await KYC.findOne({
            where: { userId },
            attributes: ['id', 'fullName', 'nationality', 'gender', 'dateOfBirth', 'identityType', 'identityNumber', 'verificationStatus', 'rejectionReason', 'verifiedAt']
        });

        if (!kycRecord) {
            // Create initial KYC record with user's full name
            kycRecord = await KYC.create({
                userId,
                fullName,
                verificationStatus: 'incomplete'
            });
        }

        res.json({
            success: true,
            kyc: {
                id: kycRecord.id,
                fullName: kycRecord.fullName,
                nationality: kycRecord.nationality,
                gender: kycRecord.gender,
                dateOfBirth: kycRecord.dateOfBirth,
                identityType: kycRecord.identityType,
                identityNumber: kycRecord.identityNumber,
                verificationStatus: kycRecord.verificationStatus,
                rejectionReason: kycRecord.rejectionReason,
                verifiedAt: kycRecord.verifiedAt,
                hasDocument: !!kycRecord.documentPath
            }
        });
    } catch (error) {
        console.error('Get KYC status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get KYC status',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Update KYC personal details
const updateKYCDetails = async (req, res) => {
    try {
        const userId = req.user.id;
        const { nationality, gender, dateOfBirth } = req.body;

        // Find existing KYC record
        let kycRecord = await KYC.findOne({
            where: { userId }
        });

        if (!kycRecord) {
            return res.status(404).json({
                success: false,
                message: 'KYC record not found. Please get KYC status first.'
            });
        }

        // Update the record
        await kycRecord.update({
            nationality: nationality || kycRecord.nationality,
            gender: gender || kycRecord.gender,
            dateOfBirth: dateOfBirth || kycRecord.dateOfBirth
        });

        res.json({
            success: true,
            message: 'KYC details updated successfully',
            kyc: {
                id: kycRecord.id,
                fullName: kycRecord.fullName,
                nationality: kycRecord.nationality,
                gender: kycRecord.gender,
                dateOfBirth: kycRecord.dateOfBirth,
                verificationStatus: kycRecord.verificationStatus
            }
        });
    } catch (error) {
        console.error('Update KYC details error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update KYC details',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Upload identity document
const uploadIdentityDocument = async (req, res) => {
    try {
        const userId = req.user.id;
        const { identityType, identityNumber } = req.body;

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No document file uploaded'
            });
        }

        if (!identityType || !identityNumber) {
            return res.status(400).json({
                success: false,
                message: 'Identity type and number are required'
            });
        }

        // Find existing KYC record
        let kycRecord = await KYC.findOne({
            where: { userId }
        });

        if (!kycRecord) {
            return res.status(404).json({
                success: false,
                message: 'KYC record not found. Please get KYC status first.'
            });
        }

        // Delete old document if exists
        if (kycRecord.documentPath && fs.existsSync(kycRecord.documentPath)) {
            fs.unlinkSync(kycRecord.documentPath);
        }

        // Update KYC record with document info
        await kycRecord.update({
            identityType,
            identityNumber,
            documentPath: req.file.path,
            verificationStatus: 'pending'
        });

        res.json({
            success: true,
            message: 'Identity document uploaded successfully',
            kyc: {
                id: kycRecord.id,
                fullName: kycRecord.fullName,
                nationality: kycRecord.nationality,
                gender: kycRecord.gender,
                dateOfBirth: kycRecord.dateOfBirth,
                identityType: kycRecord.identityType,
                identityNumber: kycRecord.identityNumber,
                verificationStatus: kycRecord.verificationStatus,
                hasDocument: true
            }
        });
    } catch (error) {
        console.error('Upload document error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to upload document',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Submit KYC for verification
const submitKYCForVerification = async (req, res) => {
    try {
        const userId = req.user.id;

        const kycRecord = await KYC.findOne({
            where: { userId }
        });

        if (!kycRecord) {
            return res.status(404).json({
                success: false,
                message: 'KYC record not found'
            });
        }

        // Check if all required fields are filled
        const requiredFields = ['nationality', 'gender', 'dateOfBirth', 'identityType', 'identityNumber', 'documentPath'];
        const missingFields = requiredFields.filter(field => !kycRecord[field]);

        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Please complete all required fields before submitting',
                missingFields
            });
        }

        // Update status to pending
        await kycRecord.update({
            verificationStatus: 'pending'
        });

        res.json({
            success: true,
            message: 'KYC submitted for verification successfully',
            verificationStatus: 'pending'
        });
    } catch (error) {
        console.error('Submit KYC error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit KYC',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

module.exports = {
    getKYCStatus,
    updateKYCDetails,
    uploadIdentityDocument,
    submitKYCForVerification,
    upload
};