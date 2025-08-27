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
        console.log('✅ Connected to SQLite production database');
        initializeTables();
    }
});

// Initialize database tables (FIXED ASYNC VERSION)
function initializeTables() {
    console.log('🔧 Step 1: Creating users table...');
    
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
        description TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.error('❌ Supply types table creation failed:', err);
            return;
        }
        console.log('✅ Supply types table created');
        createInventoryTable();
    });
}

function createInventoryTable() {
    console.log('🔧 Step 5: Creating supply_inventory table...');
    
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
    console.log('🔧 Step 6: Creating supply_usage table...');
    
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

// Seed initial data (FIXED ASYNC VERSION)
function seedInitialData() {
    console.log('🔧 Seeding Step 1: Creating admin user...');
    
    const adminEmail = 'admin@system.com';
    const adminPassword = bcrypt.hashSync('admin123', 10);
    
    db.run(`INSERT OR IGNORE INTO users (email, password, name, role) 
            VALUES (?, ?, ?, ?)`, 
            [adminEmail, adminPassword, 'System Admin', 'admin'], (err) => {
        if (err) {
            console.error('❌ Admin user creation failed:', err);
            return;
        }
        console.log('✅ Admin user created/verified');
        seedFacility();
    });
}

function seedFacility() {
    console.log('🔧 Seeding Step 2: Creating default facility...');
    
    db.run(`INSERT OR IGNORE INTO facilities (name, address, phone) 
            VALUES ('Main Healthcare Facility', '123 Healthcare Blvd', '555-0100')`, (err) => {
        if (err) {
            console.error('❌ Facility creation failed:', err);
            return;
        }
        console.log('✅ Default facility created/verified');
        seedSupplies();
    });
}

function seedSupplies() {
    console.log('🔧 Seeding Step 3: Adding essential supplies...');
    
    const supplies = [
        ['Gauze Pads 4x4"', 'dressing', 'AR001', 'each', 0.50, 50, 'Sterile gauze pads for wound dressing'],
        ['Medical Tape 1"', 'tape', 'AR002', 'roll', 3.25, 20, 'Medical adhesive tape for securing dressings'],
        ['Saline Solution 500ml', 'cleaning', 'AR003', 'bottle', 4.75, 15, 'Sterile saline solution for wound irrigation'],
        ['Wound Cleanser', 'cleaning', 'AR004', 'bottle', 8.50, 10, 'Antimicrobial wound cleanser'],
        ['Hydrogel Dressing', 'dressing', 'AR005', 'each', 12.00, 25, 'Hydrogel dressing for moist wound healing'],
        ['Foam Dressing Large', 'dressing', 'AR006', 'each', 15.50, 20, 'Absorbent foam dressing for exuding wounds'],
        ['Transparent Film 6x7"', 'dressing', 'AR007', 'each', 8.25, 30, 'Transparent film dressing with adhesive border'],
        ['Compression Bandage 4"', 'bandage', 'AR008', 'each', 6.75, 15, 'Elastic compression bandage'],
        ['Antiseptic Wipes', 'cleaning', 'AR009', 'pack', 2.25, 40, 'Pre-moistened antiseptic wipes'],
        ['Medical Gloves (Box)', 'ppe', 'AR010', 'box', 12.50, 10, 'Disposable examination gloves, box of 100']
    ];

    const stmt = db.prepare(`INSERT OR IGNORE INTO supply_types 
                            (name, category, ar_code, unit, cost_per_unit, reorder_level, description) 
                            VALUES (?, ?, ?, ?, ?, ?, ?)`);
    
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
                    console.log('🎉 ALL SUPPLIES SEEDED!');
                    seedPatients();
                }
            }
        });
    });
}

function seedPatients() {
    console.log('🔧 Seeding Step 4: Adding sample patients...');
    
    const patients = [
        ['PT001', 'John Smith', '101A', 1, '2025-08-20', 'Pressure Ulcer', 'Stage 2', 'Patient recovering well'],
        ['PT002', 'Jane Doe', '102B', 1, '2025-08-22', 'Surgical Wound', 'Moderate', 'Post-operative care'],
        ['PT003', 'Robert Johnson', '103A', 1, '2025-08-25', 'Diabetic Ulcer', 'Stage 3', 'Requires daily dressing changes']
    ];

    const stmt = db.prepare(`INSERT OR IGNORE INTO patients 
                           (patient_id, name, room, facility_id, admission_date, wound_type, severity, notes) 
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    
    let completed = 0;
    patients.forEach((patient, index) => {
        stmt.run(patient, (err) => {
            if (err) {
                console.error(`❌ Patient ${index + 1} creation failed:`, err);
            } else {
                completed++;
                console.log(`✅ Patient ${index + 1}/3 added: ${patient[1]}`);
                
                if (completed === patients.length) {
                    stmt.finalize();
                    console.log('🎉 ALL PATIENTS SEEDED!');
                    console.log('✅ DATABASE INITIALIZATION COMPLETE!');
                }
            }
        });
    });
}

// Authentication middleware
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

// Patient routes (FIXED)
app.get('/api/patients', authenticateToken, (req, res) => {
    console.log('👥 Fetching patients...');
    
    const query = `
        SELECT 
            p.id,
            p.patient_id,
            p.name,
            p.room,
            p.facility_id,
            p.admission_date,
            p.wound_type,
            p.severity,
            p.status,
            p.notes,
            p.created_at,
            f.name as facility_name
        FROM patients p 
        LEFT JOIN facilities f ON p.facility_id = f.id
        WHERE p.status = 'active' OR p.status IS NULL
        ORDER BY p.name
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('❌ Error fetching patients:', err.message);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to fetch patients',
                details: err.message 
            });
        }
        
        console.log(`✅ Patients fetched: ${rows.length} records`);
        
        // Ensure all patients have required fields
        const patients = rows.map(patient => ({
            id: patient.id,
            patient_id: patient.patient_id || 'N/A',
            name: patient.name || 'Unknown Patient',
            room: patient.room || 'N/A',
            facility_id: patient.facility_id,
            facility_name: patient.facility_name || 'Unknown Facility',
            admission_date: patient.admission_date || null,
            wound_type: patient.wound_type || 'Not specified',
            severity: patient.severity || 'Not specified',
            status: patient.status || 'active',
            notes: patient.notes || '',
            created_at: patient.created_at
        }));
        
        res.json({ success: true, patients });
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

