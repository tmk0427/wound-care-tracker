const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

console.log('🔧 PROGRESSIVE TEST: Adding production features step by step...');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your_secure_jwt_secret_key_change_in_production';

// Basic middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

console.log('✅ Step 1: Basic middleware added');

// Database connection
let db;
try {
    db = new sqlite3.Database('wound_care.db', (err) => {
        if (err) {
            console.error('❌ Database connection error:', err.message);
        } else {
            console.log('✅ Step 2: Connected to SQLite database');
        }
    });
} catch (error) {
    console.error('❌ Step 2 FAILED: Database connection error:', error);
    process.exit(1);
}

console.log('✅ Step 3: Database variable created');

// Test database table creation
function createBasicTable() {
    console.log('🔧 Step 4: Testing basic table creation...');
    
    db.run(`CREATE TABLE IF NOT EXISTS test_table (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.error('❌ Step 4 FAILED: Table creation error:', err);
        } else {
            console.log('✅ Step 4: Basic table created successfully');
        }
    });
}

try {
    createBasicTable();
} catch (error) {
    console.error('❌ Step 4 FAILED: Table creation function error:', error);
}

console.log('✅ Step 5: Table creation function executed');

// Test JWT middleware
function testAuthMiddleware(req, res, next) {
    console.log('🔧 Testing JWT middleware...');
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

console.log('✅ Step 6: JWT middleware function created');

// Basic routes
app.get('/', (req, res) => {
    console.log('📍 Root route accessed');
    res.json({
        status: 'progressive test working',
        message: 'Adding production features step by step',
        timestamp: new Date().toISOString(),
        steps_completed: [
            'Basic middleware',
            'Database connection',
            'Database variable',
            'Table creation test', 
            'Table creation function',
            'JWT middleware function',
            'Basic routes'
        ]
    });
});

console.log('✅ Step 7: Basic root route added');

// Test login route (simple version)
app.post('/api/auth/login', (req, res) => {
    console.log('📍 Login route accessed');
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    // Simple test - don't query database yet
    if (email === 'admin@system.com' && password === 'admin123') {
        const token = jwt.sign(
            { userId: 1, email: email, role: 'admin' },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            token,
            user: { id: 1, email, name: 'Test Admin', role: 'admin' }
        });
    } else {
        res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
});

console.log('✅ Step 8: Simple login route added');

// Test protected route
app.get('/api/test-protected', testAuthMiddleware, (req, res) => {
    console.log('📍 Protected route accessed');
    res.json({
        success: true,
        message: 'Protected route working',
        user: req.user
    });
});

console.log('✅ Step 9: Protected route added');

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'progressive test running',
        message: 'All basic features working',
        timestamp: new Date().toISOString(),
        database_connected: !!db
    });
});

console.log('✅ Step 10: Health check route added');

// Start server
app.listen(PORT, () => {
    console.log('');
    console.log('🔧 ================================');
    console.log('   PROGRESSIVE TEST SERVER');
    console.log('🔧 ================================');
    console.log(`✅ Server running on port ${PORT}`);
    console.log('✅ All basic production features loaded');
    console.log('🔑 Test login: admin@system.com / admin123');
    console.log('🧪 Next: Add more complex features');
    console.log('🔧 ================================');
    console.log('');
});

console.log('✅ Step 11: Server started successfully');

// Error handling
process.on('uncaughtException', (error) => {
    console.error('❌ UNCAUGHT EXCEPTION:', error.message);
    console.error('Stack:', error.stack);
    console.error('This is likely the cause of the production server crash!');
});

process.on('unhandledRejection', (error) => {
    console.error('❌ UNHANDLED REJECTION:', error.message);
    console.error('Stack:', error?.stack);
});

console.log('✅ Step 12: Error handlers added');
console.log('🎉 PROGRESSIVE TEST SETUP COMPLETE!');
