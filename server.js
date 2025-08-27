const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'wound-care-secret-key';

// Middleware
app.use(cors());
app.use(express.json());

console.log('🔧 Starting Wound Care Server...');

// Database connection
let db;
try {
    db = new sqlite3.Database('wound_care.db', (err) => {
        if (err) {
            console.error('❌ Database connection error:', err.message);
        } else {
            console.log('✅ Connected to SQLite database');
            initializeDatabase();
        }
    });
} catch (error) {
    console.error('❌ Database initialization error:', error);
    process.exit(1);
}

// Initialize database
function initializeDatabase() {
    console.log('🔧 Initializing database tables...');
    
    // Create tables with proper async handling
    const tables = [
        {
            name: 'users',
            sql: `CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                name TEXT NOT NULL,
                role TEXT DEFAULT 'user',
                facility_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        },
        {
            name: 'facilities',
            sql: `CREATE TABLE IF NOT EXISTS facilities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                address TEXT,
                phone TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        },
        {
            name: 'patients',
            sql: `CREATE TABLE IF NOT EXISTS patients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                room TEXT,
                facility_id INTEGER,
                admission_date DATE,
                wound_type TEXT,
                severity TEXT,
                status TEXT DEFAULT 'active',
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        },
        {
            name: 'supply_types',
            sql: `CREATE TABLE IF NOT EXISTS supply_types (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                ar_code TEXT UNIQUE,
                unit TEXT DEFAULT 'each',
                cost_per_unit DECIMAL(10,2),
                reorder_level INTEGER DEFAULT 10,
                description TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        },
        {
            name: 'supply_usage',
            sql: `CREATE TABLE IF NOT EXISTS supply_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id INTEGER NOT NULL,
                supply_type_id INTEGER NOT NULL,
                facility_id INTEGER NOT NULL,
                quantity_used INTEGER NOT NULL,
                usage_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                user_id INTEGER,
                notes TEXT
            )`
        }
    ];
    
    createTablesSequentially(tables, 0);
}

function createTablesSequentially(tables, index) {
    if (index >= tables.length) {
        console.log('✅ All tables created successfully');
        seedBasicData();
        return;
    }
    
    const table = tables[index];
    console.log(`🔧 Creating table: ${table.name}`);
    
    db.run(table.sql, (err) => {
        if (err) {
            console.error(`❌ Error creating table ${table.name}:`, err.message);
        } else {
            console.log(`✅ Table ${table.name} created`);
        }
        createTablesSequentially(tables, index + 1);
    });
}

function seedBasicData() {
    console.log('🔧 Seeding basic data...');
    
    // Create admin user
    const adminPassword = bcrypt.hashSync('admin123', 10);
    db.run(`INSERT OR IGNORE INTO users (email, password, name, role) 
            VALUES (?, ?, ?, ?)`, 
            ['admin@system.com', adminPassword, 'System Admin', 'admin'], (err) => {
        if (err) {
            console.error('❌ Admin user creation error:', err.message);
        } else {
            console.log('✅ Admin user created/verified');
        }
    });
    
    // Create default facility
    db.run(`INSERT OR IGNORE INTO facilities (name, address, phone) 
            VALUES (?, ?, ?)`, 
            ['Main Healthcare Facility', '123 Healthcare Blvd', '555-0100'], (err) => {
        if (err) {
            console.error('❌ Facility creation error:', err.message);
        } else {
            console.log('✅ Default facility created/verified');
        }
    });
    
    console.log('✅ Database initialization complete');
}

// Authentication middleware (FIXED with debugging)
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    console.log('🔐 Auth check - Header:', authHeader ? 'Present' : 'Missing');
    console.log('🔐 Auth check - Token:', token ? 'Present' : 'Missing');

    if (!token) {
        console.log('❌ No token provided');
        return res.status(401).json({ success: false, error: 'Access token required' });
    }

    try {
        const user = jwt.verify(token, JWT_SECRET);
        console.log('✅ Token verified for user:', user.email);
        req.user = user;
        next();
    } catch (err) {
        console.log('❌ Token verification failed:', err.message);
        if (err.name === 'TokenExpiredError') {
            return res.status(403).json({ success: false, error: 'Token expired' });
        } else if (err.name === 'JsonWebTokenError') {
            return res.status(403).json({ success: false, error: 'Invalid token format' });
        } else {
            return res.status(403).json({ success: false, error: 'Token verification failed', details: err.message });
        }
    }
}

