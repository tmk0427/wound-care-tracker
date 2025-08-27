const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const multer = require('multer');
const csv = require('csv-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Database connection failed:', err);
    } else {
        console.log('✅ Database connected successfully');
        release();
    }
});

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// File upload configuration
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// Health check and debug routes
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/api/debug/status', (req, res) => {
    res.json({ 
        success: true, 
        server: 'running', 
        database: 'connected',
        timestamp: new Date().toISOString()
    });
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// Admin-only middleware
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    next();
};

// Initialize database tables
async function initializeDatabase() {
    const tables = [
        // Facilities table
        `CREATE TABLE IF NOT EXISTS facilities (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // Users table
        `CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'user' CHECK(role IN ('user', 'admin')),
            facility_id INTEGER REFERENCES facilities(id),
            approved BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // Supplies table
        `CREATE TABLE IF NOT EXISTS supplies (
            id SERIAL PRIMARY KEY,
            ar_code TEXT NOT NULL UNIQUE,
            description TEXT NOT NULL,
            hcpcs TEXT,
            cost DECIMAL(10,2) DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // Patients table
        `CREATE TABLE IF NOT EXISTS patients (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            mrn TEXT,
            month TEXT NOT NULL,
            facility_id INTEGER REFERENCES facilities(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // Tracking table
        `CREATE TABLE IF NOT EXISTS tracking (
            id SERIAL PRIMARY KEY,
            patient_id INTEGER REFERENCES patients(id) ON DELETE CASCADE,
            supply_id INTEGER REFERENCES supplies(id) ON DELETE CASCADE,
            day INTEGER NOT NULL CHECK(day >= 1 AND day <= 31),
            quantity INTEGER DEFAULT 0,
            month TEXT NOT NULL,
            wound_dx TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(patient_id, supply_id, day)
        )`
    ];

    try {
        for (const table of tables) {
            await pool.query(table);
        }
        console.log('✅ Database tables initialized');
        
        // Create default admin user and facilities
        await createDefaultData();
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
    }
}

// Create default data
async function createDefaultData() {
    try {
        // Create default facilities if none exist
        const facilitiesCount = await pool.query('SELECT COUNT(*) FROM facilities');
        if (parseInt(facilitiesCount.rows[0].count) === 0) {
            const defaultFacilities = [
                'Main Hospital',
                'North Clinic', 
                'South Medical Center',
                'East Outpatient'
            ];
            
            for (const facility of defaultFacilities) {
                await pool.query('INSERT INTO facilities (name) VALUES ($1)', [facility]);
            }
            console.log('✅ Default facilities created');
        }

        // Create default admin user if none exists, or ensure existing admin password is properly hashed
        const adminCount = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'admin'");
        if (parseInt(adminCount.rows[0].count) === 0) {
            const hashedPassword = await bcrypt.hash('admin123', 12);
            const firstFacility = await pool.query('SELECT id FROM facilities ORDER BY id LIMIT 1');
            
            await pool.query(
                'INSERT INTO users (name, email, password, role, facility_id, approved) VALUES ($1, $2, $3, $4, $5, $6)',
                ['Admin User', 'admin@hospital.com', hashedPassword, 'admin', firstFacility.rows[0].id, true]
            );
            console.log('✅ Default admin created: admin@hospital.com / admin123');
        } else {
            // Check if admin@system.com exists and update password if needed
            const systemAdmin = await pool.query("SELECT * FROM users WHERE email = 'admin@system.com' AND role = 'admin'");
            if (systemAdmin.rows.length > 0) {
                const user = systemAdmin.rows[0];
                // Test if password is properly hashed by trying to compare
                try {
                    const isValidHash = await bcrypt.compare('admin123', user.password);
                    if (!isValidHash) {
                        // Password might not be properly hashed, update it
                        const hashedPassword = await bcrypt.hash('admin123', 12);
                        await pool.query(
                            'UPDATE users SET password = $1 WHERE email = $2',
                            [hashedPassword, 'admin@system.com']
                        );
                        console.log('✅ Updated admin@system.com password hash');
                    }
                } catch (error) {
                    // Password definitely not properly hashed, update it
                    const hashedPassword = await bcrypt.hash('admin123', 12);
                    await pool.query(
                        'UPDATE users SET password = $1 WHERE email = $2',
                        [hashedPassword, 'admin@system.com']
                    );
                    console.log('✅ Fixed admin@system.com password hash');
                }
                console.log('✅ Existing admin found: admin@system.com / admin123');
            }
        }

        // Create default supplies if none exist
        const suppliesCount = await pool.query('SELECT COUNT(*) FROM supplies');
        if (parseInt(suppliesCount.rows[0].count) === 0) {
            const defaultSupplies = [
                { ar_code: 'AR001', description: 'Wound Cleanser', hcpcs: 'A6260', cost: 12.50 },
                { ar_code: 'AR002', description: 'Gauze Dressing 4x4', hcpcs: 'A6402', cost: 3.25 },
                { ar_code: 'AR003', description: 'Medical Tape', hcpcs: 'A4450', cost: 8.75 },
                { ar_code: 'AR004', description: 'Hydrogel Dressing', hcpcs: 'A6248', cost: 15.00 },
                { ar_code: 'AR005', description: 'Foam Dressing', hcpcs: 'A6209', cost: 22.50 }
            ];
            
            for (const supply of defaultSupplies) {
                await pool.query(
                    'INSERT INTO supplies (ar_code, description, hcpcs, cost) VALUES ($1, $2, $3, $4)',
                    [supply.ar_code, supply.description, supply.hcpcs, supply.cost]
                );
            }
            console.log('✅ Default supplies created');
        }
    } catch (error) {
        console.error('❌ Error creating default data:', error);
    }
}

// Authentication routes
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password required' });
        }

        const userResult = await pool.query(`
            SELECT u.*, f.name as facility_name 
            FROM users u 
            LEFT JOIN facilities f ON u.facility_id = f.id 
            WHERE u.email = $1
        `, [email]);

        if (userResult.rows.length === 0) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        const user = userResult.rows[0];

        if (!user.approved && user.role !== 'admin') {
            return res.status(401).json({ success: false, error: 'Account pending approval' });
        }

        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, facility_id: user.facility_id },
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
        res.status(500).json({ success: false, error: 'Login failed' });
    }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password, facility_id } = req.body;

        if (!name || !email || !password || !facility_id) {
            return res.status(400).json({ success: false, error: 'All fields required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
        }

        // Check if user already exists
        const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ success: false, error: 'User already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Create user
        const result = await pool.query(
            'INSERT INTO users (name, email, password, facility_id) VALUES ($1, $2, $3, $4) RETURNING id',
            [name, email, hashedPassword, facility_id]
        );

        res.status(201).json({ 
            success: true, 
            message: 'Registration successful. Please wait for admin approval.',
            userId: result.rows[0].id
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, error: 'Registration failed' });
    }
});

