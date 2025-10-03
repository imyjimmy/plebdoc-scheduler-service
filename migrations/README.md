# Database Migrations

## Running Migrations Manually
```
# 1. Find your MySQL container name
docker ps | grep mysql

# 2. Copy the SQL file into the container
docker cp migrations/scripts/001_add_provider_profiles.sql mgit-repo-server_plebdoc_mysql_1:/tmp/

# 3. Connect to MySQL
docker exec -it mgit-repo-server_plebdoc_mysql_1 mysql -u user -p easyappointments

# 4. Enter password when prompted, then run:
USE easyappointments;
SOURCE /tmp/001_add_provider_profiles.sql;
```
