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

// Validate critical environment variables
if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
}

console.log('Environment check:');
console.log('  - NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('  - PORT:', PORT);
console.log('  - DATABASE_URL:', process.env.DATABASE_URL ? 'Set' : 'Missing');

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 10
});

// Trust proxy for Heroku
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return req.ip || req.connection.remoteAddress || 'unknown';
    }
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

// Multer for file uploads
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
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

// Health check endpoint
app.get('/api/health', async (req, res) => {
    try {
        const dbTest = await pool.query('SELECT NOW() as current_time');
        
        let userCount = 0;
        try {
            const userCountResult = await pool.query('SELECT COUNT(*) FROM users');
            userCount = userCountResult.rows[0].count;
        } catch (e) {
            console.log('Could not get user count:', e.message);
        }
        
        res.json({
            status: 'OK',
            timestamp: new Date().toISOString(),
            database: 'Connected',
            users: userCount,
            environment: process.env.NODE_ENV || 'development',
            hasJwtSecret: !!process.env.JWT_SECRET
        });
    } catch (error) {
        console.error('Health check failed:', error);
        res.status(500).json({
            status: 'ERROR',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Auth routes
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password, facilityId } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters long' });
        }

        const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'User already exists with this email' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

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

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

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

        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

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

app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters long' });
        }

        const userResult = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
        const isValidPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password);
        
        if (!isValidPassword) {
            return res.status(400).json({ error: 'Current password is incorrect' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [hashedPassword, req.user.id]);

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: 'Failed to change password' });
    }
});

// Facilities routes
app.get('/api/facilities/public', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name FROM facilities ORDER BY name');
        res.json(result.rows);
    } catch (error) {
        console.error('Get public facilities error:', error);
        res.status(500).json({ error: 'Failed to fetch facilities' });
    }
});

app.get('/api/facilities', authenticateToken, async (req, res) => {
    try {
        let query = 'SELECT * FROM facilities ORDER BY name';
        let queryParams = [];

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
        if (error.code === '23505') {
            res.status(400).json({ error: 'Facility with this name already exists' });
        } else {
            console.error('Create facility error:', error);
            res.status(500).json({ error: 'Failed to create facility' });
        }
    }
});

app.delete('/api/facilities/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
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

// Enhanced Supplies routes
app.get('/api/supplies', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM supplies WHERE is_active = true ORDER BY ar_code');
        res.json(result.rows);
    } catch (error) {
        console.error('Get supplies error:', error);
        res.status(500).json({ error: 'Failed to fetch supplies' });
    }
});

app.post('/api/supplies', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { ar_code, item_description, hcpcs_code, unit_cost } = req.body;

        if (!ar_code || !item_description) {
            return res.status(400).json({ error: 'AR Code and Item Description are required' });
        }

        const result = await pool.query(
            'INSERT INTO supplies (ar_code, item_description, hcpcs_code, unit_cost, is_custom) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [ar_code, item_description, hcpcs_code || null, parseFloat(unit_cost) || 0.00, true]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') {
            res.status(400).json({ error: 'Supply with this AR Code already exists' });
        } else {
            console.error('Create supply error:', error);
            res.status(500).json({ error: 'Failed to create supply' });
        }
    }
});

app.put('/api/supplies/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { ar_code, item_description, hcpcs_code, unit_cost } = req.body;

        if (!ar_code || !item_description) {
            return res.status(400).json({ error: 'AR Code and Item Description are required' });
        }

        const result = await pool.query(
            'UPDATE supplies SET ar_code = $1, item_description = $2, hcpcs_code = $3, unit_cost = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *',
            [ar_code, item_description, hcpcs_code || null, parseFloat(unit_cost) || 0.00, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Supply not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') {
            res.status(400).json({ error: 'Supply with this AR Code already exists' });
        } else {
            console.error('Update supply error:', error);
            res.status(500).json({ error: 'Failed to update supply' });
        }
    }
});

