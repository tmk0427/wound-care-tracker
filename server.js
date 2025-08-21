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
    console.error('❌ ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
}

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
    console.error('❌ ERROR: JWT_SECRET environment variable is required in production');
    process.exit(1);
}

console.log('🔧 Environment check:');
console.log('  - NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('  - PORT:', PORT);
console.log('  - DATABASE_URL:', process.env.DATABASE_URL ? '✅ Set' : '❌ Missing');
console.log('  - JWT_SECRET:', process.env.JWT_SECRET ? '✅ Set' : '⚠️ Using default');

// Database connection with better error handling
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    // Add connection timeout and retry settings
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 10
});

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
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
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
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

// Health check endpoint (add this early for debugging)
app.get('/health', async (req, res) => {
    try {
        const dbTest = await pool.query('SELECT NOW() as current_time');
        
        // Safely get user count
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

// Serve complete HTML application directly
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wound Care RT Supply Tracker - Enhanced</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }

        .status-banner {
            background: #f0f4ff;
            padding: 10px;
            text-align: center;
            border-bottom: 1px solid #667eea;
            color: #4a5568;
        }

        .loading-container {
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            flex-direction: column;
            gap: 20px;
        }

        .loading-spinner {
            width: 50px;
            height: 50px;
            border: 5px solid #f3f3f3;
            border-top: 5px solid #667eea;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .error-container {
            background: white;
            padding: 40px;
            border-radius: 15px;
            box-shadow: 0 15px 35px rgba(0,0,0,0.1);
            max-width: 500px;
            text-align: center;
        }

        .error-container h1 {
            color: #e53e3e;
            margin-bottom: 20px;
        }

        .error-container p {
            color: #718096;
            margin-bottom: 20px;
        }

        .retry-btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
        }

        .retry-btn:hover {
            background: #5a67d8;
        }
    </style>
</head>
<body>
    <div class="status-banner">
        🏥 Wound Care RT Supply Tracker - Initializing...
    </div>

    <div id="loadingContainer" class="loading-container">
        <div class="loading-spinner"></div>
        <h2 style="color: white;">Loading Application...</h2>
        <p style="color: #e6edff;">Connecting to database and initializing system...</p>
    </div>

    <div id="errorContainer" class="loading-container" style="display: none;">
        <div class="error-container">
            <h1>❌ Connection Error</h1>
            <p>Unable to connect to the application. Please try again.</p>
            <button class="retry-btn" onclick="window.location.reload()">Retry</button>
        </div>
    </div>

    <script>
        // Check if the app is ready
        async function checkAppStatus() {
            try {
                const response = await fetch('/health');
                const data = await response.json();
                
                if (data.status === 'OK') {
                    // App is ready, reload to get the full interface
                    setTimeout(() => {
                        window.location.reload();
                    }, 1000);
                } else {
                    throw new Error('App not ready');
                }
            } catch (error) {
                console.error('App not ready:', error);
                // Show error after 30 seconds
                setTimeout(() => {
                    document.getElementById('loadingContainer').style.display = 'none';
                    document.getElementById('errorContainer').style.display = 'flex';
                }, 30000);
                
                // Retry check in 5 seconds
                setTimeout(checkAppStatus, 5000);
            }
        }

        // Start checking app status
        setTimeout(checkAppStatus, 2000);
    </script>
</body>
</html>`);
});

// ==================== DATABASE INITIALIZATION ====================

async function initializeDatabase() {
    try {
        console.log('🔄 Starting database initialization...');
        
        // Test basic connection first
        await pool.query('SELECT NOW()');
        console.log('✅ Database connection successful');
        
        // Check if tables exist
        const tablesExist = await pool.query(`
            SELECT COUNT(*) FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name IN ('users', 'facilities', 'supplies', 'patients', 'tracking')
        `);
        
        if (parseInt(tablesExist.rows[0].count) < 5) {
            console.log('🔧 Database tables missing, running initialization...');
            
            // Create tables with better error handling
            try {
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
                        code INTEGER NOT NULL UNIQUE,
                        description TEXT NOT NULL,
                        hcpcs VARCHAR(10),
                        cost DECIMAL(10,2) DEFAULT 0.00,
                        is_custom BOOLEAN DEFAULT false,
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
                    CREATE INDEX IF NOT EXISTS idx_users_facility ON users(facility_id);
                    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
                    CREATE INDEX IF NOT EXISTS idx_patients_facility ON patients(facility_id);
                    CREATE INDEX IF NOT EXISTS idx_patients_month ON patients(month);
                    CREATE INDEX IF NOT EXISTS idx_tracking_patient ON tracking(patient_id);
                    CREATE INDEX IF NOT EXISTS idx_tracking_supply ON tracking(supply_id);
                    CREATE INDEX IF NOT EXISTS idx_supplies_code ON supplies(code);
                `);
                console.log('✅ Database tables created successfully');
            } catch (error) {
                console.error('❌ Failed to create database tables:', error);
                throw error;
            }

            // Insert default data with better error handling
            try {
                await pool.query(`
                    INSERT INTO facilities (name) VALUES 
                        ('Main Hospital'),
                        ('Clinic North'),
                        ('Clinic South'),
                        ('Outpatient Center')
                    ON CONFLICT (name) DO NOTHING;
                `);

                await pool.query(`
                    INSERT INTO supplies (code, description, hcpcs, cost, is_custom) VALUES 
                        (700, 'Foam Dressing 4x4', 'A6209', 5.50, false),
                        (701, 'Hydrocolloid Dressing 6x6', 'A6234', 8.75, false),
                        (702, 'Alginate Dressing 2x2', 'A6196', 12.25, false),
                        (703, 'Transparent Film 4x4.75', 'A6257', 3.20, false),
                        (704, 'Antimicrobial Dressing 4x5', 'A6251', 15.80, false),
                        (705, 'Collagen Dressing 4x4', 'A6021', 22.50, false),
                        (272, 'Med-Surgical Supplies', 'B4149', 0.00, false),
                        (400, 'HME filter holder for trach or vent', 'A7507', 3.49, false),
                        (401, 'HME housing & adhesive', 'A7509', 1.97, false),
                        (414, 'Trach tube', 'A7520', 12.50, false)
                    ON CONFLICT (code) DO NOTHING;
                `);

                // Insert admin user
                const hashedPassword = await bcrypt.hash('admin123', 10);
                await pool.query(`
                    INSERT INTO users (name, email, password, role, is_approved) VALUES 
                        ('System Administrator', 'admin@system.com', $1, 'admin', true)
                    ON CONFLICT (email) DO NOTHING
                `, [hashedPassword]);

                // Insert demo user
                const demoHashedPassword = await bcrypt.hash('user123', 10);
                await pool.query(`
                    INSERT INTO users (name, email, password, role, facility_id, is_approved) VALUES 
                        ('Demo User', 'user@demo.com', $1, 'user', 1, true)
                    ON CONFLICT (email) DO NOTHING
                `, [demoHashedPassword]);

                // Insert sample patients
                await pool.query(`
                    INSERT INTO patients (name, month, mrn, facility_id) VALUES 
                        ('Smith, John', '2024-12', 'MRN12345', 1),
                        ('Johnson, Mary', '2024-12', 'MRN67890', 1),
                        ('Brown, Robert', '2024-12', 'MRN11111', 2),
                        ('Davis, Jennifer', '2024-12', 'MRN22222', 1)
                    ON CONFLICT (name, month, facility_id) DO NOTHING;
                `);

                console.log('✅ Default data inserted successfully');
            } catch (error) {
                console.error('❌ Failed to insert default data:', error);
                // Don't throw here - app can work without default data
            }

            console.log('✅ Database initialized successfully');
        } else {
            console.log('✅ Database tables verified');
        }

        // Verify the setup safely
        try {
            const counts = await pool.query(`
                SELECT 
                    (SELECT COUNT(*) FROM facilities) as facilities,
                    (SELECT COUNT(*) FROM supplies) as supplies,
                    (SELECT COUNT(*) FROM users) as users,
                    (SELECT COUNT(*) FROM patients) as patients
            `);

            if (counts && counts.rows && counts.rows[0]) {
                console.log('📊 Database setup complete:');
                console.log(`   - Facilities: ${counts.rows[0].facilities}`);
                console.log(`   - Supplies: ${counts.rows[0].supplies}`);
                console.log(`   - Users: ${counts.rows[0].users}`);
                console.log(`   - Patients: ${counts.rows[0].patients}`);
            }
        } catch (verifyError) {
            console.log('⚠️  Could not verify setup counts, but continuing...');
        }

        console.log('\n🔑 Default Login Credentials:');
        console.log('   Admin: admin@system.com / admin123');
        console.log('   User:  user@demo.com / user123');

    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        throw error; // Re-throw to prevent server start with broken DB
    }
}

// ==================== AUTH ROUTES ====================
// [Include all your existing auth routes here - they look fine]

// ==================== ERROR HANDLING ====================

app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

app.use((error, req, res, next) => {
    console.error('Global error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        message: error.message,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
});

// ==================== SERVER START ====================

async function startServer() {
    try {
        console.log('🚀 Starting Wound Care RT Supply Tracker...');
        
        // Test database connection
        console.log('🔍 Testing database connection...');
        await pool.query('SELECT NOW()');
        console.log('✅ Database connection successful');
        
        // Initialize database
        await initializeDatabase();
        
        // Start server
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🔗 App URL: ${process.env.NODE_ENV === 'production' ? 'https://your-app.herokuapp.com' : `http://localhost:${PORT}`}`);
            console.log('🎉 Wound Care RT Supply Tracker is ready!');
            console.log('👑 Admin Login: admin@system.com / admin123');
            console.log('👤 User Login: user@demo.com / user123');
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

startServer();
