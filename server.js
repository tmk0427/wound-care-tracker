const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your_secure_jwt_secret_key_change_in_production';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database connection
const db = new sqlite3.Database('wound_care.db', (err) => {
    if (err) {
        console.error('❌ Database connection error:', err.message);
    } else {
        console.log('✅ Connected to SQLite database');
        initializeTables();
    }
});

// Initialize database tables
function initializeTables() {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        facility_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Facilities table
    db.run(`CREATE TABLE IF NOT EXISTS facilities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        address TEXT,
        phone TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Patients table
    db.run(`CREATE TABLE IF NOT EXISTS patients (
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (facility_id) REFERENCES facilities (id)
    )`);

    // Supply types table
    db.run(`CREATE TABLE IF NOT EXISTS supply_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        ar_code TEXT UNIQUE,
        unit TEXT DEFAULT 'each',
        cost_per_unit DECIMAL(10,2),
        reorder_level INTEGER DEFAULT 10,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Supply inventory table
    db.run(`CREATE TABLE IF NOT EXISTS supply_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supply_type_id INTEGER NOT NULL,
        facility_id INTEGER NOT NULL,
        current_stock INTEGER DEFAULT 0,
        reserved_stock INTEGER DEFAULT 0,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (supply_type_id) REFERENCES supply_types (id),
        FOREIGN KEY (facility_id) REFERENCES facilities (id)
    )`);

    // Supply usage tracking table
    db.run(`CREATE TABLE IF NOT EXISTS supply_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        supply_type_id INTEGER NOT NULL,
        facility_id INTEGER NOT NULL,
        quantity_used INTEGER NOT NULL,
        usage_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        user_id INTEGER,
        notes TEXT,
        FOREIGN KEY (patient_id) REFERENCES patients (id),
        FOREIGN KEY (supply_type_id) REFERENCES supply_types (id),
        FOREIGN KEY (facility_id) REFERENCES facilities (id),
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    console.log('✅ Database tables initialized');
    seedInitialData();
}

// Seed initial data
function seedInitialData() {
    // Create default admin user
    const adminEmail = 'admin@system.com';
    const adminPassword = bcrypt.hashSync('admin123', 10);
    
    db.run(`INSERT OR IGNORE INTO users (email, password, name, role) 
            VALUES (?, ?, ?, ?)`, 
            [adminEmail, adminPassword, 'System Admin', 'admin']);

    // Create default facility
    db.run(`INSERT OR IGNORE INTO facilities (name, address, phone) 
            VALUES ('Main Healthcare Facility', '123 Healthcare Blvd', '555-0100')`);

    // Add essential wound care supplies
    const supplies = [
        ['Gauze Pads 4x4"', 'dressing', 'AR001', 'each', 0.50, 50],
        ['Medical Tape 1"', 'tape', 'AR002', 'roll', 3.25, 20],
        ['Saline Solution 500ml', 'cleaning', 'AR003', 'bottle', 4.75, 15],
        ['Wound Cleanser', 'cleaning', 'AR004', 'bottle', 8.50, 10],
        ['Hydrogel Dressing', 'dressing', 'AR005', 'each', 12.00, 25],
        ['Foam Dressing Large', 'dressing', 'AR006', 'each', 15.50, 20],
        ['Transparent Film 6x7"', 'dressing', 'AR007', 'each', 8.25, 30],
        ['Compression Bandage 4"', 'bandage', 'AR008', 'each', 6.75, 15],
        ['Antiseptic Wipes', 'cleaning', 'AR009', 'pack', 2.25, 40],
        ['Medical Gloves (Box)', 'ppe', 'AR010', 'box', 12.50, 10]
    ];

    const stmt = db.prepare(`INSERT OR IGNORE INTO supply_types 
                            (name, category, ar_code, unit, cost_per_unit, reorder_level) 
                            VALUES (?, ?, ?, ?, ?, ?)`);
    
    supplies.forEach(supply => {
        stmt.run(supply);
    });
    stmt.finalize();

    console.log('✅ Initial data seeded');
}

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
}

// Authentication routes
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
        if (err) {
            console.error('Login error:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }

        if (!user || !bcrypt.compareSync(password, user.password)) {
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

app.post('/api/auth/register', (req, res) => {
    const { email, password, name, role = 'user', facility_id } = req.body;

    if (!email || !password || !name) {
        return res.status(400).json({ success: false, error: 'Email, password, and name required' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);

    db.run('INSERT INTO users (email, password, name, role, facility_id) VALUES (?, ?, ?, ?, ?)',
        [email, hashedPassword, name, role, facility_id], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(409).json({ success: false, error: 'Email already exists' });
            }
            return res.status(500).json({ success: false, error: 'Registration failed' });
        }

        const token = jwt.sign(
            { userId: this.lastID, email, role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.status(201).json({
            success: true,
            token,
            user: { id: this.lastID, email, name, role, facility_id }
        });
    });
});

// Patient routes
app.get('/api/patients', authenticateToken, (req, res) => {
    const query = `
        SELECT p.*, f.name as facility_name 
        FROM patients p 
        LEFT JOIN facilities f ON p.facility_id = f.id
        WHERE p.status = 'active'
        ORDER BY p.name
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error fetching patients:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, patients: rows || [] });
    });
});

