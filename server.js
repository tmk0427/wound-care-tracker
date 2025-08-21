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

console.log('🔧 Environment check:');
console.log('  - NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('  - PORT:', PORT);
console.log('  - DATABASE_URL:', process.env.DATABASE_URL ? '✅ Set' : '❌ Missing');
console.log('  - JWT_SECRET:', process.env.JWT_SECRET ? '✅ Set' : '⚠️ Using default');

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 10
});

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
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
        }
    </style>
</head>
<body>
    <!-- Status Banner -->
    <div class="status-banner">
        🏥 Wound Care RT Supply Tracker - Professional Edition
    </div>

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
                <h1>🏥 Wound Care RT Supply Tracker</h1>
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
                <h3 style="margin-bottom: 15px; color: #2b6cb0;">📊 Bulk Import Patients from Excel</h3>
                <p style="color: #4299e1; margin-bottom: 20px;">Import multiple patients at once using an Excel file (.xlsx or .xls)</p>
                
                <div style="display: flex; gap: 15px; margin-bottom: 20px; flex-wrap: wrap;">
                    <button class="btn btn-secondary" onclick="downloadExcelTemplate()">📥 Download Template</button>
                    <button class="btn btn-primary" onclick="showExcelImportModal()">📤 Import Excel File</button>
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

            <div class="table-container">
                <table class="admin-table" id="patientTable">
                    <thead>
                        <tr>
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
                <h3 style="margin-bottom: 15px; color: #4a5568;">📋 Select Patient</h3>
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
                <h3 style="margin-bottom: 15px; color: #4a5568;">📊 Report Filters & Export Options</h3>
                
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
                    <button class="btn btn-primary" onclick="applySummaryFilters()">📈 Apply Filters</button>
                    <button class="btn btn-success" onclick="downloadUserReport()">📊 Download Report</button>
                    <button class="btn btn-secondary" onclick="clearSummaryFilters()">🔄 Clear Filters</button>
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
            <h2 style="margin-bottom: 30px; color: #4a5568;">🔧 Admin Panel</h2>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">
                <div style="background: #f7fafc; padding: 20px; border-radius: 12px; border-left: 4px solid #38a169;">
                    <h3 style="color: #38a169; margin-bottom: 15px;">👥 User Management</h3>
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
                    <h3 style="color: #667eea; margin-bottom: 15px;">🏢 Facility Management</h3>
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
                    <h3 style="color: #e53e3e; margin-bottom: 15px;">📊 System Statistics</h3>
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
            <h2>📊 Import Patients from Excel</h2>
            
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
        // Global variables and application state
        let currentUser = null;
        let authToken = localStorage.getItem('authToken');
        let appData = {
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
        let excelData = null;

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

        /**
         * Show notification
         */
        function showNotification(message, isError = false) {
            const notification = document.getElementById('notification');
            const text = document.getElementById('notificationText');
            
            text.textContent = message;
            notification.className = 'notification' + (isError ? ' error' : '');
            notification.style.display = 'block';

            setTimeout(function() {
                notification.style.display = 'none';
            }, 3000);
        }

        /**
         * Populate month/year dropdowns with MM-YYYY format
         */
        function populateMonthYearDropdowns() {
            const currentDate = new Date();
            const currentMonth = currentDate.getMonth();
            const currentYear = currentDate.getFullYear();
            
            // Generate months from 2 years ago to 2 years in the future
            const months = [];
            for (let year = currentYear - 2; year <= currentYear + 2; year++) {
                for (let month = 0; month < 12; month++) {
                    const monthStr = String(month + 1).padStart(2, '0');
                    const value = monthStr + '-' + year;
                    const label = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                    months.push({ value: value, label: label });
                }
            }
            
            // Sort by date (newest first for recent months)
            months.sort((a, b) => {
                const [aMonth, aYear] = a.value.split('-').map(Number);
                const [bMonth, bYear] = b.value.split('-').map(Number);
                const aDate = new Date(aYear, aMonth - 1);
                const bDate = new Date(bYear, bMonth - 1);
                return bDate - aDate;
            });
            
            // Populate all month dropdowns
            ['patientMonth', 'trackingMonthSelect', 'summaryMonth'].forEach(function(selectId) {
                const select = document.getElementById(selectId);
                if (select) {
                    const currentOption = select.querySelector('option[value=""]').textContent;
                    select.innerHTML = '<option value="">' + currentOption + '</option>';
                    months.forEach(function(month) {
                        const option = document.createElement('option');
                        option.value = month.value;
                        option.textContent = month.label;
                        select.appendChild(option);
                    });
                    
                    // Set default to current month for patient month
                    if (selectId === 'patientMonth') {
                        const currentMonthValue = String(currentMonth + 1).padStart(2, '0') + '-' + currentYear;
                        select.value = currentMonthValue;
                    }
                }
            });
        }

        /**
         * Setup user interface based on user role and permissions
         */
        function setupUserInterface() {
            const user = currentUser;
            if (!user) return;
            
            const facilityName = user.role === 'admin' ? "All Facilities" : (user.facility_name || "User");
            document.getElementById('currentUserInfo').innerHTML = 
                '<div style="font-weight: 600;">' + (user.name || user.email) + '</div>' +
                '<div>' + (user.role === 'admin' ? 'System Administrator' : 'User') + ' • ' + facilityName + '</div>';

            const adminTabButton = document.getElementById('adminTabButton');
            const summaryFacilityGroup = document.getElementById('summaryFacilityGroup');

            if (user.role === 'admin') {
                adminTabButton.style.display = 'block';
                summaryFacilityGroup.style.display = 'block';
            } else {
                adminTabButton.style.display = 'none';
                summaryFacilityGroup.style.display = 'none';
            }
        }

        /**
         * Initialize the application
         */
        async function initApp() {
            try {
                setupUserInterface();
                populateMonthYearDropdowns();
                await loadAllData();
                populateSummaryFacilities();
            } catch (error) {
                console.error('App initialization error:', error);
                showNotification('Failed to initialize application. Please refresh the page.', true);
            }
        }

        /**
         * Load all application data
         */
        async function loadAllData() {
            try {
                console.log('🔄 Loading all data...');
                
                appData.facilities = await apiCall('/facilities');
                appData.supplies = await apiCall('/supplies');
                
                // Load patients based on user permissions
                const allPatients = await apiCall('/patients');
                if (currentUser.role === 'admin') {
                    appData.patients = allPatients;
                } else if (currentUser.facility_id) {
                    appData.patients = allPatients.filter(function(patient) {
                        return patient.facility_id === currentUser.facility_id;
                    });
                } else {
                    appData.patients = [];
                }
                
                if (appData.patients && Array.isArray(appData.patients)) {
                    appData.patients.sort(function(a, b) {
                        const nameA = (a.name || '').toLowerCase();
                        const nameB = (b.name || '').toLowerCase();
                        return nameA.localeCompare(nameB);
                    });
                }

                populatePatientFacilityDropdown();
                populateTrackingFacilitySelector();
                refreshPatientList();
                refreshPatientSelect();
                updateSummary();
                
                console.log('✅ Data loading complete');
            } catch (error) {
                console.error('Failed to load data:', error);
                showNotification('❌ Failed to load data: ' + error.message, true);
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
                document.getElementById('loginForm').classList.remove('hidden');
                document.getElementById('registerForm').classList.add('hidden');
            } else {
                document.getElementById('loginForm').classList.add('hidden');
                document.getElementById('registerForm').classList.remove('hidden');
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

            try {
                registerBtn.disabled = true;
                registerBtn.innerHTML = '<span class="loading"></span>Creating Account...';

                const response = await apiCall('/auth/register', {
                    method: 'POST',
                    body: { name: name, email: email, password: password, facilityId: facilityId || null }
                });

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

            } catch (error) {
                errorEl.textContent = error.message;
                errorEl.classList.remove('hidden');
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

                await initApp();
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
            loginError.classList.remove('hidden');
            setTimeout(function() {
                loginError.classList.add('hidden');
            }, 5000);
        }

        // ========== PASSWORD CHANGE FUNCTIONS ==========

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

        async function changePassword() {
            const current = document.getElementById('currentPassword').value;
            const newPass = document.getElementById('newPassword').value;
            const confirm = document.getElementById('confirmPassword').value;
            const messageEl = document.getElementById('passwordMessage');
            const changeBtn = document.getElementById('changePasswordBtn');

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

            try {
                changeBtn.disabled = true;
                changeBtn.innerHTML = '<span class="loading"></span>Changing...';

                await apiCall('/auth/change-password', {
                    method: 'POST',
                    body: { currentPassword: current, newPassword: newPass }
                });

                messageEl.innerHTML = '<div class="success-message">Password changed successfully!</div>';

                setTimeout(function() {
                    closeChangePasswordModal();
                }, 2000);
            } catch (error) {
                messageEl.innerHTML = '<div class="error-message">' + error.message + '</div>';
            } finally {
                changeBtn.disabled = false;
                changeBtn.innerHTML = 'Change Password';
            }
        }

        // ========== NAVIGATION FUNCTIONS ==========

        /**
         * Show tab content
         */
        function showTab(tabName, clickedElement) {
            document.querySelectorAll('.tab-content').forEach(function(tab) {
                tab.classList.add('hidden');
                tab.style.display = 'none';
            });

            document.querySelectorAll('.tab').forEach(function(tab) {
                tab.classList.remove('active');
            });

            const targetTab = document.getElementById(tabName + 'Tab');
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

        // ========== PATIENT MANAGEMENT FUNCTIONS ==========

        /**
         * Populate patient facility dropdown
         */
        function populatePatientFacilityDropdown() {
            const select = document.getElementById('patientFacility');
            select.innerHTML = '<option value="">Select Facility</option>';

            appData.facilities.forEach(function(facility) {
                const option = document.createElement('option');
                option.value = facility.id;
                option.textContent = facility.name;
                select.appendChild(option);
            });
        }

        /**
         * Add a new patient
         */
        async function addPatient() {
            const name = document.getElementById('patientName').value.trim();
            const monthInput = document.getElementById('patientMonth').value.trim();
            const mrn = document.getElementById('mrnNumber').value.trim();
            const facilityId = parseInt(document.getElementById('patientFacility').value);
            const addBtn = document.getElementById('addPatientBtn');

            if (!name || !monthInput || !facilityId) {
                showNotification('Please fill in all required fields including facility selection', true);
                return;
            }

            // Convert MM-YYYY to YYYY-MM format for storage
            const monthParts = monthInput.split('-');
            if (monthParts.length !== 2) {
                showNotification('Invalid month format selected', true);
                return;
            }
            
            const month = monthParts[1] + '-' + monthParts[0]; // Convert to YYYY-MM

            try {
                addBtn.disabled = true;
                addBtn.innerHTML = '<span class="loading"></span>Adding...';

                await apiCall('/patients', {
                    method: 'POST',
                    body: { name: name, month: month, mrn: mrn, facilityId: facilityId }
                });

                document.getElementById('patientName').value = '';
                document.getElementById('mrnNumber').value = '';
                document.getElementById('patientFacility').value = '';
                populateMonthYearDropdowns(); // Reset month to current

                await loadAllData();
                showNotification('✅ Patient added successfully!');
            } catch (error) {
                showNotification(error.message, true);
            } finally {
                addBtn.disabled = false;
                addBtn.innerHTML = 'Add Patient';
            }
        }

        /**
         * Refresh patient list
         */
        function refreshPatientList() {
            const tableBody = document.getElementById('patientTableBody');
            
            if (!tableBody) return;

            if (appData.patients.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #718096; padding: 40px;">No patients found. Add your first patient above or import from Excel.</td></tr>';
                return;
            }

            tableBody.innerHTML = '';

            appData.patients.forEach(function(patient) {
                const row = document.createElement('tr');
                
                // Convert YYYY-MM to MM-YYYY for display
                const monthParts = patient.month.split('-');
                const displayMonth = monthParts[1] + '-' + monthParts[0];
                
                row.innerHTML = 
                    '<td>' + patient.name + '</td>' +
                    '<td>' + (patient.mrn || 'N/A') + '</td>' +
                    '<td>' + displayMonth + '</td>' +
                    '<td>' + (patient.facility_name || 'Unknown') + '</td>' +
                    '<td>' + new Date(patient.updated_at).toLocaleDateString() + '</td>' +
                    '<td>' +
                        '<button class="btn btn-secondary btn-sm" onclick="viewPatientTracking(' + patient.id + ')" style="margin-right: 5px;">👁️ View</button>' +
                        '<button class="btn btn-danger btn-sm" onclick="removePatient(' + patient.id + ')">🗑️ Delete</button>' +
                    '</td>';

                tableBody.appendChild(row);
            });
        }

        /**
         * View patient tracking (switch to tracking tab)
         */
        function viewPatientTracking(patientId) {
            showTab('tracking', document.querySelector('.tab:nth-child(2)'));
            document.getElementById('patientSelect').value = patientId;
            loadPatientTracking();
        }

        /**
         * Remove a patient
         */
        async function removePatient(patientId) {
            if (confirm('Are you sure you want to remove this patient and all tracking data?')) {
                try {
                    await apiCall('/patients/' + patientId, {
                        method: 'DELETE'
                    });

                    await loadAllData();
                    showNotification('✅ Patient removed successfully!');
                } catch (error) {
                    showNotification('Failed to remove patient: ' + error.message, true);
                }
            }
        }

        // ========== EXCEL IMPORT/EXPORT FUNCTIONS ==========

        /**
         * Download Excel template for patient import
         */
        function downloadExcelTemplate() {
            const worksheet = XLSX.utils.aoa_to_sheet([
                ['Name', 'Month', 'MRN', 'Facility'],
                ['Smith, John', '12-2024', 'MRN12345', 'Main Hospital'],
                ['Doe, Jane', '12-2024', 'MRN67890', 'Main Hospital'],
                ['Johnson, Bob', '12-2024', '', 'Main Hospital']
            ]);

            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Patients');
            XLSX.writeFile(workbook, 'patient_import_template.xlsx');
        }

        /**
         * Show Excel import modal
         */
        function showExcelImportModal() {
            document.getElementById('excelImportModal').style.display = 'flex';
        }

        /**
         * Close Excel import modal
         */
        function closeExcelImportModal() {
            document.getElementById('excelImportModal').style.display = 'none';
            document.getElementById('excelFileInput').value = '';
            document.getElementById('importResults').style.display = 'none';
            document.getElementById('processImportBtn').disabled = true;
            excelData = null;
        }

        /**
         * Handle Excel file selection
         */
        function handleExcelFile(file) {
            if (!file) return;

            if (!file.name.match(/\.(xlsx|xls)$/)) {
                showNotification('Please select an Excel file (.xlsx or .xls)', true);
                return;
            }

            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];
                    excelData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                    showExcelPreview(excelData, file.name);
                    document.getElementById('processImportBtn').disabled = false;
                } catch (error) {
                    showNotification('Error reading Excel file: ' + error.message, true);
                }
            };

            reader.readAsArrayBuffer(file);
        }

        /**
         * Show Excel file preview
         */
        function showExcelPreview(data, fileName) {
            const resultsDiv = document.getElementById('importResults');
            
            if (data.length < 2) {
                resultsDiv.innerHTML = '<p style="color: #e53e3e;"><strong>Error:</strong> Excel file must contain at least a header row and one data row.</p>';
                resultsDiv.style.display = 'block';
                return;
            }

            const headers = data[0];
            const dataRows = data.slice(1);

            let html = '<h4>📄 File Preview: ' + fileName + '</h4>';
            html += '<p><strong>Rows to import:</strong> ' + dataRows.length + '</p>';
            html += '<p><strong>Columns found:</strong> ' + headers.join(', ') + '</p>';

            resultsDiv.innerHTML = html;
            resultsDiv.style.display = 'block';
        }

        /**
         * Process Excel import
         */
        async function processExcelImport() {
            const processBtn = document.getElementById('processImportBtn');
            const resultsDiv = document.getElementById('importResults');

            if (!excelData) {
                showNotification('No Excel data to process', true);
                return;
            }

            try {
                processBtn.disabled = true;
                processBtn.innerHTML = '<span class="loading"></span>Processing...';

                const worksheet = XLSX.utils.aoa_to_sheet(excelData);
                const workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, 'Patients');
                const excelBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

                const formData = new FormData();
                const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                formData.append('excelFile', blob, 'patients.xlsx');

                const response = await fetch(API_BASE + '/patients/import-excel', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + authToken
                    },
                    body: formData
                });

                const result = await response.json();

                if (!response.ok) {
                    throw new Error(result.error || 'Import failed');
                }

                let resultsHtml = '<h4 style="color: #38a169;">✅ Import Complete</h4><p>' + result.message + '</p>';
                
                if (result.results && result.results.success && result.results.success.length > 0) {
                    resultsHtml += '<h5 style="color: #38a169; margin-top: 15px;">Successfully Added:</h5><ul>';
                    result.results.success.forEach(function(msg) {
                        resultsHtml += '<li style="color: #38a169;">' + msg + '</li>';
                    });
                    resultsHtml += '</ul>';
                }

                if (result.results && result.results.errors && result.results.errors.length > 0) {
                    resultsHtml += '<h5 style="color: #e53e3e; margin-top: 15px;">Errors:</h5><ul>';
                    result.results.errors.forEach(function(msg) {
                        resultsHtml += '<li style="color: #e53e3e;">' + msg + '</li>';
                    });
                    resultsHtml += '</ul>';
                }

                resultsDiv.innerHTML = resultsHtml;
                resultsDiv.style.display = 'block';

                await loadAllData();

                if (!result.results || !result.results.errors || result.results.errors.length === 0) {
                    setTimeout(function() {
                        closeExcelImportModal();
                    }, 3000);
                }

            } catch (error) {
                resultsDiv.innerHTML = '<h4 style="color: #e53e3e;">❌ Import Failed</h4><p style="color: #e53e3e;">' + error.message + '</p>';
                resultsDiv.style.display = 'block';
            } finally {
                processBtn.disabled = false;
                processBtn.innerHTML = 'Import Data';
            }
        }

        // ========== SUPPLY TRACKING FUNCTIONS ==========

        /**
         * Populate tracking facility selector
         */
        function populateTrackingFacilitySelector() {
            const select = document.getElementById('trackingFacilitySelect');
            if (!select) return;
            
            select.innerHTML = '<option value="">All Facilities</option>';

            appData.facilities.forEach(function(facility) {
                const option = document.createElement('option');
                option.value = facility.id;
                option.textContent = facility.name;
                select.appendChild(option);
            });

            select.addEventListener('change', function() {
                updateTrackingFilters();
            });
        }

        /**
         * Update tracking filters
         */
        function updateTrackingFilters() {
            const facilitySelect = document.getElementById('trackingFacilitySelect');
            const monthSelect = document.getElementById('trackingMonthSelect');
            
            if (!facilitySelect || !monthSelect) return;
            
            const selectedFacilityId = facilitySelect.value;
            const selectedMonth = monthSelect.value;
            
            updateFilteredPatientSelect(selectedFacilityId, selectedMonth);
        }

        /**
         * Get filtered tracking patients
         */
        function getFilteredTrackingPatients(facilityId, monthFilter) {
            let filteredPatients = appData.patients.slice();
            
            if (facilityId) {
                filteredPatients = filteredPatients.filter(function(patient) {
                    return patient.facility_id == facilityId;
                });
            }
            
            if (monthFilter) {
                const monthParts = monthFilter.split('-');
                const storageFormat = monthParts[1] + '-' + monthParts[0];
                filteredPatients = filteredPatients.filter(function(patient) {
                    return patient.month === storageFormat;
                });
            }
            
            filteredPatients.sort(function(a, b) {
                const nameA = (a.name || '').toLowerCase();
                const nameB = (b.name || '').toLowerCase();
                return nameA.localeCompare(nameB);
            });
            
            return filteredPatients;
        }

        /**
         * Update filtered patient select dropdown
         */
        function updateFilteredPatientSelect(facilityId, monthFilter) {
            const select = document.getElementById('patientSelect');
            if (!select) return;
            
            select.innerHTML = '<option value="">Select Patient</option>';
            
            const filteredPatients = getFilteredTrackingPatients(facilityId, monthFilter);
            
            if (filteredPatients.length === 0) {
                select.innerHTML = '<option value="">No patients match selected filters</option>';
                return;
            }

            filteredPatients.forEach(function(patient) {
                const option = document.createElement('option');
                option.value = patient.id;

                const monthParts = patient.month.split('-');
                const displayMonth = monthParts[1] + '-' + monthParts[0];

                option.textContent = patient.name + ' (' + displayMonth + ') - ' + (patient.facility_name || 'Unknown Facility');
                select.appendChild(option);
            });

            const trackingContent = document.getElementById('trackingContent');
            if (trackingContent) {
                trackingContent.innerHTML = '<p style="text-align: center; color: #718096; font-size: 18px; margin-top: 100px;">Please select a patient from the filtered list to begin tracking supplies</p>';
            }
        }

        /**
         * Refresh patient select dropdown
         */
        function refreshPatientSelect() {
            populateTrackingFacilitySelector();
            
            const monthSelect = document.getElementById('trackingMonthSelect');
            if (monthSelect) {
                monthSelect.addEventListener('change', function() {
                    updateTrackingFilters();
                });
            }
            
            updateTrackingFilters();
            
            const patientSelect = document.getElementById('patientSelect');
            if (patientSelect) {
                patientSelect.removeEventListener('change', loadPatientTracking);
                patientSelect.addEventListener('change', loadPatientTracking);
            }
        }

        /**
         * Load patient tracking data
         */
        async function loadPatientTracking() {
            const patientId = document.getElementById('patientSelect').value;
            const container = document.getElementById('trackingContent');

            if (!patientId) {
                container.innerHTML = '<p style="text-align: center; color: #718096; font-size: 18px; margin-top: 100px;">Please select a patient to begin tracking supplies</p>';
                return;
            }

            try {
                const patient = appData.patients.find(function(p) { return p.id == patientId; });
                if (!patient) {
                    throw new Error('Patient not found');
                }

                container.innerHTML = '<p style="text-align: center; color: #667eea; font-size: 18px; margin-top: 100px;">Loading tracking data...</p>';

                const trackingData = await apiCall('/patients/' + patientId + '/tracking');
                
                container.innerHTML = 
                    '<div style="text-align: center; margin-top: 50px; padding: 40px; background: #f0f4ff; border-radius: 15px; border-left: 4px solid #667eea;">' +
                    '<h3 style="color: #667eea; margin-bottom: 20px;">🏗️ Supply Tracking Interface</h3>' +
                    '<p style="color: #4a5568; margin-bottom: 15px;"><strong>Patient:</strong> ' + patient.name + '</p>' +
                    '<p style="color: #4a5568; margin-bottom: 15px;"><strong>Facility:</strong> ' + (patient.facility_name || 'Unknown') + '</p>' +
                    '<p style="color: #4a5568; margin-bottom: 30px;"><strong>Tracking Records:</strong> ' + trackingData.length + ' entries</p>' +
                    '<p style="color: #718096;">Advanced supply tracking interface will be implemented here.</p>' +
                    '<p style="color: #718096; margin-top: 10px;">This will include day-by-day supply usage tracking, wound diagnoses, and cost calculations.</p>' +
                    '</div>';
                
            } catch (error) {
                console.error('Failed to load tracking data:', error);
                
                let errorMessage = 'Failed to load tracking data: ' + error.message;
                
                if (error.message.includes('Access denied') || error.message.includes('Unauthorized')) {
                    errorMessage = '❌ Access Denied: You may not have permission to view this patient\'s data.';
                }
                
                container.innerHTML = '<div style="text-align: center; margin-top: 50px; padding: 20px; background: #fed7d7; border-radius: 10px; border-left: 4px solid #e53e3e;"><p style="color: #c53030; font-size: 16px; margin: 0;">' + errorMessage + '</p></div>';
            }
        }

        // ========== SUMMARY REPORT FUNCTIONS ==========

        /**
         * Populate summary facilities dropdown
         */
        function populateSummaryFacilities() {
            const select = document.getElementById('summaryFacility');
            if (!select) return;
            
            select.innerHTML = '<option value="">All Facilities</option>';

            appData.facilities.forEach(function(facility) {
                const option = document.createElement('option');
                option.value = facility.id;
                option.textContent = facility.name;
                select.appendChild(option);
            });
        }

        /**
         * Apply summary filters
         */
        function applySummaryFilters() {
            const month = document.getElementById('summaryMonth').value;
            const facility = document.getElementById('summaryFacility').value;

            appData.currentFilters.month = month;
            appData.currentFilters.facility = facility;

            updateSummary();
        }

        /**
         * Clear summary filters
         */
        function clearSummaryFilters() {
            document.getElementById('summaryMonth').value = '';
            if (document.getElementById('summaryFacility')) {
                document.getElementById('summaryFacility').value = '';
            }
            
            appData.currentFilters.month = '';
            appData.currentFilters.facility = '';

            updateSummary();
        }

        /**
         * Get filtered patients for summary
         */
        function getFilteredPatients() {
            let filteredPatients = appData.patients.slice();

            if (appData.currentFilters.month) {
                const monthParts = appData.currentFilters.month.split('-');
                const storageFormat = monthParts[1] + '-' + monthParts[0];
                filteredPatients = filteredPatients.filter(function(patient) { 
                    return patient.month === storageFormat; 
                });
            }

            if (appData.currentFilters.facility) {
                filteredPatients = filteredPatients.filter(function(patient) { 
                    return patient.facility_id == appData.currentFilters.facility; 
                });
            }

            return filteredPatients;
        }

        /**
         * Update summary data
         */
        async function updateSummary() {
            try {
                const filteredPatients = getFilteredPatients();

                document.getElementById('totalPatients').textContent = filteredPatients.length;
                document.getElementById('totalUnits').textContent = '0';
                document.getElementById('activeSheets').textContent = filteredPatients.length;
                document.getElementById('totalFacilities').textContent = appData.facilities.length;

                updateSummaryTable(filteredPatients);
            } catch (error) {
                console.error('Failed to update summary:', error);
                showNotification('❌ Failed to update summary: ' + error.message, true);
            }
        }

        /**
         * Update summary table
         */
        async function updateSummaryTable(patients) {
            const tbody = document.getElementById('summaryTableBody');
            tbody.innerHTML = '';

            const patientsToShow = patients || getFilteredPatients();

            if (patientsToShow.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #718096;">No patients to display</td></tr>';
                return;
            }

            patientsToShow.forEach(function(patient) {
                const monthParts = patient.month.split('-');
                const displayMonth = monthParts[1] + '-' + monthParts[0];
                const lastUpdated = new Date(patient.updated_at).toLocaleDateString();

                const row = document.createElement('tr');
                row.innerHTML = 
                    '<td>' + patient.name + '</td>' +
                    '<td>' + displayMonth + '</td>' +
                    '<td>' + (patient.mrn || 'N/A') + '</td>' +
                    '<td>' + (patient.facility_name || 'Unknown') + '</td>' +
                    '<td>' + lastUpdated + '</td>';
                tbody.appendChild(row);
            });
        }

        /**
         * Download user report
         */
        async function downloadUserReport() {
            try {
                showNotification('📄 Generating report...');
                
                const filteredPatients = getFilteredPatients();
                const reportData = [];
                
                let fileName = 'Supply_Report';
                if (appData.currentFilters.month) {
                    const monthParts = appData.currentFilters.month.split('-');
                    const monthName = new Date(monthParts[1], monthParts[0] - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                    fileName = 'Supply_Report_' + monthName.replace(' ', '_');
                }
                
                const header = ['Patient Name', 'MRN', 'Month/Year', 'Facility', 'Last Updated'];
                
                reportData.push(['WOUND CARE SUPPLY REPORT - Generated ' + new Date().toLocaleDateString()]);
                reportData.push(header);
                
                filteredPatients.forEach(function(patient) {
                    const monthParts = patient.month.split('-');
                    const displayMonth = monthParts[1] + '-' + monthParts[0];
                    
                    const row = [
                        patient.name || 'Unknown',
                        patient.mrn || 'N/A',
                        displayMonth,
                        patient.facility_name || 'Unknown',
                        new Date(patient.updated_at).toLocaleDateString()
                    ];
                    
                    reportData.push(row);
                });

                const worksheet = XLSX.utils.aoa_to_sheet(reportData);
                const workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
                
                XLSX.writeFile(workbook, fileName + '.xlsx');
                
                showNotification('✅ Report downloaded successfully!');
                
            } catch (error) {
                console.error('Failed to generate report:', error);
                showNotification('❌ Failed to generate report: ' + error.message, true);
            }
        }

        // ========== ADMIN PANEL FUNCTIONS ==========

        /**
         * Load admin data
         */
        async function loadAdminData() {
            if (!currentUser || currentUser.role !== 'admin') return;

            try {
                const stats = await apiCall('/statistics');
                
                document.getElementById('totalUsersCount').textContent = stats.totalUsers;
                document.getElementById('pendingUsersCount').textContent = stats.pendingUsers;
                document.getElementById('totalPatientsCount').textContent = stats.totalPatients;
                document.getElementById('totalFacilitiesCount').textContent = stats.totalFacilities;
                document.getElementById('totalSuppliesCount').textContent = stats.totalSupplies;
                
                loadFacilitiesList();
            } catch (error) {
                console.error('Failed to load admin data:', error);
            }
        }

        /**
         * Load facilities list for admin
         */
        async function loadFacilitiesList() {
            try {
                const facilitiesList = document.getElementById('facilitiesList');
                if (!facilitiesList) return;
                
                if (appData.facilities.length === 0) {
                    facilitiesList.innerHTML = '<p style="color: #718096;">No facilities added yet.</p>';
                    return;
                }
                
                let html = '';
                appData.facilities.forEach(function(facility) {
                    html += '<div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #e2e8f0;">';
                    html += '<span>' + facility.name + '</span>';
                    html += '<button class="btn btn-danger btn-sm" onclick="deleteFacility(' + facility.id + ')">Delete</button>';
                    html += '</div>';
                });
                
                facilitiesList.innerHTML = html;
            } catch (error) {
                console.error('Failed to load facilities list:', error);
            }
        }

        /**
         * Add facility
         */
        async function addFacility() {
            const name = document.getElementById('newFacilityName').value.trim();
            
            if (!name) {
                showNotification('Please enter a facility name', true);
                return;
            }
            
            try {
                await apiCall('/facilities', {
                    method: 'POST',
                    body: { name: name }
                });
                
                document.getElementById('newFacilityName').value = '';
                await loadAllData();
                loadAdminData();
                showNotification('✅ Facility added successfully!');
            } catch (error) {
                showNotification('Failed to add facility: ' + error.message, true);
            }
        }

        /**
         * Delete facility
         */
        async function deleteFacility(facilityId) {
            if (!confirm('Are you sure you want to delete this facility? This action cannot be undone.')) {
                return;
            }
            
            try {
                await apiCall('/facilities/' + facilityId, {
                    method: 'DELETE'
                });
                
                await loadAllData();
                loadAdminData();
                showNotification('✅ Facility deleted successfully!');
            } catch (error) {
                showNotification('Failed to delete facility: ' + error.message, true);
            }
        }

        /**
         * Load user management (placeholder)
         */
        function loadUserManagement() {
            showNotification('👥 User management interface coming soon!');
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
                    
                    await initApp();
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

// Excel import
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

                // Convert MM-YYYY to YYYY-MM
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

// ==================== STATISTICS ROUTE ====================

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

// ==================== DATABASE INITIALIZATION ====================

async function initializeDatabase() {
    try {
        console.log('🔄 Starting database initialization...');
        
        await pool.query('SELECT NOW()');
        console.log('✅ Database connection successful');
        
        const tablesExist = await pool.query(`
            SELECT COUNT(*) FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name IN ('users', 'facilities', 'supplies', 'patients', 'tracking')
        `);
        
        if (parseInt(tablesExist.rows[0].count) < 5) {
            console.log('🔧 Creating database tables...');
            
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

            console.log('✅ Database initialized successfully');
        } else {
            console.log('✅ Database tables already exist');
        }

        console.log('🔑 Default Login: admin@system.com / admin123');

    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        // Don't throw - let the app start anyway
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
    try {
        console.log('🚀 Starting Wound Care RT Supply Tracker...');
        
        await initializeDatabase();
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`🔗 App URL: https://terence-wound-care-tracker-0ee111d0e54a.herokuapp.com`);
            console.log('🎉 Wound Care RT Supply Tracker is ready!');
            console.log('👑 Admin Login: admin@system.com / admin123');
            console.log('👤 User Login: user@demo.com / user123');
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