// Facilities routes - GET is public for registration, others require auth
app.get('/api/facilities', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM facilities ORDER BY name');
        res.json({ success: true, facilities: result.rows });
    } catch (error) {
        console.error('Get facilities error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch facilities' });
    }
});

app.post('/api/facilities', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, error: 'Facility name required' });
        }

        const result = await pool.query(
            'INSERT INTO facilities (name) VALUES ($1) RETURNING *',
            [name.trim()]
        );

        res.status(201).json({ success: true, facility: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') {
            res.status(400).json({ success: false, error: 'Facility already exists' });
        } else {
            console.error('Create facility error:', error);
            res.status(500).json({ success: false, error: 'Failed to create facility' });
        }
    }
});

app.put('/api/facilities/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;

        const result = await pool.query(
            'UPDATE facilities SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
            [name, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Facility not found' });
        }

        res.json({ success: true, facility: result.rows[0] });
    } catch (error) {
        console.error('Update facility error:', error);
        res.status(500).json({ success: false, error: 'Failed to update facility' });
    }
});

app.delete('/api/facilities/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query('DELETE FROM facilities WHERE id = $1 RETURNING *', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Facility not found' });
        }

        res.json({ success: true, message: 'Facility deleted successfully' });
    } catch (error) {
        console.error('Delete facility error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete facility' });
    }
});

// Supplies routes
app.get('/api/supplies', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM supplies ORDER BY ar_code');
        res.json({ success: true, supplies: result.rows });
    } catch (error) {
        console.error('Get supplies error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch supplies' });
    }
});

app.post('/api/supplies', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { ar_code, description, hcpcs, cost } = req.body;

        if (!ar_code || !description) {
            return res.status(400).json({ success: false, error: 'AR code and description required' });
        }

        const result = await pool.query(
            'INSERT INTO supplies (ar_code, description, hcpcs, cost) VALUES ($1, $2, $3, $4) RETURNING *',
            [ar_code, description, hcpcs || null, parseFloat(cost) || 0]
        );

        res.status(201).json({ success: true, supply: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') {
            res.status(400).json({ success: false, error: 'AR code already exists' });
        } else {
            console.error('Create supply error:', error);
            res.status(500).json({ success: false, error: 'Failed to create supply' });
        }
    }
});