app.post('/api/patients', authenticateToken, (req, res) => {
    const { patient_id, name, room, facility_id, admission_date, wound_type, severity, notes } = req.body;

    if (!patient_id || !name) {
        return res.status(400).json({ success: false, error: 'Patient ID and name required' });
    }

    db.run(`INSERT INTO patients (patient_id, name, room, facility_id, admission_date, wound_type, severity, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [patient_id, name, room, facility_id, admission_date, wound_type, severity, notes],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(409).json({ success: false, error: 'Patient ID already exists' });
                }
                return res.status(500).json({ success: false, error: 'Failed to create patient' });
            }

            res.status(201).json({
                success: true,
                patient: { id: this.lastID, patient_id, name, room, facility_id }
            });
        }
    );
});

// Supply routes
app.get('/api/supplies', authenticateToken, (req, res) => {
    const query = `
        SELECT st.*, 
               COALESCE(si.current_stock, 0) as current_stock,
               COALESCE(si.reserved_stock, 0) as reserved_stock
        FROM supply_types st
        LEFT JOIN supply_inventory si ON st.id = si.supply_type_id 
            AND si.facility_id = ?
        ORDER BY st.category, st.name
    `;

    const facilityId = req.user.facility_id || 1;

    db.all(query, [facilityId], (err, rows) => {
        if (err) {
            console.error('Error fetching supplies:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, supplies: rows || [] });
    });
});

app.post('/api/supplies/usage', authenticateToken, (req, res) => {
    const { patient_id, supply_type_id, quantity_used, notes } = req.body;
    const facility_id = req.user.facility_id || 1;

    if (!patient_id || !supply_type_id || !quantity_used) {
        return res.status(400).json({ success: false, error: 'Patient, supply, and quantity required' });
    }

    db.run(`INSERT INTO supply_usage (patient_id, supply_type_id, facility_id, quantity_used, user_id, notes)
            VALUES (?, ?, ?, ?, ?, ?)`,
        [patient_id, supply_type_id, facility_id, quantity_used, req.user.userId, notes],
        function(err) {
            if (err) {
                console.error('Usage tracking error:', err);
                return res.status(500).json({ success: false, error: 'Failed to track usage' });
            }

            // Update inventory if exists
            db.run(`UPDATE supply_inventory 
                    SET current_stock = current_stock - ?, last_updated = CURRENT_TIMESTAMP
                    WHERE supply_type_id = ? AND facility_id = ? AND current_stock >= ?`,
                [quantity_used, supply_type_id, facility_id, quantity_used]);

            res.status(201).json({
                success: true,
                usage: { id: this.lastID, quantity_used, notes }
            });
        }
    );
});

// Dashboard/analytics routes
app.get('/api/dashboard/stats', authenticateToken, (req, res) => {
    const facility_id = req.user.facility_id || 1;

    const queries = {
        patients: `SELECT COUNT(*) as count FROM patients WHERE status = 'active' AND facility_id = ?`,
        supplies: `SELECT COUNT(*) as count FROM supply_types`,
        lowStock: `SELECT COUNT(*) as count FROM supply_inventory si 
                   JOIN supply_types st ON si.supply_type_id = st.id 
                   WHERE si.facility_id = ? AND si.current_stock <= st.reorder_level`,
        usage: `SELECT COUNT(*) as count FROM supply_usage 
                WHERE facility_id = ? AND DATE(usage_date) = DATE('now')`
    };

    Promise.all([
        new Promise((resolve, reject) => {
            db.get(queries.patients, [facility_id], (err, row) => err ? reject(err) : resolve(row.count));
        }),
        new Promise((resolve, reject) => {
            db.get(queries.supplies, [], (err, row) => err ? reject(err) : resolve(row.count));
        }),
        new Promise((resolve, reject) => {
            db.get(queries.lowStock, [facility_id], (err, row) => err ? reject(err) : resolve(row.count));
        }),
        new Promise((resolve, reject) => {
            db.get(queries.usage, [facility_id], (err, row) => err ? reject(err) : resolve(row.count));
        })
    ]).then(([patients, supplies, lowStock, todayUsage]) => {
        res.json({
            success: true,
            stats: {
                active_patients: patients,
                total_supplies: supplies,
                low_stock_alerts: lowStock,
                today_usage_count: todayUsage
            }
        });
    }).catch(err => {
        console.error('Dashboard stats error:', err);
        res.status(500).json({ success: false, error: 'Failed to load stats' });
    });
});

// Serve the main application
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wound Care RT Supply Tracker</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', system-ui, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh; display: flex; align-items: center; justify-content: center;
        }
        .container { 
            background: white; padding: 2rem; border-radius: 12px; 
            box-shadow: 0 20px 40px rgba(0,0,0,0.1); width: 90%; max-width: 400px;
        }
        .header { text-align: center; margin-bottom: 2rem; }
        .header h1 { color: #4a5568; font-size: 1.8rem; margin-bottom: 0.5rem; }
        .header p { color: #718096; }
        .form-group { margin-bottom: 1.5rem; }
        .form-group label { 
            display: block; margin-bottom: 0.5rem; font-weight: 600; color: #4a5568;
        }
        .form-group input { 
            width: 100%; padding: 0.75rem; border: 2px solid #e2e8f0; 
            border-radius: 6px; font-size: 1rem; transition: border-color 0.3s;
        }
        .form-group input:focus { 
            outline: none; border-color: #667eea; 
        }
        .btn { 
            width: 100%; padding: 0.75rem; background: #667eea; 
            color: white; border: none; border-radius: 6px; 
            font-size: 1rem; font-weight: 600; cursor: pointer; transition: background 0.3s;
        }
        .btn:hover { background: #5a6fd8; }
        .alert { 
            padding: 0.75rem; margin-bottom: 1rem; border-radius: 6px; 
            font-size: 0.9rem;
        }
        .alert-error { background: #fed7d7; color: #c53030; border: 1px solid #feb2b2; }
        .alert-success { background: #c6f6d5; color: #276749; border: 1px solid #9ae6b4; }
        .dashboard { display: none; }
        .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 2rem; }
        .stat-card { 
            background: #f7fafc; padding: 1.5rem; border-radius: 8px; text-align: center;
        }
        .stat-number { font-size: 2rem; font-weight: bold; color: #667eea; }
        .stat-label { font-size: 0.9rem; color: #718096; margin-top: 0.25rem; }
        .section { margin-bottom: 2rem; }
        .section h3 { color: #4a5568; margin-bottom: 1rem; }
        .nav-btn { 
            display: inline-block; margin: 0.5rem 0.5rem 0.5rem 0; padding: 0.5rem 1rem;
            background: #e2e8f0; color: #4a5568; text-decoration: none;
            border-radius: 4px; font-size: 0.9rem; transition: background 0.3s;
        }
        .nav-btn:hover { background: #cbd5e0; }
        .logout-btn { 
            background: #fed7d7; color: #c53030; float: right;
        }
        .logout-btn:hover { background: #fbb6ce; }
    </style>
</head>
<body>
    <div class="container">
        <!-- Login Form -->
        <div id="loginForm" class="login-form">
            <div class="header">
                <h1>🏥 Wound Care Tracker</h1>
                <p>Professional RT Supply Management</p>
            </div>
            
            <div id="alertMessage"></div>
            
            <form id="loginFormElement">
                <div class="form-group">
                    <label for="email">Email Address</label>
                    <input type="email" id="email" name="email" value="admin@system.com" required>
                </div>
                
                <div class="form-group">
                    <label for="password">Password</label>
                    <input type="password" id="password" name="password" value="admin123" required>
                </div>
                
                <button type="submit" class="btn">Sign In</button>
            </form>
        </div>

        <!-- Dashboard -->
        <div id="dashboard" class="dashboard">
            <div class="header">
                <h1>🏥 Dashboard</h1>
                <a href="#" class="logout-btn nav-btn" onclick="logout()">Logout</a>
            </div>

            <div id="dashboardStats" class="stats">
                <div class="stat-card">
                    <div class="stat-number" id="patientsCount">-</div>
                    <div class="stat-label">Active Patients</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="suppliesCount">-</div>
                    <div class="stat-label">Supply Types</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="lowStockCount">-</div>
                    <div class="stat-label">Low Stock</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="usageCount">-</div>
                    <div class="stat-label">Today's Usage</div>
                </div>
            </div>

            <div class="section">
                <h3>Quick Actions</h3>
                <a href="#" class="nav-btn" onclick="showPatients()">👥 View Patients</a>
                <a href="#" class="nav-btn" onclick="showSupplies()">📦 Manage Supplies</a>
                <a href="#" class="nav-btn" onclick="trackUsage()">📊 Track Usage</a>
            </div>

            <div id="contentArea"></div>
        </div>
    </div>

    <script>
        let token = localStorage.getItem('authToken');
        let currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');

        function showAlert(message, type = 'error') {
            const alertDiv = document.getElementById('alertMessage');
            alertDiv.innerHTML = \`<div class="alert alert-\${type}">\${message}</div>\`;
            setTimeout(() => alertDiv.innerHTML = '', 5000);
        }

        // Login function
        document.getElementById('loginFormElement').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                const data = await response.json();

                if (data.success) {
                    localStorage.setItem('authToken', data.token);
                    localStorage.setItem('currentUser', JSON.stringify(data.user));
                    token = data.token;
                    currentUser = data.user;
                    
                    document.getElementById('loginForm').style.display = 'none';
                    document.getElementById('dashboard').style.display = 'block';
                    loadDashboardStats();
                    showAlert('Login successful! Welcome back.', 'success');
                } else {
                    showAlert(data.error || 'Login failed');
                }
            } catch (error) {
                showAlert('Connection error. Please try again.');
            }
        });

        // Load dashboard stats
        async function loadDashboardStats() {
            try {
                const response = await fetch('/api/dashboard/stats', {
                    headers: { 'Authorization': \`Bearer \${token}\` }
                });
                
                const data = await response.json();
                
                if (data.success) {
                    document.getElementById('patientsCount').textContent = data.stats.active_patients;
                    document.getElementById('suppliesCount').textContent = data.stats.total_supplies;
                    document.getElementById('lowStockCount').textContent = data.stats.low_stock_alerts;
                    document.getElementById('usageCount').textContent = data.stats.today_usage_count;
                }
            } catch (error) {
                console.error('Error loading stats:', error);
            }
        }

        function showPatients() {
            showAlert('Patient management feature available via API. Use /api/patients endpoint.', 'success');
        }

        function showSupplies() {
            showAlert('Supply management feature available via API. Use /api/supplies endpoint.', 'success');
        }

        function trackUsage() {
            showAlert('Usage tracking feature available via API. Use /api/supplies/usage endpoint.', 'success');
        }

        function logout() {
            localStorage.removeItem('authToken');
            localStorage.removeItem('currentUser');
            token = null;
            currentUser = {};
            
            document.getElementById('dashboard').style.display = 'none';
            document.getElementById('loginForm').style.display = 'block';
            showAlert('Logged out successfully.', 'success');
        }

        // Check if user is already logged in
        if (token && currentUser.email) {
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('dashboard').style.display = 'block';
            loadDashboardStats();
        }
    </script>
</body>
</html>
    `);
});

// Start server
app.listen(PORT, () => {
    console.log('');
    console.log('🏥 ================================');
    console.log('   WOUND CARE RT SUPPLY TRACKER');
    console.log('🏥 ================================');
    console.log(`✅ Server running on port ${PORT}`);
    console.log('✅ Database connected (SQLite)');
    console.log('✅ Authentication enabled`);
    console.log('🔑 Default login: admin@system.com / admin123');
    console.log('🏥 ================================');
    console.log('');
});

// Error handling
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled Rejection:', error);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed');
        }
        process.exit(0);
    });
});

module.exports = app;
