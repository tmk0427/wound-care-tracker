const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('Error connecting to database:', err);
    } else {
        console.log('✅ Connected to PostgreSQL database');
        release();
    }
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token.' });
        }
        req.user = user;
        next();
    });
};

// Admin middleware
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
};

// Routes

// Auth routes
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password, facilityId } = req.body;

        if (!name || !email || !password || !facilityId) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await pool.query(
            'INSERT INTO users (name, email, password, facility_id, is_approved) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [name, email, hashedPassword, facilityId, false]
        );

        res.json({ 
            message: 'Registration successful. Please wait for admin approval.',
            userId: result.rows[0].id 
        });
    } catch (error) {
        console.error('Registration error:', error);
        if (error.code === '23505') { // Unique constraint violation
            return res.status(400).json({ error: 'Email already exists' });
        }
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const result = await pool.query(
            `SELECT u.*, f.name as facility_name 
             FROM users u 
             LEFT JOIN facilities f ON u.facility_id = f.id 
             WHERE u.email = $1`,
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = result.rows[0];

        if (!(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        if (!user.is_approved) {
            return res.status(401).json({ error: 'Account not approved. Please contact an administrator.' });
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

        const userResponse = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            facilityId: user.facility_id,
            facilityName: user.facility_name
        };

        res.json({ token, user: userResponse });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/auth/verify', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
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
            facilityId: user.facility_id,
            facilityName: user.facility_name
        };

        res.json({ user: userResponse });
    } catch (error) {
        console.error('Auth verify error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Facilities routes
app.get('/api/facilities/public', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name FROM facilities ORDER BY name');
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching public facilities:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/facilities', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM facilities ORDER BY name');
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching facilities:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/facilities', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Facility name is required' });
        }

        const result = await pool.query(
            'INSERT INTO facilities (name) VALUES ($1) RETURNING *',
            [name]
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error creating facility:', error);
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Facility name already exists' });
        }
        res.status(500).json({ error: 'Database error' });
    }
});

app.put('/api/facilities/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        const facilityId = req.params.id;

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

        res.json({ message: 'Facility updated successfully' });
    } catch (error) {
        console.error('Error updating facility:', error);
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Facility name already exists' });
        }
        res.status(500).json({ error: 'Database error' });
    }
});

app.delete('/api/facilities/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const facilityId = req.params.id;

        const result = await pool.query('DELETE FROM facilities WHERE id = $1', [facilityId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Facility not found' });
        }

        res.json({ message: 'Facility deleted successfully' });
    } catch (error) {
        console.error('Error deleting facility:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Supplies routes
app.get('/api/supplies', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM supplies ORDER BY code');
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching supplies:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/supplies', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { code, description, hcpcs, cost } = req.body;
        
        if (!code || !description) {
            return res.status(400).json({ error: 'Code and description are required' });
        }

        const result = await pool.query(
            'INSERT INTO supplies (code, description, hcpcs, cost, is_custom) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [code, description, hcpcs || null, cost || 0, true]
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error creating supply:', error);
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Supply code already exists' });
        }
        res.status(500).json({ error: 'Database error' });
    }
});

app.put('/api/supplies/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { code, description, hcpcs, cost } = req.body;
        const supplyId = req.params.id;

        if (!code || !description) {
            return res.status(400).json({ error: 'Code and description are required' });
        }

        const result = await pool.query(
            'UPDATE supplies SET code = $1, description = $2, hcpcs = $3, cost = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *',
            [code, description, hcpcs || null, cost || 0, supplyId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Supply not found' });
        }

        res.json({ message: 'Supply updated successfully' });
    } catch (error) {
        console.error('Error updating supply:', error);
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Supply code already exists' });
        }
        res.status(500).json({ error: 'Database error' });
    }
});