app.put('/api/supplies/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { ar_code, description, hcpcs, cost } = req.body;

        const result = await pool.query(
            'UPDATE supplies SET ar_code = $1, description = $2, hcpcs = $3, cost = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *',
            [ar_code, description, hcpcs, parseFloat(cost) || 0, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Supply not found' });
        }

        res.json({ success: true, supply: result.rows[0] });
    } catch (error) {
        console.error('Update supply error:', error);
        res.status(500).json({ success: false, error: 'Failed to update supply' });
    }
});

app.delete('/api/supplies/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query('DELETE FROM supplies WHERE id = $1 RETURNING *', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Supply not found' });
        }

        res.json({ success: true, message: 'Supply deleted successfully' });
    } catch (error) {
        console.error('Delete supply error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete supply' });
    }
});

// Patients routes
app.get('/api/patients', authenticateToken, async (req, res) => {
    try {
        let query = `
            SELECT p.*, f.name as facility_name 
            FROM patients p 
            LEFT JOIN facilities f ON p.facility_id = f.id 
        `;
        let queryParams = [];

        // Non-admin users can only see patients from their facility
        if (req.user.role !== 'admin' && req.user.facility_id) {
            query += ' WHERE p.facility_id = $1';
            queryParams.push(req.user.facility_id);
        }

        query += ' ORDER BY p.created_at DESC';
        
        const result = await pool.query(query, queryParams);
        res.json({ success: true, patients: result.rows });
    } catch (error) {
        console.error('Get patients error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch patients' });
    }
});

app.post('/api/patients', authenticateToken, async (req, res) => {
    try {
        const { name, mrn, facility_id, month } = req.body;

        if (!name || !facility_id || !month) {
            return res.status(400).json({ success: false, error: 'Name, facility, and month required' });
        }

        // Non-admin users can only add patients to their facility
        const finalFacilityId = req.user.role === 'admin' ? facility_id : req.user.facility_id;

        const result = await pool.query(
            'INSERT INTO patients (name, mrn, facility_id, month) VALUES ($1, $2, $3, $4) RETURNING *',
            [name, mrn || null, finalFacilityId, month]
        );

        res.status(201).json({ success: true, patient: result.rows[0] });
    } catch (error) {
        console.error('Create patient error:', error);
        res.status(500).json({ success: false, error: 'Failed to create patient' });
    }
});

app.put('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, mrn } = req.body;

        const result = await pool.query(
            'UPDATE patients SET name = $1, mrn = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
            [name, mrn, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Patient not found' });
        }

        res.json({ success: true, patient: result.rows[0] });
    } catch (error) {
        console.error('Update patient error:', error);
        res.status(500).json({ success: false, error: 'Failed to update patient' });
    }
});

app.delete('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query('DELETE FROM patients WHERE id = $1 RETURNING *', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Patient not found' });
        }

        res.json({ success: true, message: 'Patient deleted successfully' });
    } catch (error) {
        console.error('Delete patient error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete patient' });
    }
});

