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

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Database connection failed:', err);
    } else {
        console.log('✅ Database connected successfully');
        release();
    }
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

// Serve HTML directly (no file system dependencies)
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wound Care RT Supply Tracker</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }
        .login-container {
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 20px;
        }
        .auth-form {
            background: white;
            padding: 40px;
            border-radius: 15px;
            box-shadow: 0 15px 35px rgba(0,0,0,0.1);
            width: 100%;
            max-width: 400px;
            text-align: center;
        }
        .auth-form h1 {
            color: #4a5568;
            margin-bottom: 30px;
            font-size: 24px;
        }
        .form-group {
            margin-bottom: 20px;
            text-align: left;
        }
        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #4a5568;
        }
        .form-group input {
            width: 100%;
            padding: 12px;
            border: 2px solid #e2e8f0;
            border-radius: 8px;
            font-size: 16px;
            transition: all 0.3s ease;
        }
        .form-group input:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        .auth-btn {
            width: 100%;
            padding: 12px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s ease;
        }
        .auth-btn:hover {
            transform: translateY(-2px);
        }
        .auth-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        .error-message {
            color: #e53e3e;
            margin-top: 10px;
            font-size: 14px;
        }
        .loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-right: 10px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .hidden { display: none !important; }
        .main-app {
            display: none;
            padding: 20px;
            max-width: 1200px;
            margin: 0 auto;
        }
        .header {
            background: white;
            padding: 20px 30px;
            border-radius: 15px;
            margin-bottom: 30px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 20px;
        }
        .btn {
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.2s ease;
            text-decoration: none;
            display: inline-block;
            font-size: 14px;
        }
        .btn-secondary { background: #e2e8f0; color: #4a5568; }
        .btn-danger { background: #e53e3e; color: white; }
        .btn:hover { transform: translateY(-2px); }
        .content-card {
            background: white;
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
            text-align: center;
        }
    </style>
</head>
<body>
    <div id="loginContainer" class="login-container">
        <div class="auth-form">
            <h1>🏥 Wound Care RT Supply Tracker</h1>
            
            <div id="loginForm">
                <div class="form-group">
                    <label for="loginEmail">Email Address</label>
                    <input type="email" id="loginEmail" placeholder="admin@system.com">
                </div>
                <div class="form-group">
                    <label for="loginPassword">Password</label>
                    <input type="password" id="loginPassword" placeholder="admin123">
                </div>
                <button class="auth-btn" onclick="login()" id="loginBtn">Sign In</button>
                <div id="loginError" class="error-message hidden"></div>
                <div style="margin-top: 20px; padding: 15px; background: #f0f4ff; border-radius: 8px; font-size: 14px;">
                    <strong>Demo Login:</strong><br>
                    Email: admin@system.com<br>
                    Password: admin123
                </div>
            </div>
        </div>
    </div>

    <div id="mainApp" class="main-app">
        <div class="header">
            <div>
                <h1>🏥 Wound Care RT Supply Tracker</h1>
                <div id="currentUserInfo"></div>
            </div>
            <div>
                <button class="btn btn-secondary" onclick="testAPI()">Test API</button>
                <button class="btn btn-danger" onclick="logout()">Logout</button>
            </div>
        </div>
        
        <div class="content-card">
            <h2>🎉 Application Successfully Deployed!</h2>
            <p style="margin: 20px 0; color: #718096;">
                Your Wound Care RT Supply Tracker is now running on Heroku.
            </p>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 30px 0;">
                <div style="padding: 20px; background: #f0fff4; border-radius: 10px; border-left: 4px solid #38a169;">
                    <h3 style="color: #38a169;">✅ Server Status</h3>
                    <p>Running on Heroku</p>
                </div>
                <div style="padding: 20px; background: #f0f4ff; border-radius: 10px; border-left: 4px solid #667eea;">
                    <h3 style="color: #667eea;">🔐 Authentication</h3>
                    <p>JWT Token System</p>
                </div>
                <div style="padding: 20px; background: #fffaf0; border-radius: 10px; border-left: 4px solid #ed8936;">
                    <h3 style="color: #ed8936;">🗃️ Database</h3>
                    <p>PostgreSQL Ready</p>
                </div>
            </div>
            <div style="margin-top: 30px;">
                <button class="btn btn-secondary" onclick="window.open('/api/health', '_blank')" style="margin: 5px;">
                    📊 Health Check
                </button>
                <button class="btn btn-secondary" onclick="testDatabaseConnection()" style="margin: 5px;">
                    🔍 Test Database
                </button>
            </div>
            <div id="testResults" style="margin-top: 20px; padding: 15px; border-radius: 8px; display: none;"></div>
        </div>
    </div>

    <script>
        let currentUser = null;
        let authToken = localStorage.getItem('authToken');
        const API_BASE = window.location.origin + '/api';

        async function apiCall(endpoint, options = {}) {
            const url = API_BASE + endpoint;
            const defaultOptions = {
                headers: { 'Content-Type': 'application/json' }
            };

            if (authToken) {
                defaultOptions.headers['Authorization'] = 'Bearer ' + authToken;
            }

            const finalOptions = Object.assign({}, defaultOptions, options);
            if (options.body && typeof options.body === 'object') {
                finalOptions.body = JSON.stringify(options.body);
            }

            try {
                const response = await fetch(url, finalOptions);
                if (response.status === 401) {
                    logout();
                    throw new Error('Authentication required');
                }
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || 'Server error');
                }
                return data;
            } catch (error) {
                console.error('API call failed:', error);
                throw error;
            }
        }

        async function login() {
            const email = document.getElementById('loginEmail').value.trim();
            const password = document.getElementById('loginPassword').value.trim();
            const loginBtn = document.getElementById('loginBtn');
            const loginError = document.getElementById('loginError');

            if (!email || !password) {
                loginError.textContent = 'Please enter both email and password';
                loginError.classList.remove('hidden');
                return;
            }

            try {
                loginBtn.disabled = true;
                loginBtn.innerHTML = '<span class="loading"></span>Signing In...';
                loginError.classList.add('hidden');

                const response = await apiCall('/auth/login', {
                    method: 'POST',
                    body: { email: email, password: password }
                });

                authToken = response.token;
                currentUser = response.user;
                localStorage.setItem('authToken', authToken);

                document.getElementById('loginContainer').style.display = 'none';
                document.getElementById('mainApp').style.display = 'block';
                
                document.getElementById('currentUserInfo').innerHTML = 
                    '<div style="font-weight: 600;">' + currentUser.name + '</div>' +
                    '<div style="color: #718096;">' + currentUser.role.toUpperCase() + ' • ' + (currentUser.facility_name || 'All Facilities') + '</div>';

            } catch (error) {
                loginError.textContent = error.message;
                loginError.classList.remove('hidden');
            } finally {
                loginBtn.disabled = false;
                loginBtn.innerHTML = 'Sign In';
            }
        }

        function logout() {
            authToken = null;
            currentUser = null;
            localStorage.removeItem('authToken');
            document.getElementById('loginContainer').style.display = 'flex';
            document.getElementById('mainApp').style.display = 'none';
            document.getElementById('loginEmail').value = '';
            document.getElementById('loginPassword').value = '';
        }

        async function testAPI() {
            const resultsDiv = document.getElementById('testResults');
            resultsDiv.style.display = 'block';
            resultsDiv.innerHTML = '<div class="loading"></div> Testing API endpoints...';

            try {
                const tests = await Promise.all([
                    apiCall('/facilities'),
                    apiCall('/supplies'),
                    apiCall('/patients')
                ]);

                resultsDiv.innerHTML = 
                    '<div style="background: #f0fff4; color: #276749; padding: 15px; border-radius: 8px;">' +
                    '<h4>✅ API Test Results</h4>' +
                    '<p>Facilities: ' + tests[0].length + ' found</p>' +
                    '<p>Supplies: ' + tests[1].length + ' found</p>' +
                    '<p>Patients: ' + tests[2].length + ' found</p>' +
                    '<p><strong>All API endpoints working correctly!</strong></p>' +
                    '</div>';
            } catch (error) {
                resultsDiv.innerHTML = 
                    '<div style="background: #fed7d7; color: #c53030; padding: 15px; border-radius: 8px;">' +
                    '<h4>❌ API Test Failed</h4>' +
                    '<p>Error: ' + error.message + '</p>' +
                    '</div>';
            }
        }

        async function testDatabaseConnection() {
            const resultsDiv = document.getElementById('testResults');
            resultsDiv.style.display = 'block';
            resultsDiv.innerHTML = '<div class="loading"></div> Testing database connection...';

            try {
                const response = await fetch('/api/health');
                const data = await response.json();

                if (data.status === 'OK') {
                    resultsDiv.innerHTML = 
                        '<div style="background: #f0fff4; color: #276749; padding: 15px; border-radius: 8px;">' +
                        '<h4>✅ Database Connection Successful</h4>' +
                        '<p><strong>Status:</strong> ' + data.status + '</p>' +
                        '<p><strong>Database:</strong> ' + data.database + '</p>' +
                        '<p><strong>Users in system:</strong> ' + data.users + '</p>' +
                        '<p><strong>Environment:</strong> ' + data.environment + '</p>' +
                        '</div>';
                } else {
                    throw new Error('Health check failed');
                }
            } catch (error) {
                resultsDiv.innerHTML = 
                    '<div style="background: #fed7d7; color: #c53030; padding: 15px; border-radius: 8px;">' +
                    '<h4>❌ Database Test Failed</h4>' +
                    '<p>Error: ' + error.message + '</p>' +
                    '</div>';
            }
        }

        // Handle Enter key for login
        document.addEventListener('DOMContentLoaded', () => {
            [document.getElementById('loginEmail'), document.getElementById('loginPassword')].forEach(input => {
                input.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') login();
                });
            });
        });

        // Check for existing auth token on page load
        window.addEventListener('DOMContentLoaded', async () => {
            if (authToken) {
                try {
                    const response = await apiCall('/auth/verify');
                    currentUser = response.user;
                    
                    document.getElementById('loginContainer').style.display = 'none';
                    document.getElementById('mainApp').style.display = 'block';
                    
                    document.getElementById('currentUserInfo').innerHTML = 
                        '<div style="font-weight: 600;">Welcome back, ' + currentUser.name + '!</div>' +
                        '<div style="color: #718096;">' + currentUser.role.toUpperCase() + ' • ' + (currentUser.facility_name || 'All Facilities') + '</div>';
                } catch (error) {
                    localStorage.removeItem('authToken');
                    authToken = null;
                    currentUser = null;
                }
            }
        });
    </script>
