require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
  try {
    console.log('🔄 Starting database migration...');
    
    // Test connection
    await pool.query('SELECT NOW()');
    console.log('✅ Database connection successful');

    // Read and execute the schema file or use inline schema
    const schemaPath = path.join(__dirname, '..', 'schema.sql');
    
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      await pool.query(schema);
      console.log('✅ Database schema applied successfully');
    } else {
      // Inline schema if file doesn't exist
      console.log('🔧 Applying inline database schema...');
      
      const schema = `
        -- Enable UUID extension
        CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

        -- Drop existing tables in correct order (respecting foreign keys)
        DROP TABLE IF EXISTS tracking CASCADE;
        DROP TABLE IF EXISTS patients CASCADE;
        DROP TABLE IF EXISTS users CASCADE;
        DROP TABLE IF EXISTS supplies CASCADE;
        DROP TABLE IF EXISTS facilities CASCADE;

        -- Create facilities table
        CREATE TABLE facilities (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        -- Create supplies table
        CREATE TABLE supplies (
            id SERIAL PRIMARY KEY,
            code INTEGER NOT NULL UNIQUE,
            description TEXT NOT NULL,
            hcpcs VARCHAR(10),
            cost DECIMAL(10,2) DEFAULT 0.00,
            is_custom BOOLEAN DEFAULT false,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        -- Create users table
        CREATE TABLE users (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('admin', 'user')),
            facility_id INTEGER REFERENCES facilities(id) ON DELETE SET NULL,
            is_approved BOOLEAN DEFAULT false,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        -- Create patients table
        CREATE TABLE patients (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            month VARCHAR(7) NOT NULL,
            mrn VARCHAR(50),
            facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(name, month, facility_id)
        );

        -- Create tracking table (with wound_dx column)
        CREATE TABLE tracking (
            id SERIAL PRIMARY KEY,
            patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
            supply_id INTEGER NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,
            day_of_month INTEGER NOT NULL CHECK (day_of_month >= 1 AND day_of_month <= 31),
            quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
            wound_dx TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(patient_id, supply_id, day_of_month)
        );

        -- Create indexes for better performance
        CREATE INDEX idx_users_email ON users(email);
        CREATE INDEX idx_users_facility ON users(facility_id);
        CREATE INDEX idx_users_role ON users(role);
        CREATE INDEX idx_patients_facility ON patients(facility_id);
        CREATE INDEX idx_patients_month ON patients(month);
        CREATE INDEX idx_tracking_patient ON tracking(patient_id);
        CREATE INDEX idx_tracking_supply ON tracking(supply_id);
        CREATE INDEX idx_tracking_patient_supply ON tracking(patient_id, supply_id);
        CREATE INDEX idx_supplies_code ON supplies(code);
        CREATE INDEX idx_supplies_custom ON supplies(is_custom);

        -- Create update trigger function
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = CURRENT_TIMESTAMP;
            RETURN NEW;
        END;
        $$ language 'plpgsql';

        -- Create triggers for automatic updated_at
        CREATE TRIGGER update_facilities_updated_at BEFORE UPDATE ON facilities
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        CREATE TRIGGER update_supplies_updated_at BEFORE UPDATE ON supplies
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        CREATE TRIGGER update_patients_updated_at BEFORE UPDATE ON patients
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        CREATE TRIGGER update_tracking_updated_at BEFORE UPDATE ON tracking
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      `;

      await pool.query(schema);
      console.log('✅ Database schema created successfully');
    }

    // Insert default data
    console.log('🔧 Inserting default data...');

    // Insert facilities
    await pool.query(`
      INSERT INTO facilities (name) VALUES 
        ('Main Hospital'),
        ('Clinic North'),
        ('Clinic South'),
        ('Outpatient Center')
      ON CONFLICT (name) DO NOTHING
    `);

    // Insert comprehensive supplies list
    await pool.query(`
      INSERT INTO supplies (code, description, hcpcs, cost, is_custom) VALUES 
        (700, 'Foam Dressing 4x4', 'A6209', 5.50, false),
        (701, 'Hydrocolloid Dressing 6x6', 'A6234', 8.75, false),
        (702, 'Alginate Dressing 2x2', 'A6196', 12.25, false),
        (703, 'Transparent Film 4x4.75', 'A6257', 3.20, false),
        (704, 'Antimicrobial Dressing 4x5', 'A6251', 15.80, false),
        (705, 'Collagen Dressing 4x4', 'A6021', 22.50, false),
        (706, 'Silicone Foam Border 6x6', 'A6212', 18.90, false),
        (707, 'Gauze Pad Sterile 4x4', 'A6402', 0.85, false),
        (708, 'Calcium Alginate 4x4', 'A6196', 14.20, false),
        (709, 'Hydrogel Sheet 4x4', 'A6242', 9.80, false),
        (710, 'Composite Dressing 4x4', 'A6203', 7.45, false),
        (711, 'Zinc Paste Bandage 3x10', 'A6456', 6.30, false),
        (712, 'Foam Dressing with Border 6x6', 'A6212', 11.95, false),
        (713, 'Transparent Film 6x7', 'A6258', 4.75, false),
        (714, 'Alginate Rope 12 inch', 'A6199', 18.50, false),
        (272, 'Med-Surgical Supplies', 'B4149', 0.00, false),
        (400, 'HME filter holder for trach or vent', 'A7507', 3.49, false),
        (401, 'HME housing & adhesive', 'A7509', 1.97, false),
        (402, 'HMES-trach valve adhesive disk', 'A7506', 0.45, false),
        (403, 'HMES filter holder or cap for tracheostoma', 'A7503', 15.85, false),
        (404, 'HMES filter', 'A7504', 0.95, false),
        (405, 'HMES-trach valve housing', 'A7505', 6.55, false),
        (406, 'HME housing w-adhesive filter', 'A7508', 4.01, false),
        (407, 'Lubricant per oz to insert trach', 'A4402', 1.90, false),
        (408, 'Piston irrigation syringe irrigation trach ostomy uro', 'A4322', 4.16, false),
        (409, 'Sterile saline 10ml and 15ml bullets', 'A4216', 0.62, false),
        (410, 'Sterile saline 100ml 1000ml 120ml 250ml and 500ml', 'A4217', 4.38, false),
        (411, 'Closed suction catheter for trach', 'A4605', 22.92, false),
        (412, 'Open suction catheter for trach', 'A4624', 3.69, false),
        (413, 'Tracheal suction catheter closed system (yankauers-ballards)', 'A4605', 22.92, false),
        (414, 'Trach tube', 'A7520', 12.50, false)
      ON CONFLICT (code) DO NOTHING
    `);

    // Insert admin user (password: admin123)
    await pool.query(`
      INSERT INTO users (name, email, password, role, is_approved) VALUES 
        ('System Administrator', 'admin@system.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj7.eV7.mJhK', 'admin', true)
      ON CONFLICT (email) DO NOTHING
    `);

    // Insert demo user (password: user123)
    await pool.query(`
      INSERT INTO users (name, email, password, role, facility_id, is_approved) VALUES 
        ('Demo User', 'user@demo.com', '$2a$12$k42ZFHFWqBPyh0fLl8O3.eOjJqhqvL6Np.8jyPU8LfQVLDXzjqZF.', 'user', 1, true)
      ON CONFLICT (email) DO NOTHING
    `);

    // Insert sample patients
    await pool.query(`
      INSERT INTO patients (name, month, mrn, facility_id) VALUES 
        ('Smith, John', '2024-12', 'MRN12345', 1),
        ('Johnson, Mary', '2024-12', 'MRN67890', 1),
        ('Brown, Robert', '2024-12', 'MRN11111', 2),
        ('Davis, Jennifer', '2024-12', 'MRN22222', 1)
      ON CONFLICT (name, month, facility_id) DO NOTHING
    `);

    // Insert sample tracking data with wound dx
    await pool.query(`
      INSERT INTO tracking (patient_id, supply_id, day_of_month, quantity, wound_dx) VALUES 
        (1, 1, 1, 2, 'Pressure ulcer stage 2'),
        (1, 1, 3, 1, 'Pressure ulcer stage 2'),
        (1, 2, 2, 1, 'Diabetic foot ulcer'),
        (1, 3, 5, 1, 'Surgical wound'),
        (2, 1, 1, 1, 'Venous stasis ulcer'),
        (2, 4, 2, 2, 'Skin tear'),
        (2, 5, 4, 1, 'Infected wound')
      ON CONFLICT (patient_id, supply_id, day_of_month) DO NOTHING
    `);

    console.log('✅ Default data inserted successfully');

    // Verify the setup
    const counts = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM facilities) as facilities,
        (SELECT COUNT(*) FROM supplies) as supplies,
        (SELECT COUNT(*) FROM users) as users,
        (SELECT COUNT(*) FROM patients) as patients,
        (SELECT COUNT(*) FROM tracking) as tracking_records
    `);

    console.log('📊 Database setup complete:');
    console.log(`   - Facilities: ${counts.rows[0].facilities}`);
    console.log(`   - Supplies: ${counts.rows[0].supplies}`);
    console.log(`   - Users: ${counts.rows[0].users}`);
    console.log(`   - Patients: ${counts.rows[0].patients}`);
    console.log(`   - Tracking Records: ${counts.rows[0].tracking_records}`);

    console.log('\n🔑 Default Login Credentials:');
    console.log('   Admin: admin@system.com / admin123');
    console.log('   User:  user@demo.com / user123');

    console.log('\n🚀 Migration completed successfully!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run migration if called directly
if (require.main === module) {
  runMigration()
    .then(() => {
      console.log('✅ Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { runMigration };