// Users routes (admin only)
app.get('/api/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.*, f.name as facility_name 
            FROM users u 
            LEFT JOIN facilities f ON u.facility_id = f.id 
            ORDER BY u.created_at DESC
        `);
        res.json({ success: true, users: result.rows });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch users' });
    }
});

app.put('/api/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, role, facility_id, approved } = req.body;

        const result = await pool.query(
            'UPDATE users SET name = $1, email = $2, role = $3, facility_id = $4, approved = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6 RETURNING *',
            [name, email, role, facility_id, approved, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        res.json({ success: true, user: result.rows[0] });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ success: false, error: 'Failed to update user' });
    }
});

app.delete('/api/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Prevent deleting yourself
        if (parseInt(id) === req.user.id) {
            return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
        }
        
        const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        res.json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete user' });
    }
});

// Tracking routes
app.get('/api/tracking', authenticateToken, async (req, res) => {
    try {
        let query = 'SELECT * FROM tracking';
        let queryParams = [];

        // Non-admin users can only see tracking for patients from their facility
        if (req.user.role !== 'admin' && req.user.facility_id) {
            query = `
                SELECT t.* FROM tracking t
                JOIN patients p ON t.patient_id = p.id
                WHERE p.facility_id = $1
            `;
            queryParams.push(req.user.facility_id);
        }

        query += ' ORDER BY patient_id, supply_id, day';
        
        const result = await pool.query(query, queryParams);
        res.json({ success: true, tracking: result.rows });
    } catch (error) {
        console.error('Get tracking error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch tracking data' });
    }
});

app.post('/api/tracking', authenticateToken, async (req, res) => {
    try {
        const { patient_id, supply_id, day, quantity, month, wound_dx } = req.body;

        if (!patient_id || !supply_id || !day || !month) {
            return res.status(400).json({ success: false, error: 'Patient, supply, day, and month required' });
        }

        const result = await pool.query(`
            INSERT INTO tracking (patient_id, supply_id, day, quantity, month, wound_dx) 
            VALUES ($1, $2, $3, $4, $5, $6) 
            ON CONFLICT (patient_id, supply_id, day) 
            DO UPDATE SET quantity = $4, wound_dx = $6, updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `, [patient_id, supply_id, day, quantity || 0, month, wound_dx || null]);

        res.json({ success: true, tracking: result.rows[0] });
    } catch (error) {
        console.error('Save tracking error:', error);
        res.status(500).json({ success: false, error: 'Failed to save tracking data' });
    }
});

app.post('/api/tracking/wound-dx', authenticateToken, async (req, res) => {
    try {
        const { patient_id, supply_id, wound_dx } = req.body;

        await pool.query(
            'UPDATE tracking SET wound_dx = $1, updated_at = CURRENT_TIMESTAMP WHERE patient_id = $2 AND supply_id = $3',
            [wound_dx, patient_id, supply_id]
        );

        res.json({ success: true, message: 'Wound diagnosis saved' });
    } catch (error) {
        console.error('Save wound dx error:', error);
        res.status(500).json({ success: false, error: 'Failed to save wound diagnosis' });
    }
});

// Reports routes
app.get('/api/reports/itemized', authenticateToken, async (req, res) => {
    try {
        const { facility_id, month } = req.query;
        
        let query = `
            SELECT 
                p.name as patient_name,
                p.mrn,
                p.month,
                f.name as facility_name,
                s.ar_code,
                s.description,
                s.hcpcs,
                COALESCE(SUM(t.quantity), 0) as units,
                s.cost as unit_cost,
                COALESCE(SUM(t.quantity), 0) * COALESCE(s.cost, 0) as total_cost,
                MAX(t.wound_dx) as wound_dx
            FROM patients p
            LEFT JOIN facilities f ON p.facility_id = f.id
            LEFT JOIN tracking t ON p.id = t.patient_id
            LEFT JOIN supplies s ON t.supply_id = s.id
        `;
        
        let whereConditions = [];
        let queryParams = [];
        let paramIndex = 1;

        // Non-admin users can only see their facility data
        if (req.user.role !== 'admin' && req.user.facility_id) {
            whereConditions.push(`p.facility_id = $${paramIndex}`);
            queryParams.push(req.user.facility_id);
            paramIndex++;
        } else if (facility_id) {
            whereConditions.push(`p.facility_id = $${paramIndex}`);
            queryParams.push(facility_id);
            paramIndex++;
        }

        if (month) {
            whereConditions.push(`p.month = $${paramIndex}`);
            queryParams.push(month);
            paramIndex++;
        }

        if (whereConditions.length > 0) {
            query += ' WHERE ' + whereConditions.join(' AND ');
        }

        query += `
            GROUP BY p.id, p.name, p.mrn, p.month, f.name, s.id, s.ar_code, s.description, s.hcpcs, s.cost
            HAVING COALESCE(SUM(t.quantity), 0) > 0
            ORDER BY p.name, s.ar_code
        `;

        const result = await pool.query(query, queryParams);
        res.json({ success: true, report: result.rows });
    } catch (error) {
        console.error('Generate report error:', error);
        res.status(500).json({ success: false, error: 'Failed to generate report' });
    }
});

app.get('/api/reports/csv', authenticateToken, async (req, res) => {
    try {
        const { facility_id, month } = req.query;
        
        // Same query as itemized report
        let query = `
            SELECT 
                p.name as patient_name,
                p.mrn,
                p.month,
                f.name as facility_name,
                s.ar_code,
                s.description,
                s.hcpcs,
                COALESCE(SUM(t.quantity), 0) as units,
                s.cost as unit_cost,
                COALESCE(SUM(t.quantity), 0) * COALESCE(s.cost, 0) as total_cost,
                MAX(t.wound_dx) as wound_dx
            FROM patients p
            LEFT JOIN facilities f ON p.facility_id = f.id
            LEFT JOIN tracking t ON p.id = t.patient_id
            LEFT JOIN supplies s ON t.supply_id = s.id
        `;
        
        let whereConditions = [];
        let queryParams = [];
        let paramIndex = 1;

        if (req.user.role !== 'admin' && req.user.facility_id) {
            whereConditions.push(`p.facility_id = $${paramIndex}`);
            queryParams.push(req.user.facility_id);
            paramIndex++;
        } else if (facility_id) {
            whereConditions.push(`p.facility_id = $${paramIndex}`);
            queryParams.push(facility_id);
            paramIndex++;
        }

        if (month) {
            whereConditions.push(`p.month = $${paramIndex}`);
            queryParams.push(month);
            paramIndex++;
        }

        if (whereConditions.length > 0) {
            query += ' WHERE ' + whereConditions.join(' AND ');
        }

        query += `
            GROUP BY p.id, p.name, p.mrn, p.month, f.name, s.id, s.ar_code, s.description, s.hcpcs, s.cost
            HAVING COALESCE(SUM(t.quantity), 0) > 0
            ORDER BY p.name, s.ar_code
        `;

        const result = await pool.query(query, queryParams);
        
        // Generate CSV content
        let csvContent = 'Name,MRN,MM-YYYY,Facility,AR Code,Description,HCPCS,Units';
        
        // Add cost columns for admin users
        if (req.user.role === 'admin') {
            csvContent += ',Unit Cost,Total Cost';
        }
        
        csvContent += ',Wound Dx\n';
        
        result.rows.forEach(row => {
            const csvRow = [
                `"${row.patient_name || ''}"`,
                `"${row.mrn || ''}"`,
                `"${row.month || ''}"`,
                `"${row.facility_name || ''}"`,
                `"${row.ar_code || ''}"`,
                `"${row.description || ''}"`,
                `"${row.hcpcs || ''}"`,
                row.units || 0
            ];
            
            if (req.user.role === 'admin') {
                csvRow.push(
                    parseFloat(row.unit_cost || 0).toFixed(2),
                    parseFloat(row.total_cost || 0).toFixed(2)
                );
            }
            
            csvRow.push(`"${row.wound_dx || ''}"`);
            csvContent += csvRow.join(',') + '\n';
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="supply-report-${new Date().toISOString().split('T')[0]}.csv"`);
        res.send(csvContent);
    } catch (error) {
        console.error('CSV export error:', error);
        res.status(500).json({ success: false, error: 'Failed to export CSV' });
    }
});