</body>
</html>`);
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

// ==================== HEALTH CHECK ====================
app.get('/api/health', async (req, res) => {
    try {
        const dbTest = await pool.query('SELECT NOW() as current_time');
        const userCount = await pool.query('SELECT COUNT(*) FROM users');
        
        res.json({
            status: 'OK',
            timestamp: new Date().toISOString(),
            database: 'Connected',
            users: userCount.rows[0].count,
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

// ==================== AUTH ROUTES ====================

// Register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password, facilityId } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters long' });
        }

        const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'User already exists with this email' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await pool.query(
            'INSERT INTO users (name, email, password, facility_id, is_approved) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email',
            [name, email, hashedPassword, facilityId || null, false]
        );

        res.status(201).json({
            message: 'Registration successful! Please wait for admin approval.',
            user: result.rows[0]
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const result = await pool.query(`
            SELECT u.*, f.name as facility_name 
            FROM users u 
            LEFT JOIN facilities f ON u.facility_id = f.id 
            WHERE u.email = $1
        `, [email]);

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];

        if (!user.is_approved) {
            return res.status(401).json({ error: 'Account pending approval' });
        }

        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        delete user.password;

        res.json({
            token,
            user: user
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Verify token
app.get('/api/auth/verify', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.*, f.name as facility_name 
            FROM users u 
            LEFT JOIN facilities f ON u.facility_id = f.id 
            WHERE u.id = $1
        `, [req.user.id]);

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }

        const user = result.rows[0];
        delete user.password;

        res.json({ user });
    } catch (error) {
        console.error('Token verification error:', error);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// ==================== FACILITIES ROUTES ====================

app.get('/api/facilities/public', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name FROM facilities ORDER BY name');
        res.json(result.rows);
    } catch (error) {
        console.error('Get public facilities error:', error);
        res.status(500).json({ error: 'Failed to fetch facilities' });
    }
});