// Facilities routes
app.get('/api/facilities', authenticateToken, (req, res) => {
    db.all('SELECT * FROM facilities ORDER BY name', [], (err, rows) => {
        if (err) {
            console.error('Error fetching facilities:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, facilities: rows || [] });
    });
});

app.post('/api/facilities', authenticateToken, (req, res) => {
    const { name, address, phone } = req.body;

    if (!name) {
        return res.status(400).json({ success: false, error: 'Facility name required' });
    }

    db.run('INSERT INTO facilities (name, address, phone) VALUES (?, ?, ?)',
        [name, address, phone], function(err) {
        if (err) {
            return res.status(500).json({ success: false, error: 'Failed to create facility' });
        }

        res.status(201).json({
            success: true,
            facility: { id: this.lastID, name, address, phone }
        });
    });
});

// Supply routes (FIXED)
app.get('/api/supplies', authenticateToken, (req, res) => {
    console.log('📦 Fetching supplies...');
    
    const query = `
        SELECT 
            st.id,
            st.name,
            st.category,
            st.ar_code,
            st.unit,
            st.cost_per_unit,
            st.reorder_level,
            st.description,
            COALESCE(si.current_stock, 0) as current_stock,
            COALESCE(si.reserved_stock, 0) as reserved_stock,
            st.created_at
        FROM supply_types st
        LEFT JOIN supply_inventory si ON st.id = si.supply_type_id 
            AND si.facility_id = COALESCE(?, 1)
        ORDER BY st.category, st.name
    `;

    const facilityId = req.user.facility_id || 1;

    db.all(query, [facilityId], (err, rows) => {
        if (err) {
            console.error('❌ Error fetching supplies:', err.message);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to fetch supplies',
                details: err.message 
            });
        }
        
        console.log(`✅ Supplies fetched: ${rows.length} items`);
        
        // Ensure all supplies have required fields
        const supplies = rows.map(supply => ({
            id: supply.id,
            name: supply.name || 'Unknown Supply',
            category: supply.category || 'uncategorized',
            ar_code: supply.ar_code || '',
            unit: supply.unit || 'each',
            cost_per_unit: supply.cost_per_unit || 0,
            reorder_level: supply.reorder_level || 10,
            description: supply.description || '',
            current_stock: supply.current_stock || 0,
            reserved_stock: supply.reserved_stock || 0,
            created_at: supply.created_at
        }));
        
        res.json({ success: true, supplies });
    });
});

