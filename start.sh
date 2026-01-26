#!/bin/bash
set -e

cd /root/o11y.tips

# Ensure logs directory exists
mkdir -p logs
mkdir -p data

# Build TypeScript
echo "Building TypeScript..."
npm run build

# Build admin UI
echo "Building admin UI..."
npm run build:admin

# Initialize database if needed (ignore if already exists)
echo "Running database migrations..."
npm run db:push || echo "Database already up to date or minor migration issue (continuing...)"

# Start with PM2
echo "Starting o11ytips with PM2..."
pm2 start ecosystem.config.js --env production

echo "Started! Check status with: pm2 status o11ytips"
echo "View logs with: pm2 logs o11ytips"
