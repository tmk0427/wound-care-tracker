require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const multer = require('multer');
const XLSX = require('xlsx');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(express.json());
app.use(express.static('static'));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// File upload setup
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// JWT verification middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Access token required' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Admin middleware
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    next();
};

// Database initialization
async function initializeDatabase() {
    try {
        // Create users table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(20) NOT NULL DEFAULT 'rt',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create patients table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS patients (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                room VARCHAR(20) NOT NULL,
                wound_type VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create supplies table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS supplies (
                id SERIAL PRIMARY KEY,
                patient_id INTEGER REFERENCES patients(id) ON DELETE CASCADE,
                day_number INTEGER NOT NULL,
                amount INTEGER NOT NULL DEFAULT 0,
                month INTEGER NOT NULL,
                year INTEGER NOT NULL,
                recorded_by INTEGER REFERENCES users(id),
                recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(patient_id, day_number, month, year)
            )
        `);

        // Create default admin user if not exists
        const adminExists = await pool.query('SELECT id FROM users WHERE username = $1', ['admin']);
        if (adminExists.rows.length === 0) {
            const hashedPassword = await bcrypt.hash('admin123', 12);
            await pool.query(
                'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
                ['admin', hashedPassword, 'admin']
            );
            console.log('✅ Default admin user created (username: admin, password: admin123)');
        }

        console.log('✅ Database initialized successfully');
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
    }
}

// Routes

// Serve main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

// Authentication routes
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Username and password are required' 
            });
        }

        const result = await pool.query(
            'SELECT id, username, password_hash, role FROM users WHERE username = $1',
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid username or password' 
            });
        }

        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid username or password' 
            });
        }

        const token = jwt.sign(
            { 
                userId: user.id, 
                username: user.username, 
                role: user.role 
            },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Login failed' });
    }
});

// Dashboard route
app.get('/api/dashboard', authenticateToken, async (req, res) => {
    try {
        const currentMonth = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();

        // Get total patients
        const patientsResult = await pool.query('SELECT COUNT(*) FROM patients');
        const totalPatients = parseInt(patientsResult.rows[0].count);

        // Get total supplies for current month
        const suppliesResult = await pool.query(
            'SELECT COALESCE(SUM(amount), 0) as total FROM supplies WHERE month = $1 AND year = $2',
            [currentMonth, currentYear]
        );
        const totalSupplies = parseInt(suppliesResult.rows[0].total);

        // Calculate estimated monthly cost (assuming $2 per supply unit)
        const monthlyCost = totalSupplies * 2;

        // Mock low inventory count (you can implement actual inventory tracking)
        const lowInventory = Math.floor(Math.random() * 5);

        res.json({
            success: true,
            stats: {
                totalPatients,
                totalSupplies,
                monthlyCost,
                lowInventory
            }
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ success: false, message: 'Failed to load dashboard' });
    }
});

// Get all patients
app.get('/api/patients', authenticateToken, async (req, res) => {
    try {
        const currentMonth = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();

        const result = await pool.query(`
            SELECT 
                p.*,
                COALESCE(
                    json_object_agg(
                        CONCAT('day_', s.day_number), 
                        s.amount
                    ) FILTER (WHERE s.id IS NOT NULL),
                    '{}'::json
                ) as supplies
            FROM patients p
            LEFT JOIN supplies s ON p.id = s.patient_id 
                AND s.month = $1 AND s.year = $2
            GROUP BY p.id
            ORDER BY p.name
        `, [currentMonth, currentYear]);

        res.json({
            success: true,
            patients: result.rows
        });
    } catch (error) {
        console.error('Get patients error:', error);
        res.status(500).json({ success: false, message: 'Failed to load patients' });
    }
});

// Add new patient
app.post('/api/patients/add', authenticateToken, async (req, res) => {
    try {
        const { name, room, wound_type } = req.body;

        if (!name || !room) {
            return res.status(400).json({ 
                success: false, 
                message: 'Patient name and room are required' 
            });
        }

        const result = await pool.query(
            'INSERT INTO patients (name, room, wound_type) VALUES ($1, $2, $3) RETURNING id',
            [name, room, wound_type || null]
        );

        res.json({
            success: true,
            message: 'Patient added successfully',
            patientId: result.rows[0].id
        });
    } catch (error) {
        console.error('Add patient error:', error);
        if (error.code === '23505') { // Unique violation
            res.status(400).json({ success: false, message: 'Patient already exists' });
        } else {
            res.status(500).json({ success: false, message: 'Failed to add patient' });
        }
    }
});

// Delete patient
app.delete('/api/patients/delete', authenticateToken, async (req, res) => {
    try {
        const { patientId } = req.body;

        if (!patientId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Patient ID is required' 
            });
        }

        await pool.query('DELETE FROM patients WHERE id = $1', [patientId]);

        res.json({
            success: true,
            message: 'Patient deleted successfully'
        });
    } catch (error) {
        console.error('Delete patient error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete patient' });
    }
});

// Update supplies
app.post('/api/supplies/update', authenticateToken, async (req, res) => {
    try {
        const { patientId, day, amount } = req.body;
        const currentMonth = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();

        if (!patientId || !day || amount === undefined) {
            return res.status(400).json({ 
                success: false, 
                message: 'Patient ID, day, and amount are required' 
            });
        }

        // Upsert supply record
        await pool.query(`
            INSERT INTO supplies (patient_id, day_number, amount, month, year, recorded_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (patient_id, day_number, month, year)
            DO UPDATE SET 
                amount = EXCLUDED.amount,
                recorded_by = EXCLUDED.recorded_by,
                recorded_at = CURRENT_TIMESTAMP
        `, [patientId, day, amount, currentMonth, currentYear, req.user.userId]);

        res.json({
            success: true,
            message: 'Supplies updated successfully'
        });
    } catch (error) {
        console.error('Update supplies error:', error);
        res.status(500).json({ success: false, message: 'Failed to update supplies' });
    }
});

// Export data to Excel
app.get('/api/export', authenticateToken, async (req, res) => {
    try {
        const currentMonth = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();

        // Get all patients with their supply data
        const result = await pool.query(`
            SELECT 
                p.name,
                p.room,
                p.wound_type,
                s.day_number,
                s.amount
            FROM patients p
            LEFT JOIN supplies s ON p.id = s.patient_id 
                AND s.month = $1 AND s.year = $2
            ORDER BY p.name, s.day_number
        `, [currentMonth, currentYear]);

        // Process data for Excel
        const workbook = XLSX.utils.book_new();
        const worksheetData = [];

        // Create header row
        const headerRow = ['Patient Name', 'Room', 'Wound Type'];
        for (let day = 1; day <= 31; day++) {
            headerRow.push(`Day ${day}`);
        }
        headerRow.push('Total');
        worksheetData.push(headerRow);

        // Group data by patient
        const patientData = {};
        result.rows.forEach(row => {
            if (!patientData[row.name]) {
                patientData[row.name] = {
                    name: row.name,
                    room: row.room,
                    wound_type: row.wound_type,
                    supplies: {}
                };
            }
            if (row.day_number) {
                patientData[row.name].supplies[row.day_number] = row.amount;
            }
        });

        // Create data rows
        Object.values(patientData).forEach(patient => {
            const row = [patient.name, patient.room, patient.wound_type || ''];
            let total = 0;
            
            for (let day = 1; day <= 31; day++) {
                const amount = patient.supplies[day] || 0;
                row.push(amount);
                total += amount;
            }
            row.push(total);
            worksheetData.push(row);
        });

        const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Supply Usage');

        // Generate buffer
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Disposition', 'attachment; filename=wound-care-supplies.xlsx');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ success: false, message: 'Export failed' });
    }
});

// Import data from Excel
app.post('/api/import', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const workbook = XLSX.readFile(req.file.path);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (data.length < 2) {
            return res.status(400).json({ success: false, message: 'File must contain data' });
        }

        const currentMonth = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();

        // Process each row (skip header)
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const name = row[0];
            const room = row[1];
            const woundType = row[2] || null;

            if (!name || !room) continue;

            // Insert or update patient
            const patientResult = await pool.query(`
                INSERT INTO patients (name, room, wound_type)
                VALUES ($1, $2, $3)
                ON CONFLICT (name, room) DO UPDATE SET
                    wound_type = EXCLUDED.wound_type,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING id
            `, [name, room, woundType]);

            const patientId = patientResult.rows[0].id;

            // Process daily supplies (columns 3-33 for days 1-31)
            for (let day = 1; day <= 31; day++) {
                const amount = parseInt(row[day + 2]) || 0;
                
                if (amount > 0) {
                    await pool.query(`
                        INSERT INTO supplies (patient_id, day_number, amount, month, year, recorded_by)
                        VALUES ($1, $2, $3, $4, $5, $6)
                        ON CONFLICT (patient_id, day_number, month, year)
                        DO UPDATE SET 
                            amount = EXCLUDED.amount,
                            recorded_by = EXCLUDED.recorded_by,
                            recorded_at = CURRENT_TIMESTAMP
                    `, [patientId, day, amount, currentMonth, currentYear, req.user.userId]);
                }
            }
        }

        // Clean up uploaded file
        require('fs').unlinkSync(req.file.path);

        res.json({
            success: true,
            message: `Successfully imported ${data.length - 1} patients`
        });
    } catch (error) {
        console.error('Import error:', error);
        res.status(500).json({ success: false, message: 'Import failed' });
    }
});

// Admin routes - User management
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, username, role, created_at 
            FROM users 
            ORDER BY created_at DESC
        `);

        res.json({
            success: true,
            users: result.rows
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ success: false, message: 'Failed to load users' });
    }
});

