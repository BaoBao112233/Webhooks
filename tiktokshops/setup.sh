#!/bin/bash

# TikTok Shop Webhooks - Quick Setup Script
# This script helps you quickly set up the webhook server

echo "========================================="
echo "TikTok Shop Webhooks - Quick Setup"
echo "========================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "⚠️  This script needs sudo privileges for some operations."
    echo "You may be prompted for your password."
    echo ""
fi

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
npm install
echo "✅ Dependencies installed"
echo ""

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found, creating from .env.example..."
    cp .env.example .env
    echo "📝 Please edit .env file with your configuration:"
    echo "   nano .env"
    echo ""
fi

# Ask for domain
read -p "🌐 Enter your domain name (e.g., webhooks.yourdomain.com): " domain
if [ ! -z "$domain" ]; then
    sed -i "s/yourdomain.com/$domain/g" nginx.conf
    sed -i "s/DOMAIN=.*/DOMAIN=$domain/" .env
    echo "✅ Domain configured: $domain"
fi
echo ""

# Ask if user wants to install Nginx
read -p "📦 Do you want to install/configure Nginx? (y/n): " install_nginx
if [ "$install_nginx" = "y" ] || [ "$install_nginx" = "Y" ]; then
    echo "Installing Nginx..."
    sudo apt update
    sudo apt install nginx -y
    
    # Copy nginx config
    sudo cp nginx.conf /etc/nginx/sites-available/tiktok-webhooks
    sudo ln -sf /etc/nginx/sites-available/tiktok-webhooks /etc/nginx/sites-enabled/
    
    # Test nginx config
    sudo nginx -t
    if [ $? -eq 0 ]; then
        sudo systemctl reload nginx
        echo "✅ Nginx installed and configured"
    else
        echo "❌ Nginx configuration error. Please check manually."
    fi
fi
echo ""

# Ask if user wants to setup SSL
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

# Ask if user wants to setup PM2
read -p "🔧 Do you want to setup PM2 process manager? (y/n): " setup_pm2
if [ "$setup_pm2" = "y" ] || [ "$setup_pm2" = "Y" ]; then
    echo "Installing PM2..."
    sudo npm install -g pm2
    
    pm2 start server.js --name tiktok-webhooks
    pm2 save
    pm2 startup
    
    echo "✅ PM2 configured"
fi
echo ""

# Final instructions
echo "========================================="
echo "✅ Setup Complete!"
echo "========================================="
echo ""
echo "📋 Next steps:"
echo ""
echo "1. Edit .env file with your TikTok App credentials:"
echo "   nano .env"
echo ""
echo "2. Start the server:"
if [ "$setup_pm2" = "y" ] || [ "$setup_pm2" = "Y" ]; then
    echo "   pm2 restart tiktok-webhooks"
else
    echo "   npm start"
fi
echo ""
echo "3. Use these URLs in TikTok Partner Center:"
if [ ! -z "$domain" ]; then
    echo "   Redirect URL: https://$domain/api/auth/tiktok/callback"
    echo "   Webhook URL:  https://$domain/api/webhooks/tiktok"
else
    echo "   Redirect URL: https://yourdomain.com/api/auth/tiktok/callback"
    echo "   Webhook URL:  https://yourdomain.com/api/webhooks/tiktok"
fi
echo ""
echo "4. Check server health:"
if [ ! -z "$domain" ]; then
    echo "   curl https://$domain/health"
else
    echo "   curl http://localhost:3000/health"
fi
echo ""
echo "========================================="
