require('dotenv').config();
const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runSafeMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Starting SAFE database migration...');
    console.log('⚠️  This migration preserves ALL existing data');
    
    // Test connection
    await client.query('SELECT NOW()');
    console.log('✅ Database connection successful');

    // Check existing tables
    const existingTablesResult = await client.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);
    const existingTables = existingTablesResult.rows.map(row => row.tablename);
    
    console.log('📋 Existing tables:', existingTables);

    // Create tables only if they don't exist
    if (!existingTables.includes('facilities')) {
      console.log('📋 Creating facilities table...');
      await client.query(`
        CREATE TABLE facilities (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL UNIQUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } else {
      console.log('✅ Facilities table already exists');
    }

    if (!existingTables.includes('supplies')) {
      console.log('📋 Creating supplies table...');
      await client.query(`
        CREATE TABLE supplies (
          id SERIAL PRIMARY KEY,
          code INTEGER NOT NULL UNIQUE,
          description TEXT NOT NULL,
          hcpcs VARCHAR(10),
          cost DECIMAL(10,2) DEFAULT 0.00,
          is_custom BOOLEAN DEFAULT false,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } else {
      console.log('✅ Supplies table already exists');
    }

    if (!existingTables.includes('users')) {
      console.log('📋 Creating users table...');
      await client.query(`
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
        )
      `);
    } else {
      console.log('✅ Users table already exists');
    }

    if (!existingTables.includes('patients')) {
      console.log('📋 Creating patients table...');
      await client.query(`
        CREATE TABLE patients (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          month VARCHAR(7) NOT NULL,
          mrn VARCHAR(50),
          facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(name, month, facility_id)
        )
      `);
    } else {
      console.log('✅ Patients table already exists');
    }

    if (!existingTables.includes('tracking')) {
      console.log('📋 Creating tracking table...');
      await client.query(`
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
        )
      `);
    } else {
      console.log('✅ Tracking table already exists');
    }

    // Add missing columns safely (for future schema updates)
    console.log('🔧 Checking for missing columns...');
    
    // Example: Add wound_dx column to tracking if it doesn't exist
    const trackingColumns = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'tracking' AND table_schema = 'public'
    `);
    const trackingColumnNames = trackingColumns.rows.map(row => row.column_name);
    
    if (!trackingColumnNames.includes('wound_dx')) {
      console.log('📋 Adding wound_dx column to tracking table...');
      await client.query('ALTER TABLE tracking ADD COLUMN wound_dx TEXT');
    }

    // Add indexes if they don't exist
    console.log('🔍 Creating database indexes (if missing)...');
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
      'CREATE INDEX IF NOT EXISTS idx_users_facility ON users(facility_id)',
      'CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)',
      'CREATE INDEX IF NOT EXISTS idx_patients_facility ON patients(facility_id)',
      'CREATE INDEX IF NOT EXISTS idx_patients_month ON patients(month)',
      'CREATE INDEX IF NOT EXISTS idx_tracking_patient ON tracking(patient_id)',
      'CREATE INDEX IF NOT EXISTS idx_tracking_supply ON tracking(supply_id)',
      'CREATE INDEX IF NOT EXISTS idx_supplies_code ON supplies(code)'
    ];

    for (const index of indexes) {
      try {
        await client.query(index);
      } catch (err) {
        // Index might already exist, continue
        console.log('Index already exists or failed to create:', err.message);
      }
    }

    // Add trigger function if it doesn't exist
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_at = CURRENT_TIMESTAMP;
          RETURN NEW;
      END;
      $$ language 'plpgsql'
    `);

    // Add triggers if they don't exist
    const triggers = [
      { table: 'facilities', trigger: 'update_facilities_updated_at' },
      { table: 'supplies', trigger: 'update_supplies_updated_at' },
      { table: 'users', trigger: 'update_users_updated_at' },
      { table: 'patients', trigger: 'update_patients_updated_at' },
      { table: 'tracking', trigger: 'update_tracking_updated_at' }
    ];

    for (const { table, trigger } of triggers) {
      try {
        await client.query(`
          CREATE TRIGGER ${trigger} 
          BEFORE UPDATE ON ${table} 
          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
        `);
      } catch (err) {
        // Trigger already exists, continue
        console.log(`Trigger ${trigger} already exists or failed to create`);
      }
    }

    // Add admin user only if NO admin exists
    const adminCheck = await client.query(
      'SELECT COUNT(*) as count FROM users WHERE role = $1',
      ['admin']
    );

    if (parseInt(adminCheck.rows[0].count) === 0) {
      console.log('👤 Creating admin user (no admin found)...');
      const bcrypt = require('bcryptjs');
      const adminPassword = await bcrypt.hash('admin123', 12);
      
      await client.query(`
        INSERT INTO users (name, email, password, role, is_approved) VALUES 
        ('System Administrator', 'admin@system.com', $1, 'admin', true)
      `, [adminPassword]);
      
      console.log('✅ Admin user created: admin@system.com / admin123');
    } else {
      console.log('✅ Admin user already exists, skipping...');
    }

    // Add basic facilities only if none exist
    const facilitiesCount = await client.query('SELECT COUNT(*) as count FROM facilities');
    if (parseInt(facilitiesCount.rows[0].count) === 0) {
      console.log('🏥 Adding default facilities...');
      await client.query(`
        INSERT INTO facilities (name) VALUES 
          ('Main Hospital'),
          ('Clinic North'),
          ('Clinic South'),
          ('Outpatient Center')
      `);
    } else {
      console.log('✅ Facilities already exist, skipping...');
    }

    // Add basic supplies only if none exist
    const suppliesCount = await client.query('SELECT COUNT(*) as count FROM supplies');
    if (parseInt(suppliesCount.rows[0].count) === 0) {
      console.log('💊 Adding default supplies...');
      await client.query(`
        INSERT INTO supplies (code, description, hcpcs, cost, is_custom) VALUES 
          (700, 'Foam Dressing 4x4', 'A6209', 5.50, false),
          (701, 'Hydrocolloid Dressing 6x6', 'A6234', 8.75, false),
          (702, 'Alginate Dressing 2x2', 'A6196', 12.25, false),
          (703, 'Transparent Film 4x4.75', 'A6257', 3.20, false),
          (704, 'Gauze Pad Sterile 4x4', 'A6402', 0.85, false)
      `);
    } else {
      console.log('✅ Supplies already exist, skipping...');
    }

    // Final verification
    const finalCounts = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM facilities) as facilities,
        (SELECT COUNT(*) FROM supplies) as supplies,
        (SELECT COUNT(*) FROM users) as users,
        (SELECT COUNT(*) FROM patients) as patients,
        (SELECT COUNT(*) FROM tracking) as tracking_records
    `);

    console.log('📊 Safe migration complete:');
    console.log(`   - Facilities: ${finalCounts.rows[0].facilities}`);
    console.log(`   - Supplies: ${finalCounts.rows[0].supplies}`);
    console.log(`   - Users: ${finalCounts.rows[0].users}`);
    console.log(`   - Patients: ${finalCounts.rows[0].patients}`);
    console.log(`   - Tracking Records: ${finalCounts.rows[0].tracking_records}`);

    console.log('\n✅ SAFE migration completed successfully!');
    console.log('🔐 All existing data has been preserved');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  runSafeMigration()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { runSafeMigration };
