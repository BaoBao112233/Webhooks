# Facebook & Messenger Webhooks Server

Webhook server cho Facebook Page & Messenger Platform với Node.js, Express và Nginx.

## Yêu cầu hệ thống

- Node.js (v14 trở lên)
- Nginx
- Domain name (bắt buộc để Facebook verify — phải HTTPS)
- SSL Certificate (khuyến nghị dùng Let's Encrypt)

## Cài đặt

### 1. Cài đặt Dependencies

```bash
cd /home/baobao/Projects/Webhooks/fb_messager
npm install
```

### 2. Cấu hình Environment Variables

```bash
cp .env.example .env
nano .env
```

Cập nhật:
- `FB_APP_ID`, `FB_APP_SECRET`: từ Facebook App → Settings → Basic
- `FB_VERIFY_TOKEN`: chuỗi tự đặt, **phải trùng** với giá trị điền ở Facebook App khi bật webhook
- `PAGE_ACCESS_TOKEN`: lấy từ Page → Messenger → Settings (dùng khi gọi Send API gửi tin nhắn)
- `DOMAIN`: domain của bạn

### 3. Chạy Server (Development)

```bash
npm run dev      # hoặc: npm start
```

Server chạy mặc định tại `http://localhost:3001`.

## Cài đặt Production với Nginx

### 1. Cài đặt Nginx

```bash
sudo apt update
sudo apt install nginx -y
```

### 2. Cấu hình Nginx

```bash
sudo cp nginx.conf /etc/nginx/sites-available/fb-webhooks
sudo nano /etc/nginx/sites-available/fb-webhooks   # đổi webhooks.yourdomain.com thành domain của bạn
sudo ln -s /etc/nginx/sites-available/fb-webhooks /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 3. Cài SSL với Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d webhooks.yourdomain.com
```

### 4. Chạy Server với PM2

```bash
sudo npm install -g pm2
pm2 start server.js --name fb-webhooks
pm2 startup
pm2 save
```

Hoặc dùng systemd:

```bash
sudo cp fb-webhooks.service /etc/systemd/system/
sudo systemctl enable fb-webhooks
sudo systemctl start fb-webhooks
sudo systemctl status fb-webhooks
```

## URLs cho Facebook App Configuration

Sau khi deploy, bạn sẽ có:

| Chức năng                         | URL                                                       |
|-----------------------------------|-----------------------------------------------------------|
| Webhook (Facebook Page object)    | `https://yourdomain.com/api/webhooks/fb`                  |
| Webhook (Messenger — tùy chọn)    | `https://yourdomain.com/api/webhooks/messenger`           |
| OAuth Redirect (Facebook Login)   | `https://yourdomain.com/api/auth/fb/callback`             |
| Health Check                      | `https://yourdomain.com/health`                           |

> Facebook chỉ cho webhook 1 URL / 1 object. `/api/webhooks/fb` đã xử lý cả `messaging` và `changes` nên có thể dùng duy nhất URL này cho object `page`. Endpoint `/api/webhooks/messenger` chỉ là alias khi bạn muốn tách biệt cấu hình.

## Cấu hình trên Facebook App

1. Vào https://developers.facebook.com/apps → chọn app → **Webhooks**.
2. Chọn object cần subscribe (thường là **Page**).
3. Bấm **Subscribe to this object** và điền:
   - **Callback URL**: `https://yourdomain.com/api/webhooks/fb`
   - **Verify Token**: giá trị bạn đặt ở `FB_VERIFY_TOKEN`
4. Facebook sẽ gửi GET request với `hub.mode=subscribe`. Server trả về `hub.challenge` → verify thành công.
5. Chọn các fields muốn nhận: `messages`, `messaging_postbacks`, `messaging_optins`, `message_deliveries`, `message_reads`, `feed`, `mention`, ...
6. Vào **Messenger → Settings → Webhooks**, link Fanpage với app để bắt đầu nhận event.

## Webhook Events được hỗ trợ

**Messenger (object `page` → `entry[].messaging[]`):**
- `message` — tin nhắn text / attachment
- `postback` — bấm button, menu
- `delivery` — báo đã gửi
- `read` — báo đã đọc
- `optin` — Send-to-Messenger / checkbox plugin
- `referral` — m.me link / ads click-to-Messenger

**Facebook Page (object `page` → `entry[].changes[]`):**
- `feed` — post, comment, reaction trên fanpage
- `mention` — fanpage được tag
- `messages` — biến thể của inbox updates

Xem các handler tương ứng trong `server.js` để thêm logic xử lý.

## Test Webhooks

### Test verification (GET)

```bash
curl "https://yourdomain.com/api/webhooks/fb?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=test123"
# → "test123"
```

### Test event (POST) — payload mẫu của Messenger

```bash
curl -X POST https://yourdomain.com/api/webhooks/fb \
  -H "Content-Type: application/json" \
  -d '{
    "object": "page",
    "entry": [{
      "id": "PAGE_ID",
      "time": 1680000000000,
      "messaging": [{
        "sender": { "id": "USER_PSID" },
        "recipient": { "id": "PAGE_ID" },
        "timestamp": 1680000000000,
        "message": { "mid": "m_xxx", "text": "hello" }
      }]
    }]
  }'
```

> Ở production (`NODE_ENV=production`), request không kèm `X-Hub-Signature-256` hợp lệ sẽ bị reject 401. Khi test thủ công, tạm set `NODE_ENV=development` hoặc tự ký request với `FB_APP_SECRET`.

### Check health

```bash
curl https://yourdomain.com/health
```

## Logs

```bash
pm2 logs fb-webhooks                       # PM2
sudo journalctl -u fb-webhooks -f          # systemd
sudo tail -f /var/log/nginx/fb-webhooks-access.log
sudo tail -f /var/log/nginx/fb-webhooks-error.log
```

## Troubleshooting

### Port đã được sử dụng
```bash
sudo lsof -i :3001
sudo kill -9 <PID>
```

### FB verify trả về 403
- Kiểm tra `FB_VERIFY_TOKEN` trong `.env` phải trùng **tuyệt đối** với giá trị điền trên Facebook App.
- Đảm bảo URL public, HTTPS hợp lệ, không bị redirect lạ.

### Signature luôn invalid
- Phải dùng `FB_APP_SECRET` (không phải Page Access Token).
- Không được thay đổi body sau khi `body-parser` parse — middleware đã lưu `req.rawBody` từ raw bytes.
- Kiểm tra proxy (Cloudflare/Nginx) không sửa body (gzip, minify JSON, ...).

### Firewall
```bash
sudo ufw allow 80
sudo ufw allow 443
sudo ufw status
```

## Bảo mật

1. **Verify signature**: mặc định bật ở `NODE_ENV=production` — giữ nguyên.
2. **HTTPS only**: Facebook yêu cầu HTTPS, đừng chạy HTTP ở production.
3. **Verify token**: dùng chuỗi đủ dài, ngẫu nhiên, không commit vào git.
4. **Rate limiting**: cân nhắc thêm middleware (`express-rate-limit`) nếu endpoint public.
5. **Env vars**: không commit `.env`.

## License

ISC
