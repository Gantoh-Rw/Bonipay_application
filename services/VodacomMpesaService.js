const axios = require('axios');
const crypto = require('crypto');

class VodacomMpesaService {
    constructor() {
        this.apiKey = process.env.VODACOM_MPESA_API_KEY;
        this.publicKey = process.env.VODACOM_MPESA_PUBLIC_KEY;
        this.serviceProviderCode = process.env.VODACOM_MPESA_SERVICE_PROVIDER_CODE;
        this.initiatorIdentifier = process.env.VODACOM_MPESA_INITIATOR_IDENTIFIER;
        this.securityCredential = process.env.VODACOM_MPESA_SECURITY_CREDENTIAL;
        this.environment = process.env.MPESA_ENVIRONMENT || 'sandbox';
        this.callbackUrl = process.env.VODACOM_CALLBACK_URL;
        
        // API endpoints
        this.baseUrl = this.environment === 'production' 
            ? 'https://openapi.m-pesa.com'
            : 'https://openapi.m-pesa.com'; // Same URL for sandbox
            
        this.sessionTimeout = 30 * 60 * 1000; // 30 minutes
        this.sessionToken = null;
        this.sessionExpiry = null;
    }

    // Generate session token
    async getSessionToken() {
        try {
            // Check if we have a valid token
            if (this.sessionToken && this.sessionExpiry && Date.now() < this.sessionExpiry) {
                return this.sessionToken;
            }

            console.log('🔐 Getting new Vodacom M-Pesa session token...');

            const response = await axios.get(`${this.baseUrl}/sandbox/ipg/v2/vodacomTZN/getSession/`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.data && response.data.output_SessionID) {
                this.sessionToken = response.data.output_SessionID;
                this.sessionExpiry = Date.now() + this.sessionTimeout;
                
                console.log('✅ Session token obtained successfully');
                return this.sessionToken;
            } else {
                throw new Error('Failed to get session token from Vodacom');
            }

        } catch (error) {
            console.error('❌ Session token error:', error.response?.data || error.message);
            throw new Error(`Session token failed: ${error.message}`);
        }
    }

    // Encrypt security credential
    encryptSecurityCredential(credential) {
        try {
            // For sandbox, you might not need encryption
            // In production, use the public key to encrypt
            return Buffer.from(credential).toString('base64');
        } catch (error) {
            throw new Error(`Encryption failed: ${error.message}`);
        }
    }

    // Test connection
    async testConnection() {
        try {
            const sessionToken = await this.getSessionToken();
            
            return {
                success: true,
                message: 'Connection successful',
                environment: this.environment,
                session_token: sessionToken ? 'Valid' : 'Invalid'
            };
        } catch (error) {
            return {
                success: false,
                message: 'Connection failed',
                environment: this.environment,
                error: error.message
            };
        }
    }

