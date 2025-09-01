require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const xlsx = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// File upload configuration
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Test database connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('Error connecting to PostgreSQL database:', err);
    } else {
        console.log('✅ Connected to PostgreSQL database successfully');
        release();
    }
});

// Authentication middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'Access token required' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Invalid token' });
        }
        req.user = user;
        next();
    });
}

// Admin middleware
function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    next();
}

// Utility function for logging activities
async function logActivity(userId, action, details = null) {
    try {
        // You can implement activity logging if needed
        console.log(`Activity: User ${userId} - ${action} - ${details}`);
    } catch (error) {
        console.error('Failed to log activity:', error);
    }
}

// Routes

// Authentication routes
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ 
            success: false, 
            message: 'Email and password are required' 
        });
    }
    
    try {
        const query = `
            SELECT u.*, f.name as facility_name 
            FROM users u
            LEFT JOIN facilities f ON u.facility_id = f.id
            WHERE u.email = $1
        `;
        
        const result = await pool.query(query, [email]);
        const user = result.rows[0];
        
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid credentials' 
            });
        }
        
        if (!user.is_approved) {
            return res.status(401).json({ 
                success: false, 
                message: 'Account pending approval. Contact administrator.' 
            });
        }
        
        const passwordMatch = await bcrypt.compare(password, user.password);
        
        if (!passwordMatch) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid credentials' 
            });
        }
        
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role,
                facility_id: user.facility_id 
            }, 
            JWT_SECRET, 
            { expiresIn: '24h' }
        );
        
        await logActivity(user.id, 'LOGIN', `User logged in: ${user.email}`);
        
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
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
});

// Dashboard routes
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
    try {
        const facilityCondition = req.user.role === 'admin' ? '' : 'WHERE p.facility_id = $1';
        const params = req.user.role === 'admin' ? [] : [req.user.facility_id];
        
        const queries = [
            `SELECT COUNT(*) as count FROM patients p ${facilityCondition}`,
            `SELECT COUNT(*) as count FROM supplies`,
            `SELECT COUNT(*) as count FROM tracking t 
             JOIN patients p ON t.patient_id = p.id ${facilityCondition}`,
            `SELECT COALESCE(SUM(t.quantity * s.cost), 0) as total 
             FROM tracking t 
             JOIN supplies s ON t.supply_id = s.id 
             JOIN patients p ON t.patient_id = p.id ${facilityCondition}`
        ];
        
        const results = await Promise.all(
            queries.map(query => pool.query(query, params))
        );
        
        res.json({
            success: true,
            stats: {
                totalPatients: parseInt(results[0].rows[0].count),
                totalSupplies: parseInt(results[1].rows[0].count),
                monthlyTracking: parseInt(results[2].rows[0].count),
                totalCost: parseFloat(results[3].rows[0].total) || 0
            }
        });
    } catch (error) {
        console.error('Stats query error:', error);
        res.status(500).json({ success: false, message: 'Failed to load statistics' });
    }
});

// Patient routes
app.get('/api/patients', authenticateToken, async (req, res) => {
    try {
        let query = `
            SELECT p.*, f.name as facility_name 
            FROM patients p
            JOIN facilities f ON p.facility_id = f.id
        `;
        let params = [];
        
        // Non-admin users can only see patients from their facility
        if (req.user.role !== 'admin' && req.user.facility_id) {
            query += ' WHERE p.facility_id = $1';
            params.push(req.user.facility_id);
        }
        
        // Add facility filter for admin users
        if (req.query.facility_id && req.user.role === 'admin') {
            const paramIndex = params.length + 1;
            query += req.user.facility_id ? ` AND p.facility_id = $${paramIndex}` : ` WHERE p.facility_id = $${paramIndex}`;
            params.push(req.query.facility_id);
        }
        
        query += ' ORDER BY p.name';
        
        const result = await pool.query(query, params);
        res.json({ success: true, patients: result.rows || [] });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ success: false, message: 'Failed to load patients' });
    }
});

