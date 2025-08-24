const { Pool } = require('pg');

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initializeDatabase() {
    const client = await pool.connect();
    
    try {
        console.log('🔄 Starting database initialization...');

        // Create Users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'user',
                facility_id INTEGER,
                is_approved BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Users table created');

        // Create Facilities table
        await client.query(`
            CREATE TABLE IF NOT EXISTS facilities (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Facilities table created');

        // Create Supplies table
        await client.query(`
            CREATE TABLE IF NOT EXISTS supplies (
                id SERIAL PRIMARY KEY,
                code INTEGER UNIQUE NOT NULL,
                description TEXT NOT NULL,
                hcpcs VARCHAR(10),
                cost DECIMAL(10,2) DEFAULT 0.00,
                is_custom BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Supplies table created');

        // Create Patients table
        await client.query(`
            CREATE TABLE IF NOT EXISTS patients (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                month VARCHAR(7) NOT NULL,
                mrn VARCHAR(50),
                facility_id INTEGER REFERENCES facilities(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Patients table created');

        // Create Tracking table
        await client.query(`
            CREATE TABLE IF NOT EXISTS tracking (
                id SERIAL PRIMARY KEY,
                patient_id INTEGER REFERENCES patients(id) ON DELETE CASCADE,
                supply_id INTEGER REFERENCES supplies(id) ON DELETE CASCADE,
                day_of_month INTEGER NOT NULL,
                quantity INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(patient_id, supply_id, day_of_month)
            )
        `);
        console.log('✅ Tracking table created');

        // Add foreign key constraint for users
        await client.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints 
                    WHERE constraint_name = 'users_facility_id_fkey'
                ) THEN
                    ALTER TABLE users ADD CONSTRAINT users_facility_id_fkey 
                    FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE SET NULL;
                END IF;
            END $$;
        `);

        // Check if default supplies exist
        const suppliesCount = await client.query('SELECT COUNT(*) FROM supplies');
        
        if (parseInt(suppliesCount.rows[0].count) === 0) {
            console.log('🔄 Adding default supplies...');
            
            const defaultSupplies = [
                { code: 700, description: 'Alginate Dressing 2"x2"', hcpcs: 'A6196', cost: 2.50 },
                { code: 701, description: 'Alginate Dressing 4"x4"', hcpcs: 'A6197', cost: 5.00 },
                { code: 702, description: 'Alginate Dressing 4"x8"', hcpcs: 'A6198', cost: 8.00 },
                { code: 703, description: 'Foam Dressing 2"x2"', hcpcs: 'A6209', cost: 3.00 },
                { code: 704, description: 'Foam Dressing 4"x4"', hcpcs: 'A6210', cost: 6.00 },
                { code: 705, description: 'Foam Dressing 6"x6"', hcpcs: 'A6211', cost: 10.00 },
                { code: 706, description: 'Hydrocolloid Dressing 2"x2"', hcpcs: 'A6234', cost: 4.00 },
                { code: 707, description: 'Hydrocolloid Dressing 4"x4"', hcpcs: 'A6235', cost: 8.00 },
                { code: 708, description: 'Hydrocolloid Dressing 6"x6"', hcpcs: 'A6236', cost: 12.00 },
                { code: 709, description: 'Transparent Film 2"x2"', hcpcs: 'A6257', cost: 1.50 },
                { code: 710, description: 'Transparent Film 4"x4"', hcpcs: 'A6258', cost: 3.00 },
                { code: 711, description: 'Gauze Pad 2"x2"', hcpcs: 'A6402', cost: 0.50 },
                { code: 712, description: 'Gauze Pad 4"x4"', hcpcs: 'A6403', cost: 1.00 },
                { code: 713, description: 'Medical Tape 1"', hcpcs: 'A4452', cost: 2.00 },
                { code: 714, description: 'Wound Cleanser 8oz', hcpcs: 'A6260', cost: 15.00 }
            ];

            for (const supply of defaultSupplies) {
                await client.query(
                    'INSERT INTO supplies (code, description, hcpcs, cost, is_custom) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (code) DO NOTHING',
                    [supply.code, supply.description, supply.hcpcs, supply.cost, false]
                );
            }
            console.log('✅ Default supplies added: ' + defaultSupplies.length + ' items');
        } else {
            console.log('ℹ️ Supplies already exist, skipping...');
        }

        // Check if admin user exists
        const adminCheck = await client.query('SELECT COUNT(*) FROM users WHERE email = $1', ['admin@system.com']);
        
        if (parseInt(adminCheck.rows[0].count) === 0) {
            console.log('🔄 Creating default admin user...');
            const bcrypt = require('bcryptjs');
            const hashedPassword = await bcrypt.hash('admin123', 10);
            
            await client.query(
                'INSERT INTO users (name, email, password, role, is_approved) VALUES ($1, $2, $3, $4, $5)',
                ['System Administrator', 'admin@system.com', hashedPassword, 'admin', true]
            );
            console.log('✅ Default admin user created (admin@system.com / admin123)');
        } else {
            console.log('ℹ️ Admin user already exists');
        }

        console.log('🎉 Database initialization completed successfully!');
        console.log('📊 You can now use your Wound Care RT Supply Tracker');
        console.log('👤 Login with: admin@system.com / admin123');

    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Run initialization
initializeDatabase()
    .then(() => {
        console.log('Database setup complete!');
        process.exit(0);
    })
    .catch(error => {
        console.error('Setup failed:', error);
        process.exit(1);
    });