app.get('/api/facilities', authenticateToken, async (req, res) => {
    try {
        let query = 'SELECT * FROM facilities ORDER BY name';
        let queryParams = [];

        if (req.user.role !== 'admin' && req.user.facility_id) {
            query = 'SELECT * FROM facilities WHERE id = $1 ORDER BY name';
            queryParams = [req.user.facility_id];
        }

        const result = await pool.query(query, queryParams);
        res.json(result.rows);
    } catch (error) {
        console.error('Get facilities error:', error);
        res.status(500).json({ error: 'Failed to fetch facilities' });
    }
});

app.post('/api/facilities', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Facility name is required' });
        }

        const result = await pool.query(
            'INSERT INTO facilities (name) VALUES ($1) RETURNING *',
            [name.trim()]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') {
            res.status(400).json({ error: 'Facility with this name already exists' });
        } else {
            console.error('Create facility error:', error);
            res.status(500).json({ error: 'Failed to create facility' });
        }
    }
});

// ==================== SUPPLIES ROUTES ====================

app.get('/api/supplies', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM supplies ORDER BY code');
        res.json(result.rows);
    } catch (error) {
        console.error('Get supplies error:', error);
        res.status(500).json({ error: 'Failed to fetch supplies' });
    }
});

app.post('/api/supplies', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { code, description, hcpcs, cost, is_custom } = req.body;

        if (!code || !description) {
            return res.status(400).json({ error: 'Code and description are required' });
        }

        const result = await pool.query(
            'INSERT INTO supplies (code, description, hcpcs, cost, is_custom) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [code, description, hcpcs || null, cost || 0, is_custom !== undefined ? is_custom : true]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') {
            res.status(400).json({ error: 'Supply with this code already exists' });
        } else {
            console.error('Create supply error:', error);
            res.status(500).json({ error: 'Failed to create supply' });
        }
    }
});

