require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(morgan('combined'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Verify TikTok Shop webhook signature
function verifyWebhookSignature(req) {
    const signature = req.headers['x-tiktok-signature'];
    const timestamp = req.headers['x-tiktok-timestamp'];
    
    if (!signature || !timestamp) {
        return false;
    }

    // Create the signature string
    const signatureString = `${process.env.TIKTOK_APP_SECRET}${req.body}${timestamp}`;
    
    // Generate HMAC SHA256 hash
    const hmac = crypto.createHmac('sha256', process.env.TIKTOK_APP_SECRET);
    hmac.update(signatureString);
    const calculatedSignature = hmac.digest('hex');

    return signature === calculatedSignature;
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'TikTok Shop Webhooks'
    });
});

// TikTok webhook endpoint
app.post(process.env.WEBHOOK_PATH || '/api/webhooks/tiktok', (req, res) => {
    console.log('Received webhook request');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));

    // Verify webhook signature (optional, uncomment for production)
    // if (!verifyWebhookSignature(req)) {
    //     console.error('Invalid webhook signature');
    //     return res.status(401).json({ error: 'Invalid signature' });
    // }

    try {
        const webhookData = req.body;
        
        // Handle different webhook event types
        switch(webhookData.type) {
            case 'ORDER_STATUS_CHANGE':
                handleOrderStatusChange(webhookData);
                break;
            case 'PRODUCT_UPDATE':
                handleProductUpdate(webhookData);
                break;
            case 'RETURN_STATUS_CHANGE':
                handleReturnStatusChange(webhookData);
                break;
            case 'PACKAGE_UPDATE':
                handlePackageUpdate(webhookData);
                break;
            default:
                console.log('Unknown webhook type:', webhookData.type);
        }

        // Always respond with 200 OK to acknowledge receipt
        res.status(200).json({ 
            success: true,
            message: 'Webhook received successfully'
        });

    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
});

// Webhook event handlers
function handleOrderStatusChange(data) {
    console.log('Processing ORDER_STATUS_CHANGE:', data);
    // Implement your order status change logic here
    // Example: Update database, send notification, etc.
}

function handleProductUpdate(data) {
    console.log('Processing PRODUCT_UPDATE:', data);
    // Implement your product update logic here
}

function handleReturnStatusChange(data) {
    console.log('Processing RETURN_STATUS_CHANGE:', data);
    // Implement your return status change logic here
}

function handlePackageUpdate(data) {
    console.log('Processing PACKAGE_UPDATE:', data);
    // Implement your package update logic here
}

// Redirect URL endpoint (for OAuth)
app.get('/api/auth/tiktok/callback', (req, res) => {
    const authCode = req.query.code;
    const state = req.query.state;
    
    console.log('Received TikTok OAuth callback');
    console.log('Auth Code:', authCode);
    console.log('State:', state);

    if (!authCode) {
        return res.status(400).json({ 
            error: 'Missing authorization code' 
        });
    }

    // Here you would exchange the auth code for an access token
    // Implement your OAuth flow logic
    
    res.status(200).json({ 
        success: true,
        message: 'Authorization successful',
        code: authCode
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    res.status(500).json({ 
        error: 'Something went wrong!',
        message: err.message 
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        error: 'Not found',
        path: req.path 
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 TikTok Shop Webhooks Server running on port ${PORT}`);
    console.log(`📍 Webhook endpoint: ${process.env.WEBHOOK_PATH || '/api/webhooks/tiktok'}`);
    console.log(`📍 OAuth callback: /api/auth/tiktok/callback`);
    console.log(`📍 Health check: /health`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
