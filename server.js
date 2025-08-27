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
                // Trigger already exists, continue
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

app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password, facility_id } = req.body;
        
        if (!name || !email || !password || !facility_id) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        const existingUser = await safeQuery('SELECT id FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'Email already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        
        const result = await safeQuery(
            'INSERT INTO users (name, email, password, facility_id, is_approved) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [name, email, hashedPassword, facility_id, false]
        );

        res.json({ 
            success: true, 
            message: 'Registration successful. Please wait for admin approval.',
            userId: result.rows[0].id 
        });

    } catch (error) {
        console.error('Registration error:', error);
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

app.put('/api/facilities/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        const facilityId = req.params.id;

        if (!name) {
            return res.status(400).json({ success: false, error: 'Facility name is required' });
        }

        const result = await safeQuery(
            'UPDATE facilities SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [name, facilityId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Facility not found' });
        }

        res.json({ success: true, message: 'Facility updated successfully' });
    } catch (error) {
        console.error('Error updating facility:', error);
        if (error.code === '23505') {
            return res.status(400).json({ success: false, error: 'Facility name already exists' });
        }
        res.status(500).json({ success: false, error: 'Failed to update facility' });
    }
});

app.delete('/api/facilities/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const facilityId = req.params.id;

        // Check if facility has any associated patients
        const patientCheck = await safeQuery('SELECT COUNT(*) as count FROM patients WHERE facility_id = $1', [facilityId]);
        const patientCount = parseInt(patientCheck.rows[0].count);

        if (patientCount > 0) {
            return res.status(400).json({ 
                success: false,
                error: `Cannot delete facility. It has ${patientCount} associated patient(s).`,
                patientCount: patientCount 
            });
        }

        const result = await safeQuery('DELETE FROM facilities WHERE id = $1', [facilityId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Facility not found' });
        }

        res.json({ success: true, message: 'Facility deleted successfully' });
    } catch (error) {
        console.error('Error deleting facility:', error);
        res.status(500).json({ success: false, error: 'Failed to delete facility' });
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

app.delete('/api/supplies/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const supplyId = req.params.id;
        
        // Check if supply is custom (only custom supplies can be deleted)
        const supplyCheck = await safeQuery('SELECT is_custom FROM supplies WHERE id = $1', [supplyId]);
        
        if (supplyCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Supply not found' });
        }

        if (!supplyCheck.rows[0].is_custom) {
            return res.status(400).json({ success: false, error: 'Cannot delete AR standard supplies' });
        }

        const result = await safeQuery('DELETE FROM supplies WHERE id = $1', [supplyId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Supply not found' });
        }

        res.json({ success: true, message: 'Supply deleted successfully' });
    } catch (error) {
        console.error('Error deleting supply:', error);
        res.status(500).json({ success: false, error: 'Failed to delete supply' });
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

app.put('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
        const { name, mrn } = req.body;
        const patientId = req.params.id;

        if (!name) {
            return res.status(400).json({ success: false, error: 'Name is required' });
        }

        // Check if patient exists and user has permission
        const patientCheck = await safeQuery('SELECT * FROM patients WHERE id = $1', [patientId]);
        
        if (patientCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Patient not found' });
        }

        const patient = patientCheck.rows[0];

        // Check permission
        if (req.user.role !== 'admin' && req.user.facilityId && req.user.facilityId != patient.facility_id) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        await safeQuery(
            'UPDATE patients SET name = $1, mrn = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
            [name, mrn || null, patientId]
        );

        res.json({ success: true, message: 'Patient updated successfully' });
    } catch (error) {
        console.error('Error updating patient:', error);
        res.status(500).json({ success: false, error: 'Failed to update patient' });
    }
});

app.delete('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
        const patientId = req.params.id;

        // Check if patient exists and user has permission
        const patientCheck = await safeQuery('SELECT * FROM patients WHERE id = $1', [patientId]);
        
        if (patientCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Patient not found' });
        }

        const patient = patientCheck.rows[0];

        // Check permission
        if (req.user.role !== 'admin' && req.user.facilityId && req.user.facilityId != patient.facility_id) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        await safeQuery('DELETE FROM patients WHERE id = $1', [patientId]);
        res.json({ success: true, message: 'Patient deleted successfully' });
    } catch (error) {
        console.error('Error deleting patient:', error);
        res.status(500).json({ success: false, error: 'Failed to delete patient' });
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
// Add these additional routes to your server.js file for enhanced tracking functionality

// ===== ENHANCED TRACKING ROUTES =====

// Get comprehensive tracking report data (admin only)
app.get('/api/reports/itemized-summary', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { facilityId, month, patientId } = req.query;
        
        let query = `
            SELECT 
                p.name as patient_name,
                p.mrn,
                p.month,
                f.name as facility_name,
                s.code as supply_code,
                s.description as item_description,
                s.hcpcs,
                s.cost as unit_cost,
                COALESCE(SUM(t.quantity), 0) as total_units,
                COALESCE(SUM(t.quantity * s.cost), 0) as total_cost,
                STRING_AGG(DISTINCT t.wound_dx, '; ') FILTER (WHERE t.wound_dx IS NOT NULL AND t.wound_dx != '') as wound_dx
            FROM patients p
            JOIN facilities f ON p.facility_id = f.id
            CROSS JOIN supplies s
            LEFT JOIN tracking t ON p.id = t.patient_id AND s.id = t.supply_id
            WHERE 1=1
        `;
        
        const params = [];
        let paramCount = 0;
        
        if (facilityId) {
            paramCount++;
            query += ` AND p.facility_id = $${paramCount}`;
            params.push(facilityId);
        }
        
        if (month) {
            paramCount++;
            query += ` AND p.month = $${paramCount}`;
            params.push(month);
        }
        
        if (patientId) {
            paramCount++;
            query += ` AND p.id = $${paramCount}`;
            params.push(patientId);
        }
        
        query += `
            GROUP BY p.id, s.id, p.name, p.mrn, p.month, f.name, s.code, s.description, s.hcpcs, s.cost
            HAVING COALESCE(SUM(t.quantity), 0) > 0
            ORDER BY p.name, s.code
        `;
        
        const result = await safeQuery(query, params);
        res.json({ success: true, report: result.rows });
        
    } catch (error) {
        console.error('Error generating itemized summary report:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to generate report',
            details: error.message 
        });
    }
});