// Routes
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Wound Care RT Supply Tracker</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
        .container { background: white; padding: 30px; border-radius: 8px; max-width: 800px; }
        .success { color: #38a169; background: #c6f6d5; padding: 15px; border-radius: 8px; margin: 1rem 0; }
        .btn { padding: 10px 20px; background: #4299e1; color: white; border: none; border-radius: 4px; margin: 5px; cursor: pointer; }
        .btn:hover { background: #3182ce; }
        .endpoint { background: #f8f9fa; padding: 10px; margin: 5px 0; border-radius: 4px; font-family: monospace; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🏥 Wound Care RT Supply Tracker</h1>
        
        <div class="success">
            ✅ <strong>Server Running Successfully!</strong><br>
            Simple, stable server with database connection working.
        </div>
        
        <h3>🔑 Login Credentials</h3>
        <div class="endpoint">
            <strong>Email:</strong> admin@system.com<br>
            <strong>Password:</strong> admin123
        </div>
        
        <h3>📋 Available API Endpoints</h3>
        <div class="endpoint">POST /api/auth/login - User login</div>
        <div class="endpoint">GET /api/patients - Get all patients</div>
        <div class="endpoint">GET /api/supplies - Get all supplies</div>
        <div class="endpoint">GET /api/facilities - Get all facilities</div>
        <div class="endpoint">GET /api/tracking - Get usage tracking</div>
        <div class="endpoint">GET /api/debug - Debug information</div>
        
        <h3>🧪 Quick Test</h3>
        <button class="btn" onclick="testServer()">Test Server Connection</button>
        <div id="result" style="margin-top: 15px;"></div>
        
        <script>
            async function testServer() {
                try {
                    const response = await fetch('/api/debug');
                    const data = await response.json();
                    document.getElementById('result').innerHTML = 
                        '<div class="success">✅ Server test successful! Database tables: ' + 
                        data.tables.length + '</div>';
                } catch (error) {
                    document.getElementById('result').innerHTML = 
                        '<div style="color: red;">❌ Server test failed: ' + error.message + '</div>';
                }
            }
        </script>
    </div>
</body>
</html>
    `);
});

// Auth routes
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
        if (err) {
            console.error('❌ Login error:', err.message);
            return res.status(500).json({ success: false, error: 'Database error' });
        }

        if (!user) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        if (!bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                facility_id: user.facility_id
            }
        });
    });
});

// Basic API routes
app.get('/api/patients', authenticateToken, (req, res) => {
    console.log('📊 Fetching patients...');
    
    const query = `SELECT * FROM patients WHERE status = 'active' OR status IS NULL ORDER BY name`;
    
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('❌ Patients error:', err.message);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        
        console.log(`✅ Patients fetched: ${rows.length}`);
        res.json({ success: true, patients: rows || [] });
    });
});

app.get('/api/supplies', authenticateToken, (req, res) => {
    console.log('📦 Fetching supplies...');
    
    const query = `SELECT * FROM supply_types ORDER BY category, name`;
    
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('❌ Supplies error:', err.message);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        
        console.log(`✅ Supplies fetched: ${rows.length}`);
        res.json({ success: true, supplies: rows || [] });
    });
});

app.get('/api/facilities', authenticateToken, (req, res) => {
    console.log('🏢 Fetching facilities...');
    
    db.all('SELECT * FROM facilities ORDER BY name', [], (err, rows) => {
        if (err) {
            console.error('❌ Facilities error:', err.message);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        
        console.log(`✅ Facilities fetched: ${rows.length}`);
        res.json({ success: true, facilities: rows || [] });
    });
});

app.get('/api/tracking', authenticateToken, (req, res) => {
    console.log('📈 Fetching tracking data...');
    
    const query = `
        SELECT su.*, p.name as patient_name, st.name as supply_name
        FROM supply_usage su
        LEFT JOIN patients p ON su.patient_id = p.id
        LEFT JOIN supply_types st ON su.supply_type_id = st.id
        ORDER BY su.usage_date DESC
        LIMIT 50
    `;
    
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('❌ Tracking error:', err.message);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        
        console.log(`✅ Tracking fetched: ${rows.length}`);
        res.json({ success: true, tracking: rows || [] });
    });
});

// Debug route (no auth required)
app.get('/api/debug', (req, res) => {
    console.log('🔍 Debug info requested');
    
    db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        
        res.json({
            success: true,
            server: 'Simple Wound Care Server',
            database: 'Connected',
            tables: tables.map(t => t.name),
            timestamp: new Date().toISOString(),
            jwtSecret: JWT_SECRET ? 'Set' : 'Missing'
        });
    });
});

// Test token endpoint
app.get('/api/test-token', authenticateToken, (req, res) => {
    console.log('🔧 Token test for user:', req.user);
    res.json({
        success: true,
        message: 'Token is valid',
        user: req.user,
        timestamp: new Date().toISOString()
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        message: 'Simple server running',
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, () => {
    console.log('');
    console.log('🏥 ================================');
    console.log('   SIMPLE WOUND CARE SERVER');
    console.log('🏥 ================================');
    console.log(`✅ Server: http://localhost:${PORT}`);
    console.log('✅ Database: SQLite connected');
    console.log('✅ Authentication: JWT enabled');
    console.log('🔑 Login: admin@system.com / admin123');
    console.log('🏥 ================================');
    console.log('');
});

// Error handling
process.on('uncaughtException', (error) => {
    console.error('❌ UNCAUGHT EXCEPTION:', error.message);
    console.error('Stack:', error.stack);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ UNHANDLED REJECTION:', error?.message);
    console.error('Stack:', error?.stack);
});

console.log('🚀 Server.js loaded successfully');
