require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';

// MIDDLEWARE
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Multer configuration
const upload = multer({
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            file.mimetype === 'application/vnd.ms-excel') {
            cb(null, true);
        } else {
            cb(new Error('Only Excel files are allowed'));
        }
    }
});

// DATABASE CONFIGURATION
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Database helper function
async function safeQuery(query, params = []) {
    try {
        console.log('Executing query:', query.substring(0, 100) + '...');
        const result = await pool.query(query, params);
        console.log('Query successful, returned', result.rows.length, 'rows');
        return result;
    } catch (error) {
        console.error('Database query failed:', error.message);
        throw error;
    }
}

// Database initialization
async function initializeDatabase() {
    try {
        console.log('Initializing database...');

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
                email_verified BOOLEAN DEFAULT true,
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
            console.log('Creating default data...');
            
            // Create default facilities
            const facilitiesCheck = await safeQuery('SELECT COUNT(*) FROM facilities');
            if (parseInt(facilitiesCheck.rows[0].count) === 0) {
                await safeQuery(`
                    INSERT INTO facilities (name) VALUES 
                    ('General Hospital'),
                    ('Memorial Medical Center'), 
                    ('St. Mary''s Hospital'),
                    ('University Medical Center')
                `);
                console.log('Default facilities created');
            }
            
            // Create admin user
            const hashedPassword = await bcrypt.hash('admin123', 12);
            await safeQuery(
                'INSERT INTO users (name, email, password, role, is_approved, email_verified) VALUES ($1, $2, $3, $4, $5, $6)',
                ['System Administrator', 'admin@system.com', hashedPassword, 'admin', true, true]
            );
            console.log('Admin user created: admin@system.com / admin123');
        }

        // Add default supplies
        const suppliesCheck = await safeQuery('SELECT COUNT(*) FROM supplies');
        if (parseInt(suppliesCheck.rows[0].count) === 0) {
            console.log('Adding AR supplies...');
            const supplies = [
                { code: 272, description: 'Med/Surgical Supplies', hcpcs: 'B4149', cost: 0.00 },
                { code: 400, description: 'HME filter holder for trach or vent', hcpcs: 'A7507', cost: 3.49 },
                { code: 600, description: 'Sterile Gauze sponge 2x2 up to 4x4', hcpcs: 'A6251', cost: 2.78 },
                { code: 634, description: 'Foam non bordered dressing medium 6x6', hcpcs: 'A6210', cost: 27.84 },
                { code: 640, description: 'Hydrocolloid dressing pad 16 sq inches', hcpcs: 'A6234', cost: 9.15 }
            ];

            for (const supply of supplies) {
                await safeQuery(
                    'INSERT INTO supplies (code, description, hcpcs, cost, is_custom) VALUES ($1, $2, $3, $4, $5)',
                    [supply.code, supply.description, supply.hcpcs, supply.cost, false]
                );
            }
            console.log('Default supplies added');
        }
        
    } catch (error) {
        console.error('Failed to initialize default data:', error);
        throw error;
    }
}

// AUTHENTICATION MIDDLEWARE
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

const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// BASIC ROUTES
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', async (req, res) => {
    try {
        await safeQuery('SELECT 1');
        res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    } catch (error) {
        res.status(500).json({ status: 'unhealthy', error: error.message });
    }
});