    // Initiate C2B payment (Customer to Business)
    async initiateC2BPayment(phoneNumber, amount, currency, thirdPartyReference, description) {
        try {
            console.log(`📱 Initiating C2B payment: ${amount} ${currency} from ${phoneNumber}`);

            const sessionToken = await this.getSessionToken();
            
            // Clean phone number (remove + and country code if present)
            const cleanPhone = phoneNumber.replace(/^\+?243/, '').replace(/\D/g, '');
            
            const payload = {
                input_ServiceProviderCode: this.serviceProviderCode,
                input_CustomerMSISDN: `243${cleanPhone}`, // Add country code
                input_Amount: parseFloat(amount),
                input_ThirdPartyReference: thirdPartyReference,
                input_TransactionReference: thirdPartyReference,
                input_PurchasedItemsDesc: description || `Deposit ${amount} ${currency}`
            };

            console.log('📤 C2B Request payload:', JSON.stringify(payload, null, 2));

            const response = await axios.post(
                `${this.baseUrl}/sandbox/ipg/v2/vodacomTZN/c2bPayment/singleStage/`,
                payload,
                {
                    headers: {
                        'Authorization': `Bearer ${sessionToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            console.log('📥 C2B Response:', JSON.stringify(response.data, null, 2));

            if (response.data && response.data.output_ResponseCode === 'INS-0') {
                return {
                    success: true,
                    transactionID: response.data.output_TransactionID,
                    conversationID: response.data.output_ConversationID,
                    thirdPartyReference: thirdPartyReference,
                    responseDescription: response.data.output_ResponseDesc || 'Payment initiated'
                };
            } else {
                return {
                    success: false,
                    responseCode: response.data?.output_ResponseCode || 'UNKNOWN',
                    responseDescription: response.data?.output_ResponseDesc || 'Payment failed'
                };
            }

        } catch (error) {
            console.error('❌ C2B Payment error:', error.response?.data || error.message);
            
            return {
                success: false,
                responseCode: 'API_ERROR',
                responseDescription: error.response?.data?.output_ResponseDesc || error.message
            };
        }
    }

    // Initiate B2C payment (Business to Customer) 
    async initiateB2CPayment(phoneNumber, amount, currency, thirdPartyReference, description) {
        try {
            console.log(`💸 Initiating B2C payment: ${amount} ${currency} to ${phoneNumber}`);

            const sessionToken = await this.getSessionToken();
            
            // Clean phone number
            const cleanPhone = phoneNumber.replace(/^\+?243/, '').replace(/\D/g, '');
            
            const payload = {
                input_ServiceProviderCode: this.serviceProviderCode,
                input_CustomerMSISDN: `243${cleanPhone}`,
                input_Amount: parseFloat(amount),
                input_ThirdPartyReference: thirdPartyReference,
                input_TransactionReference: thirdPartyReference,
                input_PaymentItemsDesc: description || `Withdrawal ${amount} ${currency}`
            };

            console.log('📤 B2C Request payload:', JSON.stringify(payload, null, 2));

            const response = await axios.post(
                `${this.baseUrl}/sandbox/ipg/v2/vodacomTZN/b2cPayment/`,
                payload,
                {
                    headers: {
                        'Authorization': `Bearer ${sessionToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            console.log('📥 B2C Response:', JSON.stringify(response.data, null, 2));

            if (response.data && response.data.output_ResponseCode === 'INS-0') {
                return {
                    success: true,
                    transactionID: response.data.output_TransactionID,
                    conversationID: response.data.output_ConversationID,
                    thirdPartyReference: thirdPartyReference,
                    responseDescription: response.data.output_ResponseDesc || 'Payment sent'
                };
            } else {
                return {
                    success: false,
                    responseCode: response.data?.output_ResponseCode || 'UNKNOWN',
                    responseDescription: response.data?.output_ResponseDesc || 'Payment failed'
                };
            }

        } catch (error) {
            console.error('❌ B2C Payment error:', error.response?.data || error.message);
            
            return {
                success: false,
                responseCode: 'API_ERROR',
                responseDescription: error.response?.data?.output_ResponseDesc || error.message
            };
        }
    }

    // Query transaction status
    async queryTransactionStatus(transactionID, thirdPartyReference) {
        try {
            console.log(`🔍 Querying transaction status: ${transactionID}`);

            const sessionToken = await this.getSessionToken();
            
            const payload = {
                input_ServiceProviderCode: this.serviceProviderCode,
                input_ThirdPartyReference: thirdPartyReference,
                input_QueryReference: transactionID
            };

            const response = await axios.post(
                `${this.baseUrl}/sandbox/ipg/v2/vodacomTZN/queryTransactionStatus/`,
                payload,
                {
                    headers: {
                        'Authorization': `Bearer ${sessionToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return {
                success: true,
                transactionStatus: response.data?.output_ResponseDesc || 'Unknown',
                responseCode: response.data?.output_ResponseCode || 'UNKNOWN',
                responseDescription: response.data?.output_ResponseDesc || 'Status retrieved'
            };

        } catch (error) {
            console.error('❌ Transaction status query error:', error.response?.data || error.message);
            
            return {
                success: false,
                responseCode: 'API_ERROR',
                responseDescription: error.message
            };
        }
    }

    // Validate configuration
    validateConfig() {
        const required = [
            'VODACOM_MPESA_API_KEY',
            'VODACOM_MPESA_PUBLIC_KEY', 
            'VODACOM_MPESA_SERVICE_PROVIDER_CODE'
        ];

        const missing = required.filter(key => !process.env[key]);
        
        if (missing.length > 0) {
            throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
        }

        return true;
    }
}

module.exports = VodacomMpesaService;