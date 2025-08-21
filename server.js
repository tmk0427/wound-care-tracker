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
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
}

console.log('Environment check:');
console.log('  - NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('  - PORT:', PORT);
console.log('  - DATABASE_URL:', process.env.DATABASE_URL ? 'Set' : 'Missing');
console.log('  - JWT_SECRET:', process.env.JWT_SECRET ? 'Set' : 'Using default');

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 10
});

// Trust proxy for Heroku
app.set('trust proxy', 1);

// Rate limiting - configured for Heroku
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    // Skip successful requests (optional)
    skipSuccessfulRequests: false,
    // Key generator for Heroku
    keyGenerator: (req) => {
        return req.ip || req.connection.remoteAddress || 'unknown';
    }
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
    limits: { fileSize: 10 * 1024 * 1024 }
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

// Health check endpoint
app.get('/api/health', async (req, res) => {
    try {
        const dbTest = await pool.query('SELECT NOW() as current_time');
        
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

// Serve complete HTML application
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wound Care RT Supply Tracker</title>
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
            background: #e6fffa;
            color: #234e52;
            text-align: center;
            padding: 8px;
            font-size: 14px;
            border-bottom: 1px solid #81e6d9;
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

        .hidden {
            display: none !important;
        }

        /* Main Application Styles */
        .main-app {
            display: none;
            padding: 20px;
            max-width: 1400px;
            margin: 0 auto;
            margin-top: 40px;
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

        /* Form Styles */
        .patient-form {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .filter-section {
            background: #f7fafc;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 30px;
            border-left: 4px solid #667eea;
        }

        /* Table Styles */
        .table-container {
            overflow-x: auto;
            margin-top: 20px;
            width: 100%;
        }

        .admin-table, .patient-table {
            width: 100%;
            border-collapse: collapse;
            background: white;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }

        .admin-table th, .admin-table td,
        .patient-table th, .patient-table td {
            padding: 12px 15px;
            text-align: left;
            border-bottom: 1px solid #e2e8f0;
        }

        .admin-table th, .patient-table th {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            font-weight: 600;
            font-size: 14px;
        }

        .admin-table tbody tr:hover,
        .patient-table tbody tr:hover {
            background-color: #f7fafc;
        }

        /* Checkbox styles */
        .checkbox-container {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 20px;
        }

        .checkbox-container input[type="checkbox"] {
            width: 18px;
            height: 18px;
            cursor: pointer;
        }

        .bulk-actions {
            display: none;
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 20px;
            align-items: center;
            gap: 15px;
        }

        .bulk-actions.show {
            display: flex;
        }

        /* Supply tracking styles */
        .tracking-grid {
            display: grid;
            grid-template-columns: 200px repeat(auto-fit, minmax(40px, 1fr));
            gap: 1px;
            background: #e2e8f0;
            border-radius: 8px;
            overflow: hidden;
            margin-top: 20px;
        }

        .tracking-header {
            background: #667eea;
            color: white;
            padding: 10px;
            font-weight: 600;
            text-align: center;
            font-size: 12px;
        }

        .tracking-supply {
            background: #f7fafc;
            padding: 10px;
            font-weight: 600;
            font-size: 12px;
            border-right: 2px solid #e2e8f0;
        }

        .tracking-cell {
            background: white;
            padding: 5px;
        }

        .tracking-input {
            width: 100%;
            padding: 4px;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            text-align: center;
            font-size: 12px;
        }

        .tracking-input:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.1);
        }

        /* Summary Cards */
        .summary-cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .summary-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 25px;
            border-radius: 15px;
            text-align: center;
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
        }

        .summary-card h3 {
            font-size: 18px;
            margin-bottom: 15px;
            opacity: 0.9;
        }

        .summary-card .value {
            font-size: 32px;
            font-weight: 700;
        }

        /* Import Section */
        .excel-import-section {
            background: linear-gradient(135deg, #e6f3ff 0%, #cce7ff 100%);
            padding: 25px;
            border-radius: 12px;
            margin-bottom: 30px;
            border-left: 4px solid #4299e1;
            border: 1px solid #bee3f8;
        }

        /* Modal Styles */
        .modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.7);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }

        .modal-content {
            background: white;
            padding: 30px;
            border-radius: 15px;
            max-width: 600px;
            width: 90%;
            max-height: 80%;
            overflow-y: auto;
        }

        /* Notification */
        .notification {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #38a169;
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            z-index: 1001;
            display: none;
            animation: slideIn 0.3s ease;
        }

        .notification.error {
            background: #e53e3e;
        }

        @keyframes slideIn {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
        }

        /* Responsive Design */
        @media (max-width: 768px) {
            .header {
                text-align: center;
            }

            .header h1 {
                font-size: 24px;
            }

            .patient-form {
                grid-template-columns: 1fr;
            }

            .summary-cards {
                grid-template-columns: 1fr;
            }

            .tabs {
                overflow-x: auto;
            }

            .tracking-grid {
                grid-template-columns: 150px repeat(auto-fit, minmax(35px, 1fr));
            }
        }
    </style>
</head>
<body>
    <!-- Status Banner -->
    <div class="status-banner">
        Wound Care RT Supply Tracker - Professional Edition
    </div>

    <!-- Login/Register Screen -->
    <div id="loginContainer" class="login-container">
        <div class="auth-form">
            <h1>Wound Care RT Supply Tracker</h1>
            
            <!-- Auth Tabs -->
            <div class="auth-tabs">
                <button class="auth-tab active" onclick="showAuthTab('login', this)">Sign In</button>
                <button class="auth-tab" onclick="showAuthTab('register', this)">Register</button>
            </div>

            <!-- Login Form -->
            <div id="loginForm">
                <div class="form-group">
                    <label for="loginEmail">Email Address</label>
                    <input type="email" id="loginEmail" placeholder="Enter your email">
                </div>
                <div class="form-group">
                    <label for="loginPassword">Password</label>
                    <input type="password" id="loginPassword" placeholder="Enter your password">
                </div>
                <button class="auth-btn" onclick="login()" id="loginBtn">Sign In</button>
                <div id="loginError" class="error-message hidden">Invalid credentials</div>
            </div>

            <!-- Registration Form -->
            <div id="registerForm" class="hidden">
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
                <div id="registerError" class="error-message hidden"></div>
                <div id="registerSuccess" class="success-message hidden"></div>
            </div>
        </div>
    </div>

    <!-- Main Application -->
    <div id="mainApp" class="main-app">
        <div class="header">
            <div>
                <h1>Wound Care RT Supply Tracker</h1>
                <div class="header-info">
                    <div id="currentUserInfo"></div>
                </div>
            </div>
            <div class="header-controls">
                <button class="btn btn-secondary" onclick="showChangePasswordModal()">Change Password</button>
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
            <h2 style="margin-bottom: 30px; color: #4a5568;">Patient Management</h2>

            <!-- Excel Import Section -->
            <div class="excel-import-section">
                <h3 style="margin-bottom: 15px; color: #2b6cb0;">Bulk Import Patients from Excel</h3>
                <p style="color: #4299e1; margin-bottom: 20px;">Import multiple patients at once using an Excel file (.xlsx or .xls)</p>
                
                <div style="display: flex; gap: 15px; margin-bottom: 20px; flex-wrap: wrap;">
                    <button class="btn btn-secondary" onclick="downloadExcelTemplate()">Download Template</button>
                    <button class="btn btn-primary" onclick="showExcelImportModal()">Import Excel File</button>
                </div>

                <div style="background: #ebf8ff; padding: 15px; border-radius: 8px; border-left: 4px solid #4299e1;">
                    <h4 style="color: #2b6cb0; margin-bottom: 10px;">Required Excel Columns:</h4>
                    <ul style="color: #2b6cb0; margin-left: 20px;">
                        <li><strong>Name</strong> - Patient full name (e.g., "Smith, John")</li>
                        <li><strong>Month</strong> - Format: MM-YYYY (e.g., "12-2024")</li>
                        <li><strong>Facility</strong> - Exact facility name from your system</li>
                        <li><strong>MRN</strong> - Medical Record Number (optional)</li>
                    </ul>
                </div>
            </div>

            <div class="patient-form" id="patientFormSection">
                <div class="form-group">
                    <label>Patient Name</label>
                    <input type="text" id="patientName" placeholder="Last, First">
                </div>
                <div class="form-group">
                    <label>Select Month/Year</label>
                    <select id="patientMonth" style="padding: 10px; border-radius: 8px; border: 2px solid #e2e8f0; width: 100%;">
                        <option value="">Select Month/Year</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>MRN (Medical Record Number)</label>
                    <input type="text" id="mrnNumber" placeholder="MRN">
                </div>
                <div class="form-group">
                    <label>Select Facility</label>
                    <select id="patientFacility">
                        <option value="">Select Facility</option>
                    </select>
                </div>
                <div class="form-group">
                    <label></label>
                    <div style="display: flex; gap: 10px; margin-top: 25px;">
                        <button class="btn btn-primary" onclick="addPatient()" id="addPatientBtn">Add Patient</button>
                    </div>
                </div>
            </div>

            <!-- Bulk Actions -->
            <div class="bulk-actions" id="bulkActions">
                <span id="selectedCount">0 patients selected</span>
                <button class="btn btn-danger btn-sm" onclick="bulkDeletePatients()">Delete Selected</button>
                <button class="btn btn-secondary btn-sm" onclick="clearSelection()">Clear Selection</button>
            </div>

            <!-- Select All Checkbox -->
            <div class="checkbox-container">
                <input type="checkbox" id="selectAllPatients" onchange="toggleSelectAll()">
                <label for="selectAllPatients">Select All Patients</label>
            </div>

            <div class="table-container">
                <table class="admin-table" id="patientTable">
                    <thead>
                        <tr>
                            <th width="50">Select</th>
                            <th>Patient Name</th>
                            <th>MRN</th>
                            <th>Month/Year</th>
                            <th>Facility</th>
                            <th>Updated</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="patientTableBody">
                        <!-- Patients will be populated here -->
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Supply Tracking Tab -->
        <div id="trackingTab" class="tab-content hidden">
            <h2 style="margin-bottom: 30px; color: #4a5568;">Supply Tracking</h2>

            <div class="filter-section">
                <h3 style="margin-bottom: 15px; color: #4a5568;">Select Patient</h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
                    <div class="form-group">
                        <label for="trackingFacilitySelect">Filter by Facility</label>
                        <select id="trackingFacilitySelect" style="padding: 10px; border-radius: 8px; border: 2px solid #e2e8f0; width: 100%;">
                            <option value="">All Facilities</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="trackingMonthSelect">Filter by Month</label>
                        <select id="trackingMonthSelect" style="padding: 10px; border-radius: 8px; border: 2px solid #e2e8f0; width: 100%;">
                            <option value="">All Months</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="patientSelect">Select Patient</label>
                        <select id="patientSelect" style="padding: 10px; border-radius: 8px; border: 2px solid #e2e8f0; width: 100%;">
                            <option value="">Select Patient</option>
                        </select>
                    </div>
                </div>
            </div>

            <div id="trackingContent">
                <p style="text-align: center; color: #718096; font-size: 18px; margin-top: 100px;">
                    Please select a patient above to begin tracking supplies
                </p>
            </div>
        </div>

        <!-- Summary Tab -->
        <div id="summaryTab" class="tab-content hidden">
            <h2 style="margin-bottom: 30px; color: #4a5568;">Summary Report</h2>

            <div class="filter-section">
                <h3 style="margin-bottom: 15px; color: #4a5568;">Report Filters & Export Options</h3>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 15px;">
                    <div class="form-group">
                        <label for="summaryMonth">Select Month/Year</label>
                        <select id="summaryMonth" style="padding: 10px; border-radius: 8px; border: 2px solid #e2e8f0; width: 100%;">
                            <option value="">All Months</option>
                        </select>
                    </div>
                    
                    <div class="form-group" id="summaryFacilityGroup">
                        <label for="summaryFacility">Select Facility</label>
                        <select id="summaryFacility" style="padding: 10px; border-radius: 8px; border: 2px solid #e2e8f0; width: 100%;">
                            <option value="">All Facilities</option>
                        </select>
                    </div>
                </div>

                <div style="display: flex; gap: 15px; flex-wrap: wrap; align-items: center;">
                    <button class="btn btn-primary" onclick="applySummaryFilters()">Apply Filters</button>
                    <button class="btn btn-success" onclick="downloadUserReport()">Download Report</button>
                    <button class="btn btn-secondary" onclick="clearSummaryFilters()">Clear Filters</button>
                </div>
            </div>

            <div class="summary-cards">
                <div class="summary-card">
                    <h3>Total Patients</h3>
                    <div class="value" id="totalPatients">0</div>
                </div>
                <div class="summary-card">
                    <h3>Total Units Used</h3>
                    <div class="value" id="totalUnits">0</div>
                </div>
                <div class="summary-card">
                    <h3>Active Tracking Sheets</h3>
                    <div class="value" id="activeSheets">0</div>
                </div>
                <div class="summary-card">
                    <h3>Total Facilities</h3>
                    <div class="value" id="totalFacilities">0</div>
                </div>
            </div>

            <div class="table-container">
                <table class="admin-table" id="summaryTable">
                    <thead>
                        <tr>
                            <th>Patient Name</th>
                            <th>Month/Year</th>
                            <th>MRN</th>
                            <th>Facility</th>
                            <th>Last Updated</th>
                        </tr>
                    </thead>
                    <tbody id="summaryTableBody">
                        <!-- Summary data will be populated here -->
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Admin Panel Tab -->
        <div id="adminTab" class="tab-content hidden">
            <h2 style="margin-bottom: 30px; color: #4a5568;">Admin Panel</h2>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">
                <div style="background: #f7fafc; padding: 20px; border-radius: 12px; border-left: 4px solid #38a169;">
                    <h3 style="color: #38a169; margin-bottom: 15px;">User Management</h3>
                    <p style="color: #718096; margin-bottom: 15px;">Manage user accounts and permissions</p>
                    <div id="userStats" style="background: white; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                            <span>Total Users:</span>
                            <strong id="totalUsersCount">0</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span>Pending Approval:</span>
                            <strong id="pendingUsersCount" style="color: #ed8936;">0</strong>
                        </div>
                    </div>
                    <button class="btn btn-primary" onclick="loadUserManagement()">Manage Users</button>
                </div>

                <div style="background: #f7fafc; padding: 20px; border-radius: 12px; border-left: 4px solid #667eea;">
                    <h3 style="color: #667eea; margin-bottom: 15px;">Facility Management</h3>
                    <p style="color: #718096; margin-bottom: 15px;">Add and configure facilities</p>
                    <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                        <input type="text" id="newFacilityName" placeholder="Facility name" style="flex: 1; padding: 8px; border: 1px solid #e2e8f0; border-radius: 4px;">
                        <button class="btn btn-success btn-sm" onclick="addFacility()">Add</button>
                    </div>
                    <div id="facilitiesList" style="background: white; padding: 15px; border-radius: 8px; max-height: 200px; overflow-y: auto;">
                        Loading facilities...
                    </div>
                </div>

                <div style="background: #f7fafc; padding: 20px; border-radius: 12px; border-left: 4px solid #e53e3e;">
                    <h3 style="color: #e53e3e; margin-bottom: 15px;">System Statistics</h3>
                    <p style="color: #718096; margin-bottom: 15px;">Overview of system usage</p>
                    <div id="systemStats" style="background: white; padding: 15px; border-radius: 8px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span>Total Patients:</span>
                            <strong id="totalPatientsCount">0</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span>Total Facilities:</span>
                            <strong id="totalFacilitiesCount">0</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span>Total Supplies:</span>
                            <strong id="totalSuppliesCount">0</strong>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Edit Patient Modal -->
    <div id="editPatientModal" class="modal">
        <div class="modal-content">
            <h2>Edit Patient</h2>
            <div class="form-group">
                <label>Patient Name</label>
                <input type="text" id="editPatientName" placeholder="Last, First">
            </div>
            <div class="form-group">
                <label>MRN (Medical Record Number)</label>
                <input type="text" id="editMrnNumber" placeholder="MRN">
            </div>
            <div class="form-group">
                <label>Select Month/Year</label>
                <select id="editPatientMonth" style="padding: 10px; border-radius: 8px; border: 2px solid #e2e8f0; width: 100%;">
                    <option value="">Select Month/Year</option>
                </select>
            </div>
            <div class="form-group">
                <label>Select Facility</label>
                <select id="editPatientFacility" style="padding: 10px; border-radius: 8px; border: 2px solid #e2e8f0; width: 100%;">
                    <option value="">Select Facility</option>
                </select>
            </div>
            <div id="editPatientMessage" style="margin: 10px 0;"></div>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button class="btn btn-secondary" onclick="closeEditPatientModal()">Cancel</button>
                <button class="btn btn-primary" onclick="savePatientEdit()" id="savePatientBtn">Save Changes</button>
            </div>
        </div>
    </div>

    <!-- Change Password Modal -->
    <div id="changePasswordModal" class="modal">
        <div class="modal-content">
            <h2>Change Password</h2>
            <div class="form-group">
                <label>Current Password</label>
                <input type="password" id="currentPassword" placeholder="Enter current password">
            </div>
            <div class="form-group">
                <label>New Password</label>
                <input type="password" id="newPassword" placeholder="Enter new password">
            </div>
            <div class="form-group">
                <label>Confirm New Password</label>
                <input type="password" id="confirmPassword" placeholder="Confirm new password">
            </div>
            <div id="passwordMessage" style="margin: 10px 0;"></div>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button class="btn btn-secondary" onclick="closeChangePasswordModal()">Cancel</button>
                <button class="btn btn-primary" onclick="changePassword()" id="changePasswordBtn">Change Password</button>
            </div>
        </div>
    </div>

    <!-- Excel Import Modal -->
    <div id="excelImportModal" class="modal">
        <div class="modal-content">
            <h2>Import Patients from Excel</h2>
            
            <div style="border: 2px dashed #4299e1; border-radius: 10px; padding: 30px; text-align: center; background: #f7faff; margin: 20px 0;">
                <div style="font-size: 48px; margin-bottom: 20px;">📁</div>
                <h3 style="color: #4299e1; margin-bottom: 10px;">Drag & Drop Excel File Here</h3>
                <p style="color: #718096; margin-bottom: 20px;">or click to browse for file</p>
                <input type="file" id="excelFileInput" accept=".xlsx,.xls" style="display: none;" onchange="handleExcelFile(this.files[0])">
                <button class="btn btn-primary" onclick="document.getElementById('excelFileInput').click()">
                    Choose Excel File
                </button>
            </div>

            <div id="importResults" style="display: none; margin-top: 20px; padding: 15px; border-radius: 8px; max-height: 200px; overflow-y: auto;"></div>

            <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
                <button class="btn btn-secondary" onclick="closeExcelImportModal()">Close</button>
                <button class="btn btn-primary" onclick="processExcelImport()" id="processImportBtn" disabled>Import Data</button>
            </div>
        </div>
    </div>

    <!-- Notification -->
    <div id="notification" class="notification">
        <span id="notificationText">Action completed successfully!</span>
    </div>

    <script>
        // Global variables
        var currentUser = null;
        var authToken = localStorage.getItem('authToken');
        var selectedPatients = new Set();
        var editingPatientId = null;
        var appData = {
            facilities: [],
            patients: [],
            supplies: [],
            selectedPatient: null,
            trackingData: {},
            currentFilters: {
                month: '',
                facility: ''
            }
        };
        var excelData = null;
        var API_BASE = window.location.origin + '/api';

        // Utility function to pad strings
        function padStart(str, targetLength, padString) {
            str = String(str);
            targetLength = targetLength >> 0;
            padString = String(padString || ' ');
            if (str.length > targetLength) {
                return str;
            }
            targetLength = targetLength - str.length;
            if (targetLength > padString.length) {
                padString += padString.repeat(targetLength / padString.length);
            }
            return padString.slice(0, targetLength) + str;
        }

        // Utility function for making API calls
        function apiCall(endpoint, options) {
            var url = API_BASE + endpoint;
            var defaultOptions = {
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            if (authToken) {
                defaultOptions.headers['Authorization'] = 'Bearer ' + authToken;
            }

            var finalOptions = {};
            for (var key in defaultOptions) {
                finalOptions[key] = defaultOptions[key];
            }
            if (options) {
                for (var key in options) {
                    if (key === 'headers') {
                        for (var headerKey in options.headers) {
                            finalOptions.headers[headerKey] = options.headers[headerKey];
                        }
                    } else {
                        finalOptions[key] = options[key];
                    }
                }
            }

            if (options && options.body && typeof options.body === 'object') {
                finalOptions.body = JSON.stringify(options.body);
            }

            return fetch(url, finalOptions).then(function(response) {
                if (response.status === 401) {
                    logout();
                    throw new Error('Authentication required');
                }

                return response.json().then(function(data) {
                    if (!response.ok) {
                        throw new Error(data.error || 'Server error');
                    }
                    return data;
                });
            }).catch(function(error) {
                console.error('API call failed:', error);
                throw error;
            });
        }

        // Show notification
        function showNotification(message, isError) {
            var notification = document.getElementById('notification');
            var text = document.getElementById('notificationText');
            
            text.textContent = message;
            notification.className = 'notification' + (isError ? ' error' : '');
            notification.style.display = 'block';

            setTimeout(function() {
                notification.style.display = 'none';
            }, 3000);
        }

        // Populate month/year dropdowns - FIXED: Current month going back 1 year
        function populateMonthYearDropdowns() {
            var currentDate = new Date();
            var currentMonth = currentDate.getMonth();
            var currentYear = currentDate.getFullYear();
            
            var months = [];
            
            // Generate 15 months: current month + 2 future months + 12 past months
            var startDate = new Date(currentYear, currentMonth - 12); // 12 months ago
            var endDate = new Date(currentYear, currentMonth + 3); // 3 months in future
            
            var iterDate = new Date(startDate);
            while (iterDate < endDate) {
                var year = iterDate.getFullYear();
                var month = iterDate.getMonth();
                
                var monthStr = padStart(String(month + 1), 2, '0');
                var value = monthStr + '-' + year;
                var label = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                
                months.push({ value: value, label: label });
                
                // Move to next month
                iterDate.setMonth(iterDate.getMonth() + 1);
            }
            
            // Sort by date (newest first)
            months.sort(function(a, b) {
                var aMonthParts = a.value.split('-');
                var bMonthParts = b.value.split('-');
                var aDate = new Date(parseInt(aMonthParts[1]), parseInt(aMonthParts[0]) - 1);
                var bDate = new Date(parseInt(bMonthParts[1]), parseInt(bMonthParts[0]) - 1);
                return bDate - aDate;
            });
            
            var selectIds = ['patientMonth', 'trackingMonthSelect', 'summaryMonth', 'editPatientMonth'];
            for (var i = 0; i < selectIds.length; i++) {
                var selectId = selectIds[i];
                var select = document.getElementById(selectId);
                if (select) {
                    var currentOption = select.querySelector('option[value=""]');
                    if (currentOption) {
                        var placeholder = currentOption.textContent;
                        select.innerHTML = '<option value="">' + placeholder + '</option>';
                        
                        for (var j = 0; j < months.length; j++) {
                            var month = months[j];
                            var option = document.createElement('option');
                            option.value = month.value;
                            option.textContent = month.label;
                            select.appendChild(option);
                        }
                        
                        if (selectId === 'patientMonth') {
                            var currentMonthValue = padStart(String(currentMonth + 1), 2, '0') + '-' + currentYear;
                            select.value = currentMonthValue;
                        }
                    }
                }
            }
        }

        // Setup user interface
        function setupUserInterface() {
            var user = currentUser;
            if (!user) return;
            
            var facilityName = user.role === 'admin' ? "All Facilities" : (user.facility_name || "User");
            document.getElementById('currentUserInfo').innerHTML = 
                '<div style="font-weight: 600;">' + (user.name || user.email) + '</div>' +
                '<div>' + (user.role === 'admin' ? 'System Administrator' : 'User') + ' • ' + facilityName + '</div>';

            var adminTabButton = document.getElementById('adminTabButton');
            var summaryFacilityGroup = document.getElementById('summaryFacilityGroup');

            if (user.role === 'admin') {
                adminTabButton.style.display = 'block';
                summaryFacilityGroup.style.display = 'block';
            } else {
                adminTabButton.style.display = 'none';
                summaryFacilityGroup.style.display = 'none';
            }
        }

        // Initialize app
        function initApp() {
            setupUserInterface();
            populateMonthYearDropdowns();
            
            var requests = [
                apiCall('/facilities'),
                apiCall('/supplies'),
                apiCall('/patients')
            ];
            
            // Simple Promise.all replacement
            var completed = 0;
            var results = [];
            var hasError = false;
            
            for (var i = 0; i < requests.length; i++) {
                (function(index) {
                    requests[index].then(function(result) {
                        if (hasError) return;
                        results[index] = result;
                        completed++;
                        if (completed === requests.length) {
                            processLoadedData(results);
                        }
                    }).catch(function(error) {
                        if (hasError) return;
                        hasError = true;
                        console.error('Failed to load data:', error);
                        showNotification('Failed to load data: ' + error.message, true);
                    });
                })(i);
            }
        }

        function processLoadedData(results) {
            appData.facilities = results[0];
            appData.supplies = results[1];
            
            var allPatients = results[2];
            if (currentUser.role === 'admin') {
                appData.patients = allPatients;
            } else if (currentUser.facility_id) {
                appData.patients = [];
                for (var i = 0; i < allPatients.length; i++) {
                    if (allPatients[i].facility_id === currentUser.facility_id) {
                        appData.patients.push(allPatients[i]);
                    }
                }
            } else {
                appData.patients = [];
            }
            
            if (appData.patients && appData.patients.length > 0) {
                appData.patients.sort(function(a, b) {
                    var nameA = (a.name || '').toLowerCase();
                    var nameB = (b.name || '').toLowerCase();
                    return nameA.localeCompare(nameB);
                });
            }

            populatePatientFacilityDropdown();
            populateEditFacilityDropdown();
            populateTrackingFacilitySelector();
            populateSummaryFacilities();
            refreshPatientList();
            refreshPatientSelect();
            updateSummary();
            
            console.log('Data loading complete');
        }

        // Authentication functions
        function showAuthTab(tab, element) {
            var tabs = document.querySelectorAll('.auth-tab');
            for (var i = 0; i < tabs.length; i++) {
                tabs[i].classList.remove('active');
            }
            element.classList.add('active');

            if (tab === 'login') {
                document.getElementById('loginForm').classList.remove('hidden');
                document.getElementById('registerForm').classList.add('hidden');
            } else {
                document.getElementById('loginForm').classList.add('hidden');
                document.getElementById('registerForm').classList.remove('hidden');
                loadFacilitiesForRegistration();
            }
        }

        function loadFacilitiesForRegistration() {
            fetch(API_BASE + '/facilities/public').then(function(response) {
                return response.json();
            }).then(function(facilities) {
                var select = document.getElementById('registerFacility');
                select.innerHTML = '<option value="">Select a facility (optional)</option>';
                
                for (var i = 0; i < facilities.length; i++) {
                    var facility = facilities[i];
                    var option = document.createElement('option');
                    option.value = facility.id;
                    option.textContent = facility.name;
                    select.appendChild(option);
                }
            }).catch(function(error) {
                console.log('Could not load facilities for registration:', error);
            });
        }

        function register() {
            var name = document.getElementById('registerName').value.trim();
            var email = document.getElementById('registerEmail').value.trim();
            var password = document.getElementById('registerPassword').value.trim();
            var facilityId = document.getElementById('registerFacility').value;
            var registerBtn = document.getElementById('registerBtn');
            var errorEl = document.getElementById('registerError');
            var successEl = document.getElementById('registerSuccess');

            errorEl.classList.add('hidden');
            successEl.classList.add('hidden');

            if (!name || !email || !password) {
                errorEl.textContent = 'Please fill in all required fields';
                errorEl.classList.remove('hidden');
                return;
            }

            if (password.length < 6) {
                errorEl.textContent = 'Password must be at least 6 characters long';
                errorEl.classList.remove('hidden');
                return;
            }

            registerBtn.disabled = true;
            registerBtn.innerHTML = '<span class="loading"></span>Creating Account...';

            apiCall('/auth/register', {
                method: 'POST',
                body: { name: name, email: email, password: password, facilityId: facilityId || null }
            }).then(function(response) {
                successEl.textContent = response.message;
                successEl.classList.remove('hidden');

                document.getElementById('registerName').value = '';
                document.getElementById('registerEmail').value = '';
                document.getElementById('registerPassword').value = '';
                document.getElementById('registerFacility').value = '';

                setTimeout(function() {
                    showAuthTab('login', document.querySelector('.auth-tab'));
                    document.getElementById('loginEmail').value = email;
                }, 2000);
            }).catch(function(error) {
                errorEl.textContent = error.message;
                errorEl.classList.remove('hidden');
            }).finally(function() {
                registerBtn.disabled = false;
                registerBtn.innerHTML = 'Create Account';
            });
        }

        function login() {
            var email = document.getElementById('loginEmail').value.trim();
            var password = document.getElementById('loginPassword').value.trim();
            var loginBtn = document.getElementById('loginBtn');
            var loginError = document.getElementById('loginError');

            if (!email || !password) {
                showError('Please enter both email and password');
                return;
            }

            loginBtn.disabled = true;
            loginBtn.innerHTML = '<span class="loading"></span>Signing In...';
            loginError.classList.add('hidden');

            apiCall('/auth/login', {
                method: 'POST',
                body: { email: email, password: password }
            }).then(function(response) {
                authToken = response.token;
                currentUser = response.user;
                localStorage.setItem('authToken', authToken);

                document.getElementById('loginContainer').style.display = 'none';
                document.getElementById('mainApp').style.display = 'block';

                initApp();
            }).catch(function(error) {
                showError(error.message);
            }).finally(function() {
                loginBtn.disabled = false;
                loginBtn.innerHTML = 'Sign In';
            });
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

        function showError(message) {
            var loginError = document.getElementById('loginError');
            loginError.textContent = message;
            loginError.classList.remove('hidden');
            setTimeout(function() {
                loginError.classList.add('hidden');
            }, 5000);
        }

        // Patient selection functions
        function togglePatientSelection(patientId, checkbox) {
            if (checkbox.checked) {
                selectedPatients.add(patientId);
            } else {
                selectedPatients.delete(patientId);
            }
            updateBulkActions();
            updateSelectAllCheckbox();
        }

        function toggleSelectAll() {
            var selectAllCheckbox = document.getElementById('selectAllPatients');
            var patientCheckboxes = document.querySelectorAll('.patient-checkbox');
            
            if (selectAllCheckbox.checked) {
                selectedPatients.clear();
                for (var i = 0; i < appData.patients.length; i++) {
                    selectedPatients.add(appData.patients[i].id);
                }
                for (var i = 0; i < patientCheckboxes.length; i++) {
                    patientCheckboxes[i].checked = true;
                }
            } else {
                selectedPatients.clear();
                for (var i = 0; i < patientCheckboxes.length; i++) {
                    patientCheckboxes[i].checked = false;
                }
            }
            updateBulkActions();
        }

        function updateSelectAllCheckbox() {
            var selectAllCheckbox = document.getElementById('selectAllPatients');
            var totalPatients = appData.patients.length;
            var selectedCount = selectedPatients.size;
            
            if (selectedCount === 0) {
                selectAllCheckbox.indeterminate = false;
                selectAllCheckbox.checked = false;
            } else if (selectedCount === totalPatients) {
                selectAllCheckbox.indeterminate = false;
                selectAllCheckbox.checked = true;
            } else {
                selectAllCheckbox.indeterminate = true;
                selectAllCheckbox.checked = false;
            }
        }

        function updateBulkActions() {
            var bulkActions = document.getElementById('bulkActions');
            var selectedCount = document.getElementById('selectedCount');
            
            if (selectedPatients.size > 0) {
                bulkActions.classList.add('show');
                selectedCount.textContent = selectedPatients.size + ' patient' + (selectedPatients.size === 1 ? '' : 's') + ' selected';
            } else {
                bulkActions.classList.remove('show');
            }
        }

        function clearSelection() {
            selectedPatients.clear();
            var patientCheckboxes = document.querySelectorAll('.patient-checkbox');
            for (var i = 0; i < patientCheckboxes.length; i++) {
                patientCheckboxes[i].checked = false;
            }
            updateBulkActions();
            updateSelectAllCheckbox();
        }

        function bulkDeletePatients() {
            if (selectedPatients.size === 0) return;
            
            var message = 'Are you sure you want to delete ' + selectedPatients.size + ' patient' + (selectedPatients.size === 1 ? '' : 's') + ' and all their tracking data?';
            if (!confirm(message)) return;
            
            var patientIds = Array.from(selectedPatients);
            var promises = [];
            
            for (var i = 0; i < patientIds.length; i++) {
                promises.push(apiCall('/patients/' + patientIds[i], { method: 'DELETE' }));
            }
            
            Promise.all(promises).then(function() {
                clearSelection();
                initApp();
                showNotification('Patients deleted successfully!');
            }).catch(function(error) {
                showNotification('Failed to delete some patients: ' + error.message, true);
                initApp(); // Refresh to show current state
            });
        }

        // Edit Patient functions
        function showEditPatientModal(patientId) {
            editingPatientId = patientId;
            var patient = null;
            for (var i = 0; i < appData.patients.length; i++) {
                if (appData.patients[i].id === patientId) {
                    patient = appData.patients[i];
                    break;
                }
            }
            
            if (!patient) {
                showNotification('Patient not found', true);
                return;
            }
            
            document.getElementById('editPatientName').value = patient.name;
            document.getElementById('editMrnNumber').value = patient.mrn || '';
            
            // Convert storage format (YYYY-MM) to display format (MM-YYYY)
            var monthParts = patient.month.split('-');
            var displayMonth = monthParts[1] + '-' + monthParts[0];
            document.getElementById('editPatientMonth').value = displayMonth;
            
            document.getElementById('editPatientFacility').value = patient.facility_id;
            document.getElementById('editPatientMessage').innerHTML = '';
            
            document.getElementById('editPatientModal').style.display = 'flex';
        }

        function closeEditPatientModal() {
            document.getElementById('editPatientModal').style.display = 'none';
            editingPatientId = null;
            document.getElementById('editPatientName').value = '';
            document.getElementById('editMrnNumber').value = '';
            document.getElementById('editPatientMonth').value = '';
            document.getElementById('editPatientFacility').value = '';
            document.getElementById('editPatientMessage').innerHTML = '';
        }

        function savePatientEdit() {
            if (!editingPatientId) return;
            
            var name = document.getElementById('editPatientName').value.trim();
            var mrn = document.getElementById('editMrnNumber').value.trim();
            var monthInput = document.getElementById('editPatientMonth').value.trim();
            var facilityId = parseInt(document.getElementById('editPatientFacility').value);
            var saveBtn = document.getElementById('savePatientBtn');
            var messageEl = document.getElementById('editPatientMessage');

            if (!name || !monthInput || !facilityId) {
                messageEl.innerHTML = '<div class="error-message">Please fill in all required fields</div>';
                return;
            }

            var monthParts = monthInput.split('-');
            if (monthParts.length !== 2) {
                messageEl.innerHTML = '<div class="error-message">Invalid month format selected</div>';
                return;
            }
            
            // Convert display format (MM-YYYY) to storage format (YYYY-MM)
            var month = monthParts[1] + '-' + monthParts[0];

            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="loading"></span>Saving...';

            apiCall('/patients/' + editingPatientId, {
                method: 'PUT',
                body: { name: name, month: month, mrn: mrn, facilityId: facilityId }
            }).then(function() {
                messageEl.innerHTML = '<div class="success-message">Patient updated successfully!</div>';
                
                setTimeout(function() {
                    closeEditPatientModal();
                    initApp();
                    showNotification('Patient updated successfully!');
                }, 1500);
            }).catch(function(error) {
                messageEl.innerHTML = '<div class="error-message">' + error.message + '</div>';
            }).finally(function() {
                saveBtn.disabled = false;
                saveBtn.innerHTML = 'Save Changes';
            });
        }

        function populateEditFacilityDropdown() {
            var select = document.getElementById('editPatientFacility');
            if (!select) return;
            
            select.innerHTML = '<option value="">Select Facility</option>';

            for (var i = 0; i < appData.facilities.length; i++) {
                var facility = appData.facilities[i];
                var option = document.createElement('option');
                option.value = facility.id;
                option.textContent = facility.name;
                select.appendChild(option);
            }
        }

        // Password change functions
        function showChangePasswordModal() {
            document.getElementById('changePasswordModal').style.display = 'flex';
        }

        function closeChangePasswordModal() {
            document.getElementById('changePasswordModal').style.display = 'none';
            document.getElementById('currentPassword').value = '';
            document.getElementById('newPassword').value = '';
            document.getElementById('confirmPassword').value = '';
            document.getElementById('passwordMessage').innerHTML = '';
        }

        function changePassword() {
            var current = document.getElementById('currentPassword').value;
            var newPass = document.getElementById('newPassword').value;
            var confirm = document.getElementById('confirmPassword').value;
            var messageEl = document.getElementById('passwordMessage');
            var changeBtn = document.getElementById('changePasswordBtn');

            if (!current || !newPass || !confirm) {
                messageEl.innerHTML = '<div class="error-message">Please fill in all fields</div>';
                return;
            }

            if (newPass !== confirm) {
                messageEl.innerHTML = '<div class="error-message">New passwords do not match</div>';
                return;
            }

            if (newPass.length < 6) {
                messageEl.innerHTML = '<div class="error-message">Password must be at least 6 characters</div>';
                return;
            }

            changeBtn.disabled = true;
            changeBtn.innerHTML = '<span class="loading"></span>Changing...';

            apiCall('/auth/change-password', {
                method: 'POST',
                body: { currentPassword: current, newPassword: newPass }
            }).then(function() {
                messageEl.innerHTML = '<div class="success-message">Password changed successfully!</div>';

                setTimeout(function() {
                    closeChangePasswordModal();
                }, 2000);
            }).catch(function(error) {
                messageEl.innerHTML = '<div class="error-message">' + error.message + '</div>';
            }).finally(function() {
                changeBtn.disabled = false;
                changeBtn.innerHTML = 'Change Password';
            });
        }

        // Navigation functions
        function showTab(tabName, clickedElement) {
            var tabContents = document.querySelectorAll('.tab-content');
            for (var i = 0; i < tabContents.length; i++) {
                tabContents[i].classList.add('hidden');
                tabContents[i].style.display = 'none';
            }

            var tabs = document.querySelectorAll('.tab');
            for (var i = 0; i < tabs.length; i++) {
                tabs[i].classList.remove('active');
            }

            var targetTab = document.getElementById(tabName + 'Tab');
            if (targetTab) {
                targetTab.classList.remove('hidden');
                targetTab.style.display = 'block';

                if (tabName === 'admin') {
                    setTimeout(function() { loadAdminData(); }, 100);
                }
            }

            if (clickedElement) {
                clickedElement.classList.add('active');
            }

            if (tabName === 'summary') {
                updateSummary();
            }

            if (tabName === 'patients') {
                refreshPatientList();
            }

            if (tabName === 'tracking') {
                refreshPatientSelect();
            }
        }

        // Patient management functions
        function populatePatientFacilityDropdown() {
            var select = document.getElementById('patientFacility');
            select.innerHTML = '<option value="">Select Facility</option>';

            for (var i = 0; i < appData.facilities.length; i++) {
                var facility = appData.facilities[i];
                var option = document.createElement('option');
                option.value = facility.id;
                option.textContent = facility.name;
                select.appendChild(option);
            }
        }

        function addPatient() {
            var name = document.getElementById('patientName').value.trim();
            var monthInput = document.getElementById('patientMonth').value.trim();
            var mrn = document.getElementById('mrnNumber').value.trim();
            var facilityId = parseInt(document.getElementById('patientFacility').value);
            var addBtn = document.getElementById('addPatientBtn');

            if (!name || !monthInput || !facilityId) {
                showNotification('Please fill in all required fields including facility selection', true);
                return;
            }

            var monthParts = monthInput.split('-');
            if (monthParts.length !== 2) {
                showNotification('Invalid month format selected', true);
                return;
            }
            
            var month = monthParts[1] + '-' + monthParts[0];

            addBtn.disabled = true;
            addBtn.innerHTML = '<span class="loading"></span>Adding...';

            apiCall('/patients', {
                method: 'POST',
                body: { name: name, month: month, mrn: mrn, facilityId: facilityId }
            }).then(function() {
                document.getElementById('patientName').value = '';
                document.getElementById('mrnNumber').value = '';
                document.getElementById('patientFacility').value = '';
                populateMonthYearDropdowns();

                initApp();
                showNotification('Patient added successfully!');
            }).catch(function(error) {
                showNotification(error.message, true);
            }).finally(function() {
                addBtn.disabled = false;
                addBtn.innerHTML = 'Add Patient';
            });
        }

        function refreshPatientList() {
            var tableBody = document.getElementById('patientTableBody');
            
            if (!tableBody) return;

            if (appData.patients.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #718096; padding: 40px;">No patients found. Add your first patient above or import from Excel.</td></tr>';
                return;
            }

            tableBody.innerHTML = '';

            for (var i = 0; i < appData.patients.length; i++) {
                var patient = appData.patients[i];
                var row = document.createElement('tr');
                
                var monthParts = patient.month.split('-');
                var displayMonth = monthParts[1] + '-' + monthParts[0];
                
                var isSelected = selectedPatients.has(patient.id);
                
                row.innerHTML = 
                    '<td><input type="checkbox" class="patient-checkbox" ' + (isSelected ? 'checked' : '') + ' onchange="togglePatientSelection(' + patient.id + ', this)"></td>' +
                    '<td>' + patient.name + '</td>' +
                    '<td>' + (patient.mrn || 'N/A') + '</td>' +
                    '<td>' + displayMonth + '</td>' +
                    '<td>' + (patient.facility_name || 'Unknown') + '</td>' +
                    '<td>' + new Date(patient.updated_at).toLocaleDateString() + '</td>' +
                    '<td>' +
                        '<button class="btn btn-secondary btn-sm" onclick="viewPatientTracking(' + patient.id + ')" style="margin-right: 5px;">View</button>' +
                        '<button class="btn btn-primary btn-sm" onclick="showEditPatientModal(' + patient.id + ')" style="margin-right: 5px;">Edit</button>' +
                        '<button class="btn btn-danger btn-sm" onclick="removePatient(' + patient.id + ')">Delete</button>' +
                    '</td>';

                tableBody.appendChild(row);
            }
            
            updateSelectAllCheckbox();
        }

        function viewPatientTracking(patientId) {
            showTab('tracking', document.querySelector('.tab:nth-child(2)'));
            document.getElementById('patientSelect').value = patientId;
            loadPatientTracking();
        }

        function removePatient(patientId) {
            if (confirm('Are you sure you want to remove this patient and all tracking data?')) {
                apiCall('/patients/' + patientId, {
                    method: 'DELETE'
                }).then(function() {
                    selectedPatients.delete(patientId);
                    initApp();
                    showNotification('Patient removed successfully!');
                }).catch(function(error) {
                    showNotification('Failed to remove patient: ' + error.message, true);
                });
            }
        }

        // Excel functions
        function downloadExcelTemplate() {
            var worksheet = XLSX.utils.aoa_to_sheet([
                ['Name', 'Month', 'MRN', 'Facility'],
                ['Smith, John', '12-2024', 'MRN12345', 'Main Hospital']
            ]);

            var workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Patients');
            XLSX.writeFile(workbook, 'patient_import_template.xlsx');
        }

        function showExcelImportModal() {
            document.getElementById('excelImportModal').style.display = 'flex';
        }

        function closeExcelImportModal() {
            document.getElementById('excelImportModal').style.display = 'none';
            document.getElementById('excelFileInput').value = '';
            document.getElementById('importResults').style.display = 'none';
            document.getElementById('processImportBtn').disabled = true;
            excelData = null;
        }

        function handleExcelFile(file) {
            if (!file) return;

            if (!file.name.match(/\.(xlsx|xls)$/)) {
                showNotification('Please select an Excel file (.xlsx or .xls)', true);
                return;
            }

            var reader = new FileReader();
            reader.onload = function(e) {
                try {
                    var data = new Uint8Array(e.target.result);
                    var workbook = XLSX.read(data, { type: 'array' });
                    var sheetName = workbook.SheetNames[0];
                    var worksheet = workbook.Sheets[sheetName];
                    excelData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                    showExcelPreview(excelData, file.name);
                    document.getElementById('processImportBtn').disabled = false;
                } catch (error) {
                    showNotification('Error reading Excel file: ' + error.message, true);
                }
            };

            reader.readAsArrayBuffer(file);
        }

        function showExcelPreview(data, fileName) {
            var resultsDiv = document.getElementById('importResults');
            
            if (data.length < 2) {
                resultsDiv.innerHTML = '<p style="color: #e53e3e;"><strong>Error:</strong> Excel file must contain at least a header row and one data row.</p>';
                resultsDiv.style.display = 'block';
                return;
            }

            var headers = data[0];
            var dataRows = data.slice(1);

            var html = '<h4>File Preview: ' + fileName + '</h4>';
            html += '<p><strong>Rows to import:</strong> ' + dataRows.length + '</p>';
            html += '<p><strong>Columns found:</strong> ' + headers.join(', ') + '</p>';

            resultsDiv.innerHTML = html;
            resultsDiv.style.display = 'block';
        }

        function processExcelImport() {
            var processBtn = document.getElementById('processImportBtn');
            var resultsDiv = document.getElementById('importResults');

            if (!excelData) {
                showNotification('No Excel data to process', true);
                return;
            }

            processBtn.disabled = true;
            processBtn.innerHTML = '<span class="loading"></span>Processing...';

            var worksheet = XLSX.utils.aoa_to_sheet(excelData);
            var workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Patients');
            var excelBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

            var formData = new FormData();
            var blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            formData.append('excelFile', blob, 'patients.xlsx');

            fetch(API_BASE + '/patients/import-excel', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + authToken
                },
                body: formData
            }).then(function(response) {
                return response.json().then(function(result) {
                    if (!response.ok) {
                        throw new Error(result.error || 'Import failed');
                    }
                    return result;
                });
            }).then(function(result) {
                var resultsHtml = '<h4 style="color: #38a169;">Import Complete</h4><p>' + result.message + '</p>';
                resultsDiv.innerHTML = resultsHtml;
                resultsDiv.style.display = 'block';

                initApp();
                setTimeout(function() {
                    closeExcelImportModal();
                }, 3000);
            }).catch(function(error) {
                resultsDiv.innerHTML = '<h4 style="color: #e53e3e;">Import Failed</h4><p style="color: #e53e3e;">' + error.message + '</p>';
                resultsDiv.style.display = 'block';
            }).finally(function() {
                processBtn.disabled = false;
                processBtn.innerHTML = 'Import Data';
            });
        }

        // Supply tracking functions
        function populateTrackingFacilitySelector() {
            var select = document.getElementById('trackingFacilitySelect');
            if (!select) return;
            
            select.innerHTML = '<option value="">All Facilities</option>';

            for (var i = 0; i < appData.facilities.length; i++) {
                var facility = appData.facilities[i];
                var option = document.createElement('option');
                option.value = facility.id;
                option.textContent = facility.name;
                select.appendChild(option);
            }

            select.addEventListener('change', function() {
                updateTrackingFilters();
            });
        }

        function updateTrackingFilters() {
            var facilitySelect = document.getElementById('trackingFacilitySelect');
            var monthSelect = document.getElementById('trackingMonthSelect');
            
            if (!facilitySelect || !monthSelect) return;
            
            var selectedFacilityId = facilitySelect.value;
            var selectedMonth = monthSelect.value;
            
            updateFilteredPatientSelect(selectedFacilityId, selectedMonth);
        }

        function getFilteredTrackingPatients(facilityId, monthFilter) {
            var filteredPatients = [];
            for (var i = 0; i < appData.patients.length; i++) {
                filteredPatients.push(appData.patients[i]);
            }
            
            if (facilityId) {
                var newFiltered = [];
                for (var i = 0; i < filteredPatients.length; i++) {
                    if (filteredPatients[i].facility_id == facilityId) {
                        newFiltered.push(filteredPatients[i]);
                    }
                }
                filteredPatients = newFiltered;
            }
            
            if (monthFilter) {
                var monthParts = monthFilter.split('-');
                var storageFormat = monthParts[1] + '-' + monthParts[0];
                var newFiltered = [];
                for (var i = 0; i < filteredPatients.length; i++) {
                    if (filteredPatients[i].month === storageFormat) {
                        newFiltered.push(filteredPatients[i]);
                    }
                }
                filteredPatients = newFiltered;
            }
            
            filteredPatients.sort(function(a, b) {
                var nameA = (a.name || '').toLowerCase();
                var nameB = (b.name || '').toLowerCase();
                return nameA.localeCompare(nameB);
            });
            
            return filteredPatients;
        }

        function updateFilteredPatientSelect(facilityId, monthFilter) {
            var select = document.getElementById('patientSelect');
            if (!select) return;
            
            select.innerHTML = '<option value="">Select Patient</option>';
            
            var filteredPatients = getFilteredTrackingPatients(facilityId, monthFilter);
            
            if (filteredPatients.length === 0) {
                select.innerHTML = '<option value="">No patients match selected filters</option>';
                return;
            }

            for (var i = 0; i < filteredPatients.length; i++) {
                var patient = filteredPatients[i];
                var option = document.createElement('option');
                option.value = patient.id;

                var monthParts = patient.month.split('-');
                var displayMonth = monthParts[1] + '-' + monthParts[0];

                option.textContent = patient.name + ' (' + displayMonth + ') - ' + (patient.facility_name || 'Unknown Facility');
                select.appendChild(option);
            }

            var trackingContent = document.getElementById('trackingContent');
            if (trackingContent) {
                trackingContent.innerHTML = '<p style="text-align: center; color: #718096; font-size: 18px; margin-top: 100px;">Please select a patient from the filtered list to begin tracking supplies</p>';
            }
        }

        function refreshPatientSelect() {
            populateTrackingFacilitySelector();
            
            var monthSelect = document.getElementById('trackingMonthSelect');
            if (monthSelect) {
                monthSelect.addEventListener('change', function() {
                    updateTrackingFilters();
                });
            }
            
            updateTrackingFilters();
            
            var patientSelect = document.getElementById('patientSelect');
            if (patientSelect) {
                patientSelect.removeEventListener('change', loadPatientTracking);
                patientSelect.addEventListener('change', loadPatientTracking);
            }
        }

        // ENHANCED Supply Tracking with Grid Interface
        function loadPatientTracking() {
            var patientId = document.getElementById('patientSelect').value;
            var container = document.getElementById('trackingContent');

            if (!patientId) {
                container.innerHTML = '<p style="text-align: center; color: #718096; font-size: 18px; margin-top: 100px;">Please select a patient to begin tracking supplies</p>';
                return;
            }

            var patient = null;
            for (var i = 0; i < appData.patients.length; i++) {
                if (appData.patients[i].id == patientId) {
                    patient = appData.patients[i];
                    break;
                }
            }
            
            if (!patient) {
                container.innerHTML = '<div style="text-align: center; margin-top: 50px; padding: 20px; background: #fed7d7; border-radius: 10px; border-left: 4px solid #e53e3e;"><p style="color: #c53030; font-size: 16px; margin: 0;">Patient not found</p></div>';
                return;
            }

            container.innerHTML = '<p style="text-align: center; color: #667eea; font-size: 18px; margin-top: 100px;">Loading tracking interface...</p>';

            // Load both tracking data and supplies
            Promise.all([
                apiCall('/patients/' + patientId + '/tracking'),
                appData.supplies
            ]).then(function(results) {
                var trackingData = results[0];
                var supplies = results[1];
                
                createTrackingInterface(patient, supplies, trackingData, container);
            }).catch(function(error) {
                console.error('Failed to load tracking data:', error);
                
                var errorMessage = 'Failed to load tracking data: ' + error.message;
                
                if (error.message.indexOf('Access denied') !== -1) {
                    errorMessage = 'Access Denied: You may not have permission to view this patient data.';
                }
                
                container.innerHTML = '<div style="text-align: center; margin-top: 50px; padding: 20px; background: #fed7d7; border-radius: 10px; border-left: 4px solid #e53e3e;"><p style="color: #c53030; font-size: 16px; margin: 0;">' + errorMessage + '</p></div>';
            });
        }

        function createTrackingInterface(patient, supplies, trackingData, container) {
            // Get number of days in the patient's month
            var monthParts = patient.month.split('-');
            var year = parseInt(monthParts[0]);
            var month = parseInt(monthParts[1]) - 1; // JavaScript months are 0-indexed
            var daysInMonth = new Date(year, month + 1, 0).getDate();
            
            // Create tracking data map for quick lookups
            var trackingMap = {};
            for (var i = 0; i < trackingData.length; i++) {
                var tracking = trackingData[i];
                var key = tracking.supply_id + '_' + tracking.day_of_month;
                trackingMap[key] = tracking.quantity;
            }
            
            var displayMonth = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            
            var html = '<div style="margin-bottom: 30px;">';
            html += '<h3 style="color: #667eea; margin-bottom: 15px;">Supply Tracking - ' + patient.name + '</h3>';
            html += '<p style="color: #4a5568; margin-bottom: 10px;"><strong>Month:</strong> ' + displayMonth + '</p>';
            html += '<p style="color: #4a5568; margin-bottom: 10px;"><strong>Facility:</strong> ' + (patient.facility_name || 'Unknown') + '</p>';
            html += '<p style="color: #4a5568; margin-bottom: 20px;"><strong>MRN:</strong> ' + (patient.mrn || 'N/A') + '</p>';
            html += '</div>';
            
            // Create the tracking grid
            html += '<div class="tracking-grid">';
            
            // Header row
            html += '<div class="tracking-header">Supply</div>';
            for (var day = 1; day <= daysInMonth; day++) {
                html += '<div class="tracking-header">' + day + '</div>';
            }
            html += '<div class="tracking-header">Total</div>';
            
            // Supply rows
            for (var i = 0; i < supplies.length; i++) {
                var supply = supplies[i];
                html += '<div class="tracking-supply" title="' + supply.description + ' (Code: ' + supply.code + ')">';
                html += supply.code + '<br><small>' + supply.description.substring(0, 20) + (supply.description.length > 20 ? '...' : '') + '</small>';
                html += '</div>';
                
                var rowTotal = 0;
                
                // Day cells
                for (var day = 1; day <= daysInMonth; day++) {
                    var key = supply.id + '_' + day;
                    var quantity = trackingMap[key] || 0;
                    rowTotal += parseInt(quantity) || 0;
                    
                    html += '<div class="tracking-cell">';
                    html += '<input type="number" class="tracking-input" ';
                    html += 'data-patient-id="' + patient.id + '" ';
                    html += 'data-supply-id="' + supply.id + '" ';
                    html += 'data-day="' + day + '" ';
                    html += 'value="' + (quantity || '') + '" ';
                    html += 'min="0" max="99" ';
                    html += 'onchange="updateTracking(this)">';
                    html += '</div>';
                }
                
                // Total cell
                html += '<div class="tracking-cell" style="background: #f7fafc; font-weight: bold; text-align: center; padding: 10px;">';
                html += '<span id="total_' + supply.id + '">' + rowTotal + '</span>';
                html += '</div>';
            }
            
            html += '</div>';
            
            // Add save button and summary
            html += '<div style="margin-top: 30px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">';
            html += '<div style="color: #4a5568;">';
            html += '<strong>Auto-saved:</strong> Changes are saved automatically as you type';
            html += '</div>';
            html += '<button class="btn btn-success" onclick="exportTrackingData(' + patient.id + ')">Export Tracking Data</button>';
            html += '</div>';
            
            container.innerHTML = html;
        }

        function updateTracking(input) {
            var patientId = input.dataset.patientId;
            var supplyId = input.dataset.supplyId;
            var day = input.dataset.day;
            var quantity = parseInt(input.value) || 0;
            
            // Validate input
            if (quantity < 0) {
                input.value = 0;
                quantity = 0;
            }
            if (quantity > 99) {
                input.value = 99;
                quantity = 99;
            }
            
            // Update total for this supply
            updateSupplyTotal(supplyId);
            
            // Save to server (with debouncing)
            clearTimeout(input.saveTimeout);
            input.saveTimeout = setTimeout(function() {
                apiCall('/patients/' + patientId + '/tracking', {
                    method: 'POST',
                    body: {
                        supplyId: parseInt(supplyId),
                        dayOfMonth: parseInt(day),
                        quantity: quantity
                    }
                }).then(function() {
                    input.style.borderColor = '#38a169';
                    setTimeout(function() {
                        input.style.borderColor = '#e2e8f0';
                    }, 1000);
                }).catch(function(error) {
                    console.error('Failed to save tracking data:', error);
                    input.style.borderColor = '#e53e3e';
                    showNotification('Failed to save: ' + error.message, true);
                });
            }, 500);
        }

        function updateSupplyTotal(supplyId) {
            var inputs = document.querySelectorAll('[data-supply-id="' + supplyId + '"]');
            var total = 0;
            
            for (var i = 0; i < inputs.length; i++) {
                total += parseInt(inputs[i].value) || 0;
            }
            
            var totalElement = document.getElementById('total_' + supplyId);
            if (totalElement) {
                totalElement.textContent = total;
            }
        }

        function exportTrackingData(patientId) {
            showNotification('Exporting tracking data...');
            
            var patient = null;
            for (var i = 0; i < appData.patients.length; i++) {
                if (appData.patients[i].id == patientId) {
                    patient = appData.patients[i];
                    break;
                }
            }
            
            if (!patient) {
                showNotification('Patient not found', true);
                return;
            }
            
            apiCall('/patients/' + patientId + '/tracking').then(function(trackingData) {
                var monthParts = patient.month.split('-');
                var displayMonth = monthParts[1] + '-' + monthParts[0];
                
                var reportData = [];
                reportData.push(['SUPPLY TRACKING REPORT']);
                reportData.push(['Patient: ' + patient.name]);
                reportData.push(['Month: ' + displayMonth]);
                reportData.push(['Facility: ' + (patient.facility_name || 'Unknown')]);
                reportData.push(['Generated: ' + new Date().toLocaleDateString()]);
                reportData.push([]);
                reportData.push(['Supply Code', 'Description', 'Day', 'Quantity']);
                
                for (var i = 0; i < trackingData.length; i++) {
                    var tracking = trackingData[i];
                    reportData.push([
                        tracking.code,
                        tracking.description,
                        tracking.day_of_month,
                        tracking.quantity
                    ]);
                }
                
                var worksheet = XLSX.utils.aoa_to_sheet(reportData);
                var workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, 'Tracking');
                
                var fileName = 'Tracking_' + patient.name.replace(/[^a-zA-Z0-9]/g, '_') + '_' + displayMonth.replace('-', '_') + '.xlsx';
                XLSX.writeFile(workbook, fileName);
                
                showNotification('Tracking data exported successfully!');
            }).catch(function(error) {
                showNotification('Failed to export: ' + error.message, true);
            });
        }

        // Summary functions
        function populateSummaryFacilities() {
            var select = document.getElementById('summaryFacility');
            if (!select) return;
            
            select.innerHTML = '<option value="">All Facilities</option>';

            for (var i = 0; i < appData.facilities.length; i++) {
                var facility = appData.facilities[i];
                var option = document.createElement('option');
                option.value = facility.id;
                option.textContent = facility.name;
                select.appendChild(option);
            }
        }

        function applySummaryFilters() {
            var month = document.getElementById('summaryMonth').value;
            var facility = document.getElementById('summaryFacility') ? document.getElementById('summaryFacility').value : '';

            appData.currentFilters.month = month;
            appData.currentFilters.facility = facility;

            updateSummary();
        }

        function clearSummaryFilters() {
            document.getElementById('summaryMonth').value = '';
            if (document.getElementById('summaryFacility')) {
                document.getElementById('summaryFacility').value = '';
            }
            
            appData.currentFilters.month = '';
            appData.currentFilters.facility = '';

            updateSummary();
        }

        function getFilteredPatients() {
            var filteredPatients = [];
            for (var i = 0; i < appData.patients.length; i++) {
                filteredPatients.push(appData.patients[i]);
            }

            if (appData.currentFilters.month) {
                var monthParts = appData.currentFilters.month.split('-');
                var storageFormat = monthParts[1] + '-' + monthParts[0];
                var newFiltered = [];
                for (var i = 0; i < filteredPatients.length; i++) {
                    if (filteredPatients[i].month === storageFormat) {
                        newFiltered.push(filteredPatients[i]);
                    }
                }
                filteredPatients = newFiltered;
            }

            if (appData.currentFilters.facility) {
                var newFiltered = [];
                for (var i = 0; i < filteredPatients.length; i++) {
                    if (filteredPatients[i].facility_id == appData.currentFilters.facility) {
                        newFiltered.push(filteredPatients[i]);
                    }
                }
                filteredPatients = newFiltered;
            }

            return filteredPatients;
        }

        function updateSummary() {
            try {
                var filteredPatients = getFilteredPatients();

                document.getElementById('totalPatients').textContent = filteredPatients.length;
                document.getElementById('totalUnits').textContent = '0';
                document.getElementById('activeSheets').textContent = filteredPatients.length;
                document.getElementById('totalFacilities').textContent = appData.facilities.length;

                updateSummaryTable(filteredPatients);
            } catch (error) {
                console.error('Failed to update summary:', error);
                showNotification('Failed to update summary: ' + error.message, true);
            }
        }

        function updateSummaryTable(patients) {
            var tbody = document.getElementById('summaryTableBody');
            tbody.innerHTML = '';

            var patientsToShow = patients || getFilteredPatients();

            if (patientsToShow.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #718096;">No patients to display</td></tr>';
                return;
            }

            for (var i = 0; i < patientsToShow.length; i++) {
                var patient = patientsToShow[i];
                var monthParts = patient.month.split('-');
                var displayMonth = monthParts[1] + '-' + monthParts[0];
                var lastUpdated = new Date(patient.updated_at).toLocaleDateString();

                var row = document.createElement('tr');
                row.innerHTML = 
                    '<td>' + patient.name + '</td>' +
                    '<td>' + displayMonth + '</td>' +
                    '<td>' + (patient.mrn || 'N/A') + '</td>' +
                    '<td>' + (patient.facility_name || 'Unknown') + '</td>' +
                    '<td>' + lastUpdated + '</td>';
                tbody.appendChild(row);
            }
        }

        function downloadUserReport() {
            try {
                showNotification('Generating report...');
                
                var filteredPatients = getFilteredPatients();
                var reportData = [];
                
                var fileName = 'Supply_Report';
                if (appData.currentFilters.month) {
                    var monthParts = appData.currentFilters.month.split('-');
                    var monthName = new Date(monthParts[1], monthParts[0] - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                    fileName = 'Supply_Report_' + monthName.replace(' ', '_');
                }
                
                var header = ['Patient Name', 'MRN', 'Month/Year', 'Facility', 'Last Updated'];
                
                reportData.push(['WOUND CARE SUPPLY REPORT - Generated ' + new Date().toLocaleDateString()]);
                reportData.push(header);
                
                for (var i = 0; i < filteredPatients.length; i++) {
                    var patient = filteredPatients[i];
                    var monthParts = patient.month.split('-');
                    var displayMonth = monthParts[1] + '-' + monthParts[0];
                    
                    var row = [
                        patient.name || 'Unknown',
                        patient.mrn || 'N/A',
                        displayMonth,
                        patient.facility_name || 'Unknown',
                        new Date(patient.updated_at).toLocaleDateString()
                    ];
                    
                    reportData.push(row);
                }

                var worksheet = XLSX.utils.aoa_to_sheet(reportData);
                var workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
                
                XLSX.writeFile(workbook, fileName + '.xlsx');
                
                showNotification('Report downloaded successfully!');
                
            } catch (error) {
                console.error('Failed to generate report:', error);
                showNotification('Failed to generate report: ' + error.message, true);
            }
        }

        // Admin functions
        function loadAdminData() {
            if (!currentUser || currentUser.role !== 'admin') return;

            apiCall('/statistics').then(function(stats) {
                document.getElementById('totalUsersCount').textContent = stats.totalUsers;
                document.getElementById('pendingUsersCount').textContent = stats.pendingUsers;
                document.getElementById('totalPatientsCount').textContent = stats.totalPatients;
                document.getElementById('totalFacilitiesCount').textContent = stats.totalFacilities;
                document.getElementById('totalSuppliesCount').textContent = stats.totalSupplies;
                
                loadFacilitiesList();
            }).catch(function(error) {
                console.error('Failed to load admin data:', error);
            });
        }

        function loadFacilitiesList() {
            try {
                var facilitiesList = document.getElementById('facilitiesList');
                if (!facilitiesList) return;
                
                if (appData.facilities.length === 0) {
                    facilitiesList.innerHTML = '<p style="color: #718096;">No facilities added yet.</p>';
                    return;
                }
                
                var html = '';
                for (var i = 0; i < appData.facilities.length; i++) {
                    var facility = appData.facilities[i];
                    html += '<div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #e2e8f0;">';
                    html += '<span>' + facility.name + '</span>';
                    html += '<button class="btn btn-danger btn-sm" onclick="deleteFacility(' + facility.id + ')">Delete</button>';
                    html += '</div>';
                }
                
                facilitiesList.innerHTML = html;
            } catch (error) {
                console.error('Failed to load facilities list:', error);
            }
        }

        function addFacility() {
            var name = document.getElementById('newFacilityName').value.trim();
            
            if (!name) {
                showNotification('Please enter a facility name', true);
                return;
            }
            
            apiCall('/facilities', {
                method: 'POST',
                body: { name: name }
            }).then(function() {
                document.getElementById('newFacilityName').value = '';
                initApp();
                loadAdminData();
                showNotification('Facility added successfully!');
            }).catch(function(error) {
                showNotification('Failed to add facility: ' + error.message, true);
            });
        }

        function deleteFacility(facilityId) {
            if (!confirm('Are you sure you want to delete this facility? This action cannot be undone.')) {
                return;
            }
            
            apiCall('/facilities/' + facilityId, {
                method: 'DELETE'
            }).then(function() {
                initApp();
                loadAdminData();
                showNotification('Facility deleted successfully!');
            }).catch(function(error) {
                showNotification('Failed to delete facility: ' + error.message, true);
            });
        }

        function loadUserManagement() {
            showNotification('User management interface coming soon!');
        }

        // Initialization
        window.addEventListener('DOMContentLoaded', function() {
            if (authToken) {
                console.log('Checking stored auth token...');
                
                apiCall('/auth/verify').then(function(response) {
                    currentUser = response.user;
                    
                    console.log('Token valid, auto-logging in user:', currentUser.email);
                    
                    document.getElementById('loginContainer').style.display = 'none';
                    document.getElementById('mainApp').style.display = 'block';
                    
                    initApp();
                }).catch(function(error) {
                    console.log('Stored token invalid, showing login');
                    localStorage.removeItem('authToken');
                    authToken = null;
                    currentUser = null;
                });
            } else {
                console.log('No stored token, showing login screen');
            }
        });

        // Handle Enter key for login
        document.addEventListener('DOMContentLoaded', function() {
            var loginEmail = document.getElementById('loginEmail');
            var loginPassword = document.getElementById('loginPassword');
            
            if (loginEmail && loginPassword) {
                var inputs = [loginEmail, loginPassword];
                for (var i = 0; i < inputs.length; i++) {
                    inputs[i].addEventListener('keypress', function(e) {
                        if (e.key === 'Enter') {
                            login();
                        }
                    });
                }
            }
        });
    </script>
</body>
</html>`);
});

// ADD NEW PUT ROUTE FOR UPDATING PATIENTS
app.put('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, month, mrn, facilityId } = req.body;

        if (!name || !month || !facilityId) {
            return res.status(400).json({ error: 'Name, month, and facility are required' });
        }

        // Check if user has access to this patient
        if (req.user.role !== 'admin') {
            const patientCheck = await pool.query('SELECT facility_id FROM patients WHERE id = $1', [id]);
            if (patientCheck.rows.length === 0 || patientCheck.rows[0].facility_id !== req.user.facility_id) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        // Verify user has access to the new facility
        if (req.user.role !== 'admin' && req.user.facility_id !== parseInt(facilityId)) {
            return res.status(403).json({ error: 'Access denied to this facility' });
        }

        const result = await pool.query(
            'UPDATE patients SET name = $1, month = $2, mrn = $3, facility_id = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *',
            [name, month, mrn || null, facilityId, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Update patient error:', error);
        res.status(500).json({ error: 'Failed to update patient' });
    }
});

// UPDATE TRACKING ROUTES for better functionality
app.post('/api/patients/:id/tracking', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { supplyId, dayOfMonth, quantity } = req.body;

        // Check if user has access to this patient
        if (req.user.role !== 'admin') {
            const patientCheck = await pool.query('SELECT facility_id FROM patients WHERE id = $1', [id]);
            if (patientCheck.rows.length === 0 || patientCheck.rows[0].facility_id !== req.user.facility_id) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        if (quantity > 0) {
            // Insert or update tracking record
            await pool.query(`
                INSERT INTO tracking (patient_id, supply_id, day_of_month, quantity)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (patient_id, supply_id, day_of_month)
                DO UPDATE SET quantity = $4, updated_at = CURRENT_TIMESTAMP
            `, [id, supplyId, dayOfMonth, quantity]);
        } else {
            // Remove tracking record if quantity is 0
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

// Continue with rest of the server code...
// [All the other auth, facilities, patients, etc. routes remain the same as before]

// Auth routes
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

app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters long' });
        }

        const userResult = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
        const isValidPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password);
        
        if (!isValidPassword) {
            return res.status(400).json({ error: 'Current password is incorrect' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [hashedPassword, req.user.id]);

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: 'Failed to change password' });
    }
});

// Facilities routes
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

app.delete('/api/facilities/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        const patientCheck = await pool.query('SELECT COUNT(*) FROM patients WHERE facility_id = $1', [id]);
        if (parseInt(patientCheck.rows[0].count) > 0) {
            return res.status(400).json({ error: 'Cannot delete facility with existing patients' });
        }

        const result = await pool.query('DELETE FROM facilities WHERE id = $1 RETURNING *', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Facility not found' });
        }

        res.json({ message: 'Facility deleted successfully' });
    } catch (error) {
        console.error('Delete facility error:', error);
        res.status(500).json({ error: 'Failed to delete facility' });
    }
});

// Supplies routes
app.get('/api/supplies', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM supplies ORDER BY code');
        res.json(result.rows);
    } catch (error) {
        console.error('Get supplies error:', error);
        res.status(500).json({ error: 'Failed to fetch supplies' });
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

app.delete('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        if (req.user.role !== 'admin') {
            const patientCheck = await pool.query('SELECT facility_id FROM patients WHERE id = $1', [id]);
            if (patientCheck.rows.length === 0 || patientCheck.rows[0].facility_id !== req.user.facility_id) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        const result = await pool.query('DELETE FROM patients WHERE id = $1 RETURNING *', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        res.json({ message: 'Patient deleted successfully' });
    } catch (error) {
        console.error('Delete patient error:', error);
        res.status(500).json({ error: 'Failed to delete patient' });
    }
});

app.post('/api/patients/import-excel', authenticateToken, upload.single('excelFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);

        const results = { success: [], errors: [] };

        const facilitiesResult = await pool.query('SELECT id, name FROM facilities');
        const facilitiesMap = {};
        facilitiesResult.rows.forEach(f => {
            facilitiesMap[f.name.toLowerCase()] = f.id;
        });

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            try {
                const name = row.Name || row.name;
                const month = row.Month || row.month;
                const mrn = row.MRN || row.mrn || '';
                const facilityName = row.Facility || row.facility;

                if (!name || !month || !facilityName) {
                    results.errors.push(`Row ${i + 2}: Missing required fields (Name, Month, Facility)`);
                    continue;
                }

                const facilityId = facilitiesMap[facilityName.toLowerCase()];
                if (!facilityId) {
                    results.errors.push(`Row ${i + 2}: Facility "${facilityName}" not found`);
                    continue;
                }

                if (req.user.role !== 'admin' && req.user.facility_id !== facilityId) {
                    results.errors.push(`Row ${i + 2}: Access denied to facility "${facilityName}"`);
                    continue;
                }

                const monthParts = month.split('-');
                const storageMonth = monthParts[1] + '-' + monthParts[0];

                await pool.query(
                    'INSERT INTO patients (name, month, mrn, facility_id) VALUES ($1, $2, $3, $4)',
                    [name, storageMonth, mrn, facilityId]
                );

                results.success.push(`${name} (${month}) added successfully`);
            } catch (error) {
                results.errors.push(`Row ${i + 2}: ${error.message}`);
            }
        }

        res.json({
            message: `Import completed: ${results.success.length} successful, ${results.errors.length} errors`,
            results
        });
    } catch (error) {
        console.error('Excel import error:', error);
        res.status(500).json({ error: 'Failed to import Excel file' });
    }
});

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

app.get('/api/statistics', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const stats = await Promise.all([
            pool.query('SELECT COUNT(*) FROM users'),
            pool.query('SELECT COUNT(*) FROM users WHERE is_approved = false'),
            pool.query('SELECT COUNT(*) FROM facilities'),
            pool.query('SELECT COUNT(*) FROM patients'),
            pool.query('SELECT COUNT(*) FROM supplies')
        ]);

        res.json({
            totalUsers: parseInt(stats[0].rows[0].count),
            pendingUsers: parseInt(stats[1].rows[0].count),
            totalFacilities: parseInt(stats[2].rows[0].count),
            totalPatients: parseInt(stats[3].rows[0].count),
            totalSupplies: parseInt(stats[4].rows[0].count)
        });
    } catch (error) {
        console.error('Get statistics error:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

async function initializeDatabase() {
    try {
        console.log('Starting database initialization...');
        
        await pool.query('SELECT NOW()');
        console.log('Database connection successful');
        
        const tablesExist = await pool.query(`
            SELECT COUNT(*) FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name IN ('users', 'facilities', 'supplies', 'patients', 'tracking')
        `);
        
        if (parseInt(tablesExist.rows[0].count) < 5) {
            console.log('Creating database tables...');
            
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
                    (706, 'Silicone Foam Border 6x6', 'A6212', 18.90, false),
                    (707, 'Gauze Pad Sterile 4x4', 'A6402', 0.85, false),
                    (708, 'Calcium Alginate 4x4', 'A6196', 14.20, false),
                    (709, 'Hydrogel Sheet 4x4', 'A6242', 9.80, false),
                    (710, 'Composite Dressing 4x4', 'A6203', 7.45, false),
                    (711, 'Zinc Paste Bandage 3x10', 'A6456', 6.30, false),
                    (712, 'Foam Dressing with Border 6x6', 'A6212', 11.95, false),
                    (713, 'Transparent Film 6x7', 'A6258', 4.75, false),
                    (714, 'Alginate Rope 12 inch', 'A6199', 18.50, false)
                ON CONFLICT (code) DO NOTHING;
            `);

            const hashedPassword = await bcrypt.hash('admin123', 10);
            await pool.query(`
                INSERT INTO users (name, email, password, role, is_approved) VALUES 
                    ('System Administrator', 'admin@system.com', $1, 'admin', true)
                ON CONFLICT (email) DO NOTHING
            `, [hashedPassword]);

            const demoHashedPassword = await bcrypt.hash('user123', 10);
            await pool.query(`
                INSERT INTO users (name, email, password, role, facility_id, is_approved) VALUES 
                    ('Demo User', 'user@demo.com', $1, 'user', 1, true)
                ON CONFLICT (email) DO NOTHING
            `, [demoHashedPassword]);

            await pool.query(`
                INSERT INTO patients (name, month, mrn, facility_id) VALUES 
                    ('Smith, John', '2024-12', 'MRN12345', 1),
                    ('Johnson, Mary', '2024-12', 'MRN67890', 1),
                    ('Brown, Robert', '2024-12', 'MRN11111', 2),
                    ('Davis, Jennifer', '2024-12', 'MRN22222', 1)
                ON CONFLICT (name, month, facility_id) DO NOTHING;
            `);

            console.log('Database initialized successfully');
        } else {
            console.log('Database tables already exist');
        }

        console.log('Default Login: admin@system.com / admin123');

    } catch (error) {
        console.error('Database initialization failed:', error);
    }
}

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

async function startServer() {
    try {
        console.log('Starting Wound Care RT Supply Tracker...');
        
        await initializeDatabase();
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`App URL: https://terence-wound-care-tracker-0ee111d0e54a.herokuapp.com`);
            console.log('Wound Care RT Supply Tracker is ready!');
            console.log('Admin Login: admin@system.com / admin123');
            console.log('User Login: user@demo.com / user123');
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
