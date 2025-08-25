require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Trust proxy for Heroku
app.set('trust proxy', 1);

// Essential middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files from public directory
app.use(express.static('public'));

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// ===== AUTHENTICATION ROUTES =====

// Register new user
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password, facilityId } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters long' });
        }

        // Check if user already exists
        const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'User with this email already exists' });
        }

        // Hash password
        const saltRounds = 12;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Insert user
        const result = await pool.query(
            'INSERT INTO users (name, email, password, facility_id, is_approved) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, facility_id, is_approved',
            [name, email, hashedPassword, facilityId || null, false]
        );

        res.status(201).json({
            message: 'User registered successfully. Please wait for admin approval.',
            user: result.rows[0]
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Login user
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // Get user with facility name
        const result = await pool.query(`
            SELECT u.*, f.name as facility_name 
            FROM users u 
            LEFT JOIN facilities f ON u.facility_id = f.id 
            WHERE u.email = $1
        `, [email]);

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];

        if (!user.is_approved) {
            return res.status(401).json({ error: 'Account pending approval' });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate JWT token
        const token = jwt.sign(
            { 
                userId: user.id, 
                email: user.email, 
                role: user.role,
                facilityId: user.facility_id 
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Remove password from response
        delete user.password;

        res.json({
            message: 'Login successful',
            token,
            user
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Verify token
app.get('/api/auth/verify', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.*, f.name as facility_name 
            FROM users u 
            LEFT JOIN facilities f ON u.facility_id = f.id 
            WHERE u.id = $1
        `, [req.user.userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = result.rows[0];
        delete user.password;

        res.json({ user });
    } catch (error) {
        console.error('Token verification error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ===== FACILITY ROUTES =====

// Get all facilities (public for registration)
app.get('/api/facilities/public', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name FROM facilities ORDER BY name');
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching facilities:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get facilities (authenticated)
app.get('/api/facilities', authenticateToken, async (req, res) => {
    try {
        let query = 'SELECT * FROM facilities ORDER BY name';
        let params = [];

        // Non-admin users can only see their facility
        if (req.user.role !== 'admin' && req.user.facilityId) {
            query = 'SELECT * FROM facilities WHERE id = $1 ORDER BY name';
            params = [req.user.facilityId];
        }

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching facilities:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add facility (admin only)
app.post('/api/facilities', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Facility name is required' });
        }

        const result = await pool.query(
            'INSERT INTO facilities (name) VALUES ($1) RETURNING *',
            [name]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error adding facility:', error);
        if (error.code === '23505') {
            res.status(400).json({ error: 'Facility name already exists' });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// ===== SUPPLY ROUTES =====

// Get supplies
app.get('/api/supplies', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM supplies ORDER BY code');
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching supplies:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add supply (admin only)
app.post('/api/supplies', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { code, description, hcpcs, cost } = req.body;
        if (!code || !description) {
            return res.status(400).json({ error: 'Code and description are required' });
        }

        const result = await pool.query(
            'INSERT INTO supplies (code, description, hcpcs, cost, is_custom) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [code, description, hcpcs || null, cost || 0, true]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error adding supply:', error);
        if (error.code === '23505') {
            res.status(400).json({ error: 'Supply code already exists' });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// ===== PATIENT ROUTES =====

// Get patients
app.get('/api/patients', authenticateToken, async (req, res) => {
    try {
        let query = `
            SELECT p.*, f.name as facility_name 
            FROM patients p 
            LEFT JOIN facilities f ON p.facility_id = f.id 
        `;
        let params = [];

        // Non-admin users can only see patients from their facility
        if (req.user.role !== 'admin' && req.user.facilityId) {
            query += ' WHERE p.facility_id = $1';
            params = [req.user.facilityId];
        }

        query += ' ORDER BY p.name, p.month';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching patients:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add patient
app.post('/api/patients', authenticateToken, async (req, res) => {
    try {
        const { name, month, mrn, facilityId } = req.body;

        if (!name || !month || !facilityId) {
            return res.status(400).json({ error: 'Name, month, and facility are required' });
        }

        // Non-admin users can only add patients to their facility
        if (req.user.role !== 'admin' && req.user.facilityId !== parseInt(facilityId)) {
            return res.status(403).json({ error: 'Can only add patients to your facility' });
        }

        const result = await pool.query(
            'INSERT INTO patients (name, month, mrn, facility_id) VALUES ($1, $2, $3, $4) RETURNING *',
            [name, month, mrn || null, facilityId]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error adding patient:', error);
        if (error.code === '23505') {
            res.status(400).json({ error: 'Patient already exists for this month and facility' });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// ===== DASHBOARD ROUTES =====

// Get dashboard summary data
app.get('/api/dashboard/summary', authenticateToken, async (req, res) => {
    try {
        const { facilityId, month } = req.query;
        
        let whereConditions = [];
        let params = [];
        let paramCount = 0;

        // Non-admin users can only see their facility data
        if (req.user.role !== 'admin' && req.user.facilityId) {
            whereConditions.push(`p.facility_id = $${++paramCount}`);
            params.push(req.user.facilityId);
        } else if (facilityId && req.user.role === 'admin') {
            whereConditions.push(`p.facility_id = $${++paramCount}`);
            params.push(facilityId);
        }

        if (month) {
            whereConditions.push(`p.month = $${++paramCount}`);
            params.push(month);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        const query = `
            SELECT 
                p.id,
                p.name,
                p.mrn,
                p.month,
                p.facility_id,
                f.name as facility_name,
                p.created_at,
                p.updated_at,
                COALESCE(SUM(t.quantity), 0) as total_units,
                COALESCE(SUM(t.quantity * s.cost), 0) as total_cost,
                STRING_AGG(DISTINCT t.wound_dx, '; ') FILTER (WHERE t.wound_dx IS NOT NULL AND t.wound_dx != '') as wound_diagnoses,
                STRING_AGG(DISTINCT s.code::text, ', ') FILTER (WHERE t.quantity > 0) as supply_codes,
                STRING_AGG(DISTINCT s.hcpcs, ', ') FILTER (WHERE s.hcpcs IS NOT NULL AND t.quantity > 0) as hcpcs_codes
            FROM patients p
            LEFT JOIN facilities f ON p.facility_id = f.id
            LEFT JOIN tracking t ON p.id = t.patient_id
            LEFT JOIN supplies s ON t.supply_id = s.id
            ${whereClause}
            GROUP BY p.id, p.name, p.mrn, p.month, p.facility_id, f.name, p.created_at, p.updated_at
            ORDER BY p.name, p.month
        `;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching dashboard summary:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ===== REPORTS ROUTES =====

// Get itemized summary report data
app.get('/api/reports/itemized-summary', authenticateToken, async (req, res) => {
    try {
        const { facilityId, month } = req.query;
        
        let whereConditions = [];
        let params = [];
        let paramCount = 0;

        // Non-admin users can only see their facility data
        if (req.user.role !== 'admin' && req.user.facilityId) {
            whereConditions.push(`p.facility_id = $${++paramCount}`);
            params.push(req.user.facilityId);
        } else if (facilityId && req.user.role === 'admin') {
            whereConditions.push(`p.facility_id = $${++paramCount}`);
            params.push(facilityId);
        }

        if (month) {
            whereConditions.push(`p.month = $${++paramCount}`);
            params.push(month);
        }

        whereConditions.push('t.quantity > 0');

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : 'WHERE t.quantity > 0';

        const query = `
            SELECT 
                p.id as patient_id,
                p.name as patient_name,
                p.mrn,
                p.month,
                p.facility_id,
                f.name as facility_name,
                s.id as supply_id,
                s.code as ar_code,
                s.description as item_description,
                s.hcpcs,
                s.cost as unit_cost,
                SUM(t.quantity) as total_units,
                SUM(t.quantity * s.cost) as total_cost,
                STRING_AGG(DISTINCT t.wound_dx, '; ') FILTER (WHERE t.wound_dx IS NOT NULL AND t.wound_dx != '') as wound_dx,
                MAX(t.updated_at) as last_updated
            FROM patients p
            INNER JOIN facilities f ON p.facility_id = f.id
            INNER JOIN tracking t ON p.id = t.patient_id
            INNER JOIN supplies s ON t.supply_id = s.id
            ${whereClause}
            GROUP BY p.id, p.name, p.mrn, p.month, p.facility_id, f.name, s.id, s.code, s.description, s.hcpcs, s.cost
            HAVING SUM(t.quantity) > 0
            ORDER BY p.name, p.month, s.code
        `;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching itemized summary:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ===== TRACKING ROUTES =====

// Get tracking data
app.get('/api/tracking/:patientId', authenticateToken, async (req, res) => {
    try {
        const { patientId } = req.params;

        // Verify patient access
        let patientQuery = 'SELECT * FROM patients WHERE id = $1';
        let patientParams = [patientId];

        if (req.user.role !== 'admin' && req.user.facilityId) {
            patientQuery += ' AND facility_id = $2';
            patientParams.push(req.user.facilityId);
        }

        const patientResult = await pool.query(patientQuery, patientParams);
        if (patientResult.rows.length === 0) {
            return res.status(404).json({ error: 'Patient not found or access denied' });
        }

        const result = await pool.query(
            'SELECT * FROM tracking WHERE patient_id = $1 ORDER BY supply_id, day_of_month',
            [patientId]
        );

        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching tracking data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update tracking data
app.post('/api/tracking', authenticateToken, async (req, res) => {
    try {
        const { patientId, supplyId, dayOfMonth, quantity, woundDx } = req.body;

        if (!patientId || !supplyId || dayOfMonth === undefined) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Verify patient access
        let patientQuery = 'SELECT * FROM patients WHERE id = $1';
        let patientParams = [patientId];

        if (req.user.role !== 'admin' && req.user.facilityId) {
            patientQuery += ' AND facility_id = $2';
            patientParams.push(req.user.facilityId);
        }

        const patientResult = await pool.query(patientQuery, patientParams);
        if (patientResult.rows.length === 0) {
            return res.status(404).json({ error: 'Patient not found or access denied' });
        }

        if (woundDx !== undefined && woundDx !== null) {
            const existingTracking = await pool.query(
                'SELECT * FROM tracking WHERE patient_id = $1 AND supply_id = $2 LIMIT 1',
                [patientId, supplyId]
            );

            if (existingTracking.rows.length > 0) {
                await pool.query(
                    'UPDATE tracking SET wound_dx = $1, updated_at = CURRENT_TIMESTAMP WHERE patient_id = $2 AND supply_id = $3',
                    [woundDx.trim() || null, patientId, supplyId]
                );
            } else if (woundDx.trim()) {
                await pool.query(
                    'INSERT INTO tracking (patient_id, supply_id, day_of_month, quantity, wound_dx) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (patient_id, supply_id, day_of_month) DO UPDATE SET wound_dx = $5, updated_at = CURRENT_TIMESTAMP',
                    [patientId, supplyId, dayOfMonth || 1, 0, woundDx.trim()]
                );
            }
            
            return res.json({ message: 'Wound diagnosis updated successfully' });
        }

        const result = await pool.query(`
            INSERT INTO tracking (patient_id, supply_id, day_of_month, quantity)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (patient_id, supply_id, day_of_month)
            DO UPDATE SET quantity = $4, updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `, [parseInt(patientId), parseInt(supplyId), parseInt(dayOfMonth), parseInt(quantity) || 0]);

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating tracking data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ===== DEFAULT ROUTE =====

// Serve main application
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== ERROR HANDLING =====

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ===== START SERVER =====

app.listen(PORT, async () => {
    console.log(`🚀 Wound Care RT Supply Tracker Server running on port ${PORT}`);
    
    // Test database connection
    try {
        const result = await pool.query('SELECT NOW()');
        console.log('✅ Database connected:', result.rows[0].now);
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
    }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM signal received: closing HTTP server');
    await pool.end();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT signal received: closing HTTP server');
    await pool.end();
    process.exit(0);
});