app.post('/api/supplies', authenticateToken, (req, res) => {
    const { name, category, ar_code, unit, cost_per_unit, reorder_level, description } = req.body;

    if (!name || !category) {
        return res.status(400).json({ success: false, error: 'Name and category required' });
    }

    db.run(`INSERT INTO supply_types (name, category, ar_code, unit, cost_per_unit, reorder_level, description)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [name, category, ar_code, unit || 'each', cost_per_unit || 0, reorder_level || 10, description || ''],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(409).json({ success: false, error: 'AR code already exists' });
                }
                return res.status(500).json({ success: false, error: 'Failed to create supply type' });
            }

            res.status(201).json({
                success: true,
                supply: { id: this.lastID, name, category, ar_code }
            });
        }
    );
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

// Dashboard routes (FIXED)
app.get('/api/dashboard', authenticateToken, (req, res) => {
    console.log('📊 Fetching dashboard data...');
    
    const facility_id = req.user.facility_id || 1;

    const queries = {
        patients: `SELECT COUNT(*) as count FROM patients WHERE (status = 'active' OR status IS NULL) AND (facility_id = ? OR ? IS NULL OR facility_id IS NULL)`,
        supplies: `SELECT COUNT(*) as count FROM supply_types`,
        lowStock: `SELECT COUNT(*) as count FROM supply_inventory si 
                   JOIN supply_types st ON si.supply_type_id = st.id 
                   WHERE si.facility_id = ? AND si.current_stock <= st.reorder_level`,
        usage: `SELECT COUNT(*) as count FROM supply_usage 
                WHERE (facility_id = ? OR ? IS NULL) AND DATE(usage_date) = DATE('now')`,
        facilities: `SELECT COUNT(*) as count FROM facilities`,
        totalUsage: `SELECT COUNT(*) as count FROM supply_usage WHERE facility_id = ? OR ? IS NULL`
    };

    Promise.all([
        new Promise((resolve, reject) => {
            db.get(queries.patients, [facility_id, facility_id], (err, row) => {
                if (err) {
                    console.error('❌ Patients count error:', err.message);
                    resolve(0);
                } else {
                    resolve(row?.count || 0);
                }
            });
        }),
        new Promise((resolve, reject) => {
            db.get(queries.supplies, [], (err, row) => {
                if (err) {
                    console.error('❌ Supplies count error:', err.message);
                    resolve(0);
                } else {
                    resolve(row?.count || 0);
                }
            });
        }),
        new Promise((resolve, reject) => {
            db.get(queries.lowStock, [facility_id], (err, row) => {
                if (err) {
                    console.error('❌ Low stock count error:', err.message);
                    resolve(0);
                } else {
                    resolve(row?.count || 0);
                }
            });
        }),
        new Promise((resolve, reject) => {
            db.get(queries.usage, [facility_id, facility_id], (err, row) => {
                if (err) {
                    console.error('❌ Usage today count error:', err.message);
                    resolve(0);
                } else {
                    resolve(row?.count || 0);
                }
            });
        }),
        new Promise((resolve, reject) => {
            db.get(queries.facilities, [], (err, row) => {
                if (err) {
                    console.error('❌ Facilities count error:', err.message);
                    resolve(0);
                } else {
                    resolve(row?.count || 0);
                }
            });
        }),
        new Promise((resolve, reject) => {
            db.get(queries.totalUsage, [facility_id, facility_id], (err, row) => {
                if (err) {
                    console.error('❌ Total usage count error:', err.message);
                    resolve(0);
                } else {
                    resolve(row?.count || 0);
                }
            });
        })
    ]).then(([patients, supplies, lowStock, todayUsage, facilities, totalUsage]) => {
        const dashboardData = {
            active_patients: patients,
            total_supplies: supplies,
            low_stock_alerts: lowStock,
            today_usage_count: todayUsage,
            total_facilities: facilities,
            total_usage: totalUsage
        };
        
        console.log('✅ Dashboard data:', dashboardData);
        
        res.json({
            success: true,
            data: dashboardData,
            stats: dashboardData
        });
    }).catch(err => {
        console.error('❌ Dashboard error:', err.message);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to load dashboard data',
            details: err.message 
        });
    });
});

app.get('/api/dashboard/stats', authenticateToken, (req, res) => {
    const facility_id = req.user.facility_id || 1;

    const queries = {
        patients: `SELECT COUNT(*) as count FROM patients WHERE status = 'active' AND (facility_id = ? OR ? IS NULL)`,
        supplies: `SELECT COUNT(*) as count FROM supply_types`,
        lowStock: `SELECT COUNT(*) as count FROM supply_inventory si 
                   JOIN supply_types st ON si.supply_type_id = st.id 
                   WHERE si.facility_id = ? AND si.current_stock <= st.reorder_level`,
        usage: `SELECT COUNT(*) as count FROM supply_usage 
                WHERE (facility_id = ? OR ? IS NULL) AND DATE(usage_date) = DATE('now')`
    };

    Promise.all([
        new Promise((resolve, reject) => {
            db.get(queries.patients, [facility_id, facility_id], (err, row) => err ? reject(err) : resolve(row.count));
        }),
        new Promise((resolve, reject) => {
            db.get(queries.supplies, [], (err, row) => err ? reject(err) : resolve(row.count));
        }),
        new Promise((resolve, reject) => {
            db.get(queries.lowStock, [facility_id], (err, row) => err ? reject(err) : resolve(row.count));
        }),
        new Promise((resolve, reject) => {
            db.get(queries.usage, [facility_id, facility_id], (err, row) => err ? reject(err) : resolve(row.count));
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

// Search endpoints
app.get('/api/search/patients', authenticateToken, (req, res) => {
    const { query } = req.query;
    if (!query) {
        return res.status(400).json({ success: false, error: 'Search query required' });
    }
    
    const searchQuery = `
        SELECT p.*, f.name as facility_name 
        FROM patients p 
        LEFT JOIN facilities f ON p.facility_id = f.id
        WHERE (p.name LIKE ? OR p.patient_id LIKE ? OR p.room LIKE ?)
        AND p.status = 'active'
        ORDER BY p.name
        LIMIT 20
    `;
    
    const searchTerm = `%${query}%`;
    db.all(searchQuery, [searchTerm, searchTerm, searchTerm], (err, rows) => {
        if (err) {
            console.error('Patient search error:', err);
            return res.status(500).json({ success: false, error: 'Search failed' });
        }
        res.json({ success: true, patients: rows || [] });
    });
});

app.get('/api/search/supplies', authenticateToken, (req, res) => {
    const { query } = req.query;
    if (!query) {
        return res.status(400).json({ success: false, error: 'Search query required' });
    }
    
    const searchQuery = `
        SELECT st.*, 
               COALESCE(si.current_stock, 0) as current_stock,
               COALESCE(si.reserved_stock, 0) as reserved_stock
        FROM supply_types st
        LEFT JOIN supply_inventory si ON st.id = si.supply_type_id 
            AND si.facility_id = ?
        WHERE (st.name LIKE ? OR st.ar_code LIKE ? OR st.category LIKE ?)
        ORDER BY st.name
        LIMIT 20
    `;
    
    const facilityId = req.user.facility_id || 1;
    const searchTerm = `%${query}%`;
    
    db.all(searchQuery, [facilityId, searchTerm, searchTerm, searchTerm], (err, rows) => {
        if (err) {
            console.error('Supply search error:', err);
            return res.status(500).json({ success: false, error: 'Search failed' });
        }
        res.json({ success: true, supplies: rows || [] });
    });
});

// Export endpoints
app.get('/api/export/patients', authenticateToken, (req, res) => {
    const query = `
        SELECT 
            p.patient_id,
            p.name,
            p.room,
            p.admission_date,
            p.wound_type,
            p.severity,
            p.status,
            p.notes,
            f.name as facility_name
        FROM patients p 
        LEFT JOIN facilities f ON p.facility_id = f.id
        WHERE p.status = 'active'
        ORDER BY p.name
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Export patients error:', err);
            return res.status(500).json({ success: false, error: 'Export failed' });
        }
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=patients_export.json');
        res.json({ success: true, patients: rows || [], exported_at: new Date().toISOString() });
    });
});

app.get('/api/export/usage', authenticateToken, (req, res) => {
    const { start_date, end_date } = req.query;
    const facility_id = req.user.facility_id || 1;
    
    const query = `
        SELECT 
            DATE(su.usage_date) as usage_date,
            su.quantity_used,
            su.notes,
            p.name as patient_name,
            p.patient_id,
            p.room,
            st.name as supply_name,
            st.ar_code,
            st.category,
            st.cost_per_unit,
            (su.quantity_used * st.cost_per_unit) as total_cost,
            u.name as user_name
        FROM supply_usage su
        JOIN patients p ON su.patient_id = p.id
        JOIN supply_types st ON su.supply_type_id = st.id
        LEFT JOIN users u ON su.user_id = u.id
        WHERE su.facility_id = ?
        AND (DATE(su.usage_date) >= ? OR ? IS NULL)
        AND (DATE(su.usage_date) <= ? OR ? IS NULL)
        ORDER BY su.usage_date DESC, p.name
    `;
    
    db.all(query, [facility_id, start_date, start_date, end_date, end_date], (err, rows) => {
        if (err) {
            console.error('Export usage error:', err);
            return res.status(500).json({ success: false, error: 'Export failed' });
        }
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=usage_export.json');
        res.json({ 
            success: true, 
            usage: rows || [], 
            exported_at: new Date().toISOString(),
            date_range: { start_date, end_date }
        });
    });
});

