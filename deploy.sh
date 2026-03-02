#!/bin/bash
set -e
cd /root/o11y.tips
echo "📦 Committing..."
git add -A
if git diff --cached --quiet; then echo "  Nothing to commit"
else git commit -m "${1:-deploy}"; echo "🚀 Pushing..."; git push origin main; fi
echo "♻️  Restarting..."
pm2 restart o11ytips --update-env
sleep 2; pm2 logs o11ytips --lines 3 --nostream
echo "✅ o11y.tips deployed!"
