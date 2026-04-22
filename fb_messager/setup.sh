#!/bin/bash

# FB & Messenger Webhooks - Quick Setup Script

echo "========================================="
echo "FB & Messenger Webhooks - Quick Setup"
echo "========================================="
echo ""

if [ "$EUID" -ne 0 ]; then
    echo "⚠️  This script needs sudo privileges for some operations."
    echo "You may be prompted for your password."
    echo ""
fi

echo "📦 Installing Node.js dependencies..."
npm install
echo "✅ Dependencies installed"
echo ""

if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found, creating from .env.example..."
    cp .env.example .env
    echo "📝 Please edit .env file with your configuration:"
    echo "   nano .env"
    echo ""
fi

read -p "🌐 Enter your domain name (e.g., webhooks.yourdomain.com): " domain
if [ ! -z "$domain" ]; then
    sed -i "s/webhooks.yourdomain.com/$domain/g" nginx.conf
    sed -i "s/DOMAIN=.*/DOMAIN=$domain/" .env
    echo "✅ Domain configured: $domain"
fi
echo ""

read -p "📦 Do you want to install/configure Nginx? (y/n): " install_nginx
if [ "$install_nginx" = "y" ] || [ "$install_nginx" = "Y" ]; then
    echo "Installing Nginx..."
    sudo apt update
    sudo apt install nginx -y

    sudo cp nginx.conf /etc/nginx/sites-available/fb-webhooks
    sudo ln -sf /etc/nginx/sites-available/fb-webhooks /etc/nginx/sites-enabled/

    sudo nginx -t
    if [ $? -eq 0 ]; then
        sudo systemctl reload nginx
        echo "✅ Nginx installed and configured"
    else
        echo "❌ Nginx configuration error. Please check manually."
    fi
fi
echo ""

read -p "🔒 Do you want to setup SSL with Let's Encrypt? (y/n): " setup_ssl
if [ "$setup_ssl" = "y" ] || [ "$setup_ssl" = "Y" ]; then
    if [ -z "$domain" ]; then
        read -p "🌐 Enter your domain name for SSL: " domain
    fi

    echo "Installing Certbot..."
    sudo apt install certbot python3-certbot-nginx -y

    echo "Obtaining SSL certificate..."
    sudo certbot --nginx -d $domain
    echo "✅ SSL configured"
fi
echo ""

read -p "🔧 Do you want to setup PM2 process manager? (y/n): " setup_pm2
if [ "$setup_pm2" = "y" ] || [ "$setup_pm2" = "Y" ]; then
    echo "Installing PM2..."
    sudo npm install -g pm2

    pm2 start server.js --name fb-webhooks
    pm2 save
    pm2 startup

    echo "✅ PM2 configured"
fi
echo ""

echo "========================================="
echo "✅ Setup Complete!"
echo "========================================="
echo ""
echo "📋 Next steps:"
echo ""
echo "1. Edit .env file with your Facebook App credentials:"
echo "   nano .env"
echo ""
echo "2. Start the server:"
if [ "$setup_pm2" = "y" ] || [ "$setup_pm2" = "Y" ]; then
    echo "   pm2 restart fb-webhooks"
else
    echo "   npm start"
fi
echo ""
echo "3. Use these URLs in Facebook App Dashboard:"
if [ ! -z "$domain" ]; then
    echo "   Callback URL (Page):      https://$domain/api/webhooks/fb"
    echo "   Callback URL (Messenger): https://$domain/api/webhooks/messenger"
    echo "   OAuth Redirect:           https://$domain/api/auth/fb/callback"
else
    echo "   Callback URL (Page):      https://yourdomain.com/api/webhooks/fb"
    echo "   Callback URL (Messenger): https://yourdomain.com/api/webhooks/messenger"
    echo "   OAuth Redirect:           https://yourdomain.com/api/auth/fb/callback"
fi
echo ""
echo "4. Check server health:"
if [ ! -z "$domain" ]; then
    echo "   curl https://$domain/health"
else
    echo "   curl http://localhost:3001/health"
fi
echo ""
echo "========================================="