// Users management routes
app.get('/api/users', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    
    db.all(`SELECT id, email, name, role, facility_id, created_at 
            FROM users ORDER BY name`, [], (err, rows) => {
        if (err) {
            console.error('Error fetching users:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, users: rows || [] });
    });
});

app.get('/api/profile', authenticateToken, (req, res) => {
    db.get('SELECT id, email, name, role, facility_id, created_at FROM users WHERE id = ?', 
           [req.user.userId], (err, user) => {
        if (err) {
            console.error('Error fetching profile:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        res.json({ success: true, user });
    });
});

// Admin routes
app.get('/api/admin/users', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    
    db.all(`SELECT id, email, name, role, facility_id, created_at 
            FROM users ORDER BY name`, [], (err, rows) => {
        if (err) {
            console.error('Error fetching admin users:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, users: rows || [] });
    });
});

app.get('/api/admin/dashboard', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    
    const queries = {
        totalUsers: `SELECT COUNT(*) as count FROM users`,
        totalPatients: `SELECT COUNT(*) as count FROM patients WHERE status = 'active'`,
        totalSupplies: `SELECT COUNT(*) as count FROM supply_types`,
        totalFacilities: `SELECT COUNT(*) as count FROM facilities`,
        totalUsageToday: `SELECT COUNT(*) as count FROM supply_usage WHERE DATE(usage_date) = DATE('now')`,
        totalUsageWeek: `SELECT COUNT(*) as count FROM supply_usage WHERE DATE(usage_date) >= DATE('now', '-7 days')`,
        recentUsers: `SELECT email, name, created_at FROM users ORDER BY created_at DESC LIMIT 5`,
        lowStock: `SELECT COUNT(*) as count FROM supply_inventory si 
                   JOIN supply_types st ON si.supply_type_id = st.id 
                   WHERE si.current_stock <= st.reorder_level`
    };

    Promise.all([
        new Promise((resolve, reject) => {
            db.get(queries.totalUsers, [], (err, row) => err ? reject(err) : resolve(row.count));
        }),
        new Promise((resolve, reject) => {
            db.get(queries.totalPatients, [], (err, row) => err ? reject(err) : resolve(row.count));
        }),
        new Promise((resolve, reject) => {
            db.get(queries.totalSupplies, [], (err, row) => err ? reject(err) : resolve(row.count));
        }),
        new Promise((resolve, reject) => {
            db.get(queries.totalFacilities, [], (err, row) => err ? reject(err) : resolve(row.count));
        }),
        new Promise((resolve, reject) => {
            db.get(queries.totalUsageToday, [], (err, row) => err ? reject(err) : resolve(row.count));
        }),
        new Promise((resolve, reject) => {
            db.get(queries.totalUsageWeek, [], (err, row) => err ? reject(err) : resolve(row.count));
        }),
        new Promise((resolve, reject) => {
            db.all(queries.recentUsers, [], (err, rows) => err ? reject(err) : resolve(rows));
        }),
        new Promise((resolve, reject) => {
            db.get(queries.lowStock, [], (err, row) => err ? reject(err) : resolve(row.count));
        })
    ]).then(([users, patients, supplies, facilities, usageToday, usageWeek, recentUsers, lowStock]) => {
        res.json({
            success: true,
            dashboard: {
                total_users: users,
                total_patients: patients,
                total_supplies: supplies,
                total_facilities: facilities,
                usage_today: usageToday,
                usage_week: usageWeek,
                low_stock_alerts: lowStock,
                recent_users: recentUsers
            },
            stats: {
                total_users: users,
                total_patients: patients,
                total_supplies: supplies,
                total_facilities: facilities,
                usage_today: usageToday,
                usage_week: usageWeek,
                low_stock_alerts: lowStock
            }
        });
    }).catch(err => {
        console.error('Admin dashboard error:', err);
        res.status(500).json({ success: false, error: 'Failed to load admin dashboard' });
    });
});

app.get('/api/admin/reports', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    
    // Return available reports
    res.json({
        success: true,
        reports: [
            { id: 'usage', name: 'Usage Report', endpoint: '/api/reports/usage' },
            { id: 'patients', name: 'Patients Export', endpoint: '/api/export/patients' },
            { id: 'usage_export', name: 'Usage Export', endpoint: '/api/export/usage' },
            { id: 'inventory', name: 'Inventory Report', endpoint: '/api/inventory' }
        ]
    });
});

app.get('/api/admin/patients', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    
    const query = `
        SELECT p.*, f.name as facility_name,
               COUNT(su.id) as usage_count,
               MAX(su.usage_date) as last_usage
        FROM patients p 
        LEFT JOIN facilities f ON p.facility_id = f.id
        LEFT JOIN supply_usage su ON p.id = su.patient_id
        GROUP BY p.id
        ORDER BY p.created_at DESC
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error fetching admin patients:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, patients: rows || [] });
    });
});

app.get('/api/admin/supplies', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    
    const query = `
        SELECT st.*, 
               AVG(si.current_stock) as avg_stock,
               SUM(su.quantity_used) as total_usage,
               COUNT(DISTINCT su.patient_id) as patients_using
        FROM supply_types st
        LEFT JOIN supply_inventory si ON st.id = si.supply_type_id
        LEFT JOIN supply_usage su ON st.id = su.supply_type_id
        GROUP BY st.id
        ORDER BY total_usage DESC, st.name
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error fetching admin supplies:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, supplies: rows || [] });
    });
});

