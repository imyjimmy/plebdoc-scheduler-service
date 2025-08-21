# PlebDoc Appointments Service

Standalone MySQL database service for appointment scheduling, extracted from EasyAppointments.

## Setup

1. Copy your schema file:
   ```bash
   cp your-schema.sql init-scripts/easyappointments_complete_schema.sql
   ```

2. Start the service:
   ```bash
   ./deploy.sh
   ```

## URLs

- **PHPMyAdmin**: http://localhost:8081
- **MySQL**: localhost:3306

## Database Credentials

- **Database**: `easyappointments`
- **Username**: `user`
- **Password**: `password`
- **Root Password**: `secret`

## Management

```bash
./deploy.sh up      # Start service
./deploy.sh down    # Stop service  
./deploy.sh clean   # Remove all data
./deploy.sh logs    # View MySQL logs
./deploy.sh rebuild # Fresh start
```

## Integration

This service provides the MySQL backend for:
- Admin Portal appointment booking
- Patient Portal appointment scheduling
- Provider availability management

Connect to it from your applications using the credentials above.
