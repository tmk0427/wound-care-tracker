const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'emergency-secret-key';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Global database
let db = null;

// Simple database connection
function connectDatabase() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(':memory:', (err) => {
            if (err) {
                console.error('Database connection failed:', err);
                reject(err);
            } else {
                console.log('✅ Emergency database connected (in-memory)');
                resolve();
            }
        });
    });
}

// Create basic tables
async function setupTables() {
    return new Promise((resolve) => {
        const setupSQL = `
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                name TEXT,
                email TEXT UNIQUE,
                password TEXT,
                role TEXT DEFAULT 'user',
                is_approved INTEGER DEFAULT 1
            );
            
            CREATE TABLE facilities (
                id INTEGER PRIMARY KEY,
                name TEXT
            );
            
            CREATE TABLE supplies (
                id INTEGER PRIMARY KEY,
                code INTEGER UNIQUE,
                description TEXT,
                hcpcs TEXT,
                cost REAL DEFAULT 0,
                is_custom INTEGER DEFAULT 1
            );
            
            CREATE TABLE patients (
                id INTEGER PRIMARY KEY,
                name TEXT,
                month TEXT,
                mrn TEXT,
                facility_id INTEGER
            );
            
            CREATE TABLE tracking_data (
                id INTEGER PRIMARY KEY,
                patient_id INTEGER,
                supply_code INTEGER,
                day INTEGER,
                quantity INTEGER,
                month TEXT
            );
        `;
        
        db.exec(setupSQL, (err) => {
            if (err) {
                console.error('Table creation failed:', err);
            } else {
                console.log('✅ Emergency tables created');
            }
            resolve();
        });
    });
}

// Add emergency data
async function addEmergencyData() {
    return new Promise(async (resolve) => {
        try {
            // Add admin user
            const hashedPassword = await bcrypt.hash('admin123', 10);
            
            db.run(
                'INSERT INTO users (name, email, password, role, is_approved) VALUES (?, ?, ?, ?, ?)',
                ['Emergency Admin', 'admin@system.com', hashedPassword, 'admin', 1],
                function(err) {
                    if (err) {
                        console.error('Admin creation failed:', err);
                    } else {
                        console.log('✅ Emergency admin created');
                    }
                }
            );
            
            // Add basic facility
            db.run('INSERT INTO facilities (name) VALUES (?)', ['Emergency Hospital'], (err) => {
                if (err) {
                    console.error('Facility creation failed:', err);
                } else {
                    console.log('✅ Emergency facility created');
                }
            });
            
            // Add basic supplies
            const supplies = [
                { code: 272, description: 'Med/Surgical Supplies', hcpcs: 'B4149', cost: 0.00 },
                { code: 400, description: 'HME filter holder for trach or vent', hcpcs: 'A7507', cost: 3.49 },
                { code: 401, description: 'HME housing & adhesive', hcpcs: 'A7509', cost: 1.97 },
                { code: 402, description: 'HMES/trach valve adhesive disk', hcpcs: 'A7506', cost: 0.45 },
                { code: 403, description: 'HMES filter holder or cap for tracheostoma', hcpcs: 'A7503', cost: 15.85 }
            ];
            
            supplies.forEach(supply => {
                db.run(
                    'INSERT INTO supplies (code, description, hcpcs, cost, is_custom) VALUES (?, ?, ?, ?, ?)',
                    [supply.code, supply.description, supply.hcpcs, supply.cost, 0],
                    (err) => {
                        if (err) {
                            console.error(`Supply ${supply.code} failed:`, err);
                        }
                    }
                );
            });
            
            console.log('✅ Emergency supplies added');
            
        } catch (error) {
            console.error('Emergency data setup failed:', error);
        }
        resolve();
    });
}

// Auth middleware
const auth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'No token' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => {
    res.json({ status: 'emergency server running', timestamp: new Date().toISOString() });
});

// Login
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
        if (err || !user) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        
        try {
            const validPassword = await bcrypt.compare(password, user.password);
            if (!validPassword) {
                return res.status(401).json({ success: false, message: 'Invalid credentials' });
            }
            
            const token = jwt.sign(
                { id: user.id, email: user.email, role: user.role },
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
                    role: user.role
                }
            });
            
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });
});

// Facilities
app.get('/api/facilities', (req, res) => {
    db.all('SELECT * FROM facilities ORDER BY name', (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        res.json({ success: true, facilities: rows || [] });
    });
});

// Supplies
app.get('/api/supplies', auth, (req, res) => {
    db.all('SELECT * FROM supplies ORDER BY code', (err, rows) => {
        if (err) {
            console.error('Supplies query error:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        console.log(`✅ Returning ${rows.length} supplies`);
        res.json({ success: true, supplies: rows || [] });
    });
});

// Patients
app.get('/api/patients', auth, (req, res) => {
    db.all('SELECT p.*, f.name as facility_name FROM patients p LEFT JOIN facilities f ON p.facility_id = f.id ORDER BY p.name', (err, rows) => {
        if (err) {
            console.error('Patients query error:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        console.log(`✅ Returning ${rows.length} patients`);
        res.json({ success: true, patients: rows || [] });
    });
});

// Tracking
app.get('/api/tracking', auth, (req, res) => {
    const query = `
        SELECT t.*, p.name as patient_name, f.name as facility_name,
               s.description as supply_description, s.cost as supply_cost
        FROM tracking_data t
        LEFT JOIN patients p ON t.patient_id = p.id
        LEFT JOIN facilities f ON p.facility_id = f.id
        LEFT JOIN supplies s ON t.supply_code = s.code
        ORDER BY p.name, t.supply_code, t.day
    `;
    
    db.all(query, (err, rows) => {
        if (err) {
            console.error('Tracking query error:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        console.log(`✅ Returning ${rows.length} tracking records`);
        res.json({ success: true, tracking: rows || [] });
    });
});

// Admin users
app.get('/api/admin/users', auth, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin required' });
    }
    
    db.all('SELECT id, name, email, role, is_approved FROM users ORDER BY name', (err, rows) => {
        if (err) {
            console.error('Users query error:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        console.log(`✅ Returning ${rows.length} users`);
        res.json({ success: true, users: rows || [] });
    });
});

// Initialize and start server
async function startEmergencyServer() {
    try {
        console.log('🚨 Starting EMERGENCY server...');
        
        // Connect to database
        await connectDatabase();
        
        // Setup tables
        await setupTables();
        
        // Add emergency data
        await addEmergencyData();
        
        // Start server
        app.listen(PORT, () => {
            console.log('');
            console.log('🚨 ================================');
            console.log('🏥 EMERGENCY WOUND CARE TRACKER');
            console.log('🚨 ================================');
            console.log(`✅ Server running on port ${PORT}`);
            console.log('✅ In-memory database active');
            console.log('🔑 Login: admin@system.com / admin123');
            console.log('🚨 ================================');
            console.log('');
        });
        
    } catch (error) {
        console.error('❌ Emergency server failed to start:', error);
        process.exit(1);
    }
}

// Graceful error handling
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
});

startEmergencyServer();