app.post('/api/patients', authenticateToken, async (req, res) => {
    const { name, mrn, month, facility_id } = req.body;
    
    if (!name || !mrn || !month || !facility_id) {
        return res.status(400).json({ 
            success: false, 
            message: 'Name, MRN, month, and facility are required' 
        });
    }
    
    // Check if user can add patients to this facility
    if (req.user.role !== 'admin' && req.user.facility_id != facility_id) {
        return res.status(403).json({ 
            success: false, 
            message: 'Cannot add patients to this facility' 
        });
    }
    
    try {
        const result = await pool.query(
            `INSERT INTO patients (name, mrn, month, facility_id) VALUES ($1, $2, $3, $4) RETURNING id`,
            [name, mrn, month, facility_id]
        );
        
        await logActivity(req.user.id, 'ADD_PATIENT', `Added patient: ${name} (${mrn})`);
        
        res.json({ 
            success: true, 
            message: 'Patient added successfully',
            patient_id: result.rows[0].id 
        });
    } catch (error) {
        if (error.code === '23505') { // Unique constraint violation
            return res.status(400).json({ 
                success: false, 
                message: 'Patient with this name already exists for this month and facility' 
            });
        }
        console.error('Database error:', error);
        res.status(500).json({ success: false, message: 'Failed to add patient' });
    }
});

// Supply routes
app.get('/api/supplies', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM supplies ORDER BY description');
        res.json({ success: true, supplies: result.rows || [] });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ success: false, message: 'Failed to load supplies' });
    }
});

app.post('/api/supplies', authenticateToken, requireAdmin, async (req, res) => {
    const { code, description, hcpcs, cost, is_custom } = req.body;
    
    if (!code || !description || cost === undefined) {
        return res.status(400).json({ 
            success: false, 
            message: 'Code, description, and cost are required' 
        });
    }
    
    try {
        const result = await pool.query(
            `INSERT INTO supplies (code, description, hcpcs, cost, is_custom) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [parseInt(code), description, hcpcs || null, parseFloat(cost), Boolean(is_custom)]
        );
        
        await logActivity(req.user.id, 'ADD_SUPPLY', `Added supply: ${description} (${code})`);
        
        res.json({ 
            success: true, 
            message: 'Supply added successfully',
            supply_id: result.rows[0].id 
        });
    } catch (error) {
        if (error.code === '23505') { // Unique constraint violation
            return res.status(400).json({ 
                success: false, 
                message: 'Supply code already exists' 
            });
        }
        console.error('Database error:', error);
        res.status(500).json({ success: false, message: 'Failed to add supply' });
    }
});

// Facility routes
app.get('/api/facilities', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM facilities ORDER BY name');
        res.json({ success: true, facilities: result.rows || [] });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ success: false, message: 'Failed to load facilities' });
    }
});

app.post('/api/facilities', authenticateToken, requireAdmin, async (req, res) => {
    const { name } = req.body;
    
    if (!name) {
        return res.status(400).json({ 
            success: false, 
            message: 'Facility name is required' 
        });
    }
    
    try {
        const result = await pool.query(
            'INSERT INTO facilities (name) VALUES ($1) RETURNING id',
            [name]
        );
        
        await logActivity(req.user.id, 'ADD_FACILITY', `Added facility: ${name}`);
        
        res.json({ 
            success: true, 
            message: 'Facility added successfully',
            facility_id: result.rows[0].id 
        });
    } catch (error) {
        if (error.code === '23505') { // Unique constraint violation
            return res.status(400).json({ 
                success: false, 
                message: 'Facility name already exists' 
            });
        }
        console.error('Database error:', error);
        res.status(500).json({ success: false, message: 'Failed to add facility' });
    }
});

// Admin routes
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.*, f.name as facility_name 
            FROM users u
            LEFT JOIN facilities f ON u.facility_id = f.id
            ORDER BY u.name
        `);
        
        // Remove password from response
        const safeUsers = result.rows.map(user => {
            const { password, ...safeUser } = user;
            return safeUser;
        });
        
        res.json({ success: true, users: safeUsers });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ success: false, message: 'Failed to load users' });
    }
});