app.get('/api/admin/stats', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    
    const queries = {
        totalUsers: `SELECT COUNT(*) as count FROM users`,
        totalPatients: `SELECT COUNT(*) as count FROM patients`,
        totalSupplies: `SELECT COUNT(*) as count FROM supply_types`,
        totalFacilities: `SELECT COUNT(*) as count FROM facilities`,
        totalUsageToday: `SELECT COUNT(*) as count FROM supply_usage WHERE DATE(usage_date) = DATE('now')`,
        totalUsageWeek: `SELECT COUNT(*) as count FROM supply_usage WHERE DATE(usage_date) >= DATE('now', '-7 days')`
    };

    Promise.all([
        new Promise((resolve, reject) => {
            db.get(queries.totalUsers, [], (err, row) => err ? reject(err) : resolve(row.count));
        }),
        new Promise((resolve, reject) => {
            db.get(queries.totalPatients, [], (err, row) => err ? reject(err) : resolve(row.count));
        }),
        new Promise((resolve, reject) => {
            db.get(queries.totalSupplies, [], (err, row) => err ? reject(err) : resolve(row.count));
        }),
        new Promise((resolve, reject) => {
            db.get(queries.totalFacilities, [], (err, row) => err ? reject(err) : resolve(row.count));
        }),
        new Promise((resolve, reject) => {
            db.get(queries.totalUsageToday, [], (err, row) => err ? reject(err) : resolve(row.count));
        }),
        new Promise((resolve, reject) => {
            db.get(queries.totalUsageWeek, [], (err, row) => err ? reject(err) : resolve(row.count));
        })
    ]).then(([users, patients, supplies, facilities, usageToday, usageWeek]) => {
        res.json({
            success: true,
            stats: {
                total_users: users,
                total_patients: patients,
                total_supplies: supplies,
                total_facilities: facilities,
                usage_today: usageToday,
                usage_week: usageWeek
            }
        });
    }).catch(err => {
        console.error('Admin stats error:', err);
        res.status(500).json({ success: false, error: 'Failed to load admin stats' });
    });
});

// Inventory management routes
app.get('/api/inventory', authenticateToken, (req, res) => {
    const facility_id = req.user.facility_id || 1;
    
    const query = `
        SELECT 
            st.id,
            st.name,
            st.category,
            st.ar_code,
            st.unit,
            st.cost_per_unit,
            st.reorder_level,
            st.description,
            COALESCE(si.current_stock, 0) as current_stock,
            COALESCE(si.reserved_stock, 0) as reserved_stock,
            si.last_updated
        FROM supply_types st
        LEFT JOIN supply_inventory si ON st.id = si.supply_type_id 
            AND si.facility_id = ?
        ORDER BY st.category, st.name
    `;
    
    db.all(query, [facility_id], (err, rows) => {
        if (err) {
            console.error('Error fetching inventory:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, inventory: rows || [], supplies: rows || [] });
    });
});

app.post('/api/inventory/update', authenticateToken, (req, res) => {
    const { supply_type_id, current_stock, reserved_stock } = req.body;
    const facility_id = req.user.facility_id || 1;

    if (!supply_type_id || current_stock === undefined) {
        return res.status(400).json({ success: false, error: 'Supply type ID and current stock required' });
    }

    db.run(`INSERT OR REPLACE INTO supply_inventory 
            (supply_type_id, facility_id, current_stock, reserved_stock, last_updated) 
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [supply_type_id, facility_id, current_stock, reserved_stock || 0],
        function(err) {
            if (err) {
                console.error('Inventory update error:', err);
                return res.status(500).json({ success: false, error: 'Failed to update inventory' });
            }

            res.json({
                success: true,
                inventory: { id: this.lastID, supply_type_id, current_stock, reserved_stock }
            });
        }
    );
});

// Tracking route (FIXED)
app.get('/api/tracking', authenticateToken, (req, res) => {
    console.log('📊 Fetching tracking data...');
    
    const facility_id = req.user.facility_id || 1;
    
    const query = `
        SELECT 
            su.id,
            su.usage_date,
            su.quantity_used,
            su.notes,
            p.id as patient_id,
            p.name as patient_name,
            p.patient_id as patient_number,
            p.room,
            st.id as supply_id,
            st.name as supply_name,
            st.ar_code,
            st.category,
            st.unit,
            u.name as user_name,
            f.name as facility_name
        FROM supply_usage su
        LEFT JOIN patients p ON su.patient_id = p.id
        LEFT JOIN supply_types st ON su.supply_type_id = st.id
        LEFT JOIN users u ON su.user_id = u.id
        LEFT JOIN facilities f ON su.facility_id = f.id
        WHERE su.facility_id = COALESCE(?, 1)
        ORDER BY su.usage_date DESC, su.id DESC
        LIMIT 100
    `;
    
    db.all(query, [facility_id], (err, rows) => {
        if (err) {
            console.error('❌ Error fetching tracking data:', err.message);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to fetch tracking data',
                details: err.message 
            });
        }
        
        console.log(`✅ Tracking data fetched: ${rows.length} records`);
        
        // Ensure all tracking records have required fields
        const tracking = rows.map(record => ({
            id: record.id,
            usage_date: record.usage_date,
            quantity_used: record.quantity_used || 0,
            notes: record.notes || '',
            patient: {
                id: record.patient_id,
                name: record.patient_name || 'Unknown Patient',
                patient_id: record.patient_number || 'N/A',
                room: record.room || 'N/A'
            },
            supply: {
                id: record.supply_id,
                name: record.supply_name || 'Unknown Supply',
                ar_code: record.ar_code || 'N/A',
                category: record.category || 'uncategorized',
                unit: record.unit || 'each'
            },
            user_name: record.user_name || 'System',
            facility_name: record.facility_name || 'Unknown Facility'
        }));
        
        res.json({ success: true, tracking });
    });
});

app.post('/api/tracking', authenticateToken, (req, res) => {
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

            res.status(201).json({
                success: true,
                tracking: { id: this.lastID, quantity_used, notes }
            });
        }
    );
});

// Reports route
app.get('/api/reports/usage', authenticateToken, (req, res) => {
    const { start_date, end_date } = req.query;
    const facility_id = req.user.facility_id || 1;
    
    const query = `
        SELECT 
            su.usage_date,
            su.quantity_used,
            su.notes,
            p.name as patient_name,
            p.patient_id,
            st.name as supply_name,
            st.ar_code,
            st.cost_per_unit,
            u.name as user_name
        FROM supply_usage su
        JOIN patients p ON su.patient_id = p.id
        JOIN supply_types st ON su.supply_type_id = st.id
        LEFT JOIN users u ON su.user_id = u.id
        WHERE su.facility_id = ?
        AND (DATE(su.usage_date) >= ? OR ? IS NULL)
        AND (DATE(su.usage_date) <= ? OR ? IS NULL)
        ORDER BY su.usage_date DESC
        LIMIT 100
    `;
    
    db.all(query, [facility_id, start_date, start_date, end_date, end_date], (err, rows) => {
        if (err) {
            console.error('Error fetching usage reports:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, usage: rows || [] });
    });
});

// Debug endpoints
app.get('/api/debug/tables', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    
    console.log('🔍 Checking database tables...');
    
    db.all(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`, [], (err, tables) => {
        if (err) {
            console.error('❌ Error fetching tables:', err.message);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to fetch tables',
                details: err.message 
            });
        }
        
        const tableInfo = {};
        let completed = 0;
        
        if (tables.length === 0) {
            return res.json({ success: true, tables: [], message: 'No tables found' });
        }
        
        tables.forEach(table => {
            const tableName = table.name;
            
            db.get(`SELECT COUNT(*) as count FROM ${tableName}`, [], (err, result) => {
                if (err) {
                    tableInfo[tableName] = { error: err.message, count: 0 };
                } else {
                    tableInfo[tableName] = { count: result.count, error: null };
                }
                
                completed++;
                if (completed === tables.length) {
                    console.log('✅ Table info collected:', tableInfo);
                    res.json({ 
                        success: true, 
                        tables: tables.map(t => t.name),
                        tableInfo,
                        totalTables: tables.length
                    });
                }
            });
        });
    });
});

