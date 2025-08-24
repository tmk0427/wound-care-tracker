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

    // Insert ALL supplies: 272, 400-414, and 600-692 (NO 700-714)
    console.log('🔧 Inserting all supply codes (272, 400-414, 600-692)...');
    
    const allSupplies = [
      // Medical/Surgical
      { code: 272, description: 'Med-Surgical Supplies', hcpcs: 'B4149', cost: 0.00, is_custom: false },
      
      // Respiratory/Tracheostomy supplies (400-414)
      { code: 400, description: 'HME filter holder for trach or vent', hcpcs: 'A7507', cost: 3.49, is_custom: false },
      { code: 401, description: 'HME housing & adhesive', hcpcs: 'A7509', cost: 1.97, is_custom: false },
      { code: 402, description: 'HMES-trach valve adhesive disk', hcpcs: 'A7506', cost: 0.45, is_custom: false },
      { code: 403, description: 'HMES filter holder or cap for tracheostoma', hcpcs: 'A7503', cost: 15.85, is_custom: false },
      { code: 404, description: 'HMES filter', hcpcs: 'A7504', cost: 0.95, is_custom: false },
      { code: 405, description: 'HMES-trach valve housing', hcpcs: 'A7505', cost: 6.55, is_custom: false },
      { code: 406, description: 'HME housing w-adhesive filter', hcpcs: 'A7508', cost: 4.01, is_custom: false },
      { code: 407, description: 'Lubricant per oz to insert trach', hcpcs: 'A4402', cost: 1.90, is_custom: false },
      { code: 408, description: 'Piston irrigation syringe irrigation trach ostomy uro', hcpcs: 'A4322', cost: 4.16, is_custom: false },
      { code: 409, description: 'Sterile saline 10ml and 15ml bullets', hcpcs: 'A4216', cost: 0.62, is_custom: false },
      { code: 410, description: 'Sterile saline 100ml 1000ml 120ml 250ml and 500ml', hcpcs: 'A4217', cost: 4.38, is_custom: false },
      { code: 411, description: 'Closed suction catheter for trach', hcpcs: 'A4605', cost: 22.92, is_custom: false },
      { code: 412, description: 'Open suction catheter for trach', hcpcs: 'A4624', cost: 3.69, is_custom: false },
      { code: 413, description: 'Tracheal suction catheter closed system (yankauers-ballards)', hcpcs: 'A4605', cost: 22.92, is_custom: false },
      { code: 414, description: 'Trach tube', hcpcs: 'A7520', cost: 12.50, is_custom: false },
      
      // Wound Care supplies (600-692) - marked as custom since they're from your live app
      { code: 600, description: 'Sterile Gauze sponge 2x2 up to 4x4, EACH 2 in package', hcpcs: 'A6251', cost: 2.78, is_custom: true },
      { code: 601, description: 'Sterile gauze sponge greater than 4x4, each', hcpcs: 'A6252', cost: 4.55, is_custom: true },
      { code: 602, description: 'ABD dressing non bordered 16 sq inches', hcpcs: 'A6251', cost: 2.78, is_custom: true },
      { code: 603, description: 'ABD dressing non bordered greater than 48 sq inches', hcpcs: 'A6253', cost: 8.85, is_custom: true },
      { code: 604, description: 'ABD dressing non bordered 48 sq inches', hcpcs: 'A6252', cost: 4.55, is_custom: true },
      { code: 605, description: 'ABD dressing bordered up to 16 sq inches', hcpcs: 'A6254', cost: 1.67, is_custom: true },
      { code: 606, description: 'ABD dressing bordered 18 sq inches or greater', hcpcs: 'A6255', cost: 4.25, is_custom: true },
      { code: 607, description: 'Adhesive remover wipes', hcpcs: 'A4456', cost: 0.34, is_custom: true },
      { code: 608, description: 'Alginate/Fiber gelling sterile 4x4 each', hcpcs: 'A6196', cost: 10.28, is_custom: true },
      { code: 609, description: 'Alginate fiber gelling sterile dressing up to 6x6 each', hcpcs: 'A6197', cost: 22.98, is_custom: true },
      { code: 610, description: 'AMB antimicrobial drain sponges', hcpcs: 'A6222', cost: 2.98, is_custom: true },
      { code: 611, description: 'Any tape each 18" (framed 4x4) or steri strips', hcpcs: 'A4452', cost: 0.53, is_custom: true },
      { code: 612, description: 'Irrigation tubing set for continuous bladder irrigation tubing used with 3 way indwelling foley cath', hcpcs: 'A4355', cost: 12.46, is_custom: true },
      { code: 613, description: 'Border gauze island dressing medium 6x6 incision & 4x10 each', hcpcs: 'A6220', cost: 3.62, is_custom: true },
      { code: 614, description: 'Border gauze island dressing small 2x2, 3x3, 4x4 each', hcpcs: 'A6219', cost: 1.33, is_custom: true },
      { code: 615, description: 'calcium alginate rope per 6"', hcpcs: 'A6199', cost: 7.37, is_custom: true },
      { code: 616, description: 'cath foley 2 way all', hcpcs: 'A4344', cost: 19.01, is_custom: true },
      { code: 617, description: 'Cah foley 3 way cont irrigation', hcpcs: 'A4346', cost: 23.26, is_custom: true },
      { code: 618, description: 'Intermittent urinary cath with insertion supplies', hcpcs: 'A4353', cost: 9.77, is_custom: true },
      { code: 619, description: 'Cath insert tray w/drain bag', hcpcs: 'A4354', cost: 16.50, is_custom: true },
      { code: 620, description: 'Cath insert tray without drain bag', hcpcs: 'A4310', cost: 10.79, is_custom: true },
      { code: 621, description: 'Coflex compression bandage second layer per yard', hcpcs: 'A6452', cost: 8.24, is_custom: true },
      { code: 622, description: 'Coflex zinc impregnated bandage per yard', hcpcs: 'A6456', cost: 1.75, is_custom: true },
      { code: 623, description: 'Collagen dressing 16 inches', hcpcs: 'A6021', cost: 29.38, is_custom: true },
      { code: 624, description: 'Collagen dressing more than 48 inches', hcpcs: 'A6023', cost: 265.90, is_custom: true },
      { code: 625, description: 'Collagen gel or paste per gm', hcpcs: 'A6011', cost: 3.19, is_custom: true },
      { code: 626, description: 'Collagen powder per 1 gm', hcpcs: 'A6010', cost: 43.27, is_custom: true },
      { code: 627, description: 'Colostomy bag closed no barrier', hcpcs: 'A5052', cost: 2.08, is_custom: true },
      { code: 628, description: 'Composite bordered 16 sq inches or less (2x2, 4x4) each', hcpcs: 'A6203', cost: 4.71, is_custom: true },
      { code: 629, description: 'Composite dressing greater than 16 sq inches (6x6)', hcpcs: 'A6204', cost: 8.69, is_custom: true },
      { code: 630, description: 'Compression bandage 3" width per yard', hcpcs: 'A6448', cost: 1.61, is_custom: true },
      { code: 631, description: 'Condom catheter', hcpcs: 'A4326', cost: 15.07, is_custom: true },
      { code: 632, description: 'Drain bag', hcpcs: 'A4358', cost: 9.07, is_custom: true },
      { code: 633, description: 'Drain bag bedside', hcpcs: 'A4357', cost: 11.53, is_custom: true },
      { code: 634, description: 'Foam non bordered dressing medium 6x6, each Mepilex, Allevyn, xeroform', hcpcs: 'A6210', cost: 27.84, is_custom: true },
      { code: 635, description: 'Foam non bordered large dressing more than 48 sq inches large Mepilex, Allevyn, Xeroform, Optifoam', hcpcs: 'A6211', cost: 41.04, is_custom: true },
      { code: 636, description: 'Gauze stretch per yard>3"<5" Kerlix', hcpcs: 'A6449', cost: 2.45, is_custom: true },
      { code: 637, description: 'Gradient wrap (Circaid/Sigvaris) each', hcpcs: 'A6545', cost: 119.03, is_custom: true },
      { code: 638, description: 'High compression bandage per yard', hcpcs: 'A6452', cost: 8.24, is_custom: true },
      { code: 639, description: 'Honey gel per oz', hcpcs: 'A6248', cost: 22.70, is_custom: true },
      { code: 640, description: 'Hydrocolloid dressing pad 16 sq inches non bordered', hcpcs: 'A6234', cost: 9.15, is_custom: true },
      { code: 641, description: 'Hydrocolloid dressing large 6x6 non bordered', hcpcs: 'A6235', cost: 23.50, is_custom: true },
      { code: 642, description: 'Hydrocolloid bordered dressing 6x6 each', hcpcs: 'A6238', cost: 31.86, is_custom: true },
      { code: 643, description: 'Hydrocolloid bordered dressing 4x4 each', hcpcs: 'A6237', cost: 11.05, is_custom: true },
      { code: 644, description: 'Hydrogel dressing pad 4x4 each', hcpcs: 'A6242', cost: 8.46, is_custom: true },
      { code: 645, description: 'Hydrofiber rope per 6"', hcpcs: 'A6199', cost: 7.37, is_custom: true },
      { code: 646, description: 'Hydrogel per oz', hcpcs: 'A6248', cost: 22.70, is_custom: true },
      { code: 647, description: 'Hydrogel dressing greater than 4x4', hcpcs: 'A6243', cost: 17.22, is_custom: true },
      { code: 648, description: 'Saline impregnated gauze sponge >16 sq inches', hcpcs: 'A6252', cost: 4.55, is_custom: true },
      { code: 649, description: 'Iodoform packing strip per yard', hcpcs: 'A6266', cost: 2.67, is_custom: true },
      { code: 650, description: 'Iodosorb gel (antimicrobial) per oz', hcpcs: 'A6248', cost: 22.70, is_custom: true },
      { code: 651, description: 'Irrigation syringe/bulb/piston', hcpcs: 'A4322', cost: 4.16, is_custom: true },
      { code: 652, description: 'Irrigation tray any purpose', hcpcs: 'A4320', cost: 6.59, is_custom: true },
      { code: 653, description: 'Kerlex roll gauze 3" to 5" per yard 4.1 yrd roll = 4 units', hcpcs: 'A6449', cost: 2.45, is_custom: true },
      { code: 654, description: 'Light compression elastic, woven bandage 3 to 5" w(ACE) per yard', hcpcs: 'A6449', cost: 2.45, is_custom: true },
      { code: 655, description: 'Male cath any type', hcpcs: 'A4326', cost: 15.07, is_custom: true },
      { code: 656, description: 'Manuka honey 4x4 each', hcpcs: 'A6242', cost: 8.46, is_custom: true },
      { code: 657, description: 'Negative pressure wound therapy dressing set', hcpcs: 'A6550', cost: 30.52, is_custom: true },
      { code: 658, description: 'Ostomy adhesive per oz', hcpcs: 'A4364', cost: 3.49, is_custom: true },
      { code: 659, description: 'Ostomy belt', hcpcs: null, cost: 9.41, is_custom: true },
      { code: 660, description: 'Ostomy face plate', hcpcs: 'A4361', cost: 22.55, is_custom: true },
      { code: 661, description: 'Ostomy pouch w/faceplate', hcpcs: 'A4375', cost: 23.99, is_custom: true },
      { code: 662, description: 'Ostomy skin barrier powder per oz', hcpcs: 'A4371', cost: 5.10, is_custom: true },
      { code: 663, description: 'Ostomy skin barrier solid', hcpcs: 'A4362', cost: 4.12, is_custom: true },
      { code: 664, description: 'Ostomy skin barrier w/flange', hcpcs: 'A4373', cost: 8.76, is_custom: true },
      { code: 665, description: 'Padding bandage per yard use with coflex', hcpcs: 'A6441', cost: 0.95, is_custom: true },
      { code: 666, description: 'Perianal fecal collection pouch', hcpcs: 'A4330', cost: 10.01, is_custom: true },
      { code: 667, description: 'Petrolatum dressing 5x9 xeroform', hcpcs: 'A6223', cost: 3.39, is_custom: true },
      { code: 668, description: 'Petro impregnated gauze sponge 4x4', hcpcs: 'A6222', cost: 2.98, is_custom: true },
      { code: 669, description: 'Piston irrigation syringe', hcpcs: 'A4322', cost: 4.16, is_custom: true },
      { code: 670, description: 'Plain 4x4 alginate gelling dressing each', hcpcs: 'A6196', cost: 10.28, is_custom: true },
      { code: 671, description: 'Puracol dressing 4x4', hcpcs: 'A6203', cost: 4.71, is_custom: true },
      { code: 672, description: 'Sterile saline 10ml and 15ml bullets', hcpcs: null, cost: 0.62, is_custom: true },
      { code: 673, description: 'Sterile saline 100ml, 120ml, 250ml, 500ml and 1000ml', hcpcs: 'A4217', cost: 4.38, is_custom: true },
      { code: 674, description: 'Silver 4x4 alginate gelling dressing each', hcpcs: 'A6196', cost: 10.28, is_custom: true },
      { code: 675, description: 'Skin prep wipe each', hcpcs: 'A5120', cost: 0.34, is_custom: true },
      { code: 676, description: 'Split gauze each 2 per package', hcpcs: 'A6251', cost: 2.78, is_custom: true },
      { code: 677, description: 'Steri strips per 18 inches', hcpcs: 'A4452', cost: 0.53, is_custom: true },
      { code: 678, description: 'Super absorbent sterile dressing', hcpcs: 'A6251', cost: 2.78, is_custom: true },
      { code: 679, description: 'Transparent film Tegaderm/opsite 16" or less', hcpcs: 'A6257', cost: 2.14, is_custom: true },
      { code: 680, description: 'Tegaderm opsite composite film 48"', hcpcs: 'A6204', cost: 8.69, is_custom: true },
      { code: 681, description: 'Tubular dressing non elastic any width per yard', hcpcs: 'A6457', cost: 1.59, is_custom: true },
      { code: 682, description: 'Wound drain collector pouch', hcpcs: 'A6154', cost: 20.09, is_custom: true },
      { code: 683, description: 'Xero/Optifoam/Mepilex 48"', hcpcs: 'A6211', cost: 41.04, is_custom: true },
      { code: 684, description: 'Mesalt cleansing dressing with 20% sodium chloride 1.1 yr', hcpcs: 'A6266', cost: 2.67, is_custom: true },
      { code: 685, description: 'Plurogel burn and wound dressing per oz', hcpcs: 'A4649', cost: 22.70, is_custom: true },
      { code: 686, description: 'Sorbex wound dressing 6x9 more than 48 sq in non adherent pansement', hcpcs: 'A6253', cost: 8.85, is_custom: true },
      { code: 687, description: 'Coban 3" wide per yard', hcpcs: 'A6452', cost: 8.24, is_custom: true },
      { code: 688, description: 'Black granufoam more than 48 sq inches', hcpcs: 'A6211', cost: 41.04, is_custom: true },
      { code: 689, description: 'Hydrofera Blue 4x4 or less', hcpcs: 'A6209', cost: 10.20, is_custom: true },
      { code: 690, description: 'Hydrofera Blue greater than 48 sq inches 6x6 8x8', hcpcs: 'A6211', cost: 41.04, is_custom: true },
      { code: 691, description: 'oil emulsion impregnated gauze', hcpcs: 'A6222', cost: 2.98, is_custom: true },
      { code: 692, description: 'Optiview transparent dressing', hcpcs: 'A6259', cost: 15.28, is_custom: true }
    ];

    // Insert supplies in batches to avoid query length limits
    console.log(`🔄 Inserting ${allSupplies.length} supply records...`);
    for (const supply of allSupplies) {
      await pool.query(
        'INSERT INTO supplies (code, description, hcpcs, cost, is_custom) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (code) DO NOTHING',
        [supply.code, supply.description, supply.hcpcs || null, supply.cost, supply.is_custom]
      );
    }

    console.log('✅ All supplies inserted successfully');
    console.log('📋 Supply ranges included:');
    console.log('   - 272: Med-Surgical');
    console.log('   - 400-414: Respiratory/Tracheostomy (15 items)');
    console.log('   - 600-692: Wound Care (93 items)');
    console.log('   - EXCLUDED: 700-714 (removed as requested)');
    console.log(`   - Total supplies: ${allSupplies.length}`);

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

    // Sample tracking data using respiratory and wound care supplies
    await pool.query(`
      INSERT INTO tracking (patient_id, supply_id, day_of_month, quantity, wound_dx) VALUES 
        (1, (SELECT id FROM supplies WHERE code = 400 LIMIT 1), 1, 2, 'Tracheostomy care'),
        (1, (SELECT id FROM supplies WHERE code = 600 LIMIT 1), 3, 1, 'Wound care'),
        (2, (SELECT id FROM supplies WHERE code = 401 LIMIT 1), 2, 1, 'Respiratory therapy'),
        (2, (SELECT id FROM supplies WHERE code = 601 LIMIT 1), 4, 2, 'Surgical wound')
      ON CONFLICT (patient_id, supply_id, day_of_month) DO NOTHING
    `);

    console.log('✅ Default data inserted successfully');

    // Verify the setup
    const counts = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM facilities) as facilities,
        (SELECT COUNT(*) FROM supplies) as supplies,
        (SELECT COUNT(*) FROM supplies WHERE code >= 600 AND code <= 692) as wound_care_supplies,
        (SELECT COUNT(*) FROM supplies WHERE code >= 400 AND code <= 414) as respiratory_supplies,
        (SELECT COUNT(*) FROM users) as users,
        (SELECT COUNT(*) FROM patients) as patients,
        (SELECT COUNT(*) FROM tracking) as tracking_records
    `);

    console.log('📊 Database setup complete:');
    console.log(`   - Facilities: ${counts.rows[0].facilities}`);
    console.log(`   - Total Supplies: ${counts.rows[0].supplies}`);
    console.log(`   - Wound Care (600-692): ${counts.rows[0].wound_care_supplies}`);
    console.log(`   - Respiratory (400-414): ${counts.rows[0].respiratory_supplies}`);
    console.log(`   - Users: ${counts.rows[0].users}`);
    console.log(`   - Patients: ${counts.rows[0].patients}`);
    console.log(`   - Tracking Records: ${counts.rows[0].tracking_records}`);

    console.log('\n🔐 Default Login Credentials:');
    console.log('   Admin: admin@system.com / admin123');
    console.log('   User:  user@demo.com / user123');

    console.log('\n✅ All supplies are now editable by admin users');
    console.log('🚀 Migration completed successfully!');

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