// Get dashboard summary with filtering
app.get('/api/dashboard/summary', authenticateToken, async (req, res) => {
    try {
        const { facilityId, month } = req.query;
        
        let query = `
            SELECT 
                p.id,
                p.name,
                p.mrn,
                p.month,
                f.name as facility_name,
                p.created_at,
                COALESCE(SUM(t.quantity), 0) as total_units,
                COALESCE(SUM(t.quantity * s.cost), 0) as total_cost,
                COUNT(DISTINCT s.id) FILTER (WHERE t.quantity > 0) as supplies_used,
                STRING_AGG(DISTINCT t.wound_dx, '; ') FILTER (WHERE t.wound_dx IS NOT NULL AND t.wound_dx != '') as wound_diagnoses
            FROM patients p
            LEFT JOIN facilities f ON p.facility_id = f.id
            LEFT JOIN tracking t ON p.id = t.patient_id
            LEFT JOIN supplies s ON t.supply_id = s.id
            WHERE 1=1
        `;
        
        const params = [];
        let paramCount = 0;
        
        // Apply facility filter based on user role
        if (req.user.role !== 'admin' && req.user.facilityId) {
            paramCount++;
            query += ` AND p.facility_id = $${paramCount}`;
            params.push(req.user.facilityId);
        } else if (facilityId) {
            paramCount++;
            query += ` AND p.facility_id = $${paramCount}`;
            params.push(facilityId);
        }
        
        if (month) {
            paramCount++;
            query += ` AND p.month = $${paramCount}`;
            params.push(month);
        }
        
        query += ' GROUP BY p.id, f.name ORDER BY p.name ASC';
        
        const result = await safeQuery(query, params);
        res.json({ success: true, patients: result.rows });
        
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to load dashboard data',
            details: error.message 
        });
    }
});

// Bulk update tracking data
app.post('/api/tracking/bulk', authenticateToken, async (req, res) => {
    try {
        const { patientId, trackingData } = req.body;
        
        if (!patientId || !trackingData || !Array.isArray(trackingData)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Patient ID and tracking data array are required' 
            });
        }

        // Verify patient access
        const patientCheck = await safeQuery('SELECT * FROM patients WHERE id = $1', [patientId]);
        
        if (patientCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Patient not found' });
        }

        const patient = patientCheck.rows[0];

        // Check permission
        if (req.user.role !== 'admin' && req.user.facilityId && req.user.facilityId != patient.facility_id) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Begin transaction for bulk update
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            for (const item of trackingData) {
                const { supplyId, dayOfMonth, quantity, woundDx } = item;
                
                if (supplyId && dayOfMonth) {
                    await client.query(
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
                }
            }
            
            await client.query('COMMIT');
            res.json({ success: true, message: 'Bulk tracking data saved successfully' });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('Error saving bulk tracking data:', error);
        res.status(500).json({ success: false, error: 'Failed to save tracking data' });
    }
});