// DEBUG ROUTES
app.get('/api/debug/patients', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const allPatients = await safeQuery(`
            SELECT p.*, f.name as facility_name 
            FROM patients p 
            LEFT JOIN facilities f ON p.facility_id = f.id
            ORDER BY p.month DESC, p.name
        `);

        const userInfo = await safeQuery(`
            SELECT id, name, email, role, facility_id, f.name as facility_name
            FROM users u
            LEFT JOIN facilities f ON u.facility_id = f.id
            WHERE u.role != 'admin'
        `);

        res.json({ 
            success: true, 
            allPatients: allPatients.rows,
            nonAdminUsers: userInfo.rows,
            patientCount: allPatients.rows.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/debug/clear-patients', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const trackingResult = await safeQuery('DELETE FROM tracking');
        const patientsResult = await safeQuery('DELETE FROM patients');
        
        res.json({ 
            success: true, 
            message: `Cleared ${trackingResult.rowCount} tracking records and ${patientsResult.rowCount} patients`,
            trackingDeleted: trackingResult.rowCount,
            patientsDeleted: patientsResult.rowCount
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DASHBOARD
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
    try {
        const [patientsResult, suppliesResult, trackingResult] = await Promise.all([
            safeQuery(`
                SELECT COUNT(*) as count 
                FROM patients p
                ${req.user.role !== 'admin' && req.user.facilityId ? 
                  'WHERE p.facility_id = $1' : ''}
            `, req.user.role !== 'admin' && req.user.facilityId ? [req.user.facilityId] : []),
            
            safeQuery('SELECT COUNT(*) as count FROM supplies'),
            
            safeQuery(`
                SELECT COUNT(*) as count 
                FROM tracking t
                JOIN patients p ON t.patient_id = p.id
                ${req.user.role !== 'admin' && req.user.facilityId ? 
                  'WHERE p.facility_id = $1' : ''}
            `, req.user.role !== 'admin' && req.user.facilityId ? [req.user.facilityId] : [])
        ]);

        let totalCostResult;
        if (req.user.role === 'admin') {
            totalCostResult = await safeQuery(`
                SELECT COALESCE(SUM(t.quantity * s.cost), 0) as total_cost
                FROM tracking t
                JOIN supplies s ON t.supply_id = s.id
                WHERE t.quantity > 0
            `);
        } else {
            totalCostResult = { rows: [{ total_cost: 0 }] };
        }

        res.json({
            success: true,
            stats: {
                totalPatients: parseInt(patientsResult.rows[0].count) || 0,
                totalSupplies: parseInt(suppliesResult.rows[0].count) || 0,
                monthlyTracking: parseInt(trackingResult.rows[0].count) || 0,
                totalCost: parseFloat(totalCostResult.rows[0].total_cost) || 0
            }
        });

    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ success: false, error: 'Failed to load dashboard statistics' });
    }
});

// AUTHENTICATION
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
        res.status(500).json({ success: false, message: 'Server error during login' });
    }
});

// FACILITIES
app.get('/api/facilities', async (req, res) => {
    try {
        const result = await safeQuery('SELECT * FROM facilities ORDER BY name ASC');
        res.json({ success: true, facilities: result.rows });
    } catch (error) {
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
        if (error.code === '23505') {
            return res.status(400).json({ success: false, error: 'Facility name already exists' });
        }
        res.status(500).json({ success: false, error: 'Failed to create facility' });
    }
});

// SUPPLIES
app.get('/api/supplies', authenticateToken, async (req, res) => {
    try {
        const result = await safeQuery('SELECT * FROM supplies ORDER BY code ASC');
        res.json({ success: true, supplies: result.rows });
    } catch (error) {
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
        if (error.code === '23505') {
            return res.status(400).json({ success: false, error: 'Supply code already exists' });
        }
        res.status(500).json({ success: false, error: 'Failed to create supply' });
    }
});

