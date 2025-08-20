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

        /* Authentication Styles */
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

        .auth-tabs {
            display: flex;
            margin-bottom: 30px;
            border-radius: 8px;
            overflow: hidden;
            background: #f7fafc;
        }

        .auth-tab {
            flex: 1;
            padding: 12px;
            background: #f7fafc;
            border: none;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s ease;
            color: #718096;
        }

        .auth-tab.active {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
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

        .form-group input, .form-group select {
            width: 100%;
            padding: 12px;
            border: 2px solid #e2e8f0;
            border-radius: 8px;
            font-size: 16px;
            transition: all 0.3s ease;
            background: white;
        }

        .form-group input:focus, .form-group select:focus {
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

        .success-message {
            color: #38a169;
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

        .forgot-password-link {
            color: #667eea;
            text-decoration: none;
            font-size: 14px;
            margin-top: 10px;
            display: inline-block;
        }

        .forgot-password-link:hover {
            text-decoration: underline;
        }

        /* Main Application Styles */
        .main-app {
            display: none;
            padding: 20px;
            max-width: 1400px;
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

        .header h1 {
            color: #4a5568;
            font-size: 28px;
            margin: 0;
        }

        .header-info {
            text-align: right;
            color: #718096;
            font-size: 14px;
        }

        .header-controls {
            display: flex;
            gap: 15px;
            align-items: center;
            flex-wrap: wrap;
        }

        .notification-badge {
            background: #e53e3e;
            color: white;
            border-radius: 50%;
            width: 20px;
            height: 20px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: bold;
            margin-left: 8px;
        }

        /* Button Styles */
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

        .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }

        .btn-secondary {
            background: #e2e8f0;
            color: #4a5568;
        }

        .btn-danger {
            background: #e53e3e;
            color: white;
        }

        .btn-success {
            background: #38a169;
            color: white;
        }

        .btn-warning {
            background: #ed8936;
            color: white;
        }

        .btn:hover {
            transform: translateY(-2px);
        }

        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }

        .btn-sm {
            padding: 6px 12px;
            font-size: 12px;
        }

        /* Tab Styles */
        .tabs {
            display: flex;
            background: white;
            border-radius: 15px;
            padding: 5px;
            margin-bottom: 20px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
            overflow-x: auto;
        }

        .tab {
            flex: 1;
            min-width: 120px;
            padding: 15px;
            text-align: center;
            border-radius: 10px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s ease;
            color: #718096;
        }

        .tab.active {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }

        .tab-content {
            background: white;
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
            min-height: 600px;
            width: 100%;
            position: relative;
        }

        /* Simple placeholder styles for the main content */
        .placeholder-content {
            text-align: center;
            padding: 60px 20px;
            background: #f0f4ff;
            border-radius: 15px;
            border: 2px dashed #667eea;
            color: #4a5568;
        }

        .placeholder-content h3 {
            color: #667eea;
            margin-bottom: 20px;
        }

        /* Responsive Design */
        @media (max-width: 768px) {
            .header {
                text-align: center;
            }

            .header h1 {
                font-size: 24px;
            }

            .header-controls {
                justify-content: center;
            }

            .main-app {
                padding: 10px;
            }
        }
    </style>
</head>
<body>
    <!-- Login/Register Screen -->
    <div id="loginContainer" class="login-container">
        <div class="auth-form">
            <h1>🏥 Wound Care RT Supply Tracker</h1>
            
            <!-- Auth Tabs -->
            <div class="auth-tabs">
                <button class="auth-tab active" onclick="showAuthTab('login', this)">Sign In</button>
                <button class="auth-tab" onclick="showAuthTab('register', this)">Register</button>
            </div>

            <!-- Login Form -->
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
                <div id="loginError" class="error-message" style="display: none;">Invalid credentials</div>
                <a href="#" class="forgot-password-link" onclick="alert('Please contact your administrator for password reset.')">Forgot Password?</a>
            </div>

            <!-- Registration Form -->
            <div id="registerForm" style="display: none;">
                <div class="form-group">
                    <label for="registerName">Full Name</label>
                    <input type="text" id="registerName" placeholder="Enter your full name">
                </div>
                <div class="form-group">
                    <label for="registerEmail">Email Address</label>
                    <input type="email" id="registerEmail" placeholder="Enter email address">
                </div>
                <div class="form-group">
                    <label for="registerPassword">Password</label>
                    <input type="password" id="registerPassword" placeholder="Enter password (min. 6 characters)">
                </div>
                <div class="form-group">
                    <label for="registerFacility">Facility (Optional)</label>
                    <select id="registerFacility">
                        <option value="">Select a facility (optional)</option>
                    </select>
                </div>
                <button class="auth-btn" onclick="register()" id="registerBtn">Create Account</button>
                <div id="registerError" class="error-message" style="display: none;"></div>
                <div id="registerSuccess" class="success-message" style="display: none;"></div>
            </div>
        </div>
    </div>

    <!-- Main Application -->
    <div id="mainApp" class="main-app">
        <div class="header">
            <div>
                <h1>🏥 Wound Care RT Supply Tracker</h1>
                <div class="header-info">
                    <div id="currentUserInfo">Welcome to the Wound Care RT Supply Tracker</div>
                </div>
            </div>
            <div class="header-controls">
                <button class="btn btn-secondary" onclick="alert('Change password feature coming soon!')">Change Password</button>
                <button class="btn btn-danger" onclick="logout()">Logout</button>
            </div>
        </div>

        <div class="tabs">
            <div class="tab active" onclick="showTab('patients', this)">Patient Management</div>
            <div class="tab" onclick="showTab('tracking', this)">Supply Tracking</div>
            <div class="tab" onclick="showTab('summary', this)">Summary Report</div>
            <div class="tab" id="adminTabButton" onclick="showTab('admin', this)">Admin Panel</div>
        </div>

        <!-- Patient Management Tab -->
        <div id="patientsTab" class="tab-content">
            <div class="placeholder-content">
                <h3>🏗️ Patient Management Coming Soon!</h3>
                <p>Add, edit, and manage patients here.</p>
                <p>Features include bulk Excel import, patient search, and facility management.</p>
            </div>
        </div>

        <!-- Supply Tracking Tab -->
        <div id="trackingTab" class="tab-content" style="display: none;">
            <div class="placeholder-content">
                <h3>📋 Supply Tracking Coming Soon!</h3>
                <p>Track daily supply usage for each patient.</p>
                <p>Features include real-time tracking, wound diagnosis codes, and automated calculations.</p>
            </div>
        </div>

        <!-- Summary Report Tab -->
        <div id="summaryTab" class="tab-content" style="display: none;">
            <div class="placeholder-content">
                <h3>📊 Summary Reports Coming Soon!</h3>
                <p>Generate comprehensive usage reports and analytics.</p>
                <p>Features include Excel export, cost analysis, and usage trends.</p>
            </div>
        </div>

        <!-- Admin Panel Tab -->
        <div id="adminTab" class="tab-content" style="display: none;">
            <div class="placeholder-content">
                <h3>🔧 Admin Panel Coming Soon!</h3>
                <p>Manage users, facilities, and system settings.</p>
                <p>Features include user approval, facility setup, and supply catalog management.</p>
            </div>
        </div>
    </div>

    <script>
        // Global variables and application state
        let currentUser = null;
        let authToken = localStorage.getItem('authToken');

        // API Configuration
        const API_BASE = window.location.origin + '/api';

        /**
         * Utility function for making API calls with authentication
         */
        async function apiCall(endpoint, options = {}) {
            const url = API_BASE + endpoint;
            const defaultOptions = {
                headers: {
                    'Content-Type': 'application/json'
                }
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

        // ========== AUTHENTICATION FUNCTIONS ==========

        /**
         * Show authentication tab (login/register)
         */
        function showAuthTab(tab, element) {
            document.querySelectorAll('.auth-tab').forEach(function(t) { t.classList.remove('active'); });
            element.classList.add('active');

            if (tab === 'login') {
                document.getElementById('loginForm').style.display = 'block';
                document.getElementById('registerForm').style.display = 'none';
            } else {
                document.getElementById('loginForm').style.display = 'none';
                document.getElementById('registerForm').style.display = 'block';
                loadFacilitiesForRegistration();
            }
        }

        /**
         * Load facilities for registration dropdown
         */
        async function loadFacilitiesForRegistration() {
            try {
                const response = await fetch(API_BASE + '/facilities/public');
                const facilities = await response.json();
                
                const select = document.getElementById('registerFacility');
                select.innerHTML = '<option value="">Select a facility (optional)</option>';
                
                facilities.forEach(function(facility) {
                    const option = document.createElement('option');
                    option.value = facility.id;
                    option.textContent = facility.name;
                    select.appendChild(option);
                });
            } catch (error) {
                console.log('Could not load facilities for registration:', error);
            }
        }

        /**
         * User registration
         */
        async function register() {
            const name = document.getElementById('registerName').value.trim();
            const email = document.getElementById('registerEmail').value.trim();
            const password = document.getElementById('registerPassword').value.trim();
            const facilityId = document.getElementById('registerFacility').value;
            const registerBtn = document.getElementById('registerBtn');
            const errorEl = document.getElementById('registerError');
            const successEl = document.getElementById('registerSuccess');

            errorEl.style.display = 'none';
            successEl.style.display = 'none';

            if (!name || !email || !password) {
                errorEl.textContent = 'Please fill in all required fields';
                errorEl.style.display = 'block';
                return;
            }

            if (password.length < 6) {
                errorEl.textContent = 'Password must be at least 6 characters long';
                errorEl.style.display = 'block';
                return;
            }

            try {
                registerBtn.disabled = true;
                registerBtn.innerHTML = '<span class="loading"></span>Creating Account...';

                const response = await apiCall('/auth/register', {
                    method: 'POST',
                    body: { name: name, email: email, password: password, facilityId: facilityId || null }
                });

                successEl.textContent = response.message;
                successEl.style.display = 'block';

                document.getElementById('registerName').value = '';
                document.getElementById('registerEmail').value = '';
                document.getElementById('registerPassword').value = '';
                document.getElementById('registerFacility').value = '';

                setTimeout(function() {
                    showAuthTab('login', document.querySelector('.auth-tab'));
                    document.getElementById('loginEmail').value = email;
                }, 2000);

            } catch (error) {
                errorEl.textContent = error.message;
                errorEl.style.display = 'block';
            } finally {
                registerBtn.disabled = false;
                registerBtn.innerHTML = 'Create Account';
            }
        }

        /**
         * User login
         */
        async function login() {
            const email = document.getElementById('loginEmail').value.trim();
            const password = document.getElementById('loginPassword').value.trim();
            const loginBtn = document.getElementById('loginBtn');
            const loginError = document.getElementById('loginError');

            if (!email || !password) {
                showError('Please enter both email and password');
                return;
            }

            try {
                loginBtn.disabled = true;
                loginBtn.innerHTML = '<span class="loading"></span>Signing In...';
                loginError.style.display = 'none';

                const response = await apiCall('/auth/login', {
                    method: 'POST',
                    body: { email: email, password: password }
                });

                authToken = response.token;
                currentUser = response.user;
                localStorage.setItem('authToken', authToken);

                document.getElementById('loginContainer').style.display = 'none';
                document.getElementById('mainApp').style.display = 'block';

                setupUserInterface();
            } catch (error) {
                showError(error.message);
            } finally {
                loginBtn.disabled = false;
                loginBtn.innerHTML = 'Sign In';
            }
        }

        /**
         * User logout
         */
        function logout() {
            authToken = null;
            currentUser = null;
            localStorage.removeItem('authToken');

            document.getElementById('loginContainer').style.display = 'flex';
            document.getElementById('mainApp').style.display = 'none';
            document.getElementById('loginEmail').value = '';
            document.getElementById('loginPassword').value = '';
        }

        /**
         * Show error message
         */
        function showError(message) {
            const loginError = document.getElementById('loginError');
            loginError.textContent = message;
            loginError.style.display = 'block';
            setTimeout(function() {
                loginError.style.display = 'none';
            }, 5000);
        }

        /**
         * Setup user interface based on user role and permissions
         */
        function setupUserInterface() {
            const user = currentUser;
            if (!user) {
                console.error('❌ No current user found');
                return;
            }
            
            console.log('⚙️ Setting up UI for user:', user.name, 'Role:', user.role);

            const facilityName = user.role === 'admin' ? "All Facilities" : (user.facility_name || "User");

            document.getElementById('currentUserInfo').innerHTML = 
                '<div style="font-weight: 600;">' + (user.name || user.email) + '</div>' +
                '<div>' + (user.role === 'admin' ? 'System Administrator' : 'User') + ' • ' + facilityName + '</div>';

            const adminTabButton = document.getElementById('adminTabButton');

            // Show/hide admin tab based on user role
            if (user.role === 'admin') {
                adminTabButton.style.display = 'block';
            } else {
                adminTabButton.style.display = 'none';
            }
        }

        // ========== NAVIGATION FUNCTIONS ==========

        /**
         * Show tab content
         */
        function showTab(tabName, clickedElement) {
            document.querySelectorAll('.tab-content').forEach(function(tab) {
                tab.style.display = 'none';
            });

            document.querySelectorAll('.tab').forEach(function(tab) {
                tab.classList.remove('active');
            });

            const targetTab = document.getElementById(tabName + 'Tab');
            if (targetTab) {
                targetTab.style.display = 'block';
            }

            if (clickedElement) {
                clickedElement.classList.add('active');
            }
        }

        // ========== INITIALIZATION ==========

        /**
         * Check for existing auth token on page load
         */
        window.addEventListener('DOMContentLoaded', async function() {
            if (authToken) {
                try {
                    console.log('🔍 Checking stored auth token...');
                    
                    const response = await apiCall('/auth/verify');
                    currentUser = response.user;
                    
                    console.log('✅ Token valid, auto-logging in user:', currentUser.email);
                    
                    document.getElementById('loginContainer').style.display = 'none';
                    document.getElementById('mainApp').style.display = 'block';
                    
                    setupUserInterface();
                } catch (error) {
                    console.log('❌ Stored token invalid, showing login');
                    localStorage.removeItem('authToken');
                    authToken = null;
                    currentUser = null;
                }
            } else {
                console.log('🔓 No stored token, showing login screen');
            }
        });

        /**
         * Handle Enter key for login
         */
        document.addEventListener('DOMContentLoaded', function() {
            const loginEmail = document.getElementById('loginEmail');
            const loginPassword = document.getElementById('loginPassword');
            
            if (loginEmail && loginPassword) {
                [loginEmail, loginPassword].forEach(function(input) {
                    input.addEventListener('keypress', function(e) {
                        if (e.key === 'Enter') {
                            login();
                        }
                    });
                });
            }
        });
    </script>
</body>
</html>`);
});

// ==================== HEALTH CHECK ====================
app.get('/api/health', async (req, res) => {
    try {
        const dbTest = await pool.query('SELECT NOW() as current_time');
        
        res.json({
            status: 'OK',
            timestamp: new Date().toISOString(),
            database: 'Connected',
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

// Change password
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters long' });
        }

        // Verify current password
        const userResult = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
        const isValidPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password);
        
        if (!isValidPassword) {
            return res.status(400).json({ error: 'Current password is incorrect' });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        await pool.query('UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [hashedPassword, req.user.id]);

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: 'Failed to change password' });
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

// ==================== DATABASE INITIALIZATION ====================

async function initializeDatabase() {
    try {
        console.log('🔄 Starting database initialization...');
        
        // Check if tables exist
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

                CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
                CREATE INDEX IF NOT EXISTS idx_users_facility ON users(facility_id);
                CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
                CREATE INDEX IF NOT EXISTS idx_patients_facility ON patients(facility_id);
                CREATE INDEX IF NOT EXISTS idx_patients_month ON patients(month);
                CREATE INDEX IF NOT EXISTS idx_tracking_patient ON tracking(patient_id);
                CREATE INDEX IF NOT EXISTS idx_tracking_supply ON tracking(supply_id);
                CREATE INDEX IF NOT EXISTS idx_supplies_code ON supplies(code);
            `);

            // Insert default data
            await pool.query(`
                INSERT INTO facilities (name) VALUES 
                    ('Main Hospital'),
                    ('Clinic North'),
                    ('Clinic South'),
                    ('Outpatient Center')
                ON CONFLICT (name) DO NOTHING;

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
                    (SELECT COUNT(*) FROM users) as users
            `);

            if (counts && counts.rows && counts.rows[0]) {
                console.log('📊 Database setup complete:');
                console.log(`   - Facilities: ${counts.rows[0].facilities}`);
                console.log(`   - Supplies: ${counts.rows[0].supplies}`);
                console.log(`   - Users: ${counts.rows[0].users}`);
            }
        } catch (verifyError) {
            console.log('⚠️  Could not verify setup counts, but continuing...');
        }

        console.log('\n🔑 Default Login Credentials:');
        console.log('   Admin: admin@system.com / admin123');
        console.log('   User:  user@demo.com / user123');

    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        // Don't exit, let the app start anyway
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
        message: error.message,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
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
        console.log('👤 User Login: user@demo.com / user123');
    });
}

startServer().catch(error => {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
});