// Delete all tracking data for a patient (admin only)
app.delete('/api/tracking/patient/:patientId', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const patientId = req.params.patientId;
        
        const result = await safeQuery('DELETE FROM tracking WHERE patient_id = $1', [patientId]);
        
        res.json({ 
            success: true, 
            message: 'All tracking data deleted for patient',
            deletedRecords: result.rowCount 
        });
    } catch (error) {
        console.error('Error deleting patient tracking data:', error);
        res.status(500).json({ success: false, error: 'Failed to delete tracking data' });
    }
});

// Get tracking statistics
app.get('/api/tracking/stats', authenticateToken, async (req, res) => {
    try {
        const { facilityId, month } = req.query;
        
        let query = `
            SELECT 
                COUNT(DISTINCT p.id) as total_patients,
                COUNT(DISTINCT t.supply_id) as supplies_used,
                COALESCE(SUM(t.quantity), 0) as total_units,
                COALESCE(SUM(t.quantity * s.cost), 0) as total_cost,
                COUNT(DISTINCT t.id) as tracking_entries
            FROM patients p
            LEFT JOIN tracking t ON p.id = t.patient_id
            LEFT JOIN supplies s ON t.supply_id = s.id
            WHERE 1=1
        `;
        
        const params = [];
        let paramCount = 0;
        
        // Apply facility filter
        if (req.user.role !== 'admin' && req.user.facilityId) {
            paramCount++;
            query += ` AND p.facility_id = $${paramCount}`;
            params.push(req.user.facilityId);
        } else if (facilityId) {
            paramCount++;
            query += ` AND p.facility_id = $${paramCount}`;
            params.push(facilityId);
        }
        
        if (month) {
            paramCount++;
            query += ` AND p.month = $${paramCount}`;
            params.push(month);
        }
        
        const result = await safeQuery(query, params);
        res.json({ success: true, stats: result.rows[0] });
        
    } catch (error) {
        console.error('Error fetching tracking statistics:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch statistics' });
    }
});

// Get supplies usage summary
app.get('/api/supplies/usage-summary', authenticateToken, async (req, res) => {
    try {
        const { facilityId, month } = req.query;
        
        let query = `
            SELECT 
                s.id,
                s.code,
                s.description,
                s.hcpcs,
                s.cost,
                COALESCE(SUM(t.quantity), 0) as total_usage,
                COALESCE(SUM(t.quantity * s.cost), 0) as total_value,
                COUNT(DISTINCT p.id) as patients_using
            FROM supplies s
            LEFT JOIN tracking t ON s.id = t.supply_id
            LEFT JOIN patients p ON t.patient_id = p.id
        `;
        
        const params = [];
        let paramCount = 0;
        let whereAdded = false;
        
        // Apply facility filter
        if (req.user.role !== 'admin' && req.user.facilityId) {
            paramCount++;
            query += ` WHERE p.facility_id = $${paramCount}`;
            params.push(req.user.facilityId);
            whereAdded = true;
        } else if (facilityId) {
            paramCount++;
            query += ` WHERE p.facility_id = $${paramCount}`;
            params.push(facilityId);
            whereAdded = true;
        }
        
        if (month) {
            paramCount++;
            query += `${whereAdded ? ' AND' : ' WHERE'} p.month = $${paramCount}`;
            params.push(month);
        }
        
        query += `
            GROUP BY s.id, s.code, s.description, s.hcpcs, s.cost
            ORDER BY total_usage DESC, s.code ASC
        `;
        
        const result = await safeQuery(query, params);
        res.json({ success: true, supplies: result.rows });
        
    } catch (error) {
        console.error('Error fetching supplies usage summary:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch usage summary' });
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
        const { isApproved } = req.body;
        
        await safeQuery(
            'UPDATE users SET is_approved = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', 
            [isApproved !== undefined ? isApproved : true, id]
        );
        res.json({ success: true, message: 'User approval status updated' });

    } catch (error) {
        console.error('Error updating user approval:', error);
        res.status(500).json({ success: false, error: 'Failed to update user approval' });
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

