-- PlebDoc Appointments Database Initialization
-- This creates the appointments database structure

-- Set charset and collation
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- Source the complete schema
SOURCE /docker-entrypoint-initdb.d/easyappointments_complete_schema.sql;

-- Add any PlebDoc-specific customizations here
INSERT INTO settings (name, value) VALUES ('plebdoc_service_version', '1.0.0');

-- Re-enable foreign key checks
SET FOREIGN_KEY_CHECKS = 1;