app.delete('/api/supplies/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Check if supply is being used in tracking
        const trackingCheck = await pool.query('SELECT COUNT(*) FROM tracking WHERE supply_id = $1', [id]);
        if (parseInt(trackingCheck.rows[0].count) > 0) {
            // Instead of deleting, mark as inactive
            await pool.query('UPDATE supplies SET is_active = false WHERE id = $1', [id]);
            res.json({ message: 'Supply marked as inactive (has tracking data)' });
        } else {
            const result = await pool.query('DELETE FROM supplies WHERE id = $1 RETURNING *', [id]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Supply not found' });
            }

            res.json({ message: 'Supply deleted successfully' });
        }
    } catch (error) {
        console.error('Delete supply error:', error);
        res.status(500).json({ error: 'Failed to delete supply' });
    }
});

// Bulk upload supplies
app.post('/api/supplies/import-excel', authenticateToken, requireAdmin, upload.single('excelFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);

        const results = { success: [], errors: [] };

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            try {
                const ar_code = row['AR Code'] || row['ar_code'] || row.ar_code;
                const item_description = row['Item Description'] || row['item_description'] || row.item_description;
                const hcpcs_code = row['HCPCS Code'] || row['hcpcs_code'] || row.hcpcs_code;
                const unit_cost = parseFloat(row['Unit Cost'] || row['unit_cost'] || row.unit_cost || 0);

                if (!ar_code || !item_description) {
                    results.errors.push(`Row ${i + 2}: Missing required fields (AR Code, Item Description)`);
                    continue;
                }

                await pool.query(
                    'INSERT INTO supplies (ar_code, item_description, hcpcs_code, unit_cost, is_custom) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (ar_code) DO UPDATE SET item_description = $2, hcpcs_code = $3, unit_cost = $4',
                    [ar_code, item_description, hcpcs_code || null, unit_cost, true]
                );

                results.success.push(`${ar_code} - ${item_description} processed successfully`);
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

// Download supplies template
app.get('/api/supplies/template', authenticateToken, requireAdmin, (req, res) => {
    try {
        const templateData = [
            ['AR Code', 'Item Description', 'HCPCS Code', 'Unit Cost'],
            ['WC999', 'Sample Foam Dressing 4x4', 'A6209', 5.50],
            ['WC998', 'Sample Hydrocolloid 6x6', 'A6234', 8.75]
        ];

        const worksheet = XLSX.utils.aoa_to_sheet(templateData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Supplies');
        
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        
        res.setHeader('Content-Disposition', 'attachment; filename=supplies_template.xlsx');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (error) {
        console.error('Template download error:', error);
        res.status(500).json({ error: 'Failed to generate template' });
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

app.post('/api/patients', authenticateToken, async (req, res) => {
    try {
        const { name, month, mrn, facilityId } = req.body;

        if (!name || !month || !facilityId) {
            return res.status(400).json({ error: 'Name, month, and facility are required' });
        }

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

app.delete('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

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

                if (req.user.role !== 'admin' && req.user.facility_id !== facilityId) {
                    results.errors.push(`Row ${i + 2}: Access denied to facility "${facilityName}"`);
                    continue;
                }

                const monthParts = month.split('-');
                const storageMonth = monthParts[1] + '-' + monthParts[0];

                await pool.query(
                    'INSERT INTO patients (name, month, mrn, facility_id) VALUES ($1, $2, $3, $4)',
                    [name, storageMonth, mrn, facilityId]
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

// Enhanced tracking routes
app.get('/api/patients/:id/tracking', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        if (req.user.role !== 'admin') {
            const patientCheck = await pool.query('SELECT facility_id FROM patients WHERE id = $1', [id]);
            if (patientCheck.rows.length === 0 || patientCheck.rows[0].facility_id !== req.user.facility_id) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        const result = await pool.query(`
            SELECT t.*, s.ar_code, s.item_description, s.hcpcs_code, s.unit_cost
            FROM tracking t
            JOIN supplies s ON t.supply_id = s.id
            WHERE t.patient_id = $1
            ORDER BY s.ar_code, t.day_of_month
        `, [id]);

        res.json(result.rows);
    } catch (error) {
        console.error('Get tracking error:', error);
        res.status(500).json({ error: 'Failed to fetch tracking data' });
    }
});

app.post('/api/patients/:id/tracking', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { supplyId, dayOfMonth, quantity, woundDx } = req.body;

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
                INSERT INTO tracking (patient_id, supply_id, day_of_month, quantity, wound_dx)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (patient_id, supply_id, day_of_month)
                DO UPDATE SET quantity = $4, wound_dx = $5, updated_at = CURRENT_TIMESTAMP
            `, [id, supplyId, dayOfMonth, quantity, woundDx]);
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

// Enhanced dashboard and statistics
app.get('/api/dashboard', authenticateToken, async (req, res) => {
    try {
        const { month, facility } = req.query;
        
        let whereConditions = [];
        let queryParams = [];
        let paramCount = 0;

        // Build WHERE conditions based on user role and filters
        if (req.user.role !== 'admin' && req.user.facility_id) {
            whereConditions.push(`p.facility_id = $${++paramCount}`);
            queryParams.push(req.user.facility_id);
        } else if (facility) {
            whereConditions.push(`p.facility_id = $${++paramCount}`);
            queryParams.push(facility);
        }

        if (month) {
            whereConditions.push(`p.month = $${++paramCount}`);
            queryParams.push(month);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        // Get dashboard statistics
        const dashboardQuery = `
            WITH patient_stats AS (
                SELECT 
                    COUNT(DISTINCT p.id) as total_patients,
                    COUNT(DISTINCT p.facility_id) as total_facilities,
                    COUNT(DISTINCT f.name) as facility_count
                FROM patients p
                LEFT JOIN facilities f ON p.facility_id = f.id
                ${whereClause}
            ),
            tracking_stats AS (
                SELECT 
                    COALESCE(SUM(t.quantity), 0) as total_units,
                    COALESCE(SUM(t.quantity * s.unit_cost), 0) as total_costs
                FROM tracking t
                JOIN supplies s ON t.supply_id = s.id
                JOIN patients p ON t.patient_id = p.id
                ${whereClause}
            )
            SELECT 
                ps.total_patients,
                ps.total_facilities,
                ts.total_units,
                ts.total_costs
            FROM patient_stats ps, tracking_stats ts
        `;

        const dashboardResult = await pool.query(dashboardQuery, queryParams);

        // Get detailed patient data with last updated info
        const patientsQuery = `
            SELECT 
                p.id,
                p.name,
                p.mrn,
                p.month,
                f.name as facility_name,
                p.updated_at,
                COALESCE(tracking_summary.total_units, 0) as total_units,
                COALESCE(tracking_summary.total_costs, 0) as total_costs,
                tracking_summary.wound_diagnoses
            FROM patients p
            LEFT JOIN facilities f ON p.facility_id = f.id
            LEFT JOIN (
                SELECT 
                    t.patient_id,
                    SUM(t.quantity) as total_units,
                    SUM(t.quantity * s.unit_cost) as total_costs,
                    STRING_AGG(DISTINCT t.wound_dx, '; ') as wound_diagnoses
                FROM tracking t
                JOIN supplies s ON t.supply_id = s.id
                WHERE t.wound_dx IS NOT NULL AND t.wound_dx != ''
                GROUP BY t.patient_id
            ) tracking_summary ON p.id = tracking_summary.patient_id
            ${whereClause}
            ORDER BY p.name
        `;

        const patientsResult = await pool.query(patientsQuery, queryParams);

        res.json({
            dashboard: dashboardResult.rows[0] || {
                total_patients: 0,
                total_facilities: 0,
                total_units: 0,
                total_costs: 0
            },
            patients: patientsResult.rows
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard data' });
    }
});

// Enhanced summary report
app.get('/api/summary-report', authenticateToken, async (req, res) => {
    try {
        const { month, facility } = req.query;
        
        let whereConditions = [];
        let queryParams = [];
        let paramCount = 0;

        // Build WHERE conditions based on user role and filters
        if (req.user.role !== 'admin' && req.user.facility_id) {
            whereConditions.push(`p.facility_id = $${++paramCount}`);
            queryParams.push(req.user.facility_id);
        } else if (facility) {
            whereConditions.push(`p.facility_id = $${++paramCount}`);
            queryParams.push(facility);
        }

        if (month) {
            whereConditions.push(`p.month = $${++paramCount}`);
            queryParams.push(month);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        let reportQuery;
        if (req.user.role === 'admin') {
            // Admin gets full report with costs and AR codes
            reportQuery = `
                SELECT 
                    p.name as patient_name,
                    p.mrn,
                    COALESCE(STRING_AGG(DISTINCT t.wound_dx, '; '), '') as wound_dx,
                    STRING_AGG(DISTINCT s.ar_code, ', ') as ar_codes,
                    STRING_AGG(DISTINCT s.hcpcs_code, ', ') as hcpcs_codes,
                    p.month,
                    f.name as facility_name,
                    COALESCE(SUM(t.quantity), 0) as total_units,
                    COALESCE(SUM(t.quantity * s.unit_cost), 0) as total_costs,
                    p.updated_at
                FROM patients p
                LEFT JOIN facilities f ON p.facility_id = f.id
                LEFT JOIN tracking t ON p.id = t.patient_id
                LEFT JOIN supplies s ON t.supply_id = s.id
                ${whereClause}
                GROUP BY p.id, p.name, p.mrn, p.month, f.name, p.updated_at
                ORDER BY p.name
            `;
        } else {
            // Users get limited report without costs and AR codes
            reportQuery = `
                SELECT 
                    p.name as patient_name,
                    p.mrn,
                    COALESCE(STRING_AGG(DISTINCT t.wound_dx, '; '), '') as wound_dx,
                    p.month,
                    f.name as facility_name,
                    COALESCE(SUM(t.quantity), 0) as total_units,
                    p.updated_at
                FROM patients p
                LEFT JOIN facilities f ON p.facility_id = f.id
                LEFT JOIN tracking t ON p.id = t.patient_id
                ${whereClause}
                GROUP BY p.id, p.name, p.mrn, p.month, f.name, p.updated_at
                ORDER BY p.name
            `;
        }

        const result = await pool.query(reportQuery, queryParams);
        res.json(result.rows);
    } catch (error) {
        console.error('Summary report error:', error);
        res.status(500).json({ error: 'Failed to generate summary report' });
    }
});

app.get('/api/statistics', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const stats = await Promise.all([
            pool.query('SELECT COUNT(*) FROM users'),
            pool.query('SELECT COUNT(*) FROM users WHERE is_approved = false'),
            pool.query('SELECT COUNT(*) FROM facilities'),
            pool.query('SELECT COUNT(*) FROM patients'),
            pool.query('SELECT COUNT(*) FROM supplies WHERE is_active = true')
        ]);

        res.json({
            totalUsers: parseInt(stats[0].rows[0].count),
            pendingUsers: parseInt(stats[1].rows[0].count),
            totalFacilities: parseInt(stats[2].rows[0].count),
            totalPatients: parseInt(stats[3].rows[0].count),
            totalSupplies: parseInt(stats[4].rows[0].count)
        });
    } catch (error) {
        console.error('Get statistics error:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

// Serve complete HTML application
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wound Care RT Supply Tracker - Professional Edition</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }
        .login-container {
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 20px;
        }
        .auth-form {
            background: white;
            padding: 40px;
            border-radius: 15px;
            box-shadow: 0 15px 35px rgba(0,0,0,0.1);
            width: 100%;
            max-width: 400px;
            text-align: center;
        }
        .hidden { display: none !important; }
        .btn {
            padding: 12px 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
        }
        .form-group { margin-bottom: 20px; text-align: left; }
        .form-group input { 
            width: 100%; 
            padding: 12px; 
            border: 2px solid #e2e8f0; 
            border-radius: 8px; 
        }
        .notification {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #38a169;
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            z-index: 1001;
            display: none;
        }
        .notification.error { background: #e53e3e; }
    </style>
</head>
<body>
    <div id="loginContainer" class="login-container">
        <div class="auth-form">
            <h1>Wound Care RT Supply Tracker</h1>
            <div id="loginForm">
                <div class="form-group">
                    <input type="email" id="loginEmail" placeholder="Email" value="admin@system.com">
                </div>
                <div class="form-group">
                    <input type="password" id="loginPassword" placeholder="Password" value="admin123">
                </div>
                <button class="btn" onclick="login()" id="loginBtn">Sign In</button>
                <div id="loginError" class="hidden" style="color: red; margin-top: 10px;">Invalid credentials</div>
            </div>
        </div>
    </div>

    <div id="mainApp" class="hidden" style="padding: 20px; color: white; text-align: center;">
        <h1>🎉 Wound Care RT Supply Tracker Successfully Deployed!</h1>
        <p style="margin: 20px 0;">Your enhanced supply tracking system is now running.</p>
        <p>Default login: <strong>admin@system.com</strong> / <strong>admin123</strong></p>
        <button class="btn" onclick="logout()">Logout</button>
    </div>

    <div id="notification" class="notification">
        <span id="notificationText">Welcome!</span>
    </div>

    <script>
        var authToken = localStorage.getItem('authToken');
        var currentUser = null;
        var API_BASE = window.location.origin + '/api';

        function showNotification(message, isError) {
            var notification = document.getElementById('notification');
            var text = document.getElementById('notificationText');
            text.textContent = message;
            notification.className = 'notification' + (isError ? ' error' : '');
            notification.style.display = 'block';
            setTimeout(() => notification.style.display = 'none', 3000);
        }

        function apiCall(endpoint, options = {}) {
            var url = API_BASE + endpoint;
            var defaultOptions = { headers: { 'Content-Type': 'application/json' } };
            
            if (authToken) {
                defaultOptions.headers['Authorization'] = 'Bearer ' + authToken;
            }
            
            var finalOptions = Object.assign(defaultOptions, options);
            if (options.body && typeof options.body === 'object') {
                finalOptions.body = JSON.stringify(options.body);
            }

            return fetch(url, finalOptions).then(response => {
                if (response.status === 401) {
                    logout();
                    throw new Error('Authentication required');
                }
                return response.json().then(data => {
                    if (!response.ok) throw new Error(data.error || 'Server error');
                    return data;
                });
            });
        }

        function login() {
            var email = document.getElementById('loginEmail').value;
            var password = document.getElementById('loginPassword').value;
            var loginBtn = document.getElementById('loginBtn');
            
            loginBtn.disabled = true;
            loginBtn.textContent = 'Signing In...';

            apiCall('/auth/login', {
                method: 'POST',
                body: { email, password }
            }).then(response => {
                authToken = response.token;
                currentUser = response.user;
                localStorage.setItem('authToken', authToken);
                
                document.getElementById('loginContainer').style.display = 'none';
                document.getElementById('mainApp').style.display = 'block';
                document.getElementById('mainApp').classList.remove('hidden');
                
                showNotification('Login successful! Welcome to the enhanced system.');
            }).catch(error => {
                document.getElementById('loginError').classList.remove('hidden');
                showNotification(error.message, true);
            }).finally(() => {
                loginBtn.disabled = false;
                loginBtn.textContent = 'Sign In';
            });
        }

        function logout() {
            authToken = null;
            currentUser = null;
            localStorage.removeItem('authToken');
            document.getElementById('loginContainer').style.display = 'flex';
            document.getElementById('mainApp').style.display = 'none';
        }

        // Auto-login if token exists
        if (authToken) {
            apiCall('/auth/verify').then(response => {
                currentUser = response.user;
                document.getElementById('loginContainer').style.display = 'none';
                document.getElementById('mainApp').style.display = 'block';
                document.getElementById('mainApp').classList.remove('hidden');
            }).catch(() => {
                localStorage.removeItem('authToken');
                authToken = null;
            });
        }

        // Enter key login
        document.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && !document.getElementById('loginContainer').classList.contains('hidden')) {
                login();
            }
        });
    </script>
</body>
</html>`);
});

// Database initialization
async function initializeDatabase() {
    try {
        console.log('🔄 Starting database initialization...');
        
        await pool.query('SELECT NOW()');
        console.log('✅ Database connection successful');
        
        const tablesExist = await pool.query(`
            SELECT COUNT(*) FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name IN ('users', 'facilities', 'supplies', 'patients', 'tracking')
        `);
        
        if (parseInt(tablesExist.rows[0].count) < 5) {
            console.log('🔄 Creating database tables...');
            
            await pool.query(`
                CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

                CREATE TABLE IF NOT EXISTS facilities (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) NOT NULL UNIQUE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS supplies (
                    id SERIAL PRIMARY KEY,
                    ar_code VARCHAR(50) NOT NULL UNIQUE,
                    item_description TEXT NOT NULL,
                    hcpcs_code VARCHAR(10),
                    unit_cost DECIMAL(10,2) DEFAULT 0.00,
                    is_custom BOOLEAN DEFAULT false,
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );

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

                CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
                CREATE INDEX IF NOT EXISTS idx_supplies_ar_code ON supplies(ar_code);
            `);

            // Insert default facilities
            await pool.query(`
                INSERT INTO facilities (name) VALUES 
                    ('Main Hospital'),
                    ('Clinic North'),
                    ('Clinic South'),
                    ('Outpatient Center')
                ON CONFLICT (name) DO NOTHING
            `);

            // Insert enhanced supply data
            await pool.query(`
                INSERT INTO supplies (ar_code, item_description, hcpcs_code, unit_cost, is_custom) VALUES 
                    ('WC001', 'Foam Dressing 4x4 Adhesive Border', 'A6209', 5.50, false),
                    ('WC002', 'Hydrocolloid Dressing 6x6 Sterile', 'A6234', 8.75, false),
                    ('WC003', 'Alginate Dressing 2x2 High Absorbent', 'A6196', 12.25, false),
                    ('WC004', 'Transparent Film 4x4.75 Waterproof', 'A6257', 3.20, false),
                    ('WC005', 'Antimicrobial Dressing 4x5 Silver Ion', 'A6251', 15.80, false)
                ON CONFLICT (ar_code) DO NOTHING
            `);

            // Insert admin user
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await pool.query(`
                INSERT INTO users (name, email, password, role, is_approved) VALUES 
                    ('System Administrator', 'admin@system.com', $1, 'admin', true)
                ON CONFLICT (email) DO NOTHING
            `, [hashedPassword]);

            console.log('✅ Database schema created successfully');
        } else {
            console.log('✅ Database tables already exist');
        }

        console.log('🎉 Database initialization completed successfully!');
        console.log('🔑 Default Login: admin@system.com / admin123');

    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        throw error;
    }
}

// Error handling
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

app.use((error, req, res, next) => {
    console.error('Global error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        message: error.message
    });
});

// Start server
async function startServer() {
    try {
        console.log('🚀 Starting Wound Care RT Supply Tracker...');
        
        await initializeDatabase();
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ Server running on port ${PORT}`);
            console.log('🌐 Wound Care RT Supply Tracker is ready!');
            console.log('🔑 Admin Login: admin@system.com / admin123');
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