// CSV batch upload for patients
app.post('/api/patients/batch-upload', authenticateToken, upload.single('csv'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No CSV file uploaded' });
        }

        const results = [];
        const errors = [];
        let imported = 0;

        // Read CSV file
        fs.createReadStream(req.file.path)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', async () => {
                try {
                    for (const row of results) {
                        try {
                            const { Name, MRN, Facility, Month } = row;
                            
                            if (!Name || !Facility || !Month) {
                                errors.push(`Row missing required fields: ${JSON.stringify(row)}`);
                                continue;
                            }

                            // Find facility by name
                            const facilityResult = await pool.query('SELECT id FROM facilities WHERE name ILIKE $1', [Facility]);
                            if (facilityResult.rows.length === 0) {
                                errors.push(`Facility not found: ${Facility}`);
                                continue;
                            }

                            const facility_id = facilityResult.rows[0].id;
                            
                            // Non-admin users can only add to their facility
                            const finalFacilityId = req.user.role === 'admin' ? facility_id : req.user.facility_id;

                            await pool.query(
                                'INSERT INTO patients (name, mrn, facility_id, month) VALUES ($1, $2, $3, $4)',
                                [Name, MRN || null, finalFacilityId, Month]
                            );
                            imported++;
                        } catch (error) {
                            errors.push(`Error processing row: ${error.message}`);
                        }
                    }

                    // Clean up uploaded file
                    fs.unlinkSync(req.file.path);

                    res.json({ 
                        success: true, 
                        imported,
                        errors: errors.length > 0 ? errors : null
                    });
                } catch (error) {
                    console.error('Batch upload processing error:', error);
                    res.status(500).json({ success: false, error: 'Failed to process CSV' });
                }
            });
    } catch (error) {
        console.error('Batch upload error:', error);
        res.status(500).json({ success: false, error: 'Failed to upload CSV' });
    }
});

// Serve static files from static directory
app.use(express.static(path.join(__dirname, 'static')));

// Catch all handler: send back index.html file for any non-API routes
app.get('*', (req, res) => {
    if (!req.url.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'static', 'index.html'));
    } else {
        res.status(404).json({ success: false, error: 'API endpoint not found' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Access at: https://terence-wound-care-tracker-0ee111d0e54a.herokuapp.com/`);
    console.log(`📋 Health check: /health`);
    console.log(`🔧 Debug status: /api/debug/status`);
    initializeDatabase();
});
