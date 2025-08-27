const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Database connection for Heroku
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Test database connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('Error connecting to database:', err);
        console.error('Database URL exists:', !!process.env.DATABASE_URL);
        console.error('Node ENV:', process.env.NODE_ENV);
    } else {
        console.log('Connected to PostgreSQL database');
        client.query('SELECT NOW()', (err, result) => {
            if (err) {
                console.error('Database query test failed:', err);
            } else {
                console.log('Database query test successful:', result.rows[0].now);
            }
            release();
        });
    }
});

// Database helper function
async function safeQuery(query, params = []) {
    try {
        const result = await pool.query(query, params);
        return result;
    } catch (error) {
        console.error('Database query failed:');
        console.error('Query:', query.substring(0, 200) + '...');
        console.error('Parameters:', params);
        console.error('Error message:', error.message);
        throw error;
    }
}

// Initialize database tables
async function initializeDatabase() {
    try {
        console.log('Initializing database tables...');

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
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create patients table
        await safeQuery(`
            CREATE TABLE IF NOT EXISTS patients (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                month VARCHAR(7) NOT NULL,
                mrn VARCHAR(50),
                facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(name, month, facility_id)
            )
        `);

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

        // Create indexes
        await safeQuery('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
        await safeQuery('CREATE INDEX IF NOT EXISTS idx_users_facility ON users(facility_id)');
        await safeQuery('CREATE INDEX IF NOT EXISTS idx_patients_facility ON patients(facility_id)');
        await safeQuery('CREATE INDEX IF NOT EXISTS idx_patients_month ON patients(month)');
        await safeQuery('CREATE INDEX IF NOT EXISTS idx_tracking_patient ON tracking(patient_id)');
        await safeQuery('CREATE INDEX IF NOT EXISTS idx_tracking_supply ON tracking(supply_id)');

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
            console.log('Creating admin user...');
            
            // Create default facilities first
            const facilitiesCheck = await safeQuery('SELECT COUNT(*) FROM facilities');
            if (parseInt(facilitiesCheck.rows[0].count) === 0) {
                await safeQuery(`
                    INSERT INTO facilities (name) VALUES 
                    ('General Hospital'),
                    ('Memorial Medical Center'), 
                    ('St. Mary''s Hospital'),
                    ('University Medical Center'),
                    ('Regional Health System')
                `);
            }
            
            const hashedPassword = await bcrypt.hash('admin123', 12);
            await safeQuery(
                'INSERT INTO users (name, email, password, role, is_approved) VALUES ($1, $2, $3, $4, $5)',
                ['System Administrator', 'admin@system.com', hashedPassword, 'admin', true]
            );
            
            console.log('Admin user created: admin@system.com / admin123');
        }

        // Check if supplies exist
        const suppliesCheck = await safeQuery('SELECT COUNT(*) FROM supplies');
        if (parseInt(suppliesCheck.rows[0].count) === 0) {
            console.log('Adding AR supplies...');
            
            // Add key AR supplies - truncated for brevity but can be expanded
            const keySupplies = [
                { code: 272, description: 'Med/Surgical Supplies', hcpcs: 'B4149', cost: 0.00 },
                { code: 400, description: 'HME filter holder for trach or vent', hcpcs: 'A7507', cost: 3.49 },
                { code: 600, description: 'Sterile Gauze sponge 2x2 up to 4x4, EACH 2 in package', hcpcs: 'A6251', cost: 2.78 },
                { code: 634, description: 'Foam non bordered dressing medium 6x6, each Mepilex, Allevyn, xeroform', hcpcs: 'A6210', cost: 27.84 },
                { code: 640, description: 'Hydrocolloid dressing pad 16 sq inches non bordered', hcpcs: 'A6234', cost: 9.15 }
            ];

            for (const supply of keySupplies) {
                await safeQuery(
                    'INSERT INTO supplies (code, description, hcpcs, cost, is_custom) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (code) DO NOTHING',
                    [supply.code, supply.description, supply.hcpcs, supply.cost, false]
                );
            }
        }
        
    } catch (error) {
        console.error('Failed to initialize default data:', error);
        throw error;
    }
}

// Authentication middleware
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

// Admin middleware
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', async (req, res) => {
    try {
        await safeQuery('SELECT 1');
        res.json({ 
            status: 'healthy', 
            timestamp: new Date().toISOString(),
            database: 'connected' 
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'unhealthy', 
            timestamp: new Date().toISOString(),
            database: 'disconnected',
            error: error.message 
        });
    }
});

// Auth routes
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password required' });
        }

        const result = await safeQuery(
            'SELECT u.*, f.name as facility_name FROM users u LEFT JOIN facilities f ON u.facility_id = f.id WHERE u.email = $1',
            [email]
        );

        const user = result.rows[0];
        if (!user || !await bcrypt.compare(password, user.password)) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        if (!user.is_approved) {
            return res.status(403).json({ success: false, message: 'Account pending approval' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, facilityId: user.facility_id },
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
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Facilities routes
app.get('/api/facilities', async (req, res) => {
    try {
        const result = await safeQuery('SELECT * FROM facilities ORDER BY name ASC');
        res.json({ success: true, facilities: result.rows });
    } catch (error) {
        console.error('Error fetching facilities:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch facilities' });
    }
});

// Supplies routes
app.get('/api/supplies', authenticateToken, async (req, res) => {
    try {
        const result = await safeQuery('SELECT * FROM supplies ORDER BY code ASC');
        res.json({ success: true, supplies: result.rows });
    } catch (error) {
        console.error('Error fetching supplies:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch supplies' });
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
        let params = [];

        if (req.user.role !== 'admin' && req.user.facilityId) {
            query += ' WHERE p.facility_id = $1';
            params.push(req.user.facilityId);
        }

        query += ' ORDER BY p.name ASC';

        const result = await safeQuery(query, params);
        res.json({ success: true, patients: result.rows });
    } catch (error) {
        console.error('Error fetching patients:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch patients' });
    }
});

// Basic error handling
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Received SIGTERM signal, shutting down gracefully');
    pool.end(() => {
        console.log('Database pool closed');
        process.exit(0);
    });
});

// Initialize and start server
async function startServer() {
    try {
        await initializeDatabase();
        
        app.listen(PORT, () => {
            console.log(`Wound Care RT Supply Tracker running on port ${PORT}`);
            console.log(`Server URL: http://localhost:${PORT}`);
            console.log('Default credentials: admin@system.com / admin123');
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

module.exports = app;