// PATIENTS - FIXED WITH STRICT FILTERING
app.get('/api/patients', authenticateToken, async (req, res) => {
    try {
        const { facility_id, month } = req.query;
        
        console.log('=== PATIENT QUERY DEBUG ===');
        console.log('User Role:', req.user.role);
        console.log('User Facility ID:', req.user.facilityId);
        
        let query = `
            SELECT p.*, f.name as facility_name 
            FROM patients p 
            LEFT JOIN facilities f ON p.facility_id = f.id
        `;
        let params = [];
        let conditions = [];

        // STRICT FILTERING FOR NON-ADMIN USERS
        if (req.user.role !== 'admin') {
            if (req.user.facilityId) {
                conditions.push('p.facility_id = $' + (params.length + 1));
                params.push(req.user.facilityId);
                conditions.push("p.month >= '2025-09'"); // September 2025 onwards only
                console.log('Non-admin filters applied: facility =', req.user.facilityId, ', month >= 2025-09');
            } else {
                console.log('User has no facility - returning empty');
                return res.json({ success: true, patients: [] });
            }
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

        console.log('Final query:', query);
        console.log('Query params:', params);

        const result = await safeQuery(query, params);
        
        console.log('Query result count:', result.rows.length);
        console.log('=== END DEBUG ===');

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

        // Month restriction for non-admin users
        if (req.user.role !== 'admin' && month < '2025-09') {
            return res.status(400).json({ success: false, error: 'Can only add patients for September 2025 onwards' });
        }

        const result = await safeQuery(
            'INSERT INTO patients (name, month, mrn, facility_id) VALUES ($1, $2, $3, $4) RETURNING *',
            [name, month, mrn ? mrn.trim() : null, facility_id]
        );

        res.json({ success: true, patient: result.rows[0] });

    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ success: false, error: 'Patient already exists for this month and facility' });
        }
        res.status(500).json({ success: false, error: 'Failed to create patient' });
    }
});

// BULK PATIENT UPLOAD - EXCEL ONLY
app.post('/api/patients/bulk', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No Excel file uploaded' });
        }

        let data;
        try {
            const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            data = XLSX.utils.sheet_to_json(sheet);
        } catch (parseError) {
            return res.status(400).json({ success: false, error: 'Invalid Excel file format' });
        }

        if (data.length === 0) {
            return res.status(400).json({ success: false, error: 'No data found in Excel file' });
        }

        // Load facilities for mapping
        const facilitiesResult = await safeQuery('SELECT id, name FROM facilities');
        const facilityMap = {};
        facilitiesResult.rows.forEach(facility => {
            facilityMap[facility.name.toLowerCase()] = facility.id;
        });

        const results = { successful: 0, failed: [] };

        for (const row of data) {
            try {
                const name = (row.Name || row.name || '').toString().trim();
                const mrn = (row.MRN || row.mrn || '').toString().trim();
                const month = (row.Month || row.month || '').toString().trim();
                const facilityName = (row.Facility || row.facility || '').toString().trim();

                if (!name || !month || !facilityName) {
                    results.failed.push({ 
                        name: name || 'Unknown', 
                        error: 'Missing required fields (Name, Month, Facility)' 
                    });
                    continue;
                }

                // Convert MM-YYYY to YYYY-MM
                let dbMonth = month;
                if (month.match(/^\d{2}-\d{4}$/)) {
                    const parts = month.split('-');
                    dbMonth = `${parts[1]}-${parts[0]}`;
                }

                // Month restriction for non-admin users
                if (req.user.role !== 'admin' && dbMonth < '2025-09') {
                    results.failed.push({ 
                        name: name, 
                        error: 'Can only add patients for September 2025 onwards' 
                    });
                    continue;
                }

                const facilityId = facilityMap[facilityName.toLowerCase()];
                if (!facilityId) {
                    results.failed.push({ 
                        name: name, 
                        error: `Facility "${facilityName}" not found` 
                    });
                    continue;
                }

                // Permission check for non-admin users
                if (req.user.role !== 'admin' && req.user.facilityId && req.user.facilityId != facilityId) {
                    results.failed.push({ 
                        name: name, 
                        error: 'No permission to add patients to this facility' 
                    });
                    continue;
                }

                await safeQuery(
                    'INSERT INTO patients (name, mrn, month, facility_id) VALUES ($1, $2, $3, $4)',
                    [name, mrn || null, dbMonth, facilityId]
                );

                results.successful++;

            } catch (error) {
                results.failed.push({ 
                    name: row.Name || row.name || 'Unknown', 
                    error: error.message 
                });
            }
        }

        res.json({
            success: true,
            message: `Upload completed. ${results.successful} successful, ${results.failed.length} failed.`,
            successful: results.successful,
            failed: results.failed
        });

    } catch (error) {
        console.error('Bulk upload error:', error);
        res.status(500).json({ success: false, error: 'Server error during bulk upload' });
    }
});

