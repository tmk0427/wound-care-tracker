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

// FIXED: Enhanced month format conversion with debugging
function convertMonthFormat(monthInput) {
    if (!monthInput) return null;
    
    const month = monthInput.toString().trim();
    console.log('Converting month format:', month);
    
    // Handle different month formats
    if (month.match(/^\d{4}-\d{2}$/)) {
        // Already in YYYY-MM format
        console.log('Month already in YYYY-MM format:', month);
        return month;
    }
    
    if (month.match(/^\d{2}-\d{4}$/)) {
        // MM-YYYY format, convert to YYYY-MM
        const parts = month.split('-');
        const converted = `${parts[1]}-${parts[0]}`;
        console.log('Converted MM-YYYY to YYYY-MM:', month, '->', converted);
        return converted;
    }
    
    if (month.match(/^\d{1,2}\/\d{4}$/)) {
        // M/YYYY or MM/YYYY format
        const parts = month.split('/');
        const monthNum = parts[0].padStart(2, '0');
        const converted = `${parts[1]}-${monthNum}`;
        console.log('Converted M/YYYY to YYYY-MM:', month, '->', converted);
        return converted;
    }
    
    console.log('WARNING: Unrecognized month format:', month);
    return month; // Return as-is if format not recognized
}

// Updated helper function to check for MRN duplicates within the same month
async function checkMRNDuplicate(mrn, month, facility_id, excludePatientId = null) {
    if (!mrn || mrn.trim() === '') {
        return false; // Empty MRNs are allowed
    }
    
    let query = 'SELECT id, name, month FROM patients WHERE TRIM(mrn) = TRIM($1) AND month = $2';
    let params = [mrn, month];
    
    // If facility_id is provided, also check facility constraint
    if (facility_id) {
        query += ' AND facility_id = $' + (params.length + 1);
        params.push(facility_id);
    }
    
    if (excludePatientId) {
        query += ' AND id != $' + (params.length + 1);
        params.push(excludePatientId);
    }
    
    const result = await safeQuery(query, params);
    return result.rows.length > 0 ? result.rows[0] : false;
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

        // Create patients table with MRN uniqueness
        await safeQuery(`
            CREATE TABLE IF NOT EXISTS patients (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                month VARCHAR(7) NOT NULL,
                mrn VARCHAR(50),
                facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Remove old unique constraint on (name, month, facility_id) if it exists
        await safeQuery(`
            ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_name_month_facility_id_key
        `).catch(e => console.log('Old constraint already removed or never existed'));

        // Remove the problematic global MRN unique index
        await safeQuery(`
            DROP INDEX IF EXISTS patients_mrn_unique
        `).catch(e => console.log('Global MRN index already removed'));

        // Add proper MRN constraint that allows same MRN across different months
        await safeQuery(`
            CREATE UNIQUE INDEX IF NOT EXISTS patients_mrn_month_facility_unique 
            ON patients(mrn, month, facility_id) 
            WHERE mrn IS NOT NULL AND TRIM(mrn) != ''
        `).catch(e => console.log('MRN month facility index already exists'));

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
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', async (req, res) => {
    try {
        await safeQuery('SELECT 1');
        res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    } catch (error) {
        res.status(500).json({ status: 'unhealthy', error: error.message });
    }
});

// DASHBOARD
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
    try {
        let patientQuery, patientParams = [];
        let trackingQuery, trackingParams = [];

        if (req.user.role === 'admin') {
            patientQuery = 'SELECT COUNT(*) as count FROM patients p';
            trackingQuery = 'SELECT COUNT(*) as count FROM tracking t JOIN patients p ON t.patient_id = p.id';
        } else if (req.user.facilityId) {
            patientQuery = `SELECT COUNT(*) as count FROM patients p WHERE p.facility_id = $1 AND p.month >= '2025-09'`;
            patientParams = [req.user.facilityId];
            trackingQuery = `SELECT COUNT(*) as count FROM tracking t JOIN patients p ON t.patient_id = p.id WHERE p.facility_id = $1 AND p.month >= '2025-09'`;
            trackingParams = [req.user.facilityId];
        } else {
            patientQuery = 'SELECT 0 as count';
            trackingQuery = 'SELECT 0 as count';
        }

        const [patientsResult, suppliesResult, trackingResult] = await Promise.all([
            safeQuery(patientQuery, patientParams),
            safeQuery('SELECT COUNT(*) as count FROM supplies'),
            safeQuery(trackingQuery, trackingParams)
        ]);

        let totalValue;
        if (req.user.role === 'admin') {
            const totalCostResult = await safeQuery(`
                SELECT COALESCE(SUM(t.quantity * s.cost), 0) as total_cost
                FROM tracking t
                JOIN supplies s ON t.supply_id = s.id
                WHERE t.quantity > 0
            `);
            totalValue = parseFloat(totalCostResult.rows[0].total_cost) || 0;
        } else {
            const totalUnitsResult = await safeQuery(`
                SELECT COALESCE(SUM(t.quantity), 0) as total_units
                FROM tracking t
                JOIN patients p ON t.patient_id = p.id
                ${req.user.facilityId ? 'WHERE p.facility_id = $1' : ''}
            `, req.user.facilityId ? [req.user.facilityId] : []);
            totalValue = parseInt(totalUnitsResult.rows[0].total_units) || 0;
        }

        res.json({
            success: true,
            stats: {
                totalPatients: parseInt(patientsResult.rows[0].count) || 0,
                totalSupplies: parseInt(suppliesResult.rows[0].count) || 0,
                monthlyTracking: parseInt(trackingResult.rows[0].count) || 0,
                totalCost: totalValue
            }
        });

    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to load dashboard statistics',
            stats: { totalPatients: 0, totalSupplies: 0, monthlyTracking: 0, totalCost: 0 }
        });
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

app.put('/api/facilities/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const facilityId = req.params.id;
        const { name } = req.body;
        
        if (!name) {
            return res.status(400).json({ success: false, error: 'Facility name is required' });
        }

        const result = await safeQuery(
            'UPDATE facilities SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
            [name, facilityId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Facility not found' });
        }

        res.json({ success: true, facility: result.rows[0] });

    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ success: false, error: 'Facility name already exists' });
        }
        res.status(500).json({ success: false, error: 'Failed to update facility' });
    }
});

app.delete('/api/facilities/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const facilityId = req.params.id;
        
        const result = await safeQuery('DELETE FROM facilities WHERE id = $1', [facilityId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Facility not found' });
        }

        res.json({ success: true, message: 'Facility deleted successfully' });

    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to delete facility' });
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

app.put('/api/supplies/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const supplyId = req.params.id;
        const { code, description, hcpcs, cost } = req.body;
        
        if (!code || !description) {
            return res.status(400).json({ success: false, error: 'Code and description are required' });
        }

        const result = await safeQuery(
            'UPDATE supplies SET code = $1, description = $2, hcpcs = $3, cost = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *',
            [code, description, hcpcs || null, parseFloat(cost) || 0, supplyId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Supply not found' });
        }

        res.json({ success: true, supply: result.rows[0] });

    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ success: false, error: 'Supply code already exists' });
        }
        res.status(500).json({ success: false, error: 'Failed to update supply' });
    }
});

app.delete('/api/supplies/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const supplyId = req.params.id;
        
        const supply = await safeQuery('SELECT is_custom FROM supplies WHERE id = $1', [supplyId]);
        if (supply.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Supply not found' });
        }
        
        if (!supply.rows[0].is_custom) {
            return res.status(400).json({ success: false, error: 'Cannot delete AR standard supplies' });
        }
        
        const result = await safeQuery('DELETE FROM supplies WHERE id = $1', [supplyId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Supply not found' });
        }

        res.json({ success: true, message: 'Supply deleted successfully' });

    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to delete supply' });
    }
});

// SUPPLY IMPORT
app.post('/api/supplies/import', authenticateToken, requireAdmin, upload.single('file'), async (req, res) => {
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

        let imported = 0;
        let errors = [];

        for (const row of data) {
            try {
                const code = parseInt(row.Code || row.code);
                const description = (row.Description || row.description || '').toString().trim();
                const hcpcs = (row.HCPCS || row.hcpcs || '').toString().trim();
                const cost = parseFloat(row.Cost || row.cost || 0);

                if (!code || !description) {
                    errors.push({ row: row, error: 'Missing code or description' });
                    continue;
                }

                await safeQuery(
                    'INSERT INTO supplies (code, description, hcpcs, cost, is_custom) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, hcpcs = EXCLUDED.hcpcs, cost = EXCLUDED.cost',
                    [code, description, hcpcs || null, cost, true]
                );

                imported++;

            } catch (error) {
                errors.push({ row: row, error: error.message });
            }
        }

        res.json({
            success: true,
            message: `Successfully imported ${imported} supplies. ${errors.length} errors.`,
            imported: imported,
            errors: errors.slice(0, 10)
        });

    } catch (error) {
        console.error('Supply import error:', error);
        res.status(500).json({ success: false, error: 'Server error during import' });
    }
});

// PATIENTS
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

        if (req.user.role !== 'admin') {
            if (req.user.facilityId) {
                conditions.push('p.facility_id = $' + (params.length + 1));
                params.push(req.user.facilityId);
                conditions.push("p.month >= '2025-09'");
            } else {
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

        if (req.user.role !== 'admin' && req.user.facilityId && req.user.facilityId != facility_id) {
            return res.status(403).json({ success: false, error: 'Cannot add patients to this facility' });
        }

        if (req.user.role !== 'admin' && month < '2025-09') {
            return res.status(400).json({ success: false, error: 'Can only add patients for September 2025 onwards' });
        }

        // Check for MRN duplicate within the same month and facility
        if (mrn && mrn.trim()) {
            const duplicate = await checkMRNDuplicate(mrn.trim(), month, facility_id);
            if (duplicate) {
                return res.status(400).json({ 
                    success: false, 
                    error: `MRN "${mrn.trim()}" already exists for patient "${duplicate.name}" in ${duplicate.month}` 
                });
            }
        }

        const result = await safeQuery(
            'INSERT INTO patients (name, month, mrn, facility_id) VALUES ($1, $2, $3, $4) RETURNING *',
            [name, month, mrn ? mrn.trim() : null, facility_id]
        );

        res.json({ success: true, patient: result.rows[0] });

    } catch (error) {
        console.error('Error creating patient:', error);
        res.status(500).json({ success: false, error: 'Failed to create patient' });
    }
});

app.put('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
        const patientId = req.params.id;
        const { name, month, mrn, facility_id } = req.body;
        
        if (!name || !month || !facility_id) {
            return res.status(400).json({ success: false, error: 'Name, month, and facility are required' });
        }

        if (req.user.role !== 'admin' && req.user.facilityId && req.user.facilityId != facility_id) {
            return res.status(403).json({ success: false, error: 'Cannot modify patients from this facility' });
        }

        if (req.user.role !== 'admin' && month < '2025-09') {
            return res.status(400).json({ success: false, error: 'Can only modify patients for September 2025 onwards' });
        }

        // Check for MRN duplicate within the same month and facility (excluding current patient)
        if (mrn && mrn.trim()) {
            const duplicate = await checkMRNDuplicate(mrn.trim(), month, facility_id, parseInt(patientId));
            if (duplicate) {
                return res.status(400).json({ 
                    success: false, 
                    error: `MRN "${mrn.trim()}" already exists for patient "${duplicate.name}" in ${duplicate.month}` 
                });
            }
        }

        const result = await safeQuery(
            'UPDATE patients SET name = $1, month = $2, mrn = $3, facility_id = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *',
            [name, month, mrn ? mrn.trim() : null, facility_id, patientId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Patient not found' });
        }

        res.json({ success: true, patient: result.rows[0] });

    } catch (error) {
        console.error('Error updating patient:', error);
        res.status(500).json({ success: false, error: 'Failed to update patient' });
    }
});

app.delete('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
        const patientId = req.params.id;
        
        if (req.user.role !== 'admin') {
            const patient = await safeQuery('SELECT facility_id FROM patients WHERE id = $1', [patientId]);
            if (patient.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Patient not found' });
            }
            if (req.user.facilityId !== patient.rows[0].facility_id) {
                return res.status(403).json({ success: false, error: 'Cannot delete patients from other facilities' });
            }
        }
        
        const result = await safeQuery('DELETE FROM patients WHERE id = $1', [patientId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Patient not found' });
        }

        res.json({ success: true, message: 'Patient deleted successfully' });

    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to delete patient' });
    }
});

// FIXED: BULK PATIENT UPLOAD with enhanced month conversion and debugging
app.post('/api/patients/bulk', authenticateToken, async (req, res) => {
    try {
        const { patients } = req.body;
        
        if (!patients || !Array.isArray(patients) || patients.length === 0) {
            return res.status(400).json({ success: false, error: 'No patient data provided' });
        }

        console.log(`Starting bulk upload for ${patients.length} patients`);

        const facilitiesResult = await safeQuery('SELECT id, name FROM facilities');
        const facilityMap = {};
        facilitiesResult.rows.forEach(facility => {
            const cleanName = facility.name.toLowerCase().trim();
            facilityMap[cleanName] = facility.id;
            facilityMap[facility.name] = facility.id;
        });

        console.log('Facility mapping:', facilityMap);

        const results = { successful: 0, failed: [] };

        for (let i = 0; i < patients.length; i++) {
            const patient = patients[i];
            
            try {
                const name = (patient.name || patient.Name || '').toString().trim();
                const mrn = (patient.mrn || patient.MRN || '').toString().trim();
                const month = (patient.month || patient.Month || '').toString().trim();
                const facilityName = (patient.facilityName || patient.Facility || patient.facility || '').toString().trim();

                console.log(`Processing patient ${i + 1}:`, { name, mrn, month: month, facility: facilityName });

                if (!name || !month || !facilityName) {
                    results.failed.push({ 
                        name: name || 'Row ' + (i + 1), 
                        error: 'Missing required fields (Name, Month, Facility)' 
                    });
                    continue;
                }

                // FIXED: Enhanced month format conversion
                const dbMonth = convertMonthFormat(month);
                if (!dbMonth) {
                    results.failed.push({ 
                        name: name, 
                        error: `Invalid month format: "${month}"` 
                    });
                    continue;
                }

                if (req.user.role !== 'admin' && dbMonth < '2025-09') {
                    results.failed.push({ 
                        name: name, 
                        error: `Month ${dbMonth} is before September 2025 (non-admin restriction)` 
                    });
                    continue;
                }

                const facilityKey = facilityName.toLowerCase().trim();
                const facilityId = facilityMap[facilityKey];
                
                if (!facilityId) {
                    results.failed.push({ 
                        name: name, 
                        error: `Facility "${facilityName}" not found. Available facilities: ${Object.keys(facilityMap).join(', ')}` 
                    });
                    continue;
                }

                if (req.user.role !== 'admin' && req.user.facilityId && req.user.facilityId != facilityId) {
                    results.failed.push({ 
                        name: name, 
                        error: 'No permission to add patients to this facility' 
                    });
                    continue;
                }

                // Check MRN duplicate within the same month and facility
                if (mrn && mrn.length > 0) {
                    const duplicate = await checkMRNDuplicate(mrn, dbMonth, facilityId);
                    if (duplicate) {
                        results.failed.push({ 
                            name: name, 
                            error: `MRN "${mrn}" already exists for patient "${duplicate.name}" in ${duplicate.month}` 
                        });
                        continue;
                    }
                }

                console.log(`Inserting patient: ${name}, MRN: ${mrn}, Month: ${dbMonth}, Facility: ${facilityId}`);

                await safeQuery(
                    'INSERT INTO patients (name, mrn, month, facility_id) VALUES ($1, $2, $3, $4)',
                    [name, mrn || null, dbMonth, facilityId]
                );

                results.successful++;
                console.log(`Successfully added patient: ${name} in ${dbMonth}`);

            } catch (error) {
                console.error(`Error processing patient ${i + 1}:`, error);
                results.failed.push({ 
                    name: patient.name || patient.Name || ('Row ' + (i + 1)), 
                    error: 'Database error: ' + error.message 
                });
            }
        }

        console.log(`Bulk upload completed: ${results.successful} successful, ${results.failed.length} failed`);

        res.json({
            success: true,
            message: `Upload completed. ${results.successful} successful, ${results.failed.length} failed.`,
            successful: results.successful,
            failed: results.failed.slice(0, 20)
        });

    } catch (error) {
        console.error('Bulk upload error:', error);
        res.status(500).json({ success: false, error: 'Server error during bulk upload: ' + error.message });
    }
});

// TRACKING
app.get('/api/tracking/:patientId', authenticateToken, async (req, res) => {
    try {
        const patientId = req.params.patientId;
        
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
             DO UPDATE SET quantity = EXCLUDED.quantity, wound_dx = EXCLUDED.wound_dx, updated_at = CURRENT_TIMESTAMP`,
            [patientId, supplyId, dayOfMonth, quantity || 0, woundDx || null]
        );

        res.json({ success: true, message: 'Tracking data saved successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to save tracking data' });
    }
});

