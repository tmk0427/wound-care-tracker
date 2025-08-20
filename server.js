const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Initialize database on startup
async function initializeDatabase() {
    try {
        // Check if tables exist, if not run migration
        const tablesExist = await pool.query(`
            SELECT COUNT(*) FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name IN ('users', 'facilities', 'supplies', 'patients', 'tracking')
        `);
        
        if (parseInt(tablesExist.rows[0].count) < 5) {
            console.log('🔧 Database tables missing, running initialization...');
            const { runMigration } = require('./migrate');
            await runMigration();
        } else {
            console.log('✅ Database tables verified');
        }
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        // Don't exit, let the app start anyway
    }
}

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

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});

// Middleware
app.use(limiter);
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

// Static files - serve index.html from root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Static files
app.use(express.static('.'));

// Multer for file uploads
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Authentication middleware
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
        
        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        req.user = userResult.rows[0];
        next();
    } catch (error) {
        console.error('Token verification failed:', error);
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// Admin middleware
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// ==================== AUTH ROUTES ====================

// Register
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
        const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'User already exists with this email' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert user
        const result = await pool.query(
            'INSERT INTO users (name, email, password, facility_id, is_approved) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email',
            [name, email, hashedPassword, facilityId || null, false]
        );

        res.status(201).json({
            message: 'Registration successful! Please wait for admin approval.',
            user: result.rows[0]
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // Find user with facility info
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

        // Check password
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Remove password from response
        delete user.password;

        res.json({
            token,
            user: user
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
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
        `, [req.user.id]);

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }

        const user = result.rows[0];
        delete user.password;

        res.json({ user });
    } catch (error) {
        console.error('Token verification error:', error);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// Change password
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters long' });
        }

        // Verify current password
        const userResult = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
        const isValidPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password);
        
        if (!isValidPassword) {
            return res.status(400).json({ error: 'Current password is incorrect' });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        await pool.query('UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [hashedPassword, req.user.id]);

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: 'Failed to change password' });
    }
});

// ==================== FACILITIES ROUTES ====================

// Get facilities (public for registration)
app.get('/api/facilities/public', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name FROM facilities ORDER BY name');
        res.json(result.rows);
    } catch (error) {
        console.error('Get public facilities error:', error);
        res.status(500).json({ error: 'Failed to fetch facilities' });
    }
});

// Get facilities (authenticated)
app.get('/api/facilities', authenticateToken, async (req, res) => {
    try {
        let query = 'SELECT * FROM facilities ORDER BY name';
        let queryParams = [];

        // If user is not admin, filter by their facility
        if (req.user.role !== 'admin' && req.user.facility_id) {
            query = 'SELECT * FROM facilities WHERE id = $1 ORDER BY name';
            queryParams = [req.user.facility_id];
        }

        const result = await pool.query(query, queryParams);
        res.json(result.rows);
    } catch (error) {
        console.error('Get facilities error:', error);
        res.status(500).json({ error: 'Failed to fetch facilities' });
    }
});

// Create facility (admin only)
app.post('/api/facilities', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Facility name is required' });
        }

        const result = await pool.query(
            'INSERT INTO facilities (name) VALUES ($1) RETURNING *',
            [name.trim()]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') { // Unique constraint violation
            res.status(400).json({ error: 'Facility with this name already exists' });
        } else {
            console.error('Create facility error:', error);
            res.status(500).json({ error: 'Failed to create facility' });
        }
    }
});

// Delete facility (admin only)
app.delete('/api/facilities/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Check if facility has patients
        const patientCheck = await pool.query('SELECT COUNT(*) FROM patients WHERE facility_id = $1', [id]);
        if (parseInt(patientCheck.rows[0].count) > 0) {
            return res.status(400).json({ error: 'Cannot delete facility with existing patients' });
        }

        const result = await pool.query('DELETE FROM facilities WHERE id = $1 RETURNING *', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Facility not found' });
        }

        res.json({ message: 'Facility deleted successfully' });
    } catch (error) {
        console.error('Delete facility error:', error);
        res.status(500).json({ error: 'Failed to delete facility' });
    }
});

// ==================== SUPPLIES ROUTES ====================

// Get supplies
app.get('/api/supplies', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM supplies ORDER BY code');
        res.json(result.rows);
    } catch (error) {
        console.error('Get supplies error:', error);
        res.status(500).json({ error: 'Failed to fetch supplies' });
    }
});

// Create supply (admin only)
app.post('/api/supplies', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { code, description, hcpcs, cost, is_custom } = req.body;

        if (!code || !description) {
            return res.status(400).json({ error: 'Code and description are required' });
        }

        const result = await pool.query(
            'INSERT INTO supplies (code, description, hcpcs, cost, is_custom) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [code, description, hcpcs || null, cost || 0, is_custom !== undefined ? is_custom : true]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') { // Unique constraint violation
            res.status(400).json({ error: 'Supply with this code already exists' });
        } else {
            console.error('Create supply error:', error);
            res.status(500).json({ error: 'Failed to create supply' });
        }
    }
});

// Update supply (admin only)
app.put('/api/supplies/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { hcpcs, cost } = req.body;

        const result = await pool.query(
            'UPDATE supplies SET hcpcs = $1, cost = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
            [hcpcs, cost || 0, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Supply not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Update supply error:', error);
        res.status(500).json({ error: 'Failed to update supply' });
    }
});

// Delete supply (admin only)
app.delete('/api/supplies/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query('DELETE FROM supplies WHERE id = $1 RETURNING *', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Supply not found' });
        }

        res.json({ message: 'Supply deleted successfully' });
    } catch (error) {
        console.error('Delete supply error:', error);
        res.status(500).json({ error: 'Failed to delete supply' });
    }
});

// ==================== PATIENTS ROUTES ====================

// Get patients
app.get('/api/patients', authenticateToken, async (req, res) => {
    try {
        let query = `
            SELECT p.*, f.name as facility_name 
            FROM patients p 
            LEFT JOIN facilities f ON p.facility_id = f.id
        `;
        let queryParams = [];

        // If user is not admin, filter by their facility
        if (req.user.role !== 'admin' && req.user.facility_id) {
            query += ' WHERE p.facility_id = $1';
            queryParams = [req.user.facility_id];
        }

        query += ' ORDER BY p.name';

        const result = await pool.query(query, queryParams);
        res.json(result.rows);
    } catch (error) {
        console.error('Get patients error:', error);
        res.status(500).json({ error: 'Failed to fetch patients' });
    }
});

// Create patient
app.post('/api/patients', authenticateToken, async (req, res) => {
    try {
        const { name, month, mrn, facilityId } = req.body;

        if (!name || !month || !facilityId) {
            return res.status(400).json({ error: 'Name, month, and facility are required' });
        }

        // Verify user has access to this facility
        if (req.user.role !== 'admin' && req.user.facility_id !== parseInt(facilityId)) {
            return res.status(403).json({ error: 'Access denied to this facility' });
        }

        const result = await pool.query(
            'INSERT INTO patients (name, month, mrn, facility_id) VALUES ($1, $2, $3, $4) RETURNING *',
            [name, month, mrn || null, facilityId]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Create patient error:', error);
        res.status(500).json({ error: 'Failed to create patient' });
    }
});

// Update patient - FIXED: Added missing route
app.put('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, month, mrn, facilityId } = req.body;

        if (!name || !month || !facilityId) {
            return res.status(400).json({ error: 'Name, month, and facility are required' });
        }

        // Check if user has access to this patient
        if (req.user.role !== 'admin') {
            const patientCheck = await pool.query('SELECT facility_id FROM patients WHERE id = $1', [id]);
            if (patientCheck.rows.length === 0 || patientCheck.rows[0].facility_id !== req.user.facility_id) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        // Verify user has access to the new facility
        if (req.user.role !== 'admin' && req.user.facility_id !== parseInt(facilityId)) {
            return res.status(403).json({ error: 'Access denied to this facility' });
        }

        const result = await pool.query(
            'UPDATE patients SET name = $1, month = $2, mrn = $3, facility_id = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *',
            [name, month, mrn || null, facilityId, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Update patient error:', error);
        res.status(500).json({ error: 'Failed to update patient' });
    }
});

// Delete patient
app.delete('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Check if user has access to this patient
        if (req.user.role !== 'admin') {
            const patientCheck = await pool.query('SELECT facility_id FROM patients WHERE id = $1', [id]);
            if (patientCheck.rows.length === 0 || patientCheck.rows[0].facility_id !== req.user.facility_id) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        const result = await pool.query('DELETE FROM patients WHERE id = $1 RETURNING *', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        res.json({ message: 'Patient deleted successfully' });
    } catch (error) {
        console.error('Delete patient error:', error);
        res.status(500).json({ error: 'Failed to delete patient' });
    }
});

// Excel import
app.post('/api/patients/import-excel', authenticateToken, upload.single('excelFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);

        const results = { success: [], errors: [] };

        // Get facilities for validation
        const facilitiesResult = await pool.query('SELECT id, name FROM facilities');
        const facilitiesMap = {};
        facilitiesResult.rows.forEach(f => {
            facilitiesMap[f.name.toLowerCase()] = f.id;
        });

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            try {
                const name = row.Name || row.name;
                const month = row.Month || row.month;
                const mrn = row.MRN || row.mrn || '';
                const facilityName = row.Facility || row.facility;

                if (!name || !month || !facilityName) {
                    results.errors.push(`Row ${i + 2}: Missing required fields (Name, Month, Facility)`);
                    continue;
                }

                const facilityId = facilitiesMap[facilityName.toLowerCase()];
                if (!facilityId) {
                    results.errors.push(`Row ${i + 2}: Facility "${facilityName}" not found`);
                    continue;
                }

                // Check facility access for non-admin users
                if (req.user.role !== 'admin' && req.user.facility_id !== facilityId) {
                    results.errors.push(`Row ${i + 2}: Access denied to facility "${facilityName}"`);
                    continue;
                }

                await pool.query(
                    'INSERT INTO patients (name, month, mrn, facility_id) VALUES ($1, $2, $3, $4)',
                    [name, month, mrn, facilityId]
                );

                results.success.push(`${name} (${month}) added successfully`);
            } catch (error) {
                results.errors.push(`Row ${i + 2}: ${error.message}`);
            }
        }

        res.json({
            message: `Import completed: ${results.success.length} successful, ${results.errors.length} errors`,
            results
        });
    } catch (error) {
        console.error('Excel import error:', error);
        res.status(500).json({ error: 'Failed to import Excel file' });
    }
});

// ==================== TRACKING ROUTES ====================

// Get tracking data for patient
app.get('/api/patients/:id/tracking', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Check if user has access to this patient
        if (req.user.role !== 'admin') {
            const patientCheck = await pool.query('SELECT facility_id FROM patients WHERE id = $1', [id]);
            if (patientCheck.rows.length === 0 || patientCheck.rows[0].facility_id !== req.user.facility_id) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        const result = await pool.query(`
            SELECT t.*, s.code, s.description, s.hcpcs, s.cost, s.is_custom
            FROM tracking t
            JOIN supplies s ON t.supply_id = s.id
            WHERE t.patient_id = $1
            ORDER BY s.code, t.day_of_month
        `, [id]);

        res.json(result.rows);
    } catch (error) {
        console.error('Get tracking error:', error);
        res.status(500).json({ error: 'Failed to fetch tracking data' });
    }
});

// Update tracking data
app.post('/api/patients/:id/tracking', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { supplyId, dayOfMonth, quantity } = req.body;

        // Check if user has access to this patient
        if (req.user.role !== 'admin') {
            const patientCheck = await pool.query('SELECT facility_id FROM patients WHERE id = $1', [id]);
            if (patientCheck.rows.length === 0 || patientCheck.rows[0].facility_id !== req.user.facility_id) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        if (quantity > 0) {
            // Insert or update tracking record
            await pool.query(`
                INSERT INTO tracking (patient_id, supply_id, day_of_month, quantity)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (patient_id, supply_id, day_of_month)
                DO UPDATE SET quantity = $4, updated_at = CURRENT_TIMESTAMP
            `, [id, supplyId, dayOfMonth, quantity]);
        } else {
            // Remove tracking record if quantity is 0
            await pool.query(
                'DELETE FROM tracking WHERE patient_id = $1 AND supply_id = $2 AND day_of_month = $3',
                [id, supplyId, dayOfMonth]
            );
        }

        res.json({ message: 'Tracking updated successfully' });
    } catch (error) {
        console.error('Update tracking error:', error);
        res.status(500).json({ error: 'Failed to update tracking data' });
    }
});

// ==================== WOUND DX ROUTES - FIXED ====================

// Get wound dx data for patient (using tracking table)
app.get('/api/patients/:id/wound-dx', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Check if user has access to this patient
        if (req.user.role !== 'admin') {
            const patientCheck = await pool.query('SELECT facility_id FROM patients WHERE id = $1', [id]);
            if (patientCheck.rows.length === 0 || patientCheck.rows[0].facility_id !== req.user.facility_id) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        const result = await pool.query(`
            SELECT DISTINCT supply_id, 
                   COALESCE(wound_dx, '') as wound_dx
            FROM tracking
            WHERE patient_id = $1 AND wound_dx IS NOT NULL AND wound_dx != ''
        `, [id]);

        res.json(result.rows);
    } catch (error) {
        console.error('Get wound dx error:', error);
        res.status(500).json({ error: 'Failed to fetch wound dx data' });
    }
});

// Update wound dx data (using tracking table)
app.post('/api/patients/:id/wound-dx', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { supplyId, woundDx } = req.body;

        // Check if user has access to this patient
        if (req.user.role !== 'admin') {
            const patientCheck = await pool.query('SELECT facility_id FROM patients WHERE id = $1', [id]);
            if (patientCheck.rows.length === 0 || patientCheck.rows[0].facility_id !== req.user.facility_id) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        if (woundDx && woundDx.trim()) {
            // Update all tracking records for this patient and supply with the wound dx
            await pool.query(`
                UPDATE tracking 
                SET wound_dx = $3, updated_at = CURRENT_TIMESTAMP 
                WHERE patient_id = $1 AND supply_id = $2
            `, [id, supplyId, woundDx.trim()]);

            // If no tracking records exist, create a placeholder
            const existingRecords = await pool.query(
                'SELECT COUNT(*) FROM tracking WHERE patient_id = $1 AND supply_id = $2',
                [id, supplyId]
            );

            if (parseInt(existingRecords.rows[0].count) === 0) {
                await pool.query(`
                    INSERT INTO tracking (patient_id, supply_id, day_of_month, quantity, wound_dx)
                    VALUES ($1, $2, 1, 0, $3)
                `, [id, supplyId, woundDx.trim()]);
            }
        } else {
            // Clear wound dx from all tracking records for this patient and supply
            await pool.query(`
                UPDATE tracking 
                SET wound_dx = NULL, updated_at = CURRENT_TIMESTAMP 
                WHERE patient_id = $1 AND supply_id = $2
            `, [id, supplyId]);
        }

        res.json({ message: 'Wound Dx updated successfully' });
    } catch (error) {
        console.error('Update wound dx error:', error);
        res.status(500).json({ error: 'Failed to update wound dx data' });
    }
});

// ==================== USER MANAGEMENT ROUTES (ADMIN ONLY) ====================

// Get all users
app.get('/api/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
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
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Get pending users
app.get('/api/users/pending', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.*, f.name as facility_name 
            FROM users u 
            LEFT JOIN facilities f ON u.facility_id = f.id 
            WHERE u.is_approved = false 
            ORDER BY u.created_at DESC
        `);

        // Remove passwords from response
        const users = result.rows.map(user => {
            delete user.password;
            return user;
        });

        res.json(users);
    } catch (error) {
        console.error('Get pending users error:', error);
        res.status(500).json({ error: 'Failed to fetch pending users' });
    }
});

// Approve user
app.post('/api/users/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'UPDATE users SET is_approved = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id, name, email',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ message: 'User approved successfully', user: result.rows[0] });
    } catch (error) {
        console.error('Approve user error:', error);
        res.status(500).json({ error: 'Failed to approve user' });
    }
});

