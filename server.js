require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
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

// Serve static files from current directory
app.use(express.static('.'));

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

// Update facility (admin only)
app.put('/api/facilities/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const facilityId = parseInt(req.params.id);
        const { name } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Facility name is required' });
        }

        const result = await pool.query(
            'UPDATE facilities SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
            [name, facilityId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Facility not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating facility:', error);
        if (error.code === '23505') {
            res.status(400).json({ error: 'Facility name already exists' });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// Delete facility (admin only)
app.delete('/api/facilities/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const facilityId = parseInt(req.params.id);

        // Check if facility has patients
        const patientCheck = await pool.query(
            'SELECT COUNT(*) FROM patients WHERE facility_id = $1',
            [facilityId]
        );

        if (parseInt(patientCheck.rows[0].count) > 0) {
            return res.status(400).json({ 
                error: 'Cannot delete facility - it has patients assigned' 
            });
        }

        const result = await pool.query(
            'DELETE FROM facilities WHERE id = $1 RETURNING *',
            [facilityId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Facility not found' });
        }

        res.json({ message: 'Facility deleted successfully' });
    } catch (error) {
        console.error('Error deleting facility:', error);
        res.status(500).json({ error: 'Internal server error' });
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

// Update supply (admin only)
app.put('/api/supplies/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const supplyId = parseInt(req.params.id);
        const { code, description, hcpcs, cost } = req.body;

        if (!code || !description) {
            return res.status(400).json({ error: 'Code and description are required' });
        }

        const result = await pool.query(
            'UPDATE supplies SET code = $1, description = $2, hcpcs = $3, cost = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *',
            [parseInt(code), description, hcpcs || null, parseFloat(cost) || 0, supplyId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Supply not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating supply:', error);
        if (error.code === '23505') {
            res.status(400).json({ error: 'Supply code already exists' });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// Delete supply (admin only)
app.delete('/api/supplies/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const supplyId = parseInt(req.params.id);

        // Check if supply is being used in tracking
        const trackingCheck = await pool.query(
            'SELECT COUNT(*) FROM tracking WHERE supply_id = $1',
            [supplyId]
        );

        if (parseInt(trackingCheck.rows[0].count) > 0) {
            return res.status(400).json({ 
                error: 'Cannot delete supply - it is being used in patient tracking records' 
            });
        }

        const result = await pool.query(
            'DELETE FROM supplies WHERE id = $1 RETURNING *',
            [supplyId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Supply not found' });
        }

        res.json({ message: 'Supply deleted successfully' });
    } catch (error) {
        console.error('Error deleting supply:', error);
        res.status(500).json({ error: 'Internal server error' });
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

// Update patient
app.put('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
        const patientId = parseInt(req.params.id);
        const { name, mrn } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Patient name is required' });
        }

        // Verify patient access (non-admin users can only edit patients from their facility)
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
            'UPDATE patients SET name = $1, mrn = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
            [name, mrn, patientId]
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating patient:', error);
        if (error.code === '23505') {
            res.status(400).json({ error: 'A patient with this name already exists for this month and facility' });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// Delete patient
app.delete('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
        const patientId = parseInt(req.params.id);

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

        // Delete patient (cascade will delete tracking data)
        const result = await pool.query(
            'DELETE FROM patients WHERE id = $1 RETURNING *',
            [patientId]
        );

        res.json({ message: 'Patient deleted successfully' });
    } catch (error) {
        console.error('Error deleting patient:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ===== USER MANAGEMENT ROUTES =====

// Get users (admin only)
app.get('/api/users', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const result = await pool.query(`
            SELECT u.*, f.name as facility_name 
            FROM users u 
            LEFT JOIN facilities f ON u.facility_id = f.id 
            ORDER BY u.created_at DESC
        `);

        // Remove passwords from response
        const users = result.rows.map(user => {
            delete user.password;
            return user;
        });

        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update user approval (admin only)
app.put('/api/users/:id/approval', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const userId = parseInt(req.params.id);
        const { isApproved } = req.body;

        const result = await pool.query(
            'UPDATE users SET is_approved = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, name, email, is_approved',
            [isApproved, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating user approval:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete user (admin only)
app.delete('/api/users/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const userId = parseInt(req.params.id);

        // Prevent deletion of self
        if (userId === req.user.userId) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }

        const result = await pool.query(
            'DELETE FROM users WHERE id = $1 AND role != $2 RETURNING *',
            [userId, 'admin']
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found or cannot delete admin user' });
        }

        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Internal server error' });
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

// ===== DATABASE INITIALIZATION =====

async function initializeDatabase() {
    try {
        console.log('🔧 Initializing database...');

        // Create tables
        await pool.query(`
            -- Create facilities table
            CREATE TABLE IF NOT EXISTS facilities (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            -- Create supplies table
            CREATE TABLE IF NOT EXISTS supplies (
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
            );

            -- Create patients table
            CREATE TABLE IF NOT EXISTS patients (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                month VARCHAR(7) NOT NULL,
                mrn VARCHAR(50),
                facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(name, month, facility_id)
            );

            -- Create tracking table
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
            );
        `);

        // Create indexes
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            CREATE INDEX IF NOT EXISTS idx_users_facility ON users(facility_id);
            CREATE INDEX IF NOT EXISTS idx_patients_facility ON patients(facility_id);
            CREATE INDEX IF NOT EXISTS idx_patients_month ON patients(month);
            CREATE INDEX IF NOT EXISTS idx_tracking_patient ON tracking(patient_id);
            CREATE INDEX IF NOT EXISTS idx_tracking_supply ON tracking(supply_id);
            CREATE INDEX IF NOT EXISTS idx_supplies_code ON supplies(code);
        `);

        // Insert default data
        await pool.query(`
            INSERT INTO facilities (name) VALUES 
                ('Main Hospital'),
                ('Clinic North'),
                ('Clinic South'),
                ('Outpatient Center')
            ON CONFLICT (name) DO NOTHING;
        `);

        // Insert comprehensive supplies
        const supplies = [
            { code: 700, description: 'Foam Dressing 4x4', hcpcs: 'A6209', cost: 5.50 },
            { code: 701, description: 'Hydrocolloid Dressing 6x6', hcpcs: 'A6234', cost: 8.75 },
            { code: 702, description: 'Alginate Dressing 2x2', hcpcs: 'A6196', cost: 12.25 },
            { code: 703, description: 'Transparent Film 4x4.75', hcpcs: 'A6257', cost: 3.20 },
            { code: 704, description: 'Antimicrobial Dressing 4x5', hcpcs: 'A6251', cost: 15.80 },
            { code: 705, description: 'Collagen Dressing 4x4', hcpcs: 'A6021', cost: 22.50 },
            { code: 706, description: 'Silicone Foam Border 6x6', hcpcs: 'A6212', cost: 18.90 },
            { code: 707, description: 'Gauze Pad Sterile 4x4', hcpcs: 'A6402', cost: 0.85 },
            { code: 708, description: 'Calcium Alginate 4x4', hcpcs: 'A6196', cost: 14.20 },
            { code: 709, description: 'Hydrogel Sheet 4x4', hcpcs: 'A6242', cost: 9.80 },
            { code: 710, description: 'Composite Dressing 4x4', hcpcs: 'A6203', cost: 7.45 },
            { code: 711, description: 'Zinc Paste Bandage 3x10', hcpcs: 'A6456', cost: 6.30 },
            { code: 712, description: 'Foam Dressing with Border 6x6', hcpcs: 'A6212', cost: 11.95 },
            { code: 713, description: 'Transparent Film 6x7', hcpcs: 'A6258', cost: 4.75 },
            { code: 714, description: 'Alginate Rope 12 inch', hcpcs: 'A6199', cost: 18.50 }
        ];

        for (const supply of supplies) {
            await pool.query(
                'INSERT INTO supplies (code, description, hcpcs, cost, is_custom) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (code) DO NOTHING',
                [supply.code, supply.description, supply.hcpcs, supply.cost, false]
            );
        }

        // Create admin user
        const hashedAdminPassword = await bcrypt.hash('admin123', 12);
        await pool.query(`
            INSERT INTO users (name, email, password, role, is_approved) VALUES 
                ('System Administrator', 'admin@system.com', $1, 'admin', true)
            ON CONFLICT (email) DO NOTHING
        `, [hashedAdminPassword]);

        // Create demo user
        const hashedUserPassword = await bcrypt.hash('user123', 12);
        await pool.query(`
            INSERT INTO users (name, email, password, role, facility_id, is_approved) VALUES 
                ('Demo User', 'user@demo.com', $1, 'user', 1, true)
            ON CONFLICT (email) DO NOTHING
        `, [hashedUserPassword]);

        // Insert sample patients
        await pool.query(`
            INSERT INTO patients (name, month, mrn, facility_id) VALUES 
                ('Smith, John', '2024-12', 'MRN12345', 1),
                ('Johnson, Mary', '2024-12', 'MRN67890', 1),
                ('Brown, Robert', '2024-12', 'MRN11111', 2),
                ('Davis, Jennifer', '2024-12', 'MRN22222', 1)
            ON CONFLICT (name, month, facility_id) DO NOTHING
        `);

        // Insert sample tracking data
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

        console.log('✅ Database initialized successfully');
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        throw error;
    }
}

// ===== DEFAULT ROUTE =====

// Serve main application
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ===== ERROR HANDLING =====

// 404 handler
app.use((req, res) => {
    if (req.url.startsWith('/api')) {
        res.status(404).json({ error: 'API endpoint not found' });
    } else {
        res.sendFile(path.join(__dirname, 'index.html'));
    }
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ===== START SERVER =====

async function startServer() {
    try {
        await initializeDatabase();
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Wound Care RT Supply Tracker Server running on port ${PORT}`);
            console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🔗 URL: ${process.env.NODE_ENV === 'production' ? 'https://your-app.herokuapp.com' : `http://localhost:${PORT}`}`);
            console.log('🔑 Default Login Credentials:');
            console.log('   👑 Admin: admin@system.com / admin123');
            console.log('   👤 User:  user@demo.com / user123');
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

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

startServer();
