require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3001;

const FB_WEBHOOK_PATH = process.env.WEBHOOK_PATH || '/api/webhooks/fb';
const MESSENGER_WEBHOOK_PATH = process.env.MESSENGER_WEBHOOK_PATH || '/api/webhooks/messenger';

// Middleware
app.use(morgan('combined'));

// Giữ lại raw body để verify chữ ký X-Hub-Signature-256
app.use(bodyParser.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(bodyParser.urlencoded({ extended: true }));

// Verify Facebook webhook signature (SHA256)
function verifyFbSignature(req) {
    const signatureHeader = req.headers['x-hub-signature-256'];
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
        return false;
    }
    if (!process.env.FB_APP_SECRET) {
        console.warn('FB_APP_SECRET not set - cannot verify signature');
        return false;
    }
    if (!req.rawBody) {
        return false;
    }

    const expected = crypto
        .createHmac('sha256', process.env.FB_APP_SECRET)
        .update(req.rawBody)
        .digest('hex');
    const received = signatureHeader.slice('sha256='.length);

    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(received, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

// GET verification handler (dùng chung cho cả FB và Messenger)
function handleVerification(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.FB_VERIFY_TOKEN) {
        console.log('Webhook verified successfully');
        return res.status(200).send(challenge);
    }
    console.warn('Webhook verification failed', { mode, tokenMatched: token === process.env.FB_VERIFY_TOKEN });
    return res.sendStatus(403);
}

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'Facebook & Messenger Webhooks'
    });
});

// ===== Facebook Page Webhook =====
app.get(FB_WEBHOOK_PATH, handleVerification);

app.post(FB_WEBHOOK_PATH, (req, res) => {
    console.log('Received FB webhook');

    if (process.env.NODE_ENV === 'production' && !verifyFbSignature(req)) {
        console.error('Invalid FB webhook signature');
        return res.sendStatus(401);
    }

    try {
        const body = req.body;

        // Luôn phản hồi 200 sớm cho FB, xử lý bất đồng bộ bên dưới
        res.status(200).send('EVENT_RECEIVED');

        if (body.object === 'page') {
            (body.entry || []).forEach((entry) => {
                if (entry.messaging) {
                    entry.messaging.forEach((event) => routeMessengerEvent(event, entry));
                }
                if (entry.changes) {
                    entry.changes.forEach((change) => handlePageFeedChange(change, entry));
                }
            });
            return;
        }

        console.log('Unhandled FB object type:', body.object);
    } catch (error) {
        console.error('Error processing FB webhook:', error);
    }
});

// ===== Messenger Webhook (endpoint riêng, hữu ích khi FB App cấu hình tách) =====
app.get(MESSENGER_WEBHOOK_PATH, handleVerification);

app.post(MESSENGER_WEBHOOK_PATH, (req, res) => {
    console.log('Received Messenger webhook');

    if (process.env.NODE_ENV === 'production' && !verifyFbSignature(req)) {
        console.error('Invalid Messenger webhook signature');
        return res.sendStatus(401);
    }

    try {
        const body = req.body;
        res.status(200).send('EVENT_RECEIVED');

        if (body.object === 'page') {
            (body.entry || []).forEach((entry) => {
                (entry.messaging || []).forEach((event) => routeMessengerEvent(event, entry));
            });
            return;
        }

        console.log('Unhandled Messenger object type:', body.object);
    } catch (error) {
        console.error('Error processing Messenger webhook:', error);
    }
});

// ===== Event routers & handlers =====
function routeMessengerEvent(event, entry) {
    const senderId = event.sender && event.sender.id;
    const recipientId = event.recipient && event.recipient.id;
    console.log(`Messenger event | page=${entry.id} sender=${senderId} recipient=${recipientId}`);

    if (event.message) {
        return handleMessengerMessage(event);
    }
    if (event.postback) {
        return handleMessengerPostback(event);
    }
    if (event.delivery) {
        return handleMessengerDelivery(event);
    }
    if (event.read) {
        return handleMessengerRead(event);
    }
    if (event.optin) {
        return handleMessengerOptin(event);
    }
    if (event.referral) {
        return handleMessengerReferral(event);
    }
    console.log('Unknown Messenger event:', JSON.stringify(event));
}

function handleMessengerMessage(event) {
    const text = event.message.text;
    const attachments = event.message.attachments;
    console.log('Messenger message:', { text, attachments });
    // TODO: phản hồi tin nhắn qua Send API nếu cần
}

function handleMessengerPostback(event) {
    console.log('Messenger postback:', event.postback);
    // TODO: xử lý payload từ button/menu
}

function handleMessengerDelivery(event) {
    console.log('Messenger delivery:', event.delivery);
}

function handleMessengerRead(event) {
    console.log('Messenger read:', event.read);
}

function handleMessengerOptin(event) {
    console.log('Messenger optin:', event.optin);
}

function handleMessengerReferral(event) {
    console.log('Messenger referral:', event.referral);
}

function handlePageFeedChange(change, entry) {
    console.log(`Page feed change | page=${entry.id} field=${change.field}`);
    switch (change.field) {
        case 'feed':
            console.log('Feed event:', change.value);
            break;
        case 'mention':
            console.log('Mention event:', change.value);
            break;
        case 'messages':
            console.log('Messages field event:', change.value);
            break;
        default:
            console.log('Unhandled field:', change.field, change.value);
    }
}

// ===== OAuth callback (Facebook Login) =====
app.get('/api/auth/fb/callback', (req, res) => {
    const { code, state, error, error_description: errorDescription } = req.query;

    if (error) {
        console.error('FB OAuth error:', error, errorDescription);
        return res.status(400).json({ error, error_description: errorDescription });
    }
    if (!code) {
        return res.status(400).json({ error: 'Missing authorization code' });
    }

    console.log('Received FB OAuth callback', { code, state });
    // TODO: đổi code lấy access_token qua Graph API nếu cần
    res.status(200).json({ success: true, message: 'Authorization successful', code });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    res.status(500).json({ error: 'Something went wrong!', message: err.message });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found', path: req.path });
});

app.listen(PORT, () => {
    console.log(`FB & Messenger Webhooks Server running on port ${PORT}`);
    console.log(`FB webhook:        ${FB_WEBHOOK_PATH}`);
    console.log(`Messenger webhook: ${MESSENGER_WEBHOOK_PATH}`);
    console.log(`OAuth callback:    /api/auth/fb/callback`);
    console.log(`Health check:      /health`);
    console.log(`Environment:       ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
