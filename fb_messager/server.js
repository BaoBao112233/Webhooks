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
function logEvent(label, data) {
    const ts = new Date().toISOString();
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[${ts}] ${label}`);
    console.log(JSON.stringify(data, null, 2));
    console.log('─'.repeat(60));
}

function routeMessengerEvent(event, entry) {
    const senderId = event.sender && event.sender.id;
    const recipientId = event.recipient && event.recipient.id;
    const timestamp = event.timestamp ? new Date(event.timestamp).toISOString() : null;

    if (event.message) {
        return handleMessengerMessage(event, entry.id, senderId, recipientId, timestamp);
    }
    if (event.postback) {
        return handleMessengerPostback(event, entry.id, senderId, timestamp);
    }
    if (event.delivery) {
        return handleMessengerDelivery(event, entry.id, senderId);
    }
    if (event.read) {
        return handleMessengerRead(event, entry.id, senderId);
    }
    if (event.optin) {
        return handleMessengerOptin(event, entry.id, senderId);
    }
    if (event.referral) {
        return handleMessengerReferral(event, entry.id, senderId);
    }
    logEvent('⚠️  UNKNOWN EVENT', { pageId: entry.id, senderId, recipientId, timestamp, event });
}

function handleMessengerMessage(event, pageId, senderId, recipientId, timestamp) {
    const msg = event.message;
    const isEcho = msg.is_echo;
    const label = isEcho ? '📤 MESSAGE SENT (echo)' : '📨 MESSAGE RECEIVED';
    logEvent(label, {
        metadata: { pageId, senderId, recipientId, timestamp, mid: msg.mid },
        text: msg.text || null,
        attachments: msg.attachments || null,
        quickReply: msg.quick_reply || null,
        isEcho,
        nlp: msg.nlp || null,
    });
    // TODO: phản hồi tin nhắn qua Send API nếu cần
}

function handleMessengerPostback(event, pageId, senderId, timestamp) {
    logEvent('🔘 POSTBACK', {
        metadata: { pageId, senderId, timestamp },
        title: event.postback.title,
        payload: event.postback.payload,
        referral: event.postback.referral || null,
    });
    // TODO: xử lý payload từ button/menu
}

function handleMessengerDelivery(event, pageId, senderId) {
    logEvent('✅ DELIVERY', {
        metadata: { pageId, senderId },
        mids: event.delivery.mids || null,
        watermark: event.delivery.watermark,
    });
}

function handleMessengerRead(event, pageId, senderId) {
    logEvent('👁️  READ', {
        metadata: { pageId, senderId },
        watermark: event.read.watermark,
    });
}

function handleMessengerOptin(event, pageId, senderId) {
    logEvent('🔔 OPT-IN', {
        metadata: { pageId, senderId },
        optin: event.optin,
    });
}

function handleMessengerReferral(event, pageId, senderId) {
    logEvent('🔗 REFERRAL', {
        metadata: { pageId, senderId },
        referral: event.referral,
    });
}

function handlePageFeedChange(change, entry) {
    logEvent(`📋 PAGE FEED — field: ${change.field}`, {
        metadata: { pageId: entry.id, field: change.field },
        value: change.value,
    });
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