app.post('/api/admin/users/add', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { username, password, role } = req.body;

        if (!username || !password || !role) {
            return res.status(400).json({ 
                success: false, 
                message: 'Username, password, and role are required' 
            });
        }

        if (!['admin', 'rt', 'nurse'].includes(role)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid role' 
            });
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        await pool.query(
            'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
            [username, hashedPassword, role]
        );

        res.json({
            success: true,
            message: 'User added successfully'
        });
    } catch (error) {
        console.error('Add user error:', error);
        if (error.code === '23505') { // Unique violation
            res.status(400).json({ success: false, message: 'Username already exists' });
        } else {
            res.status(500).json({ success: false, message: 'Failed to add user' });
        }
    }
});

app.delete('/api/admin/users/delete', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'User ID is required' 
            });
        }

        // Prevent deleting self
        if (userId === req.user.userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete your own account' 
            });
        }

        await pool.query('DELETE FROM users WHERE id = $1', [userId]);

        res.json({
            success: true,
            message: 'User deleted successfully'
        });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete user' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
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
        success: false, 
        message: 'Route not found' 
    });
});

// Start server
async function startServer() {
    try {
        await initializeDatabase();
        
        app.listen(PORT, () => {
            console.log(`🚀 Wound Care RT Supply Tracker server running on port ${PORT}`);
            console.log(`🌐 Access your app at: http://localhost:${PORT}`);
            console.log(`👤 Default login: admin / admin123`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
