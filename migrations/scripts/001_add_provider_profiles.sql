-- Migration: Add provider_profiles table
-- Date: 2025-01-XX
-- Description: Creates the provider_profiles table for doctor profile information

-- Now create provider_profiles table
CREATE TABLE IF NOT EXISTS provider_profiles (
  user_id INT PRIMARY KEY,
  username VARCHAR(100) UNIQUE,
  
  bio TEXT,
  profile_pic_url VARCHAR(255),

  -- Demographics (for verification)
  year_of_birth INT,           -- YOB field
  place_of_birth VARCHAR(30),  -- POB field
  gender CHAR(1),              -- GEN field (M, F)

  languages JSON,  -- Array of languages
  
  -- Identity (from TX Med Board)
  first_name VARCHAR(22),  -- FN field
  last_name VARCHAR(25),   -- LN field
  suffix VARCHAR(3),        -- SUF field
  
  -- License info
  license_number VARCHAR(9),  -- LIC field
  license_state VARCHAR(2) DEFAULT 'TX',
  license_issued_date DATE,   -- LID field (MMDDYYYY)
  license_expiration_date DATE, -- LED field (MMDDYYYY)
  registration_status VARCHAR(3), -- RSC field (AC, ACN, etc.)
  registration_date DATE,      -- RSD field
  method_of_licensure CHAR(1), -- MOL field (E, R, L, C)
  
  -- Education
  medical_school VARCHAR(67),  -- SCH field
  graduation_year INT,         -- GYR field
  degree_type VARCHAR(2),      -- DEG field (MD, DO)
  
  -- Specialties  
  primary_specialty VARCHAR(30),   -- SPEC1 field
  secondary_specialty VARCHAR(30),  -- SPEC2 field
  board_certifications JSON, -- array of certifications
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- working plan and timezone
  working_plan JSON,
  timezone VARCHAR(50) DEFAULT 'America/Chicago',

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_username (username),
  INDEX idx_license (license_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verify the table was created
SELECT 'provider_profiles table created successfully' AS status;