// Update user facility
app.put('/api/users/:id/facility', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { facilityId } = req.body;

        const result = await pool.query(
            'UPDATE users SET facility_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, name, email',
            [facilityId || null, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ message: 'User facility updated successfully', user: result.rows[0] });
    } catch (error) {
        console.error('Update user facility error:', error);
        res.status(500).json({ error: 'Failed to update user facility' });
    }
});

// Delete user
app.delete('/api/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Prevent deleting the system admin
        const userCheck = await pool.query('SELECT email FROM users WHERE id = $1', [id]);
        if (userCheck.rows.length > 0 && userCheck.rows[0].email === 'admin@system.com') {
            return res.status(400).json({ error: 'Cannot delete system administrator' });
        }

        const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id, name, email', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

// ==================== STATISTICS ROUTE ====================

app.get('/api/statistics', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const stats = await Promise.all([
            pool.query('SELECT COUNT(*) FROM users'),
            pool.query('SELECT COUNT(*) FROM users WHERE is_approved = false'),
            pool.query('SELECT COUNT(*) FROM facilities'),
            pool.query('SELECT COUNT(*) FROM patients'),
            pool.query('SELECT COUNT(*) FROM supplies'),
            pool.query('SELECT COUNT(*) FROM supplies WHERE is_custom = true')
        ]);

        res.json({
            totalUsers: parseInt(stats[0].rows[0].count),
            pendingUsers: parseInt(stats[1].rows[0].count),
            totalFacilities: parseInt(stats[2].rows[0].count),
            totalPatients: parseInt(stats[3].rows[0].count),
            totalSupplies: parseInt(stats[4].rows[0].count),
            customSupplies: parseInt(stats[5].rows[0].count)
        });
    } catch (error) {
        console.error('Get statistics error:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

// ==================== ERROR HANDLING ====================

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('Global error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// ==================== SERVER START ====================

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 App URL: ${process.env.NODE_ENV === 'production' ? 'https://your-app.herokuapp.com' : `http://localhost:${PORT}`}`);
});