app.post('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    const { name, email, password, role, facility_id } = req.body;
    
    if (!name || !email || !password || !role) {
        return res.status(400).json({ 
            success: false, 
            message: 'Name, email, password, and role are required' 
        });
    }
    
    if (!['admin', 'user'].includes(role)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Role must be admin or user' 
        });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, 12);
        
        const result = await pool.query(
            `INSERT INTO users (name, email, password, role, facility_id, is_approved) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [name, email, hashedPassword, role, facility_id || null, true]
        );
        
        await logActivity(req.user.id, 'ADD_USER', `Created user: ${name} (${email})`);
        
        res.json({ 
            success: true, 
            message: 'User created successfully',
            user_id: result.rows[0].id 
        });
    } catch (error) {
        if (error.code === '23505') { // Unique constraint violation
            return res.status(400).json({ 
                success: false, 
                message: 'Email already exists' 
            });
        }
        console.error('Database error:', error);
        res.status(500).json({ success: false, message: 'Failed to create user' });
    }
});

// Export routes
app.get('/api/export/supply-report', authenticateToken, async (req, res) => {
    const { facility_id, month } = req.query;
    
    try {
        let query = `
            SELECT 
                p.name as patient_name,
                p.mrn,
                f.name as facility_name,
                p.month,
                s.code as ar_code,
                s.description,
                s.hcpcs,
                t.quantity as units_used,
                s.cost as cost_per_unit,
                (t.quantity * s.cost) as total_cost,
                t.created_at::date as date_used
            FROM tracking t
            JOIN patients p ON t.patient_id = p.id
            JOIN supplies s ON t.supply_id = s.id
            JOIN facilities f ON p.facility_id = f.id
            WHERE 1=1
        `;
        
        const params = [];
        let paramIndex = 1;
        
        // Apply facility filter
        if (facility_id && facility_id !== 'all') {
            query += ` AND p.facility_id = $${paramIndex}`;
            params.push(facility_id);
            paramIndex++;
        }
        
        // Apply month filter
        if (month && month !== 'all') {
            query += ` AND p.month = $${paramIndex}`;
            params.push(month);
            paramIndex++;
        }
        
        // Non-admin users can only export from their facility
        if (req.user.role !== 'admin' && req.user.facility_id) {
            query += ` AND p.facility_id = $${paramIndex}`;
            params.push(req.user.facility_id);
            paramIndex++;
        }
        
        query += ' ORDER BY f.name, p.name, s.description';
        
        const result = await pool.query(query, params);
        const records = result.rows;
        
        if (!records || records.length === 0) {
            return res.json({
                success: true,
                csvData: 'Patient Name,MRN,Facility,Month,AR Code,Description,HCPCS,Units Used,Cost Per Unit,Total Cost\n',
                summary: {
                    totalRecords: 0,
                    uniqueSupplies: 0,
                    uniquePatients: 0,
                    totalUnits: 0,
                    totalCost: '0.00'
                }
            });
        }
        
        // Generate CSV
        let csvData = 'Patient Name,MRN,Facility,Month,AR Code,Description,HCPCS,Units Used,Cost Per Unit,Total Cost\n';
        
        const uniqueSupplies = new Set();
        const uniquePatients = new Set();
        let totalUnits = 0;
        let totalCost = 0;
        
        records.forEach(record => {
            const row = [
                `"${record.patient_name}"`,
                `"${record.mrn || ''}"`,
                `"${record.facility_name}"`,
                `"${record.month}"`,
                `"${record.ar_code}"`,
                `"${record.description}"`,
                `"${record.hcpcs || ''}"`,
                record.units_used,
                `"$${parseFloat(record.cost_per_unit || 0).toFixed(2)}"`,
                `"$${parseFloat(record.total_cost || 0).toFixed(2)}"`
            ];
            csvData += row.join(',') + '\n';
            
            uniqueSupplies.add(record.ar_code);
            uniquePatients.add(record.patient_name + record.mrn);
            totalUnits += record.units_used || 0;
            totalCost += parseFloat(record.total_cost || 0);
        });
        
        await logActivity(req.user.id, 'EXPORT_REPORT', `Generated supply usage report: ${records.length} records`);
        
        res.json({
            success: true,
            csvData,
            summary: {
                totalRecords: records.length,
                uniqueSupplies: uniqueSupplies.size,
                uniquePatients: uniquePatients.size,
                totalUnits: totalUnits,
                totalCost: totalCost.toFixed(2)
            }
        });
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ success: false, message: 'Failed to generate report' });
    }
});

// File upload routes
app.post('/api/upload/patients', authenticateToken, upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    
    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);
        
        if (!data || data.length === 0) {
            return res.status(400).json({ success: false, message: 'No data found in file' });
        }
        
        let processed = 0;
        let errors = [];
        
        for (let index = 0; index < data.length; index++) {
            const row = data[index];
            const { Name, MRN, Month, Facility } = row;
            
            if (!Name || !Month || !Facility) {
                errors.push(`Row ${index + 2}: Missing required fields (Name, Month, Facility)`);
                continue;
            }
            
            try {
                // Find facility ID
                const facilityResult = await pool.query('SELECT id FROM facilities WHERE name = $1', [Facility]);
                
                if (!facilityResult.rows.length) {
                    errors.push(`Row ${index + 2}: Facility "${Facility}" not found`);
                    continue;
                }
                
                const facilityId = facilityResult.rows[0].id;
                
                // Check if user can add to this facility
                if (req.user.role !== 'admin' && req.user.facility_id != facilityId) {
                    errors.push(`Row ${index + 2}: No permission for facility "${Facility}"`);
                    continue;
                }
                
                // Insert patient
                await pool.query(
                    `INSERT INTO patients (name, mrn, month, facility_id) VALUES ($1, $2, $3, $4)`,
                    [Name, MRN || null, Month, facilityId]
                );
                
                processed++;
            } catch (err) {
                if (err.code === '23505') {
                    errors.push(`Row ${index + 2}: Patient already exists`);
                } else {
                    errors.push(`Row ${index + 2}: Database error`);
                    console.error('Row processing error:', err);
                }
            }
        }
        
        await logActivity(req.user.id, 'BULK_UPLOAD', `Bulk uploaded ${processed} patients`);
        
        res.json({
            success: true,
            message: `Successfully uploaded ${processed} patients`,
            processed,
            errors
        });
        
    } catch (error) {
        console.error('File processing error:', error);
        res.status(500).json({ success: false, message: 'Failed to process file' });
    }
});

// Supply tracking routes
app.get('/api/tracking/:patient_id', authenticateToken, async (req, res) => {
    const { patient_id } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT t.*, s.code, s.description, s.cost, s.hcpcs
            FROM tracking t
            JOIN supplies s ON t.supply_id = s.id
            WHERE t.patient_id = $1
            ORDER BY t.day_of_month DESC, s.description
        `, [patient_id]);
        
        res.json({ success: true, tracking: result.rows || [] });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ success: false, message: 'Failed to load tracking data' });
    }
});

