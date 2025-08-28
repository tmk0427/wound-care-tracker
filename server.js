const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== DATABASE CONFIGURATION =====
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Test database connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('Error connecting to database:', err);
        console.error('Database URL exists:', !!process.env.DATABASE_URL);
        console.error('Node ENV:', process.env.NODE_ENV);
    } else {
        console.log('Connected to PostgreSQL database');
        client.query('SELECT NOW()', (err, result) => {
            if (err) {
                console.error('Database query test failed:', err);
            } else {
                console.log('Database query test successful:', result.rows[0].now);
            }
            release();
        });
    }
});

// ===== DATABASE HELPER FUNCTIONS =====
async function safeQuery(query, params = []) {
    try {
        console.log('Executing query:', query.substring(0, 100) + '...');
        console.log('Parameters:', params);
        
        const result = await pool.query(query, params);
        console.log('Query successful, returned', result.rows.length, 'rows');
        return result;
    } catch (error) {
        console.error('Database query failed:');
        console.error('Query:', query.substring(0, 200) + '...');
        console.error('Parameters:', params);
        console.error('Error message:', error.message);
        console.error('Error code:', error.code);
        throw error;
    }
}

// ===== DATABASE INITIALIZATION =====
async function initializeDatabase() {
    try {
        console.log('Initializing database tables...');

        // Create facilities table
        await safeQuery(`
            CREATE TABLE IF NOT EXISTS facilities (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create supplies table
        await safeQuery(`
            CREATE TABLE IF NOT EXISTS supplies (
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

        // Create users table
        await safeQuery(`
            CREATE TABLE IF NOT EXISTS users (
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

        // Create patients table
        await safeQuery(`
            CREATE TABLE IF NOT EXISTS patients (
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

        // Create tracking table
        await safeQuery(`
            CREATE TABLE IF NOT EXISTS tracking (
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

        // Create indexes for performance
        await safeQuery('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
        await safeQuery('CREATE INDEX IF NOT EXISTS idx_users_facility ON users(facility_id)');
        await safeQuery('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)');
        await safeQuery('CREATE INDEX IF NOT EXISTS idx_patients_facility ON patients(facility_id)');
        await safeQuery('CREATE INDEX IF NOT EXISTS idx_patients_month ON patients(month)');
        await safeQuery('CREATE INDEX IF NOT EXISTS idx_tracking_patient ON tracking(patient_id)');
        await safeQuery('CREATE INDEX IF NOT EXISTS idx_tracking_supply ON tracking(supply_id)');
        await safeQuery('CREATE INDEX IF NOT EXISTS idx_supplies_code ON supplies(code)');

        // Create trigger function for updated_at
        await safeQuery(`
            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            $$ language 'plpgsql'
        `);

        // Create triggers for updated_at
        const triggers = [
            { table: 'facilities', trigger: 'update_facilities_updated_at' },
            { table: 'supplies', trigger: 'update_supplies_updated_at' },
            { table: 'users', trigger: 'update_users_updated_at' },
            { table: 'patients', trigger: 'update_patients_updated_at' },
            { table: 'tracking', trigger: 'update_tracking_updated_at' }
        ];

        for (const { table, trigger } of triggers) {
            try {
                await safeQuery(`
                    CREATE TRIGGER ${trigger} 
                    BEFORE UPDATE ON ${table} 
                    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
                `);
            } catch (err) {
                console.log(`Trigger ${trigger} already exists or failed to create`);
            }
        }

        await initializeDefaultData();
        console.log('Database initialization completed successfully');
        
    } catch (error) {
        console.error('Database initialization failed:', error);
        throw error;
    }
}

async function initializeDefaultData() {
    try {
        // Check if admin exists
        const adminCheck = await safeQuery('SELECT COUNT(*) FROM users WHERE role = $1', ['admin']);
        
        if (parseInt(adminCheck.rows[0].count) === 0) {
            console.log('Creating admin user and default data...');
            
            // Create default facilities first
            const facilitiesCheck = await safeQuery('SELECT COUNT(*) FROM facilities');
            if (parseInt(facilitiesCheck.rows[0].count) === 0) {
                await safeQuery(`
                    INSERT INTO facilities (name) VALUES 
                    ('General Hospital'),
                    ('Memorial Medical Center'), 
                    ('St. Mary''s Hospital'),
                    ('University Medical Center'),
                    ('Regional Health System')
                `);
                console.log('Default facilities created');
            }
            
            const hashedPassword = await bcrypt.hash('admin123', 12);
            await safeQuery(
                'INSERT INTO users (name, email, password, role, is_approved) VALUES ($1, $2, $3, $4, $5)',
                ['System Administrator', 'admin@system.com', hashedPassword, 'admin', true]
            );
            
            console.log('Admin user created: admin@system.com / admin123');
        }

        // Check if supplies exist
        const suppliesCheck = await safeQuery('SELECT COUNT(*) FROM supplies');
        if (parseInt(suppliesCheck.rows[0].count) === 0) {
            console.log('Adding AR supplies...');
            
            // Complete AR supplies list
            const arSupplies = [
                { code: 272, description: 'Med/Surgical Supplies', hcpcs: 'B4149', cost: 0.00 },
                { code: 400, description: 'HME filter holder for trach or vent', hcpcs: 'A7507', cost: 3.49 },
                { code: 401, description: 'HME housing & adhesive', hcpcs: 'A7509', cost: 1.97 },
                { code: 402, description: 'HMES/trach valve adhesive disk', hcpcs: 'A7506', cost: 0.45 },
                { code: 403, description: 'HMES filter holder or cap for tracheostoma', hcpcs: 'A7503', cost: 15.85 },
                { code: 404, description: 'HMES filter', hcpcs: 'A7504', cost: 0.95 },
                { code: 405, description: 'HMES/trach valve housing', hcpcs: 'A7505', cost: 6.55 },
                { code: 600, description: 'Sterile Gauze sponge 2x2 up to 4x4, EACH 2 in package', hcpcs: 'A6251', cost: 2.78 },
                { code: 634, description: 'Foam non bordered dressing medium 6x6, each Mepilex, Allevyn, xeroform', hcpcs: 'A6210', cost: 27.84 },
                { code: 640, description: 'Hydrocolloid dressing pad 16 sq inches non bordered', hcpcs: 'A6234', cost: 9.15 },
                { code: 644, description: 'Hydrogel dressing pad 4x4 each', hcpcs: 'A6242', cost: 8.46 },
                { code: 679, description: 'Transparent film Tegaderm/opsite 16" or less', hcpcs: 'A6257', cost: 2.14 }
            ];

            for (const supply of arSupplies) {
                await safeQuery(
                    'INSERT INTO supplies (code, description, hcpcs, cost, is_custom) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (code) DO NOTHING',
                    [supply.code, supply.description, supply.hcpcs, supply.cost, false]
                );
            }
            console.log(`Added ${arSupplies.length} AR supplies`);
        }
        
    } catch (error) {
        console.error('Failed to initialize default data:', error);
        throw error;
    }
}

// ===== AUTHENTICATION MIDDLEWARE =====
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Admin middleware
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// ===== BASIC ROUTES =====
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', async (req, res) => {
    try {
        await safeQuery('SELECT 1');
        res.json({ 
            status: 'healthy', 
            timestamp: new Date().toISOString(),
            database: 'connected' 
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'unhealthy', 
            timestamp: new Date().toISOString(),
            database: 'disconnected',
            error: error.message 
        });
    }
});

// ===== AUTHENTICATION ROUTES =====
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password required' });
        }

        const result = await safeQuery(
            `SELECT u.*, f.name as facility_name 
             FROM users u 
             LEFT JOIN facilities f ON u.facility_id = f.id 
             WHERE u.email = $1`,
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const user = result.rows[0];

        if (!(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        if (!user.is_approved) {
            return res.status(403).json({ success: false, message: 'Account pending approval' });
        }

        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role, 
                facilityId: user.facility_id 
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                facility_id: user.facility_id,
                facility_name: user.facility_name
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/auth/verify', authenticateToken, async (req, res) => {
    try {
        const result = await safeQuery(
            `SELECT u.*, f.name as facility_name 
             FROM users u 
             LEFT JOIN facilities f ON u.facility_id = f.id 
             WHERE u.id = $1`,
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        const user = result.rows[0];
        const userResponse = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            facility_id: user.facility_id,
            facility_name: user.facility_name
        };

        res.json({ user: userResponse });
    } catch (error) {
        console.error('Auth verify error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ===== FACILITIES ROUTES =====
app.get('/api/facilities', async (req, res) => {
    try {
        const result = await safeQuery('SELECT * FROM facilities ORDER BY name ASC');
        res.json({ success: true, facilities: result.rows });
    } catch (error) {
        console.error('Error fetching facilities:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch facilities' });
    }
});

app.post('/api/facilities', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        
        if (!name) {
            return res.status(400).json({ success: false, error: 'Facility name is required' });
        }

        const result = await safeQuery(
            'INSERT INTO facilities (name) VALUES ($1) RETURNING *',
            [name]
        );

        res.json({ success: true, facility: result.rows[0] });

    } catch (error) {
        console.error('Error creating facility:', error);
        if (error.code === '23505') {
            return res.status(400).json({ success: false, error: 'Facility name already exists' });
        }
        res.status(500).json({ success: false, error: 'Failed to create facility' });
    }
});

// ===== SUPPLIES ROUTES =====
app.get('/api/supplies', authenticateToken, async (req, res) => {
    try {
        const result = await safeQuery('SELECT * FROM supplies ORDER BY code ASC');
        res.json({ success: true, supplies: result.rows });
    } catch (error) {
        console.error('Error fetching supplies:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch supplies' });
    }
});

app.post('/api/supplies', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { code, description, hcpcs, cost } = req.body;
        
        if (!code || !description) {
            return res.status(400).json({ success: false, error: 'Code and description are required' });
        }

        const result = await safeQuery(
            'INSERT INTO supplies (code, description, hcpcs, cost, is_custom) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [code, description, hcpcs || null, parseFloat(cost) || 0, true]
        );

        res.json({ success: true, supply: result.rows[0] });

    } catch (error) {
        console.error('Error creating supply:', error);
        if (error.code === '23505') {
            return res.status(400).json({ success: false, error: 'Supply code already exists' });
        }
        res.status(500).json({ success: false, error: 'Failed to create supply' });
    }
});

app.put('/api/supplies/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { code, description, hcpcs, cost } = req.body;
        const supplyId = req.params.id;

        if (!code || !description) {
            return res.status(400).json({ success: false, error: 'Code and description are required' });
        }

        const result = await safeQuery(
            'UPDATE supplies SET code = $1, description = $2, hcpcs = $3, cost = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5',
            [code, description, hcpcs || null, parseFloat(cost) || 0, supplyId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Supply not found' });
        }

        res.json({ success: true, message: 'Supply updated successfully' });
    } catch (error) {
        console.error('Error updating supply:', error);
        if (error.code === '23505') {
            return res.status(400).json({ success: false, error: 'Supply code already exists' });
        }
        res.status(500).json({ success: false, error: 'Failed to update supply' });
    }
});

// ===== PATIENTS ROUTES =====
app.get('/api/patients', authenticateToken, async (req, res) => {
    try {
        const { facility_id, month } = req.query;
        
        let query = `
            SELECT p.*, f.name as facility_name 
            FROM patients p 
            LEFT JOIN facilities f ON p.facility_id = f.id
        `;
        let params = [];
        let conditions = [];

        // Apply facility filter if user is not admin
        if (req.user.role !== 'admin' && req.user.facilityId) {
            conditions.push('p.facility_id = $' + (params.length + 1));
            params.push(req.user.facilityId);
        } else if (facility_id) {
            conditions.push('p.facility_id = $' + (params.length + 1));
            params.push(facility_id);
        }

        if (month) {
            conditions.push('p.month = $' + (params.length + 1));
            params.push(month);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY p.name ASC';

        const result = await safeQuery(query, params);
        res.json({ success: true, patients: result.rows });

    } catch (error) {
        console.error('Error fetching patients:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch patients' });
    }
});

app.post('/api/patients', authenticateToken, async (req, res) => {
    try {
        const { name, month, mrn, facility_id } = req.body;
        
        if (!name || !month || !facility_id) {
            return res.status(400).json({ success: false, error: 'Name, month, and facility are required' });
        }

        // Check permission for non-admin users
        if (req.user.role !== 'admin' && req.user.facilityId && req.user.facilityId != facility_id) {
            return res.status(403).json({ success: false, error: 'Cannot add patients to this facility' });
        }

        const result = await safeQuery(
            'INSERT INTO patients (name, month, mrn, facility_id) VALUES ($1, $2, $3, $4) RETURNING *',
            [name, month, mrn || null, facility_id]
        );

        res.json({ success: true, patient: result.rows[0] });

    } catch (error) {
        console.error('Error creating patient:', error);
        if (error.code === '23505') {
            return res.status(400).json({ success: false, error: 'Patient already exists for this month and facility' });
        }
        res.status(500).json({ success: false, error: 'Failed to create patient' });
    }
});

// ===== BULK PATIENT UPLOAD ROUTE =====
app.post('/api/patients/bulk', authenticateToken, async (req, res) => {
    try {
        const { patients } = req.body;
        
        if (!patients || !Array.isArray(patients) || patients.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Patients array is required' 
            });
        }

        if (patients.length > 1000) {
            return res.status(400).json({ 
                success: false, 
                error: 'Maximum 1000 patients per upload' 
            });
        }

        // Load facilities to map names to IDs
        const facilitiesResult = await safeQuery('SELECT id, name FROM facilities ORDER BY name');
        const facilityMap = {};
        for (const facility of facilitiesResult.rows) {
            facilityMap[facility.name.toLowerCase()] = facility.id;
        }

        const results = {
            successful: 0,
            failed: []
        };

        // Process each patient
        for (const patientData of patients) {
            try {
                const { name, mrn, month, facilityName } = patientData;
                
                // Validate name format "Last, First"
                if (!name || name.trim().length < 3) {
                    results.failed.push({ 
                        name: name || 'Unknown', 
                        error: 'Name must be at least 3 characters' 
                    });
                    continue;
                }

                if (name.indexOf(',') === -1) {
                    results.failed.push({ 
                        name: name, 
                        error: 'Name must be in "Last, First" format' 
                    });
                    continue;
                }

                const nameParts = name.split(',');
                if (nameParts.length !== 2 || !nameParts[0].trim() || !nameParts[1].trim()) {
                    results.failed.push({ 
                        name: name, 
                        error: 'Invalid "Last, First" format' 
                    });
                    continue;
                }

                // Validate month format MM-YYYY
                if (!month || !month.match(/^\d{2}-\d{4}$/)) {
                    results.failed.push({ 
                        name: name, 
                        error: 'Month must be in MM-YYYY format (e.g., 08-2024)' 
                    });
                    continue;
                }

                // Validate month range
                const monthParts = month.split('-');
                const monthNum = parseInt(monthParts[0]);
                const year = parseInt(monthParts[1]);
                
                if (monthNum < 1 || monthNum > 12) {
                    results.failed.push({ 
                        name: name, 
                        error: 'Month must be 01-12' 
                    });
                    continue;
                }
                
                if (year < 2020 || year > 2030) {
                    results.failed.push({ 
                        name: name, 
                        error: 'Year must be between 2020-2030' 
                    });
                    continue;
                }

                // Convert MM-YYYY to YYYY-MM for database storage
                const dbMonth = `${year}-${monthParts[0]}`;

                if (!facilityName || facilityName.trim().length < 2) {
                    results.failed.push({ 
                        name: name, 
                        error: 'Facility name is required' 
                    });
                    continue;
                }

                // Find facility ID
                const facilityId = facilityMap[facilityName.toLowerCase()];
                if (!facilityId) {
                    results.failed.push({ 
                        name: name, 
                        error: 'Facility "' + facilityName + '" not found' 
                    });
                    continue;
                }

                // Check permission for non-admin users
                if (req.user.role !== 'admin' && req.user.facilityId && req.user.facilityId != facilityId) {
                    results.failed.push({ 
                        name: name, 
                        error: 'No permission to add patients to this facility' 
                    });
                    continue;
                }

                // Insert patient with cleaned name
                const cleanName = `${nameParts[0].trim()}, ${nameParts[1].trim()}`;
                const insertResult = await safeQuery(
                    'INSERT INTO patients (name, mrn, month, facility_id) VALUES ($1, $2, $3, $4) RETURNING id',
                    [cleanName, mrn ? mrn.trim() : null, dbMonth, facilityId]
                );

                if (insertResult.rows.length > 0) {
                    results.successful++;
                }

            } catch (error) {
                // Handle duplicate patient or other database errors
                if (error.code === '23505') { // Unique constraint violation
                    results.failed.push({ 
                        name: patientData.name || 'Unknown', 
                        error: 'Patient already exists for this month and facility' 
                    });
                } else {
                    results.failed.push({ 
                        name: patientData.name || 'Unknown', 
                        error: 'Database error: ' + error.message 
                    });
                }
            }
        }

        res.json({
            success: true,
            message: `Upload completed. ${results.successful} successful, ${results.failed.length} failed.`,
            successful: results.successful,
            failed: results.failed
        });

    } catch (error) {
        console.error('Bulk patient upload error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error during bulk upload',
            details: error.message 
        });
    }
});

// ===== TRACKING ROUTES =====
app.get('/api/tracking/:patientId', authenticateToken, async (req, res) => {
    try {
        const patientId = req.params.patientId;

        // Check if user has permission to view this patient
        const patientCheck = await safeQuery('SELECT * FROM patients WHERE id = $1', [patientId]);
        
        if (patientCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Patient not found' });
        }

        const patient = patientCheck.rows[0];

        // Check permission
        if (req.user.role !== 'admin' && req.user.facilityId && req.user.facilityId != patient.facility_id) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const result = await safeQuery(
            `SELECT t.*, s.description as supply_description, s.cost as supply_cost, s.hcpcs, s.code as supply_code
             FROM tracking t 
             LEFT JOIN supplies s ON t.supply_id = s.id 
             WHERE t.patient_id = $1 
             ORDER BY s.code, t.day_of_month`,
            [patientId]
        );

        res.json({ success: true, tracking: result.rows });
    } catch (error) {
        console.error('Error fetching tracking data:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch tracking data' });
    }
});

app.post('/api/tracking', authenticateToken, async (req, res) => {
    try {
        const { patientId, supplyId, dayOfMonth, quantity, woundDx } = req.body;

        if (!patientId || !supplyId || !dayOfMonth) {
            return res.status(400).json({ success: false, error: 'Patient ID, supply ID, and day are required' });
        }

        // Check if user has permission
        const patientCheck = await safeQuery('SELECT * FROM patients WHERE id = $1', [patientId]);
        
        if (patientCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Patient not found' });
        }

        const patient = patientCheck.rows[0];

        // Check permission
        if (req.user.role !== 'admin' && req.user.facilityId && req.user.facilityId != patient.facility_id) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Upsert tracking data
        await safeQuery(
            `INSERT INTO tracking (patient_id, supply_id, day_of_month, quantity, wound_dx, updated_at) 
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
             ON CONFLICT (patient_id, supply_id, day_of_month) 
             DO UPDATE SET 
                quantity = EXCLUDED.quantity,
                wound_dx = CASE 
                    WHEN EXCLUDED.wound_dx IS NOT NULL AND EXCLUDED.wound_dx != '' 
                    THEN EXCLUDED.wound_dx 
                    ELSE tracking.wound_dx 
                END,
                updated_at = CURRENT_TIMESTAMP`,
            [patientId, supplyId, dayOfMonth, quantity || 0, woundDx || null]
        );

        res.json({ success: true, message: 'Tracking data saved successfully' });
    } catch (error) {
        console.error('Error saving tracking data:', error);
        res.status(500).json({ success: false, error: 'Failed to save tracking data' });
    }
});

app.get('/api/tracking', authenticateToken, async (req, res) => {
    try {
        const result = await safeQuery('SELECT * FROM tracking ORDER BY id DESC LIMIT 1000');
        res.json({ success: true, tracking: result.rows });
    } catch (error) {
        console.error('Error fetching all tracking data:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch tracking data' });
    }
});

// ===== ADMIN ROUTES =====
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await safeQuery(`
            SELECT u.*, f.name as facility_name 
            FROM users u 
            LEFT JOIN facilities f ON u.facility_id = f.id 
            ORDER BY u.name ASC
        `);
        res.json({ success: true, users: result.rows });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch users' });
    }
});

app.post('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name, email, password, role, facility_id } = req.body;
        
        if (!name || !email || !password) {
            return res.status(400).json({ success: false, error: 'Name, email, and password are required' });
        }

        const existingUser = await safeQuery('SELECT id FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ success: false, error: 'Email already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        
        const result = await safeQuery(
            'INSERT INTO users (name, email, password, role, facility_id, is_approved) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [name, email, hashedPassword, role || 'user', facility_id || null, true]
        );

        res.json({ success: true, user: result.rows[0] });

    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ success: false, error: 'Failed to create user' });
    }
});

app.put('/api/admin/users/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        await safeQuery(
            'UPDATE users SET is_approved = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1', 
            [id]
        );
        res.json({ success: true, message: 'User approved successfully' });

    } catch (error) {
        console.error('Error approving user:', error);
        res.status(500).json({ success: false, error: 'Failed to approve user' });
    }
});

app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (parseInt(id) === req.user.id) {
            return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
        }
        
        const result = await safeQuery('DELETE FROM users WHERE id = $1', [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        res.json({ success: true, message: 'User deleted successfully' });

    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ success: false, error: 'Failed to delete user' });
    }
});

// ===== ERROR HANDLING MIDDLEWARE =====
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ 
        success: false, 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// 404 handler
app.use((req, res) => {
    console.log('404 - Route not found:', req.method, req.path);
    res.status(404).json({ error: 'Route not found' });
});

// ===== GRACEFUL SHUTDOWN =====
process.on('SIGTERM', () => {
    console.log('Received SIGTERM signal, shutting down gracefully');
    pool.end(() => {
        console.log('Database pool closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('Received SIGINT signal, shutting down gracefully');
    pool.end(() => {
        console.log('Database pool closed');
        process.exit(0);
    });
});

// ===== SERVER STARTUP =====
async function startServer() {
    try {
        await initializeDatabase();
        
        app.listen(PORT, () => {
            console.log('');
            console.log('================================');
            console.log('Wound Care RT Supply Tracker');
            console.log('================================');
            console.log(`Server running on port ${PORT}`);
            console.log(`Server URL: http://localhost:${PORT}`);
            console.log(`Health check: http://localhost:${PORT}/health`);
            console.log('');
            console.log('Default credentials: admin@system.com / admin123');
            console.log('================================');
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

module.exports = app;
