#!/bin/bash

LATEST_BACKUP="../mgit-repo-server/mysql-backups/easyappointments_latest.sql"

if [ -f "$LATEST_BACKUP" ]; then
    echo "📋 Found backup. Use restore-backup.sh to restore from backup."
    echo "🚀 Or use 'docker-compose up -d' for fresh start."
    ./restore-backup.sh
else
    echo "ℹ️ No backup found, starting normally..."
    docker-compose up -d
fi