// ==================== PATIENTS ROUTES ====================

app.get('/api/patients', authenticateToken, async (req, res) => {
    try {
        let query = `
            SELECT p.*, f.name as facility_name 
            FROM patients p 
            LEFT JOIN facilities f ON p.facility_id = f.id
        `;
        let queryParams = [];

        if (req.user.role !== 'admin' && req.user.facility_id) {
            query += ' WHERE p.facility_id = $1';
            queryParams = [req.user.facility_id];
        }

        query += ' ORDER BY p.name';

        const result = await pool.query(query, queryParams);
        res.json(result.rows);
    } catch (error) {
        console.error('Get patients error:', error);
        res.status(500).json({ error: 'Failed to fetch patients' });
    }
});

app.post('/api/patients', authenticateToken, async (req, res) => {
    try {
        const { name, month, mrn, facilityId } = req.body;

        if (!name || !month || !facilityId) {
            return res.status(400).json({ error: 'Name, month, and facility are required' });
        }

        if (req.user.role !== 'admin' && req.user.facility_id !== parseInt(facilityId)) {
            return res.status(403).json({ error: 'Access denied to this facility' });
        }

        const result = await pool.query(
            'INSERT INTO patients (name, month, mrn, facility_id) VALUES ($1, $2, $3, $4) RETURNING *',
            [name, month, mrn || null, facilityId]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Create patient error:', error);
        res.status(500).json({ error: 'Failed to create patient' });
    }
});

// ==================== TRACKING ROUTES ====================

app.get('/api/patients/:id/tracking', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        if (req.user.role !== 'admin') {
            const patientCheck = await pool.query('SELECT facility_id FROM patients WHERE id = $1', [id]);
            if (patientCheck.rows.length === 0 || patientCheck.rows[0].facility_id !== req.user.facility_id) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        const result = await pool.query(`
            SELECT t.*, s.code, s.description, s.hcpcs, s.cost, s.is_custom
            FROM tracking t
            JOIN supplies s ON t.supply_id = s.id
            WHERE t.patient_id = $1
            ORDER BY s.code, t.day_of_month
        `, [id]);

        res.json(result.rows);
    } catch (error) {
        console.error('Get tracking error:', error);
        res.status(500).json({ error: 'Failed to fetch tracking data' });
    }
});

app.post('/api/patients/:id/tracking', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { supplyId, dayOfMonth, quantity } = req.body;

        if (req.user.role !== 'admin') {
            const patientCheck = await pool.query('SELECT facility_id FROM patients WHERE id = $1', [id]);
            if (patientCheck.rows.length === 0 || patientCheck.rows[0].facility_id !== req.user.facility_id) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        if (quantity > 0) {
            await pool.query(`
                INSERT INTO tracking (patient_id, supply_id, day_of_month, quantity)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (patient_id, supply_id, day_of_month)
                DO UPDATE SET quantity = $4, updated_at = CURRENT_TIMESTAMP
            `, [id, supplyId, dayOfMonth, quantity]);
        } else {
            await pool.query(
                'DELETE FROM tracking WHERE patient_id = $1 AND supply_id = $2 AND day_of_month = $3',
                [id, supplyId, dayOfMonth]
            );
        }

        res.json({ message: 'Tracking updated successfully' });
    } catch (error) {
        console.error('Update tracking error:', error);
        res.status(500).json({ error: 'Failed to update tracking data' });
    }
});

// ==================== WOUND DX ROUTES ====================

