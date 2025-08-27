const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

console.log('🔧 TESTING COMPLEX DATABASE FEATURES...');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your_secure_jwt_secret_key_change_in_production';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

console.log('✅ Basic middleware added');

// Database connection
const db = new sqlite3.Database('wound_care.db', (err) => {
    if (err) {
        console.error('❌ Database connection error:', err.message);
        process.exit(1);
    } else {
        console.log('✅ Connected to SQLite database');
        console.log('🔧 Starting complex table initialization...');
        initializeTables();
    }
});

// Initialize database tables (COMPLEX VERSION)
function initializeTables() {
    console.log('🔧 Step 1: Creating users table...');
    
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        facility_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.error('❌ Users table creation failed:', err);
            return;
        }
        console.log('✅ Users table created');
        createFacilitiesTable();
    });
}

function createFacilitiesTable() {
    console.log('🔧 Step 2: Creating facilities table...');
    
    db.run(`CREATE TABLE IF NOT EXISTS facilities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        address TEXT,
        phone TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.error('❌ Facilities table creation failed:', err);
            return;
        }
        console.log('✅ Facilities table created');
        createPatientsTable();
    });
}

function createPatientsTable() {
    console.log('🔧 Step 3: Creating patients table...');
    
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
    )`, (err) => {
        if (err) {
            console.error('❌ Patients table creation failed:', err);
            return;
        }
        console.log('✅ Patients table created');
        createSupplyTypesTable();
    });
}

function createSupplyTypesTable() {
    console.log('🔧 Step 4: Creating supply_types table...');
    
    db.run(`CREATE TABLE IF NOT EXISTS supply_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        ar_code TEXT UNIQUE,
        unit TEXT DEFAULT 'each',
        cost_per_unit DECIMAL(10,2),
        reorder_level INTEGER DEFAULT 10,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.error('❌ Supply types table creation failed:', err);
            return;
        }
        console.log('✅ Supply types table created');
        createInventoryTables();
    });
}

function createInventoryTables() {
    console.log('🔧 Step 5: Creating inventory tables...');
    
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
    )`, (err) => {
        if (err) {
            console.error('❌ Supply inventory table creation failed:', err);
            return;
        }
        console.log('✅ Supply inventory table created');
        createUsageTable();
    });
}

function createUsageTable() {
    console.log('🔧 Step 6: Creating usage tracking table...');
    
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
    )`, (err) => {
        if (err) {
            console.error('❌ Supply usage table creation failed:', err);
            return;
        }
        console.log('✅ Supply usage table created');
        console.log('🎉 ALL TABLES CREATED SUCCESSFULLY!');
        console.log('🔧 Starting data seeding...');
        seedInitialData();
    });
}

// Seed initial data (COMPLEX VERSION)
function seedInitialData() {
    console.log('🔧 Seeding Step 1: Creating admin user...');
    
    const adminEmail = 'admin@system.com';
    const adminPassword = bcrypt.hashSync('admin123', 10);
    
    db.run(`INSERT OR IGNORE INTO users (email, password, name, role) 
            VALUES (?, ?, ?, ?)`, 
            [adminEmail, adminPassword, 'System Admin', 'admin'], (err) => {
        if (err) {
            console.error('❌ Admin user creation failed:', err);
        } else {
            console.log('✅ Admin user created/verified');
            seedFacility();
        }
    });
}

function seedFacility() {
    console.log('🔧 Seeding Step 2: Creating default facility...');
    
    db.run(`INSERT OR IGNORE INTO facilities (name, address, phone) 
            VALUES ('Main Healthcare Facility', '123 Healthcare Blvd', '555-0100')`, (err) => {
        if (err) {
            console.error('❌ Facility creation failed:', err);
        } else {
            console.log('✅ Default facility created/verified');
            seedSupplies();
        }
    });
}

function seedSupplies() {
    console.log('🔧 Seeding Step 3: Adding essential supplies...');
    
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
    
    let completed = 0;
    supplies.forEach((supply, index) => {
        stmt.run(supply, (err) => {
            if (err) {
                console.error(`❌ Supply ${index + 1} creation failed:`, err);
            } else {
                completed++;
                console.log(`✅ Supply ${index + 1}/10 added: ${supply[0]}`);
                
                if (completed === supplies.length) {
                    stmt.finalize();
                    console.log('🎉 ALL SUPPLIES SEEDED SUCCESSFULLY!');
                    console.log('✅ Database initialization complete!');
                }
            }
        });
    });
}

// Basic authentication middleware
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

// Routes
app.get('/', (req, res) => {
    res.json({
        status: 'Complex database test server',
        message: 'Testing complex database initialization and seeding',
        timestamp: new Date().toISOString(),
        features: [
            'Multiple table creation',
            'Foreign key constraints', 
            'Complex data seeding',
            'Bcrypt password hashing',
            'Prepared statements'
        ]
    });
});

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    // NOW TEST REAL DATABASE QUERY
    db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
        if (err) {
            console.error('❌ Login database query failed:', err);
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

app.get('/api/supplies', authenticateToken, (req, res) => {
    console.log('📍 Testing supplies query...');
    
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
            console.error('❌ Supplies query failed:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        console.log(`✅ Supplies query successful: ${rows.length} items`);
        res.json({ success: true, supplies: rows || [] });
    });
});

app.listen(PORT, () => {
    console.log('');
    console.log('🔧 ================================');
    console.log('   COMPLEX DATABASE TEST SERVER');
    console.log('🔧 ================================');
    console.log(`✅ Server running on port ${PORT}`);
    console.log('✅ Complex database features loaded');
    console.log('🔑 Real login: admin@system.com / admin123');
    console.log('🔧 ================================');
    console.log('');
});

process.on('uncaughtException', (error) => {
    console.error('❌ UNCAUGHT EXCEPTION in complex DB test:', error.message);
    console.error('Stack:', error.stack);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ UNHANDLED REJECTION in complex DB test:', error.message);
    console.error('Stack:', error?.stack);
});