app.get('/api/debug/sample-data', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    
    console.log('🔍 Fetching sample data from all tables...');
    
    const sampleQueries = {
        patients: `SELECT * FROM patients LIMIT 3`,
        supply_types: `SELECT * FROM supply_types LIMIT 5`,
        facilities: `SELECT * FROM facilities LIMIT 3`,
        users: `SELECT id, email, name, role, created_at FROM users LIMIT 3`,
        supply_usage: `SELECT * FROM supply_usage LIMIT 3`
    };
    
    const sampleData = {};
    let completed = 0;
    const totalQueries = Object.keys(sampleQueries).length;
    
    Object.entries(sampleQueries).forEach(([table, query]) => {
        db.all(query, [], (err, rows) => {
            if (err) {
                console.error(`❌ Error fetching sample from ${table}:`, err.message);
                sampleData[table] = { error: err.message, data: [] };
            } else {
                sampleData[table] = { error: null, data: rows || [], count: rows?.length || 0 };
            }
            
            completed++;
            if (completed === totalQueries) {
                console.log('✅ Sample data collected');
                res.json({ 
                    success: true, 
                    sampleData,
                    timestamp: new Date().toISOString()
                });
            }
        });
    });
});

// Serve the main application
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
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
            min-height: 100vh;
        }
        .container { 
            max-width: 1200px; margin: 0 auto; padding: 20px;
        }
        .card { 
            background: white; padding: 2rem; border-radius: 12px; 
            box-shadow: 0 20px 40px rgba(0,0,0,0.1); margin-bottom: 20px;
        }
        .header { text-align: center; margin-bottom: 2rem; }
        .header h1 { color: #4a5568; font-size: 2rem; margin-bottom: 0.5rem; }
        .header p { color: #718096; font-size: 1.1rem; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin: 2rem 0; }
        .stat-card { 
            background: #f7fafc; padding: 1.5rem; border-radius: 8px; text-align: center;
            border: 1px solid #e2e8f0;
        }
        .stat-number { font-size: 2rem; font-weight: bold; color: #667eea; }
        .stat-label { font-size: 0.9rem; color: #718096; margin-top: 0.25rem; }
        .success { color: #38a169; background: #c6f6d5; padding: 1rem; border-radius: 8px; margin: 1rem 0; }
        .error { color: #e53e3e; background: #fed7d7; padding: 1rem; border-radius: 8px; margin: 1rem 0; }
        .btn { 
            padding: 0.75rem 1.5rem; background: #667eea; color: white; 
            border: none; border-radius: 6px; cursor: pointer; margin: 0.5rem;
            text-decoration: none; display: inline-block; transition: background 0.3s;
        }
        .btn:hover { background: #5a6fd8; }
        .section { margin: 2rem 0; }
        .section h3 { color: #4a5568; margin-bottom: 1rem; }
        .section h4 { color: #667eea; margin-bottom: 0.5rem; font-size: 1rem; }
        .endpoint { 
            background: #f8f9fa; padding: 1rem; border-radius: 6px; margin: 0.5rem 0;
            border-left: 4px solid #667eea; font-family: monospace;
        }
        .method { 
            display: inline-block; padding: 0.25rem 0.5rem; border-radius: 4px;
            font-size: 0.8rem; font-weight: bold; margin-right: 0.5rem;
        }
        .get { background: #d4edda; color: #155724; }
        .post { background: #d1ecf1; color: #0c5460; }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <div class="header">
                <h1>🏥 Wound Care RT Supply Tracker</h1>
                <p>Professional Healthcare Supply Management System</p>
            </div>
            
            <div class="success">
                ✅ <strong>Production Server Running Successfully!</strong><br>
                Database connected • Authentication enabled • All API endpoints available
            </div>
            
            <div id="statsContainer" class="stats">
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
                    <div class="stat-label">Low Stock Alerts</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="usageCount">-</div>
                    <div class="stat-label">Today's Usage</div>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="section">
                <h3>🔑 Default Login Credentials</h3>
                <div class="endpoint">
                    <strong>Email:</strong> admin@system.com<br>
                    <strong>Password:</strong> admin123
                </div>
            </div>
        </div>

        <div class="card">
            <div class="section">
                <h3>📋 Available API Endpoints</h3>
                
                <h4 style="margin-top: 1.5rem; color: #667eea;">🔐 Authentication</h4>
                <div class="endpoint">
                    <span class="method post">POST</span>/api/auth/login - User authentication
                </div>
                <div class="endpoint">
                    <span class="method post">POST</span>/api/auth/register - User registration  
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/profile - User profile
                </div>
                
                <h4 style="margin-top: 1.5rem; color: #667eea;">📊 Dashboard</h4>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/dashboard - Dashboard data
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/dashboard/stats - Dashboard statistics
                </div>
                
                <h4 style="margin-top: 1.5rem; color: #667eea;">👥 Patient Management</h4>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/patients - Get all patients
                </div>
                <div class="endpoint">
                    <span class="method post">POST</span>/api/patients - Create new patient
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/search/patients?query=... - Search patients
                </div>
                
                <h4 style="margin-top: 1.5rem; color: #667eea;">🏢 Facility Management</h4>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/facilities - Get all facilities
                </div>
                <div class="endpoint">
                    <span class="method post">POST</span>/api/facilities - Create new facility
                </div>
                
                <h4 style="margin-top: 1.5rem; color: #667eea;">📦 Supply Management</h4>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/supplies - Get supply inventory
                </div>
                <div class="endpoint">
                    <span class="method post">POST</span>/api/supplies - Create new supply type
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/inventory - Detailed inventory with stock levels
                </div>
                <div class="endpoint">
                    <span class="method post">POST</span>/api/inventory/update - Update inventory levels
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/search/supplies?query=... - Search supplies
                </div>
                
                <h4 style="margin-top: 1.5rem; color: #667eea;">📊 Usage Tracking</h4>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/tracking - Get usage tracking data
                </div>
                <div class="endpoint">
                    <span class="method post">POST</span>/api/tracking - Record supply usage
                </div>
                <div class="endpoint">
                    <span class="method post">POST</span>/api/supplies/usage - Track supply usage (alias)
                </div>
                
                <h4 style="margin-top: 1.5rem; color: #667eea;">📈 Reports & Export</h4>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/reports/usage - Usage reports
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/export/patients - Export patients data
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/export/usage - Export usage data
                </div>
                
                <h4 style="margin-top: 1.5rem; color: #667eea;">👨‍💼 Admin & Users</h4>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/users - Get all users (admin only)
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/admin/users - Admin user management
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/admin/dashboard - Admin dashboard data
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/admin/stats - Admin statistics
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/admin/reports - Available reports list
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/admin/patients - Admin patient overview
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/admin/supplies - Admin supply analytics
                </div>
            </div>
        </div>

        <div class="card">
            <div class="section">
                <h3>🧪 Quick Tests</h3>
                <button class="btn" onclick="testLogin()">Test Login</button>
                <button class="btn" onclick="loadStats()">Load Statistics</button>
                <button class="btn" onclick="testSupplies()">Test Supplies</button>
                <button class="btn" onclick="testPatients()">Test Patients</button>
                <button class="btn" onclick="testTracking()">Test Tracking</button>
                <button class="btn" onclick="testDebugTables()">Debug Tables</button>
                <button class="btn" onclick="testSampleData()">Sample Data</button>
                <div id="testResults" style="margin-top: 1rem;"></div>
            </div>
        </div>
    </div>

    <script>
        let token = localStorage.getItem('authToken');
        
        async function testLogin() {
            const results = document.getElementById('testResults');
            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: 'admin@system.com', password: 'admin123' })
                });
                
                const data = await response.json();
                if (data.success) {
                    token = data.token;
                    localStorage.setItem('authToken', token);
                    results.innerHTML = '<div class="success">✅ Login successful! Token saved.</div>';
                    loadStats();
                } else {
                    results.innerHTML = '<div class="error">❌ Login failed: ' + data.error + '</div>';
                }
            } catch (error) {
                results.innerHTML = '<div class="error">❌ Login error: ' + error.message + '</div>';
            }
        }
        
        async function loadStats() {
            if (!token) {
                document.getElementById('testResults').innerHTML = '<div class="error">❌ Please login first</div>';
                return;
            }
            
            try {
                const response = await fetch('/api/dashboard/stats', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                const data = await response.json();
                if (data.success) {
                    document.getElementById('patientsCount').textContent = data.stats.active_patients;
                    document.getElementById('suppliesCount').textContent = data.stats.total_supplies;
                    document.getElementById('lowStockCount').textContent = data.stats.low_stock_alerts;
                    document.getElementById('usageCount').textContent = data.stats.today_usage_count;
                    document.getElementById('testResults').innerHTML = '<div class="success">✅ Stats loaded successfully!</div>';
                }
            } catch (error) {
                document.getElementById('testResults').innerHTML = '<div class="error">❌ Stats error: ' + error.message + '</div>';
            }
        }
        
        async function testSupplies() {
            if (!token) {
                document.getElementById('testResults').innerHTML = '<div class="error">❌ Please login first</div>';
                return;
            }
            
            try {
                const response = await fetch('/api/supplies', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                const data = await response.json();
                if (data.success) {
                    document.getElementById('testResults').innerHTML = 
                        '<div class="success">✅ Supplies loaded: ' + data.supplies.length + ' items</div>';
                }
            } catch (error) {
                document.getElementById('testResults').innerHTML = '<div class="error">❌ Supplies error: ' + error.message + '</div>';
            }
        }
        
        async function testTracking() {
            if (!token) {
                document.getElementById('testResults').innerHTML = '<div class="error">❌ Please login first</div>';
                return;
            }
            
            try {
                const response = await fetch('/api/tracking', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                const data = await response.json();
                if (data.success) {
                    document.getElementById('testResults').innerHTML = 
                        '<div class="success">✅ Tracking data loaded: ' + data.tracking.length + ' usage records</div>';
                }
            } catch (error) {
                document.getElementById('testResults').innerHTML = '<div class="error">❌ Tracking error: ' + error.message + '</div>';
            }
        }
        
        async function testAdminUsers() {
            if (!token) {
                document.getElementById('testResults').innerHTML = '<div class="error">❌ Please login first</div>';
                return;
            }
            
            try {
                const response = await fetch('/api/admin/users', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                const data = await response.json();
                if (data.success) {
                    document.getElementById('testResults').innerHTML = 
                        '<div class="success">✅ Admin users loaded: ' + data.users.length + ' users</div>';
                } else {
                    document.getElementById('testResults').innerHTML = 
                        '<div class="error">❌ Admin users failed: ' + (data.error || 'Unknown error') + '</div>';
                }
            } catch (error) {
                document.getElementById('testResults').innerHTML = '<div class="error">❌ Admin users error: ' + error.message + '</div>';
            }
        }
        
        async function testTracking() {
            if (!token) {
                document.getElementById('testResults').innerHTML = '<div class="error">❌ Please login first</div>';
                return;
            }
            
            try {
                const response = await fetch('/api/tracking', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                const data = await response.json();
                if (data.success) {
                    document.getElementById('testResults').innerHTML = 
                        '<div class="success">✅ Tracking data loaded: ' + data.tracking.length + ' usage records</div>';
                } else {
                    document.getElementById('testResults').innerHTML = 
                        '<div class="error">❌ Tracking failed: ' + (data.error || 'Unknown error') + 
                        (data.details ? '<br>Details: ' + data.details : '') + '</div>';
                }
            } catch (error) {
                document.getElementById('testResults').innerHTML = '<div class="error">❌ Tracking error: ' + error.message + '</div>';
            }
        }
        
        async function testDebugTables() {
            if (!token) {
                document.getElementById('testResults').innerHTML = '<div class="error">❌ Please login first</div>';
                return;
            }
            
            try {
                const response = await fetch('/api/debug/tables', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                const data = await response.json();
                if (data.success) {
                    let tableInfo = '';
                    for (const [table, info] of Object.entries(data.tableInfo)) {
                        tableInfo += `${table}: ${info.count} records${info.error ? ' (ERROR: ' + info.error + ')' : ''}<br>`;
                    }
                    document.getElementById('testResults').innerHTML = 
                        '<div class="success">✅ Database Tables:<br>' + tableInfo + '</div>';
                } else {
                    document.getElementById('testResults').innerHTML = 
                        '<div class="error">❌ Debug tables failed: ' + (data.error || 'Unknown error') + '</div>';
                }
            } catch (error) {
                document.getElementById('testResults').innerHTML = '<div class="error">❌ Debug tables error: ' + error.message + '</div>';
            }
        }
        
        async function testSampleData() {
            if (!token) {
                document.getElementById('testResults').innerHTML = '<div class="error">❌ Please login first</div>';
                return;
            }
            
            try {
                const response = await fetch('/api/debug/sample-data', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                const data = await response.json();
                if (data.success) {
                    let sampleInfo = 'Sample Data:<br>';
                    for (const [table, info] of Object.entries(data.sampleData)) {
                        sampleInfo += `📊 ${table}: ${info.count} samples${info.error ? ' (ERROR)' : ''}<br>`;
                    }
                    document.getElementById('testResults').innerHTML = 
                        '<div class="success">✅ ' + sampleInfo + '</div>';
                } else {
                    document.getElementById('testResults').innerHTML = 
                        '<div class="error">❌ Sample data failed: ' + (data.error || 'Unknown error') + '</div>';
                }
            } catch (error) {
                document.getElementById('testResults').innerHTML = '<div class="error">❌ Sample data error: ' + error.message + '</div>';
            }
        }
        
        async function testPatients() {
            if (!token) {
                document.getElementById('testResults').innerHTML = '<div class="error">❌ Please login first</div>';
                return;
            }
            
            try {
                const response = await fetch('/api/patients', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                const data = await response.json();
                if (data.success) {
                    document.getElementById('testResults').innerHTML = 
                        '<div class="success">✅ Patients loaded: ' + data.patients.length + ' active patients</div>';
                }
            } catch (error) {
                document.getElementById('testResults').innerHTML = '<div class="error">❌ Patients error: ' + error.message + '</div>';
            }
        }
        
        // Auto-load stats if token exists
        if (token) {
            loadStats();
        }
    </script>
</body>
</html>    `);
});

// Catch-all for missing API endpoints (for debugging)
app.all('/api/*', (req, res) => {
    console.log(`❓ Missing API endpoint: ${req.method} ${req.path}`);
    console.log(`   Headers: ${JSON.stringify(req.headers.authorization ? 'Bearer [token]' : 'No auth')}`);
    console.log(`   Body: ${JSON.stringify(req.body)}`);
    
    res.status(404).json({
        success: false,
        error: 'API endpoint not found',
        method: req.method,
        path: req.path,
        message: 'This endpoint has not been implemented yet. Check the available endpoints at /'
    });
});

// Start server
app.listen(PORT, () => {
    console.log('');
    console.log('🏥 ================================');
    console.log('   WOUND CARE RT SUPPLY TRACKER');
    console.log('🏥 ================================');
    console.log(`✅ Server running on port ${PORT}`);
    console.log('✅ Database connected (SQLite)');
    console.log('✅ 30+ API endpoints enabled (with debugging)');
    console.log('🔑 Default login: admin@system.com / admin123');
    console.log('📊 Sample data: 3 patients, 10 supply types');
    console.log('🔧 Features: Auth, Dashboard, Patients, Supplies, Tracking, Reports, Export, Admin');
    console.log('🐛 Debug endpoints: /api/debug/tables, /api/debug/sample-data');
    console.log('📝 Detailed error logging enabled');
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
