const axios = require('axios');
const crypto = require('crypto');

class FlutterwaveService {
    constructor() {
        this.publicKey = process.env.FLUTTERWAVE_PUBLIC_KEY;
        this.secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
        this.encryptionKey = process.env.FLUTTERWAVE_ENCRYPTION_KEY;
        this.environment = process.env.FLUTTERWAVE_ENVIRONMENT || 'sandbox';
        this.callbackUrl = process.env.FLUTTERWAVE_CALLBACK_URL;
        
        // API endpoints
        this.baseUrl = this.environment === 'production' 
            ? 'https://api.flutterwave.com/v3'
            : 'https://api.flutterwave.com/v3'; // Same for sandbox
    }

    // Encrypt card data (if needed later)
    encryptData(data) {
        const cipher = crypto.createCipher('aes-256-cbc', this.encryptionKey);
        let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'base64');
        encrypted += cipher.final('base64');
        return encrypted;
    }

    // Test connection
    async testConnection() {
        try {
            const response = await axios.get(`${this.baseUrl}/banks/NG`, {
                headers: {
                    'Authorization': `Bearer ${this.secretKey}`,
                    'Content-Type': 'application/json'
                }
            });

            return {
                success: true,
                message: 'Connection successful',
                environment: this.environment
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

    // Initiate Mobile Money Collection (Customer pays you)
    async initiateMobileMoneyCollection(phoneNumber, amount, currency, txRef, description, network = 'vodacom') {
        try {
            console.log(`📱 Initiating Mobile Money Collection: ${amount} ${currency} from ${phoneNumber}`);

            // Clean phone number for DRC
            const cleanPhone = phoneNumber.replace(/^\+?243/, '').replace(/\D/g, '');
            const fullPhone = `243${cleanPhone}`;

            const payload = {
                tx_ref: txRef,
                amount: parseFloat(amount),
                currency: currency,
                email: "customer@example.com", // Required by Flutterwave
                phone_number: fullPhone,
                fullname: "Customer Name", // You can get this from user data
                redirect_url: this.callbackUrl,
                meta: {
                    consumer_id: txRef,
                    consumer_mac: "92a3-912ba-1192a"
                },
                customizations: {
                    title: "Payment",
                    description: description || `Deposit ${amount} ${currency}`,
                    logo: "https://your-app.com/logo.png"
                },
                configurations: {
                    network: network // vodacom, airtel, orange, etc.
                }
            };

            console.log('📤 Mobile Money Collection payload:', JSON.stringify(payload, null, 2));

            const response = await axios.post(
                `${this.baseUrl}/charges?type=mobile_money_congo_drc`,
                payload,
                {
                    headers: {
                        'Authorization': `Bearer ${this.secretKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            console.log('📥 Mobile Money Collection Response:', JSON.stringify(response.data, null, 2));

            if (response.data && response.data.status === 'success') {
                return {
                    success: true,
                    transactionID: response.data.data.id,
                    flw_ref: response.data.data.flw_ref,
                    tx_ref: txRef,
                    payment_link: response.data.data.link,
                    responseDescription: 'Payment initiated successfully'
                };
            } else {
                return {
                    success: false,
                    responseCode: response.data?.status || 'UNKNOWN',
                    responseDescription: response.data?.message || 'Payment failed'
                };
            }

        } catch (error) {
            console.error('❌ Mobile Money Collection error:', error.response?.data || error.message);
            
            return {
                success: false,
                responseCode: 'API_ERROR',
                responseDescription: error.response?.data?.message || error.message
            };
        }
    }

    // Initiate Transfer (Send money to customer)
    async initiateTransfer(phoneNumber, amount, currency, txRef, description, narration) {
        try {
            console.log(`💸 Initiating Transfer: ${amount} ${currency} to ${phoneNumber}`);

            // Clean phone number
            const cleanPhone = phoneNumber.replace(/^\+?243/, '').replace(/\D/g, '');
            const fullPhone = `+243${cleanPhone}`;

            const payload = {
                account_bank: "VODACOM", // or "AIRTEL", "ORANGE" for DRC
                account_number: fullPhone,
                amount: parseFloat(amount),
                narration: narration || description || `Transfer ${amount} ${currency}`,
                currency: currency,
                reference: txRef,
                callback_url: this.callbackUrl,
                debit_currency: currency
            };

            console.log('📤 Transfer payload:', JSON.stringify(payload, null, 2));

            const response = await axios.post(
                `${this.baseUrl}/transfers`,
                payload,
                {
                    headers: {
                        'Authorization': `Bearer ${this.secretKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            console.log('📥 Transfer Response:', JSON.stringify(response.data, null, 2));

            if (response.data && response.data.status === 'success') {
                return {
                    success: true,
                    transferID: response.data.data.id,
                    reference: response.data.data.reference,
                    tx_ref: txRef,
                    responseDescription: 'Transfer initiated successfully'
                };
            } else {
                return {
                    success: false,
                    responseCode: response.data?.status || 'UNKNOWN',
                    responseDescription: response.data?.message || 'Transfer failed'
                };
            }

        } catch (error) {
            console.error('❌ Transfer error:', error.response?.data || error.message);
            
            return {
                success: false,
                responseCode: 'API_ERROR',
                responseDescription: error.response?.data?.message || error.message
            };
        }
    }

    // Verify transaction status
    async verifyTransaction(transactionId) {
        try {
            console.log(`🔍 Verifying transaction: ${transactionId}`);

            const response = await axios.get(
                `${this.baseUrl}/transactions/${transactionId}/verify`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.secretKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return {
                success: true,
                data: response.data.data,
                status: response.data.data.status,
                responseDescription: 'Transaction verified'
            };

        } catch (error) {
            console.error('❌ Transaction verification error:', error.response?.data || error.message);
            
            return {
                success: false,
                responseCode: 'API_ERROR',
                responseDescription: error.message
            };
        }
    }

    // Get supported banks/networks for DRC
    async getSupportedNetworks() {
        try {
            const response = await axios.get(`${this.baseUrl}/banks/CD`, {
                headers: {
                    'Authorization': `Bearer ${this.secretKey}`
                }
            });

            return response.data.data;
        } catch (error) {
            console.error('Error fetching networks:', error);
            return [];
        }
    }

    // Validate configuration
    validateConfig() {
        const required = [
            'FLUTTERWAVE_PUBLIC_KEY',
            'FLUTTERWAVE_SECRET_KEY',
            'FLUTTERWAVE_ENCRYPTION_KEY'
        ];

        const missing = required.filter(key => !process.env[key]);
        
        if (missing.length > 0) {
            throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
        }

        return true;
    }
}

module.exports = FlutterwaveService;