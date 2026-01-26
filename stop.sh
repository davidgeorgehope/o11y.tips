#!/bin/bash

cd /root/o11y.tips

echo "Stopping o11ytips..."
pm2 stop o11ytips 2>/dev/null || true
pm2 delete o11ytips 2>/dev/null || true

echo "Stopped."
