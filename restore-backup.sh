#!/bin/bash

# Set backup path based on environment
if [[ "$OSTYPE" == "darwin"* ]]; then
    BACKUP_PATH="../mgit-repo-server/mysql-backups"
else
    BACKUP_PATH="/home/imyjimmy/umbrel/app-data/mgitreposerver-mgit-repo-server/mysql-backups"
fi

LATEST_BACKUP="${BACKUP_PATH}/easyappointments_latest.sql"

# Function to wait for MySQL to be ready
wait_for_mysql() {
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if docker exec plebdoc-scheduler-service-mysql-1 \
           mysqladmin ping -h localhost -u user -ppassword --silent; then
            echo "MySQL is ready!"
            return 0
        fi
        echo "Attempt $attempt/$max_attempts: Waiting for MySQL..."
        sleep 2
        ((attempt++))
    done
    
    echo "MySQL failed to start within timeout"
    return 1
}

# Check if backup exists
if [ -f "$LATEST_BACKUP" ]; then
    echo "Found existing backup: $LATEST_BACKUP"
    echo "Automatically restoring from backup..."
    
    # Start services
    docker-compose up -d mysql
    
    # Wait for MySQL
    if wait_for_mysql; then
        echo "Restoring database from backup..."
        if docker exec -i plebdoc-scheduler-service-mysql-1 mysql \
            -u user -ppassword easyappointments < "$LATEST_BACKUP"; then
            echo "Database restored successfully!"
            
            # Now start the rest of the services
            docker-compose up -d
        else
            echo "Database restoration failed"
            exit 1
        fi
    else
        echo "MySQL startup failed"
        exit 1
    fi
else
    echo "No backup found, starting with fresh database..."
    docker-compose up -d
fi

echo "Services started!"
echo "PHPMyAdmin: http://localhost:8089"
echo "Swagger UI: http://localhost:8082"