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

// ===== Admin: staff handover =====
// Liệt kê các user đang ở trạng thái staff-handled (AI đang tắt với họ)
app.get('/api/admin/handover', (req, res) => {
    res.status(200).json({
        count: staffHandledUsers.size,
        users: Array.from(staffHandledUsers),
    });
});

// Release: bật lại AI cho 1 user. Body: { psid: "..." }  hoặc all=true để release tất cả
app.post('/api/admin/handover/release', (req, res) => {
    const { psid, all } = req.body || {};
    if (all) {
        const cleared = staffHandledUsers.size;
        staffHandledUsers.clear();
        logEvent('♻️  HANDOVER RELEASED (all)', { cleared });
        return res.status(200).json({ success: true, cleared });
    }
    if (!psid) {
        return res.status(400).json({ error: 'Missing "psid" or "all" in body' });
    }
    const removed = releaseStaffHandover(psid);
    logEvent('♻️  HANDOVER RELEASED', { psid, removed });
    res.status(200).json({ success: true, psid, released: removed });
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

// ===== Chatbot integration =====
// PSID là chuỗi 16+ chữ số, vượt 2^53 → cắt 12 chữ số cuối để fit Number an toàn
function psidToInt(psid) {
    return Number(String(psid).slice(-12));
}

async function callChatbot({ senderId, text, imageUrl }) {
    const baseUrl = (process.env.CHATBOT_API_URL || 'http://localhost:5555').replace(/\/$/, '');
    const userIdInt = psidToInt(senderId);
    const payload = {
        conversation_id: String(senderId),
        session_id: userIdInt,
        user_id: userIdInt,
        message: text || '',
        url_image: imageUrl || null,
        limit_words: Number(process.env.CHATBOT_LIMIT_WORDS) || 500,
        social_network: process.env.CHATBOT_SOCIAL_NETWORK || 'messenger',
    };

    const resp = await fetch(`${baseUrl}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        throw new Error(`Chatbot ${resp.status}: ${JSON.stringify(data)}`);
    }
    return data;
}

async function sendMessengerMessage(psid, text) {
    const token = process.env.PAGE_ACCESS_TOKEN;
    if (!token) {
        console.warn('PAGE_ACCESS_TOKEN not set — skip Send API');
        return;
    }
    const version = process.env.GRAPH_API_VERSION || 'v19.0';
    const base = (process.env.GRAPH_API_BASE || 'https://graph.facebook.com').replace(/\/$/, '');
    const url = `${base}/${version}/me/messages?access_token=${encodeURIComponent(token)}`;
    const body = {
        recipient: { id: psid },
        message: { text },
        messaging_type: 'RESPONSE',
        metadata: process.env.AI_METADATA_TAG || 'ai',
    };
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        throw new Error(`Send API ${resp.status}: ${JSON.stringify(data)}`);
    }
    return data;
}

async function autoReplyWithChatbot({ pageId, senderId, text, imageUrl }) {
    const t0 = Date.now();
    const chatRes = await callChatbot({ senderId, text, imageUrl });
    const replyText = (chatRes && chatRes.response) ? chatRes.response : '';
    logEvent('🤖 CHATBOT REPLY', {
        pageId,
        senderId,
        elapsedMs: Date.now() - t0,
        errorStatus: chatRes && chatRes.error_status,
        notifi: chatRes && chatRes.notifi,
        response: replyText,
    });
    if (!replyText) return;

    // Tách reply thành nhiều đoạn theo "\n\n" rồi gửi tuần tự để cảm giác tự nhiên hơn
    const chunks = replyText
        .split(/\n{2,}/)
        .map((s) => s.trim())
        .filter(Boolean);

    if (chunks.length <= 1) {
        // Reply không chứa "\n\n" → gửi nguyên văn (giữ nguyên xuống dòng đơn)
        await sendMessengerMessage(senderId, replyText);
        return;
    }

    // Bỏ qua khoảng nghỉ giữa các message khi <=0 hoặc không phải số hợp lệ
    const gapMs = Math.max(0, Number(process.env.MESSAGE_CHUNK_DELAY_MS) || 0);
    for (let i = 0; i < chunks.length; i++) {
        await sendMessengerMessage(senderId, chunks[i]);
        if (gapMs > 0 && i < chunks.length - 1) {
            await new Promise((r) => setTimeout(r, gapMs));
        }
    }
    logEvent('✉️  CHUNKED SEND', { senderId, totalChunks: chunks.length });
}

// ===== Message batching (gom tin nhắn user trong cửa sổ N giây) =====
// Map<userPsid, { pageId, texts: string[], imageUrls: string[], timer }>
const userBatches = new Map();

// Set<userPsid> — cuộc hội thoại với user nào có staff đã can thiệp thì AI dừng với user đó.
// Per-user, không ảnh hưởng các user khác. Reset khi restart hoặc gọi admin endpoint.
const staffHandledUsers = new Set();

function isStaffHandled(userPsid) {
    return staffHandledUsers.has(String(userPsid));
}

function markStaffHandled(userPsid) {
    staffHandledUsers.add(String(userPsid));
}

function releaseStaffHandover(userPsid) {
    return staffHandledUsers.delete(String(userPsid));
}

function scheduleBatchedReply({ pageId, senderId, text, imageUrl }) {
    const windowMs = Number(process.env.BATCH_WINDOW_MS) || 3000;
    let batch = userBatches.get(senderId);
    if (!batch) {
        batch = { pageId, texts: [], imageUrls: [], timer: null };
        userBatches.set(senderId, batch);
    }
    if (text) batch.texts.push(text);
    if (imageUrl) batch.imageUrls.push(imageUrl);
    if (batch.timer) clearTimeout(batch.timer);

    batch.timer = setTimeout(() => {
        userBatches.delete(senderId);

        // Kiểm tra lại trước khi gọi chatbot
        if (process.env.AUTO_REPLY_ENABLED !== 'true') {
            logEvent('⏭️  SKIP BATCH (auto-reply globally disabled)', { senderId, batched: batch.texts.length });
            return;
        }
        if (isStaffHandled(senderId)) {
            logEvent('⏭️  SKIP BATCH (staff handover for this user)', { senderId, batched: batch.texts.length });
            return;
        }

        const combinedText = batch.texts.join('\n').trim();
        const finalImage = batch.imageUrls[batch.imageUrls.length - 1] || null;
        logEvent('📦 BATCH FLUSH', {
            senderId,
            messageCount: batch.texts.length,
            imageCount: batch.imageUrls.length,
            combinedText,
            imageUrl: finalImage,
        });

        autoReplyWithChatbot({ pageId: batch.pageId, senderId, text: combinedText, imageUrl: finalImage })
            .catch((err) => console.error('Auto-reply failed:', err.message));
    }, windowMs);
}

function cancelPendingBatch(senderId, reason) {
    const batch = userBatches.get(senderId);
    if (!batch) return;
    if (batch.timer) clearTimeout(batch.timer);
    userBatches.delete(senderId);
    logEvent('🛑 BATCH CANCELLED', { senderId, reason, dropped: batch.texts.length });
}

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

// Phân loại nguồn tin nhắn: user / ai / staff
// - Không phải echo => user (khách hàng nhắn vào page)
// - Echo + app_id == FB_APP_ID => ai (do app của ta gửi qua Send API)
// - Echo + metadata khớp AI_METADATA_TAG => ai (đánh dấu tường minh khi gọi Send API)
// - Echo còn lại => staff (nhân viên trả lời từ Page Inbox / Meta Business Suite)
function classifyMessageSource(msg) {
    if (!msg.is_echo) return 'user';
    const aiTag = process.env.AI_METADATA_TAG || 'ai';
    if (msg.metadata && String(msg.metadata).toLowerCase() === aiTag.toLowerCase()) return 'ai';
    if (process.env.FB_APP_ID && String(msg.app_id) === String(process.env.FB_APP_ID)) return 'ai';
    return 'staff';
}

const SOURCE_LABELS = {
    user: '👤 USER MESSAGE',
    ai:   '🤖 AI MESSAGE (echo)',
    staff:'🧑‍💼 STAFF MESSAGE (echo)',
};

function handleMessengerMessage(event, pageId, senderId, recipientId, timestamp) {
    const msg = event.message;
    const source = classifyMessageSource(msg);
    logEvent(SOURCE_LABELS[source], {
        source,
        metadata: { pageId, senderId, recipientId, timestamp, mid: msg.mid },
        text: msg.text || null,
        attachments: msg.attachments || null,
        quickReply: msg.quick_reply || null,
        isEcho: !!msg.is_echo,
        appId: msg.app_id || null,
        echoMetadata: msg.metadata || null,
        nlp: msg.nlp || null,
    });

    // Staff trả lời cho user nào → đánh dấu user đó (recipientId), AI dừng với riêng user đó.
    // Các user khác vẫn được AI trả lời bình thường.
    if (source === 'staff') {
        const userPsid = recipientId;
        if (!isStaffHandled(userPsid)) {
            markStaffHandled(userPsid);
            logEvent('🚫 STAFF HANDOVER', {
                reason: 'staff replied — AI disabled for this user only',
                pageId,
                userPsid,
            });
        }
        cancelPendingBatch(userPsid, 'staff replied');
        return;
    }

    // Bỏ qua echo của AI để tránh loop
    if (source !== 'user') return;
    if (process.env.AUTO_REPLY_ENABLED !== 'true') return;
    if (isStaffHandled(senderId)) {
        logEvent('⏭️  SKIP USER MESSAGE (staff handover active)', { senderId });
        return;
    }

    const text = (msg.text || '').trim();
    const imageAttachment = (msg.attachments || []).find((a) => a.type === 'image');
    const imageUrl = imageAttachment && imageAttachment.payload && imageAttachment.payload.url;
    if (!text && !imageUrl) return;

    // Gom tin trong cửa sổ BATCH_WINDOW_MS rồi mới gọi chatbot
    scheduleBatchedReply({ pageId, senderId, text, imageUrl });
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
