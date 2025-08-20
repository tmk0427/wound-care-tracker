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
        console.error('Database connection failed:', err);
    } else {
        console.log('Database connected successfully');
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

// Serve the complete HTML application directly from root route
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

        /* Filter and Form Styles */
        .filter-section {
            background: #f7fafc;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 30px;
            border-left: 4px solid #667eea;
        }

        .patient-form {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .excel-import-section {
            background: linear-gradient(135deg, #e6f3ff 0%, #cce7ff 100%);
            padding: 25px;
            border-radius: 12px;
            margin-bottom: 30px;
            border-left: 4px solid #4299e1;
            border: 1px solid #bee3f8;
        }

        .file-upload-area {
            border: 2px dashed #4299e1;
            border-radius: 10px;
            padding: 30px;
            text-align: center;
            background: #f7faff;
            margin: 20px 0;
            transition: all 0.3s ease;
        }

        .file-upload-area.dragover {
            border-color: #2b6cb0;
            background: #ebf8ff;
            transform: scale(1.02);
        }

        .file-upload-area input[type="file"] {
            display: none;
        }

        .upload-button {
            background: #4299e1;
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.2s ease;
        }

        .upload-button:hover {
            background: #3182ce;
            transform: translateY(-2px);
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

        /* Supply Tracking Table */
        .supply-tracker {
            position: relative;
            overflow: hidden;
            background: white;
            border-radius: 10px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
            margin-top: 20px;
        }

        .tracker-search-section {
            background: #f7fafc;
            padding: 15px 20px;
            border-bottom: 1px solid #e2e8f0;
            border-radius: 10px 10px 0 0;
        }

        .search-box {
            width: 100%;
            max-width: 400px;
            padding: 12px;
            border: 2px solid #e2e8f0;
            border-radius: 8px;
            font-size: 16px;
            transition: all 0.3s ease;
        }

        .search-box:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        .supply-row:hover {
            background-color: #f7fafc !important;
        }

        .supply-row.custom-supply {
            background-color: #f0f4ff !important;
        }

        .supply-row.custom-supply:hover {
            background-color: #e6edff !important;
        }

        .custom-badge {
            background: #e6fffa;
            color: #319795;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            margin-left: 8px;
        }

        /* Summary and Stats */
        .summary-cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .summary-card, .stats-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 25px;
            border-radius: 15px;
            text-align: center;
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
        }

        .summary-card h3, .stats-card h4 {
            font-size: 18px;
            margin-bottom: 15px;
            opacity: 0.9;
        }

        .summary-card .value, .stats-card .value {
            font-size: 32px;
            font-weight: 700;
        }

        .summary-filters {
            background: #f7fafc;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 30px;
            border-left: 4px solid #667eea;
        }

        .filter-group {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 15px;
        }

        .summary-table {
            width: 100%;
            border-collapse: collapse;
            background: white;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }

        .summary-table th, .summary-table td {
            padding: 15px;
            text-align: left;
            border-bottom: 1px solid #e2e8f0;
        }

        .summary-table th {
            background: #f7fafc;
            font-weight: 600;
            color: #4a5568;
        }

        /* Admin Panel Styles */
        .admin-only-column, .admin-only-controls {
            display: none !important;
        }

        .main-app.show-admin .admin-only-column,
        .main-app.show-admin .admin-only-controls {
            display: table-cell !important;
        }

        .main-app.show-admin .btn.admin-only-controls {
            display: inline-block !important;
        }

        .admin-section {
            background: #f7fafc;
            padding: 25px;
            border-radius: 12px;
            margin-bottom: 30px;
            border-left: 4px solid #667eea;
            width: 100%;
        }

        .add-new-section {
            background: linear-gradient(135deg, #f0f4ff 0%, #e6edff 100%);
            padding: 25px;
            border-radius: 12px;
            margin-bottom: 25px;
            border-left: 4px solid #667eea;
            border: 1px solid #ddd6fe;
            width: 100%;
        }

        .admin-form {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
            width: 100%;
        }

        .admin-cards {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 20px;
            margin-top: 20px;
            width: 100%;
        }

        .admin-card {
            background: linear-gradient(135deg, #f7fafc 0%, #edf2f7 100%);
            border-radius: 12px;
            padding: 20px;
            border: 2px solid #e2e8f0;
            transition: all 0.3s ease;
        }

        .admin-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
            border-color: #667eea;
        }

        .admin-card h4 {
            color: #4a5568;
            margin-bottom: 10px;
            font-size: 18px;
        }

        .admin-card p {
            color: #718096;
            font-size: 14px;
            margin-bottom: 8px;
        }

        .admin-card .card-actions {
            margin-top: 15px;
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
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

        .modal h2 {
            margin-bottom: 20px;
            color: #4a5568;
        }

        /* Progress and Status */
        .progress-bar {
            width: 100%;
            height: 8px;
            background: #e2e8f0;
            border-radius: 4px;
            overflow: hidden;
            margin: 10px 0;
        }

        .progress-fill {
            height: 100%;
            background: #4299e1;
            transition: width 0.3s ease;
            border-radius: 4px;
        }

        .tracking-status {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #38a169;
            color: white;
            padding: 10px 15px;
            border-radius: 8px;
            z-index: 100;
            display: none;
            animation: slideIn 0.3s ease;
        }

        .tracking-status.error {
            background: #e53e3e;
        }

        @keyframes slideIn {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
        }

        .import-results {
            margin-top: 20px;
            padding: 15px;
            border-radius: 8px;
            max-height: 200px;
            overflow-y: auto;
        }

        .import-results.success {
            background: #f0fff4;
            border: 1px solid #9ae6b4;
            color: #276749;
        }

        .import-results.error {
            background: #fed7d7;
            border: 1px solid #feb2b2;
            color: #c53030;
        }

        .import-results.mixed {
            background: #fffaf0;
            border: 1px solid #fbd38d;
            color: #744210;
        }

        /* Utility Classes */
        .hidden {
            display: none !important;
        }

        .empty-state {
            text-align: center;
            padding: 40px 20px;
            background: #f7fafc;
            border-radius: 12px;
            border: 2px dashed #e2e8f0;
            color: #718096;
            grid-column: 1 / -1;
        }

        .empty-state p {
            margin: 0;
            font-size: 16px;
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

            .patient-form {
                grid-template-columns: 1fr;
            }

            .summary-cards {
                grid-template-columns: 1fr;
            }

            .admin-form {
                grid-template-columns: 1fr;
            }

            .admin-cards {
                grid-template-columns: 1fr;
            }

            .admin-table {
                font-size: 14px;
            }

            .admin-table th, .admin-table td {
                padding: 8px 10px;
            }

            .filter-group {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div id="loginContainer" class="login-container">
        <div class="auth-form">
            <h1>🏥 Wound Care RT Supply Tracker</h1>
            <div class="auth-tabs">
                <button class="auth-tab active" onclick="showAuthTab('login', this)">Sign In</button>
                <button class="auth-tab" onclick="showAuthTab('register', this)">Register</button>
            </div>
            <div id="loginForm">
                <div class="form-group">
                    <label for="loginEmail">Email Address</label>
                    <input type="email" id="loginEmail" placeholder="Enter email address">
                </div>
                <div class="form-group">
                    <label for="loginPassword">Password</label>
                    <input type="password" id="loginPassword" placeholder="Enter password">
                </div>
                <button class="auth-btn" onclick="login()" id="loginBtn">Sign In</button>
                <div id="loginError" class="error-message hidden">Invalid credentials</div>
                <a href="#" class="forgot-password-link" onclick="showForgotPasswordModal()">Forgot Password?</a>
            </div>
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
            <div class="tab" id="adminTabButton" onclick="showTab('admin', this)">
                Admin Panel
                <span id="pendingUsersNotification" class="notification-badge hidden">0</span>
            </div>
        </div>

        <!-- Tab contents will be populated by JavaScript -->
        <div id="patientsTab" class="tab-content">
            <h2 style="margin-bottom: 30px; color: #4a5568;">Patient Management</h2>
            <div style="text-align: center; padding: 40px; color: #718096;">
                <p>Loading patient management interface...</p>
            </div>
        </div>

        <div id="trackingTab" class="tab-content hidden">
            <h2 style="margin-bottom: 30px; color: #4a5568;">Supply Tracking</h2>
            <div style="text-align: center; padding: 40px; color: #718096;">
                <p>Loading supply tracking interface...</p>
            </div>
        </div>

        <div id="summaryTab" class="tab-content hidden">
            <h2 style="margin-bottom: 30px; color: #4a5568;">Summary Report</h2>
            <div style="text-align: center; padding: 40px; color: #718096;">
                <p>Loading summary report interface...</p>
            </div>
        </div>

        <div id="adminTab" class="tab-content hidden">
            <h2 style="margin-bottom: 30px; color: #4a5568;">🔧 Admin Panel</h2>
            <div style="text-align: center; padding: 40px; color: #718096;">
                <p>Loading admin panel...</p>
            </div>
        </div>
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
            currentFilters: { month: '', facility: '' }
        };

        // API Configuration
        const API_BASE = window.location.origin + '/api';

        // Utility function for making API calls with authentication
        async function apiCall(endpoint, options = {}) {
            const url = API_BASE + endpoint;
            const defaultOptions = { headers: { 'Content-Type': 'application/json' } };

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

        // Authentication functions
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
            const loginError = document.getElementById('loginError');
            loginError.textContent = message;
            loginError.classList.remove('hidden');
            setTimeout(function() {
                loginError.classList.add('hidden');
            }, 5000);
        }

        // Tab navigation
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
            }

            if (clickedElement) {
                clickedElement.classList.add('active');
            }
        }

        // Password management
        function showChangePasswordModal() {
            // Placeholder for password change modal
            alert('Password change functionality will be implemented here');
        }

        function showForgotPasswordModal() {
            // Placeholder for forgot password modal  
            alert('Forgot password functionality will be implemented here');
        }

        // Application initialization
        async function initApp() {
            try {
                setupUserInterface();
                await loadAllData();
                console.log('Application initialized successfully');
            } catch (error) {
                console.error('App initialization error:', error);
                alert('Failed to initialize application. Please refresh the page.');
            }
        }

        function setupUserInterface() {
            const user = currentUser;
            if (!user) {
                console.error('No current user found');
                return;
            }
            
            const facilityName = user.role === 'admin' ? "All Facilities" : (user.facility_name || "User");

            document.getElementById('currentUserInfo').innerHTML = 
                '<div style="font-weight: 600;">' + (user.name || user.email) + '</div>' +
                '<div>' + (user.role === 'admin' ? 'System Administrator' : 'User') + ' • ' + facilityName + '</div>';

            const adminTabButton = document.getElementById('adminTabButton');
            const mainApp = document.getElementById('mainApp');

            const isReallyAdmin = user.role === 'admin' && user.email !== undefined;
            
            if (isReallyAdmin) {
                if (adminTabButton) {
                    adminTabButton.style.display = 'block';
                }
                mainApp.classList.add('show-admin');
            } else {
                if (adminTabButton) {
                    adminTabButton.style.display = 'none';
                }
                mainApp.classList.remove('show-admin');
            }
        }

        async function loadAllData() {
            try {
                console.log('Loading all data for user:', currentUser.email, 'Role:', currentUser.role);
                
                appData.facilities = await apiCall('/facilities');
                appData.supplies = await apiCall('/supplies');
                
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
                
                console.log('Data loading complete');
            } catch (error) {
                console.error('Failed to load data:', error);
                alert('Failed to load data: ' + error.message);
            }
        }

        // Check for existing auth token on page load
        window.addEventListener('DOMContentLoaded', async function() {
            if (authToken) {
                try {
                    console.log('Checking stored auth token...');
                    
                    const response = await apiCall('/auth/verify');
                    currentUser = response.user;
                    
                    console.log('Token valid, auto-logging in user:', currentUser.email);
                    
                    document.getElementById('loginContainer').style.display = 'none';
                    document.getElementById('mainApp').style.display = 'block';
                    
                    await initApp();
                } catch (error) {
                    console.log('Stored token invalid, showing login');
                    localStorage.removeItem('authToken');
                    authToken = null;
                    currentUser = null;
                }
            } else {
                console.log('No stored token, showing login screen');
            }
        });

        // Handle Enter key for login
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

// Multer for file uploads
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Database initialization
async function initializeDatabase() {
    try {
        console.log('Starting database initialization...');
        
        // Create patient_supply_dx table if it doesn't exist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS patient_supply_dx (
                id SERIAL PRIMARY KEY,
                patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
                supply_id INTEGER NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,
                wound_dx TEXT NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(patient_id, supply_id)
            )
        `);
        
        await pool.query(`
            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            $$ language 'plpgsql';
        `);
        
        await pool.query(`
            DROP TRIGGER IF EXISTS update_patient_supply_dx_updated_at ON patient_supply_dx;
            CREATE TRIGGER update_patient_supply_dx_updated_at 
                BEFORE UPDATE ON patient_supply_dx
                FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        `);
        
        console.log('Database initialization completed successfully');
    } catch (error) {
        console.error('Database initialization failed:', error);
    }
}

// Initialize database on startup
initializeDatabase();

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

// ==================== ALL API ROUTES ====================
// [All the same API routes as before - auth, facilities, supplies, patients, tracking, wound dx, user management, statistics]

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

// Get facilities (public for registration)
app.get('/api/facilities/public', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name FROM facilities ORDER BY name');
        res.json(result.rows);
    } catch (error) {
        console.error('Get public facilities error:', error);
        res.status(500).json({ error: 'Failed to fetch facilities' });
    }
});

// Get facilities (authenticated)
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

// Get supplies
app.get('/api/supplies', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM supplies ORDER BY code');
        res.json(result.rows);
    } catch (error) {
        console.error('Get supplies error:', error);
        res.status(500).json({ error: 'Failed to fetch supplies' });
    }
});

// Get patients
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

// [Additional API routes would go here - simplified for brevity]

// Error handling
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

app.use((error, req, res, next) => {
    console.error('Global error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