app.delete('/api/supplies/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const supplyId = req.params.id;

        const result = await pool.query('DELETE FROM supplies WHERE id = $1', [supplyId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Supply not found' });
        }

        res.json({ message: 'Supply deleted successfully' });
    } catch (error) {
        console.error('Error deleting supply:', error);
        res.status(500).json({ error: 'Database error' });
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
        let params = [];

        // Filter by facility if user is not admin
        if (req.user.role !== 'admin' && req.user.facilityId) {
            query += ' WHERE p.facility_id = $1';
            params.push(req.user.facilityId);
        }

        query += ' ORDER BY p.created_at DESC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching patients:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/patients', authenticateToken, async (req, res) => {
    try {
        const { name, mrn, month, facilityId } = req.body;
        
        if (!name || !month || !facilityId) {
            return res.status(400).json({ error: 'Name, month, and facility are required' });
        }

        // Check if user has permission to add to this facility
        if (req.user.role !== 'admin' && req.user.facilityId !== facilityId) {
            return res.status(403).json({ error: 'Access denied for this facility' });
        }

        const result = await pool.query(
            'INSERT INTO patients (name, mrn, month, facility_id) VALUES ($1, $2, $3, $4) RETURNING *',
            [name, mrn || null, month, facilityId]
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error creating patient:', error);
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Patient already exists for this month and facility' });
        }
        res.status(500).json({ error: 'Database error' });
    }
});

app.put('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
        const { name, mrn } = req.body;
        const patientId = req.params.id;

        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }

        // First check if patient exists and user has permission
        const patientCheck = await pool.query('SELECT * FROM patients WHERE id = $1', [patientId]);
        
        if (patientCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        const patient = patientCheck.rows[0];

        // Check permission
        if (req.user.role !== 'admin' && req.user.facilityId !== patient.facility_id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Update patient
        await pool.query(
            'UPDATE patients SET name = $1, mrn = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
            [name, mrn || null, patientId]
        );

        res.json({ message: 'Patient updated successfully' });
    } catch (error) {
        console.error('Error updating patient:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.delete('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
        const patientId = req.params.id;

        // First check if patient exists and user has permission
        const patientCheck = await pool.query('SELECT * FROM patients WHERE id = $1', [patientId]);
        
        if (patientCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        const patient = patientCheck.rows[0];

        // Check permission
        if (req.user.role !== 'admin' && req.user.facilityId !== patient.facility_id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Delete patient (cascade will handle tracking data)
        await pool.query('DELETE FROM patients WHERE id = $1', [patientId]);
        res.json({ message: 'Patient deleted successfully' });
    } catch (error) {
        console.error('Error deleting patient:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Supply tracking routes
app.get('/api/tracking/:patientId', authenticateToken, async (req, res) => {
    try {
        const patientId = req.params.patientId;

        // First check if user has permission to view this patient
        const patientCheck = await pool.query('SELECT * FROM patients WHERE id = $1', [patientId]);
        
        if (patientCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        const patient = patientCheck.rows[0];

        // Check permission
        if (req.user.role !== 'admin' && req.user.facilityId !== patient.facility_id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Get tracking data including wound_dx
        const result = await pool.query(
            'SELECT * FROM tracking WHERE patient_id = $1 ORDER BY supply_id, day_of_month',
            [patientId]
        );

        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching tracking data:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/tracking', authenticateToken, async (req, res) => {
    try {
        const { patientId, supplyId, dayOfMonth, quantity, woundDx } = req.body;

        if (!patientId || !supplyId || !dayOfMonth) {
            return res.status(400).json({ error: 'Patient ID, supply ID, and day are required' });
        }

        // First check if user has permission
        const patientCheck = await pool.query('SELECT * FROM patients WHERE id = $1', [patientId]);
        
        if (patientCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        const patient = patientCheck.rows[0];

        // Check permission
        if (req.user.role !== 'admin' && req.user.facilityId !== patient.facility_id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Upsert tracking data with wound_dx support
        await pool.query(
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

        res.json({ message: 'Tracking data updated successfully' });
    } catch (error) {
        console.error('Error updating tracking data:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Dashboard routes
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
                STRING_AGG(DISTINCT t.wound_dx, '; ') FILTER (WHERE t.wound_dx IS NOT NULL AND t.wound_dx != '') as wound_diagnoses,
                STRING_AGG(DISTINCT s.code::text, ',') as supply_codes,
                STRING_AGG(DISTINCT s.hcpcs, ',') FILTER (WHERE s.hcpcs IS NOT NULL AND s.hcpcs != '') as hcpcs_codes
            FROM patients p
            LEFT JOIN facilities f ON p.facility_id = f.id
            LEFT JOIN tracking t ON p.id = t.patient_id
            LEFT JOIN supplies s ON t.supply_id = s.id
            WHERE 1=1
        `;
        
        const params = [];
        let paramCount = 0;
        
        // Apply filters
        if (req.user.role !== 'admin' && req.user.facilityId) {
            paramCount++;
            query += ` AND p.facility_id = ${paramCount}`;
            params.push(req.user.facilityId);
        } else if (facilityId) {
            paramCount++;
            query += ` AND p.facility_id = ${paramCount}`;
            params.push(facilityId);
        }
        
        if (month) {
            paramCount++;
            query += ` AND p.month = ${paramCount}`;
            params.push(month);
        }
        
        query += ' GROUP BY p.id, f.name ORDER BY p.created_at DESC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching dashboard summary:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Reports routes
app.get('/api/reports/itemized-summary', authenticateToken, async (req, res) => {
    try {
        const { facilityId, month } = req.query;
        
        let query = `
            SELECT 
                p.name as patient_name,
                p.mrn,
                f.name as facility_name,
                s.code as ar_code,
                s.description as item_description,
                s.hcpcs,
                SUM(t.quantity) as total_units,
                s.cost as unit_cost,
                SUM(t.quantity * s.cost) as total_cost,
                t.wound_dx
            FROM patients p
            JOIN tracking t ON p.id = t.patient_id
            JOIN supplies s ON t.supply_id = s.id
            LEFT JOIN facilities f ON p.facility_id = f.id
            WHERE t.quantity > 0
        `;
        
        const params = [];
        let paramCount = 0;
        
        // Apply filters
        if (req.user.role !== 'admin' && req.user.facilityId) {
            paramCount++;
            query += ` AND p.facility_id = ${paramCount}`;
            params.push(req.user.facilityId);
        } else if (facilityId) {
            paramCount++;
            query += ` AND p.facility_id = ${paramCount}`;
            params.push(facilityId);
        }
        
        if (month) {
            paramCount++;
            query += ` AND p.month = ${paramCount}`;
            params.push(month);
        }
        
        query += ' GROUP BY p.id, s.id, p.name, p.mrn, f.name, s.code, s.description, s.hcpcs, s.cost, t.wound_dx ORDER BY p.name, s.code';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching itemized summary:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Users management routes (admin only)
app.get('/api/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.id, u.name, u.email, u.role, u.facility_id, u.is_approved, u.created_at, u.updated_at, f.name as facility_name 
             FROM users u 
             LEFT JOIN facilities f ON u.facility_id = f.id 
             ORDER BY u.created_at DESC`
        );
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.put('/api/users/:id/approval', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { isApproved } = req.body;
        const userId = req.params.id;

        const result = await pool.query(
            'UPDATE users SET is_approved = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [isApproved, userId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ message: 'User approval status updated successfully' });
    } catch (error) {
        console.error('Error updating user approval:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.delete('/api/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;

        // Prevent deleting yourself
        if (parseInt(userId) === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }

        const result = await pool.query('DELETE FROM users WHERE id = $1', [userId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    pool.end(() => {
        console.log('Database connection pool closed.');
        process.exit(0);
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🏥 Wound Care RT Supply Tracker running on port ${PORT}`);
    console.log(`🌐 Server URL: http://localhost:${PORT}`);
    console.log(`👤 Login credentials available in your migration data`);
    console.log(`📋 Connected to existing PostgreSQL database`);
});

module.exports = app;