app.post('/api/tracking', authenticateToken, async (req, res) => {
    const { patient_id, supply_id, quantity, day_of_month, wound_dx } = req.body;
    
    if (!patient_id || !supply_id || !quantity || !day_of_month) {
        return res.status(400).json({ 
            success: false, 
            message: 'Patient, supply, quantity, and day are required' 
        });
    }
    
    try {
        const result = await pool.query(
            `INSERT INTO tracking (patient_id, supply_id, quantity, day_of_month, wound_dx) 
             VALUES ($1, $2, $3, $4, $5) 
             ON CONFLICT (patient_id, supply_id, day_of_month) 
             DO UPDATE SET quantity = $2, wound_dx = $5, updated_at = CURRENT_TIMESTAMP 
             RETURNING id`,
            [patient_id, supply_id, quantity, day_of_month, wound_dx || null]
        );
        
        await logActivity(req.user.id, 'ADD_TRACKING', `Added supply tracking: ${quantity} units`);
        
        res.json({ 
            success: true, 
            message: 'Tracking record saved successfully',
            tracking_id: result.rows[0].id 
        });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ success: false, message: 'Failed to save tracking record' });
    }
});

// Health check route
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Serve static files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ 
        success: false, 
        message: 'Internal server error' 
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ 
        error: 'Route not found',
        message: `Route ${req.method} ${req.originalUrl} not found`
    });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    await pool.end();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down gracefully...');
    await pool.end();
    process.exit(0);
});

// Start server
app.listen(PORT, () => {
    console.log(`🏥 Wound Care RT Supply Tracker Server running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`🗄️  Database: PostgreSQL`);
    console.log(`🔐 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