app.get('/api/patients/:id/wound-dx', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        if (req.user.role !== 'admin') {
            const patientCheck = await pool.query('SELECT facility_id FROM patients WHERE id = $1', [id]);
            if (patientCheck.rows.length === 0 || patientCheck.rows[0].facility_id !== req.user.facility_id) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        const result = await pool.query(`
            SELECT DISTINCT ON (supply_id) 
                   supply_id, 
                   COALESCE(wound_dx, '') as wound_dx
            FROM tracking
            WHERE patient_id = $1 
              AND wound_dx IS NOT NULL 
              AND wound_dx != ''
            ORDER BY supply_id, updated_at DESC
        `, [id]);

        res.json(result.rows);
    } catch (error) {
        console.error('Get wound dx error:', error);
        res.status(500).json({ error: 'Failed to fetch wound dx data' });
    }
});

app.post('/api/patients/:id/wound-dx', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { supplyId, woundDx } = req.body;

        if (req.user.role !== 'admin') {
            const patientCheck = await pool.query('SELECT facility_id FROM patients WHERE id = $1', [id]);
            if (patientCheck.rows.length === 0 || patientCheck.rows[0].facility_id !== req.user.facility_id) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        if (woundDx && woundDx.trim()) {
            const updateResult = await pool.query(`
                UPDATE tracking 
                SET wound_dx = $3, updated_at = CURRENT_TIMESTAMP 
                WHERE patient_id = $1 AND supply_id = $2
                RETURNING id
            `, [id, supplyId, woundDx.trim()]);

            if (updateResult.rows.length === 0) {
                await pool.query(`
                    INSERT INTO tracking (patient_id, supply_id, day_of_month, quantity, wound_dx)
                    VALUES ($1, $2, 1, 0, $3)
                    ON CONFLICT (patient_id, supply_id, day_of_month) 
                    DO UPDATE SET wound_dx = $3, updated_at = CURRENT_TIMESTAMP
                `, [id, supplyId, woundDx.trim()]);
            }
        } else {
            await pool.query(`
                UPDATE tracking 
                SET wound_dx = NULL, updated_at = CURRENT_TIMESTAMP 
                WHERE patient_id = $1 AND supply_id = $2
            `, [id, supplyId]);
        }

        res.json({ message: 'Wound Dx updated successfully' });
    } catch (error) {
        console.error('Update wound dx error:', error);
        res.status(500).json({ error: 'Failed to update wound dx data' });
    }
});

// ==================== DATABASE INITIALIZATION ====================

async function initializeDatabase() {
    try {
        console.log('🔄 Starting database initialization...');
        
        const tablesExist = await pool.query(`
            SELECT COUNT(*) FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name IN ('users', 'facilities', 'supplies', 'patients', 'tracking')
        `);
        
        if (parseInt(tablesExist.rows[0].count) < 5) {
            console.log('🔧 Database tables missing, running initialization...');
            
            // Create tables
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
            `);

            // Insert default data
            await pool.query(`
                INSERT INTO facilities (name) VALUES 
                    ('Main Hospital'),
                    ('Clinic North'),
                    ('Clinic South')
                ON CONFLICT (name) DO NOTHING;

                INSERT INTO supplies (code, description, hcpcs, cost, is_custom) VALUES 
                    (700, 'Foam Dressing 4x4', 'A6209', 5.50, false),
                    (701, 'Hydrocolloid Dressing 6x6', 'A6234', 8.75, false),
                    (702, 'Alginate Dressing 2x2', 'A6196', 12.25, false),
                    (272, 'Med-Surgical Supplies', 'B4149', 0.00, false)
                ON CONFLICT (code) DO NOTHING;
            `);

            // Insert admin user
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await pool.query(`
                INSERT INTO users (name, email, password, role, is_approved) VALUES 
                    ('System Administrator', 'admin@system.com', $1, 'admin', true)
                ON CONFLICT (email) DO NOTHING
            `, [hashedPassword]);

            console.log('✅ Database initialized successfully');
        } else {
            console.log('✅ Database tables verified');
        }
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
    }
}

// ==================== ERROR HANDLING ====================

app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

app.use((error, req, res, next) => {
    console.error('Global error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        message: error.message
    });
});

// ==================== SERVER START ====================

async function startServer() {
    await initializeDatabase();
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🔗 App URL: ${process.env.NODE_ENV === 'production' ? 'https://your-app.herokuapp.com' : `http://localhost:${PORT}`}`);
        console.log('🎉 Wound Care RT Supply Tracker is ready!');
        console.log('👑 Admin Login: admin@system.com / admin123');
    });
}

startServer().catch(error => {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
});
