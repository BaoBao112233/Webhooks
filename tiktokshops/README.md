# TikTok Shop Webhooks Server

Webhook server cho TikTok Shop API với Node.js, Express và Nginx.

## Yêu cầu hệ thống

- Node.js (v14 trở lên)
- Nginx
- Domain name hoặc Public IP
- SSL Certificate (khuyến nghị dùng Let's Encrypt)

## Cài đặt

### 1. Cài đặt Dependencies

```bash
cd /home/baobao/Projects/Webhooks/tiktokshops
npm install
```

### 2. Cấu hình Environment Variables

Chỉnh sửa file `.env`:

```bash
nano .env
```

Cập nhật các thông tin sau:
- `TIKTOK_APP_KEY`: App Key từ TikTok Developer Portal
- `TIKTOK_APP_SECRET`: App Secret từ TikTok Developer Portal
- `DOMAIN`: Domain của bạn (ví dụ: webhooks.yourdomain.com)

### 3. Chạy Server (Development)

```bash
npm run dev
```

Hoặc:

```bash
npm start
```

Server sẽ chạy tại `http://localhost:3000`

## Cài đặt Production với Nginx

### 1. Cài đặt Nginx (nếu chưa có)

```bash
sudo apt update
sudo apt install nginx -y
```

### 2. Cấu hình Nginx

```bash
# Copy nginx config
sudo cp nginx.conf /etc/nginx/sites-available/tiktok-webhooks

# Chỉnh sửa file config và thay đổi 'yourdomain.com' thành domain của bạn
sudo nano /etc/nginx/sites-available/tiktok-webhooks

# Tạo symlink
sudo ln -s /etc/nginx/sites-available/tiktok-webhooks /etc/nginx/sites-enabled/

# Test config
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

### 3. Cài đặt SSL với Let's Encrypt (Khuyến nghị)

```bash
# Cài đặt Certbot
sudo apt install certbot python3-certbot-nginx -y

# Lấy SSL certificate
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Certbot sẽ tự động cấu hình Nginx với SSL
```

### 4. Chạy Server với PM2 (Process Manager)

```bash
# Cài đặt PM2
sudo npm install -g pm2

# Start server
pm2 start server.js --name tiktok-webhooks

# Auto start on reboot
pm2 startup
pm2 save
```

Hoặc sử dụng systemd:

```bash
# Copy service file
sudo cp tiktok-webhooks.service /etc/systemd/system/

# Enable và start service
sudo systemctl enable tiktok-webhooks
sudo systemctl start tiktok-webhooks

# Check status
sudo systemctl status tiktok-webhooks
```

## URLs cho TikTok App Configuration

Sau khi cài đặt xong, bạn sẽ có các URLs sau:

### Redirect URL (OAuth)
```
https://yourdomain.com/api/auth/tiktok/callback
```

### Webhook URL
```
https://yourdomain.com/api/webhooks/tiktok
```

### Health Check URL
```
https://yourdomain.com/health
```

## Cấu hình TikTok Shop App

1. Truy cập TikTok Shop Partner Center: https://partner.tiktokshop.com
2. Vào mục "App & Service" → Chọn app của bạn
3. Điền thông tin:
   - **Redirect URL**: `https://yourdomain.com/api/auth/tiktok/callback`
   - **Enable API**: Bật ON
   - **Customer support email**: Email hỗ trợ của bạn
   - **Target sellers**: Chọn market phù hợp (Vietnam)

4. Sau khi tạo xong, vào "Development Kits" → "Webhooks"
5. Thêm webhook endpoint: `https://yourdomain.com/api/webhooks/tiktok`

## Webhook Events được hỗ trợ

Server này xử lý các webhook events sau:

- `ORDER_STATUS_CHANGE`: Thay đổi trạng thái đơn hàng
- `PRODUCT_UPDATE`: Cập nhật sản phẩm
- `RETURN_STATUS_CHANGE`: Thay đổi trạng thái trả hàng
- `PACKAGE_UPDATE`: Cập nhật gói hàng

## Test Webhooks

### Sử dụng curl:

```bash
curl -X POST https://yourdomain.com/api/webhooks/tiktok \
  -H "Content-Type: application/json" \
  -d '{
    "type": "ORDER_STATUS_CHANGE",
    "data": {
      "order_id": "123456",
      "status": "SHIPPED"
    }
  }'
```

### Check health:

```bash
curl https://yourdomain.com/health
```

## Logs

### Xem logs từ PM2:
```bash
pm2 logs tiktok-webhooks
```

### Xem logs từ systemd:
```bash
sudo journalctl -u tiktok-webhooks -f
```

### Xem logs từ Nginx:
```bash
sudo tail -f /var/log/nginx/tiktok-webhooks-access.log
sudo tail -f /var/log/nginx/tiktok-webhooks-error.log
```

## Troubleshooting

### Port đã được sử dụng
```bash
# Kiểm tra process đang dùng port 3000
sudo lsof -i :3000

# Kill process nếu cần
sudo kill -9 <PID>
```

### Nginx không start được
```bash
# Check config syntax
sudo nginx -t

# Check error logs
sudo tail -f /var/log/nginx/error.log
```

### Firewall
Đảm bảo firewall cho phép traffic vào port 80 và 443:
```bash
sudo ufw allow 80
sudo ufw allow 443
sudo ufw status
```

## Bảo mật

1. **Verify Webhook Signature**: Uncomment code trong `server.js` để verify signature từ TikTok
2. **Rate Limiting**: Thêm rate limiting middleware để chống spam
3. **HTTPS Only**: Luôn sử dụng HTTPS trong production
4. **Environment Variables**: Không commit file `.env` vào git

## License

ISC