// TRACKING
app.get('/api/tracking/:patientId', authenticateToken, async (req, res) => {
    try {
        const patientId = req.params.patientId;
        
        // Check permission
        const patientCheck = await safeQuery('SELECT * FROM patients WHERE id = $1', [patientId]);
        if (patientCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Patient not found' });
        }

        const patient = patientCheck.rows[0];
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
        res.status(500).json({ success: false, error: 'Failed to fetch tracking data' });
    }
});

app.post('/api/tracking', authenticateToken, async (req, res) => {
    try {
        const { patientId, supplyId, dayOfMonth, quantity, woundDx } = req.body;

        if (!patientId || !supplyId || !dayOfMonth) {
            return res.status(400).json({ success: false, error: 'Patient ID, supply ID, and day are required' });
        }

        // Check permission
        const patientCheck = await safeQuery('SELECT * FROM patients WHERE id = $1', [patientId]);
        if (patientCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Patient not found' });
        }

        const patient = patientCheck.rows[0];
        if (req.user.role !== 'admin' && req.user.facilityId && req.user.facilityId != patient.facility_id) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        await safeQuery(
            `INSERT INTO tracking (patient_id, supply_id, day_of_month, quantity, wound_dx) 
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (patient_id, supply_id, day_of_month) 
             DO UPDATE SET quantity = EXCLUDED.quantity, wound_dx = EXCLUDED.wound_dx`,
            [patientId, supplyId, dayOfMonth, quantity || 0, woundDx || null]
        );

        res.json({ success: true, message: 'Tracking data saved successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to save tracking data' });
    }
});

// ADMIN USERS
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
            'INSERT INTO users (name, email, password, role, facility_id, is_approved, email_verified) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [name, email, hashedPassword, role || 'user', facility_id || null, true, true]
        );

        res.json({ success: true, user: result.rows[0] });

    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ success: false, error: 'Failed to create user' });
    }
});

app.put('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const { name, email, role, facility_id } = req.body;
        
        if (!name || !email || !role) {
            return res.status(400).json({ success: false, error: 'Name, email, and role are required' });
        }

        const existingUser = await safeQuery('SELECT id FROM users WHERE email = $1 AND id != $2', [email, userId]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ success: false, error: 'Email already exists' });
        }

        const result = await safeQuery(
            'UPDATE users SET name = $1, email = $2, role = $3, facility_id = $4 WHERE id = $5',
            [name, email, role, facility_id || null, userId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        res.json({ success: true, message: 'User updated successfully' });

    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to update user' });
    }
});

app.put('/api/admin/users/:id/reset-password', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const { newPassword } = req.body;
        
        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ success: false, error: 'Password must be at least 8 characters long' });
        }
        
        const userCheck = await safeQuery('SELECT id, email, name FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        const hashedPassword = await bcrypt.hash(newPassword, 12);
        
        const result = await safeQuery(
            'UPDATE users SET password = $1 WHERE id = $2',
            [hashedPassword, userId]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Failed to update password' });
        }
        
        const user = userCheck.rows[0];
        res.json({ 
            success: true, 
            message: 'Password reset successfully for ' + user.name,
            userEmail: user.email
        });

    } catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).json({ success: false, error: 'Failed to reset password' });
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
        res.status(500).json({ success: false, error: 'Failed to delete user' });
    }
});

// ERROR HANDLING
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// SERVER STARTUP
async function startServer() {
    try {
        await initializeDatabase();
        
        app.listen(PORT, () => {
            console.log('================================');
            console.log('Wound Care RT Supply Tracker');
            console.log('================================');
            console.log(`Server running on port ${PORT}`);
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