// FIXED: ENHANCED EXPORT REPORT with proper MRN number formatting
app.get('/api/export/supply-report', authenticateToken, async (req, res) => {
    try {
        const { facility_id, month } = req.query;
        
        let conditions = ['t.quantity > 0'];
        let params = [];
        
        if (req.user.role !== 'admin') {
            if (req.user.facilityId) {
                conditions.push('p.facility_id = $' + (params.length + 1));
                params.push(req.user.facilityId);
                conditions.push("p.month >= '2025-09'");
            } else {
                return res.status(403).json({ success: false, error: 'No facility access' });
            }
        }
        
        if (facility_id && facility_id !== 'all') {
            if (req.user.role !== 'admin' && req.user.facilityId && req.user.facilityId != facility_id) {
                return res.status(403).json({ success: false, error: 'No access to this facility' });
            }
            conditions.push('p.facility_id = $' + (params.length + 1));
            params.push(facility_id);
        }
        
        if (month && month !== 'all') {
            conditions.push('p.month = $' + (params.length + 1));
            params.push(month);
        }

        const query = `
            SELECT 
                s.code,
                s.description,
                s.hcpcs,
                s.cost,
                p.name as patient_name,
                p.mrn,
                p.month,
                f.name as facility_name,
                t.day_of_month,
                t.quantity,
                t.wound_dx,
                (t.quantity * s.cost) as total_cost
            FROM tracking t
            JOIN supplies s ON t.supply_id = s.id
            JOIN patients p ON t.patient_id = p.id
            JOIN facilities f ON p.facility_id = f.id
            WHERE ${conditions.join(' AND ')}
            ORDER BY s.code ASC, p.name ASC, t.day_of_month ASC
        `;

        const result = await safeQuery(query, params);
        
        if (result.rows.length === 0) {
            return res.json({
                success: true,
                message: 'No supply usage data found for the selected criteria',
                csvData: ''
            });
        }

        const groupedData = {};
        result.rows.forEach(row => {
            const key = row.code;
            if (!groupedData[key]) {
                groupedData[key] = {
                    supply: {
                        code: row.code,
                        description: row.description,
                        hcpcs: row.hcpcs,
                        cost: parseFloat(row.cost || 0)
                    },
                    usage: []
                };
            }
            groupedData[key].usage.push(row);
        });

        let csvContent = 'Supply Code,Supply Description,HCPCS,Unit Cost,Patient Name,MRN,Month,Facility,Day,Quantity,Total Cost,Wound DX\n';
        
        // FIXED: Enhanced CSV escaping function with special MRN formatting
        const escapeCsv = (val, isMRN = false) => {
            if (!val && val !== 0) return '';
            
            val = String(val);
            
            // SPECIAL HANDLING FOR MRN: Force Excel to treat as text to avoid scientific notation
            if (isMRN && val && val.trim() !== '' && val.trim() !== 'N/A') {
                // Method: Add leading apostrophe to force text format
                val = "'" + val.trim();
            }
            
            // Standard CSV escaping
            if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                val = '"' + val.replace(/"/g, '""') + '"';
            }
            
            return val;
        };

        Object.keys(groupedData)
            .sort((a, b) => parseInt(a) - parseInt(b))
            .forEach(code => {
                const supply = groupedData[code].supply;
                const usageData = groupedData[code].usage;
                
                usageData.forEach(usage => {
                    const row = [
                        escapeCsv(supply.code),
                        escapeCsv(supply.description),
                        escapeCsv(supply.hcpcs || 'N/A'),
                        supply.cost.toFixed(2),
                        escapeCsv(usage.patient_name),
                        escapeCsv(usage.mrn || 'N/A', true), // TRUE flag for MRN formatting
                        escapeCsv(usage.month),
                        escapeCsv(usage.facility_name),
                        usage.day_of_month,
                        usage.quantity,
                        parseFloat(usage.total_cost || 0).toFixed(2),
                        escapeCsv(usage.wound_dx || '')
                    ].join(',');
                    
                    csvContent += row + '\n';
                });
            });

        const totalUnits = result.rows.reduce((sum, row) => sum + parseInt(row.quantity || 0), 0);
        const totalCost = result.rows.reduce((sum, row) => sum + parseFloat(row.total_cost || 0), 0);
        const uniqueSupplies = Object.keys(groupedData).length;
        const uniquePatients = [...new Set(result.rows.map(row => row.patient_name))].length;
        
        res.json({
            success: true,
            csvData: csvContent,
            summary: {
                totalRecords: result.rows.length,
                uniqueSupplies: uniqueSupplies,
                uniquePatients: uniquePatients,
                totalUnits: totalUnits,
                totalCost: totalCost.toFixed(2)
            }
        });

    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to generate export report: ' + error.message 
        });
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
            'UPDATE users SET name = $1, email = $2, role = $3, facility_id = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5',
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

app.put('/api/admin/users/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        
        const result = await safeQuery(
            'UPDATE users SET is_approved = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
            [userId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        res.json({ success: true, message: 'User approved successfully' });

    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to approve user' });
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
            'UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
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
            console.log('FIXED: MRN export formatting prevents scientific notation');
            console.log('FIXED: Enhanced month format conversion for bulk upload');
            console.log('FIXED: Same MRN allowed across different months');
            console.log('Enhanced debugging for bulk upload operations');
            console.log('================================');
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

module.exports = app;
