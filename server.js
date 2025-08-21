<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wound Care RT Supply Tracker - Professional Edition</title>
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
            max-width: 1600px;
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

        /* Dashboard Cards */
        .dashboard-cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .dashboard-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 25px;
            border-radius: 15px;
            text-align: center;
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
            position: relative;
            overflow: hidden;
        }

        .dashboard-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(255,255,255,0.1);
            transform: skewY(-5deg);
            transform-origin: top left;
        }

        .dashboard-card-content {
            position: relative;
            z-index: 1;
        }

        .dashboard-card h3 {
            font-size: 16px;
            margin-bottom: 15px;
            opacity: 0.9;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .dashboard-card .value {
            font-size: 36px;
            font-weight: 700;
            margin-bottom: 10px;
        }

        .dashboard-card .subtitle {
            font-size: 14px;
            opacity: 0.8;
        }

        /* Enhanced Table Styles */
        .table-container {
            overflow-x: auto;
            margin-top: 20px;
            width: 100%;
            border-radius: 10px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }

        .data-table {
            width: 100%;
            border-collapse: collapse;
            background: white;
            border-radius: 10px;
            overflow: hidden;
        }

        .data-table th, .data-table td {
            padding: 15px;
            text-align: left;
            border-bottom: 1px solid #e2e8f0;
        }

        .data-table th {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            font-weight: 600;
            font-size: 14px;
            position: sticky;
            top: 0;
            z-index: 10;
        }

        .data-table tbody tr:hover {
            background-color: #f7fafc;
        }

        .data-table tbody tr:nth-child(even) {
            background-color: #f8f9fa;
        }

        /* Enhanced Tracking Grid */
        .tracking-container {
            background: white;
            border-radius: 15px;
            overflow: hidden;
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
            margin-top: 20px;
        }

        .tracking-grid {
            position: relative;
            overflow: auto;
            max-height: 70vh;
            border: 1px solid #e2e8f0;
        }

        .tracking-table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            font-size: 12px;
        }

        .tracking-table th,
        .tracking-table td {
            border: 1px solid #e2e8f0;
            padding: 8px;
            text-align: center;
            min-width: 50px;
            position: relative;
        }

        /* Freeze first 7 columns */
        .tracking-table th:nth-child(-n+7),
        .tracking-table td:nth-child(-n+7) {
            position: sticky;
            left: 0;
            background: white;
            z-index: 5;
            box-shadow: 2px 0 5px rgba(0,0,0,0.1);
        }

        .tracking-table th {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 10;
        }

        .tracking-table th:nth-child(-n+7) {
            z-index: 15;
        }

        .tracking-table .supply-info {
            text-align: left;
            min-width: 200px;
            max-width: 250px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .tracking-table .ar-code {
            font-weight: bold;
            color: #667eea;
        }

        .tracking-table .item-desc {
            font-size: 11px;
            color: #718096;
            margin-top: 2px;
        }

        .tracking-input {
            width: 100%;
            padding: 4px;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            text-align: center;
            font-size: 12px;
            background: white;
        }

        .tracking-input:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.1);
        }

        .wound-dx-input {
            width: 100%;
            padding: 4px;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            font-size: 11px;
            resize: vertical;
            min-height: 30px;
        }

        .wound-dx-input:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.1);
        }

        .total-cell {
            background: #f7fafc !important;
            font-weight: bold;
            color: #4a5568;
        }

        .cost-cell {
            background: #e6fffa !important;
            font-weight: bold;
            color: #2d3748;
        }

        /* Supply Management Styles */
        .supply-form {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
            padding: 25px;
            background: #f7fafc;
            border-radius: 12px;
            border-left: 4px solid #667eea;
        }

        .supply-actions {
            display: flex;
            gap: 10px;
            margin-top: 20px;
            flex-wrap: wrap;
        }

        /* Filter Section */
        .filter-section {
            background: #f7fafc;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 30px;
            border-left: 4px solid #667eea;
        }

        .filter-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 15px;
        }

        .filter-actions {
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
            align-items: center;
        }

        /* Import Section */
        .import-section {
            background: linear-gradient(135deg, #e6f3ff 0%, #cce7ff 100%);
            padding: 25px;
            border-radius: 12px;
            margin-bottom: 30px;
            border-left: 4px solid #4299e1;
            border: 1px solid #bee3f8;
        }

        .import-section h3 {
            color: #2b6cb0;
            margin-bottom: 15px;
        }

        .import-section p {
            color: #4299e1;
            margin-bottom: 20px;
        }

        .import-actions {
            display: flex;
            gap: 15px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }

        .import-info {
            background: #ebf8ff;
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid #4299e1;
        }

        .import-info h4 {
            color: #2b6cb0;
            margin-bottom: 10px;
        }

        .import-info ul {
            color: #2b6cb0;
            margin-left: 20px;
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
            max-width: 800px;
            width: 90%;
            max-height: 90%;
            overflow-y: auto;
        }

        .modal-content h2 {
            margin-bottom: 20px;
            color: #4a5568;
        }

        /* File Drop Zone */
        .file-drop-zone {
            border: 2px dashed #4299e1;
            border-radius: 10px;
            padding: 40px;
            text-align: center;
            background: #f7faff;
            margin: 20px 0;
            transition: all 0.3s ease;
        }

        .file-drop-zone:hover {
            border-color: #667eea;
            background: #edf2f7;
        }

        .file-drop-zone.dragover {
            border-color: #667eea;
            background: #e6f3ff;
        }

        .file-icon {
            font-size: 48px;
            margin-bottom: 20px;
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
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
        }

        .notification.error {
            background: #e53e3e;
        }

        .notification.warning {
            background: #ed8936;
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

            .supply-form {
                grid-template-columns: 1fr;
            }

            .dashboard-cards {
                grid-template-columns: 1fr;
            }

            .tabs {
                overflow-x: auto;
            }

            .tracking-table {
                font-size: 10px;
            }

            .tracking-table th,
            .tracking-table td {
                padding: 6px;
                min-width: 40px;
            }

            .tracking-table .supply-info {
                min-width: 150px;
                max-width: 180px;
            }
        }

        /* Additional utility classes */
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .mb-20 { margin-bottom: 20px; }
        .mt-20 { margin-top: 20px; }
        .p-20 { padding: 20px; }
        
        .bg-success { background-color: #38a169; }
        .bg-warning { background-color: #ed8936; }
        .bg-danger { background-color: #e53e3e; }
        .bg-info { background-color: #4299e1; }
        
        .text-success { color: #38a169; }
        .text-warning { color: #ed8936; }
        .text-danger { color: #e53e3e; }
        .text-info { color: #4299e1; }

        .font-bold { font-weight: bold; }
        .font-sm { font-size: 12px; }
        .font-lg { font-size: 18px; }
    </style>
</head>
<body>
    <!-- Status Banner -->
    <div class="status-banner">
        Wound Care RT Supply Tracker - Professional Edition v2.0
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
            <div class="tab active" onclick="showTab('dashboard', this)">Dashboard</div>
            <div class="tab" onclick="showTab('patients', this)">Patient Management</div>
            <div class="tab" onclick="showTab('tracking', this)">Supply Tracking</div>
            <div class="tab" onclick="showTab('summary', this)">Summary Report</div>
            <div class="tab" id="suppliesTabButton" onclick="showTab('supplies', this)">Supply Management</div>
            <div class="tab" id="adminTabButton" onclick="showTab('admin', this)">Admin Panel</div>
        </div>

        <!-- Dashboard Tab -->
        <div id="dashboardTab" class="tab-content">
            <h2 style="margin-bottom: 30px; color: #4a5568;">Dashboard</h2>

            <!-- Filter Section for Dashboard -->
            <div class="filter-section">
                <h3 style="margin-bottom: 15px; color: #4a5568;">Dashboard Filters</h3>
                
                <div class="filter-grid">
                    <div class="form-group">
                        <label for="dashboardMonth">Select Month/Year</label>
                        <select id="dashboardMonth">
                            <option value="">All Months</option>
                        </select>
                    </div>
                    
                    <div class="form-group" id="dashboardFacilityGroup">
                        <label for="dashboardFacility">Select Facility</label>
                        <select id="dashboardFacility">
                            <option value="">All Facilities</option>
                        </select>
                    </div>
                </div>

                <div class="filter-actions">
                    <button class="btn btn-primary" onclick="applyDashboardFilters()">Apply Filters</button>
                    <button class="btn btn-secondary" onclick="clearDashboardFilters()">Clear Filters</button>
                    <button class="btn btn-success" onclick="exportDashboardData()">Export Dashboard Data</button>
                </div>
            </div>

            <!-- Dashboard Cards -->
            <div class="dashboard-cards">
                <div class="dashboard-card">
                    <div class="dashboard-card-content">
                        <h3>Total Patients</h3>
                        <div class="value" id="dashboardTotalPatients">0</div>
                        <div class="subtitle">Active tracking records</div>
                    </div>
                </div>
                <div class="dashboard-card">
                    <div class="dashboard-card-content">
                        <h3>Total Units</h3>
                        <div class="value" id="dashboardTotalUnits">0</div>
                        <div class="subtitle">Supply units used</div>
                    </div>
                </div>
                <div class="dashboard-card">
                    <div class="dashboard-card-content">
                        <h3>Total Facilities</h3>
                        <div class="value" id="dashboardTotalFacilities">0</div>
                        <div class="subtitle">Healthcare locations</div>
                    </div>
                </div>
                <div class="dashboard-card" id="dashboardCostCard">
                    <div class="dashboard-card-content">
                        <h3>Total Costs</h3>
                        <div class="value" id="dashboardTotalCosts">$0</div>
                        <div class="subtitle">Supply expenditure</div>
                    </div>
                </div>
            </div>

            <!-- Patient Data Table -->
            <div class="table-container">
                <table class="data-table" id="dashboardPatientsTable">
                    <thead>
                        <tr id="dashboardTableHeader">
                            <th>Patient Name</th>
                            <th>MRN</th>
                            <th>Wound Diagnosis</th>
                            <th>Month/Year</th>
                            <th>Facility</th>
                            <th>Total Units</th>
                            <th>Last Updated</th>
                        </tr>
                    </thead>
                    <tbody id="dashboardPatientsTableBody">
                        <!-- Dashboard patient data will be populated here -->
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Patient Management Tab -->
        <div id="patientsTab" class="tab-content hidden">
            <h2 style="margin-bottom: 30px; color: #4a5568;">Patient Management</h2>

            <!-- Excel Import Section -->
            <div class="import-section">
                <h3>Bulk Import Patients from Excel</h3>
                <p>Import multiple patients at once using an Excel file (.xlsx or .xls)</p>
                
                <div class="import-actions">
                    <button class="btn btn-secondary" onclick="downloadExcelTemplate()">Download Template</button>
                    <button class="btn btn-primary" onclick="showExcelImportModal()">Import Excel File</button>
                </div>

                <div class="import-info">
                    <h4>Required Excel Columns:</h4>
                    <ul>
                        <li><strong>Name</strong> - Patient full name (e.g., "Smith, John")</li>
                        <li><strong>Month</strong> - Format: MM-YYYY (e.g., "01-2025")</li>
                        <li><strong>Facility</strong> - Exact facility name from your system</li>
                        <li><strong>MRN</strong> - Medical Record Number (optional)</li>
                    </ul>
                </div>
            </div>

            <div class="supply-form" id="patientFormSection">
                <div class="form-group">
                    <label>Patient Name</label>
                    <input type="text" id="patientName" placeholder="Last, First">
                </div>
                <div class="form-group">
                    <label>Select Month/Year</label>
                    <select id="patientMonth">
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
                <table class="data-table" id="patientTable">
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
                <h3 style="margin-bottom: 15px; color: #4a5568;">Select Patient</h3>
                <div class="filter-grid">
                    <div class="form-group">
                        <label for="trackingFacilitySelect">Filter by Facility</label>
                        <select id="trackingFacilitySelect">
                            <option value="">All Facilities</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="trackingMonthSelect">Filter by Month</label>
                        <select id="trackingMonthSelect">
                            <option value="">All Months</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="patientSelect">Select Patient</label>
                        <select id="patientSelect">
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
                
                <div class="filter-grid">
                    <div class="form-group">
                        <label for="summaryMonth">Select Month/Year</label>
                        <select id="summaryMonth">
                            <option value="">All Months</option>
                        </select>
                    </div>
                    
                    <div class="form-group" id="summaryFacilityGroup">
                        <label for="summaryFacility">Select Facility</label>
                        <select id="summaryFacility">
                            <option value="">All Facilities</option>
                        </select>
                    </div>
                </div>

                <div class="filter-actions">
                    <button class="btn btn-primary" onclick="applySummaryFilters()">Apply Filters</button>
                    <button class="btn btn-success" onclick="downloadSummaryReport()">Download Report</button>
                    <button class="btn btn-secondary" onclick="clearSummaryFilters()">Clear Filters</button>
                </div>
            </div>

            <div class="table-container">
                <table class="data-table" id="summaryTable">
                    <thead>
                        <tr id="summaryTableHeader">
                            <th>Patient Name</th>
                            <th>MRN</th>
                            <th>Wound Diagnosis</th>
                            <th>Month/Year</th>
                            <th>Facility</th>
                            <th>Total Units</th>
                            <th>Last Updated</th>
                        </tr>
                    </thead>
                    <tbody id="summaryTableBody">
                        <!-- Summary data will be populated here -->
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Supply Management Tab (Admin Only) -->
        <div id="suppliesTab" class="tab-content hidden">
            <h2 style="margin-bottom: 30px; color: #4a5568;">Supply Management</h2>

            <!-- Import Section -->
            <div class="import-section">
                <h3>Bulk Import Supplies from Excel</h3>
                <p>Import multiple supply items at once using an Excel file (.xlsx or .xls)</p>
                
                <div class="import-actions">
                    <button class="btn btn-secondary" onclick="downloadSupplyTemplate()">Download Template</button>
                    <button class="btn btn-primary" onclick="showSupplyImportModal()">Import Excel File</button>
                </div>

                <div class="import-info">
                    <h4>Required Excel Columns:</h4>
                    <ul>
                        <li><strong>AR Code</strong> - Unique supply code (e.g., "WC001")</li>
                        <li><strong>Item Description</strong> - Full description of the supply</li>
                        <li><strong>HCPCS Code</strong> - Healthcare billing code (optional)</li>
                        <li><strong>Unit Cost</strong> - Cost per unit in dollars (e.g., 5.50)</li>
                    </ul>
                </div>
            </div>

            <!-- Add New Supply Form -->
            <div class="supply-form">
                <div class="form-group">
                    <label for="supplyArCode">AR Code</label>
                    <input type="text" id="supplyArCode" placeholder="e.g., WC001">
                </div>
                <div class="form-group">
                    <label for="supplyDescription">Item Description</label>
                    <input type="text" id="supplyDescription" placeholder="e.g., Foam Dressing 4x4">
                </div>
                <div class="form-group">
                    <label for="supplyHcpcs">HCPCS Code</label>
                    <input type="text" id="supplyHcpcs" placeholder="e.g., A6209">
                </div>
                <div class="form-group">
                    <label for="supplyUnitCost">Unit Cost ($)</label>
                    <input type="number" id="supplyUnitCost" placeholder="0.00" step="0.01" min="0">
                </div>
                <div class="form-group">
                    <label></label>
                    <div class="supply-actions">
                        <button class="btn btn-primary" onclick="addSupply()" id="addSupplyBtn">Add Supply</button>
                        <button class="btn btn-secondary" onclick="clearSupplyForm()" id="clearSupplyBtn">Clear Form</button>
                    </div>
                </div>
            </div>

            <div class="table-container">
                <table class="data-table" id="suppliesTable">
                    <thead>
                        <tr>
                            <th>AR Code</th>
                            <th>Item Description</th>
                            <th>HCPCS Code</th>
                            <th>Unit Cost</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="suppliesTableBody">
                        <!-- Supplies will be populated here -->
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
                <select id="editPatientMonth">
                    <option value="">Select Month/Year</option>
                </select>
            </div>
            <div class="form-group">
                <label>Select Facility</label>
                <select id="editPatientFacility">
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

    <!-- Edit Supply Modal -->
    <div id="editSupplyModal" class="modal">
        <div class="modal-content">
            <h2>Edit Supply</h2>
            <div class="form-group">
                <label>AR Code</label>
                <input type="text" id="editSupplyArCode" placeholder="e.g., WC001">
            </div>
            <div class="form-group">
                <label>Item Description</label>
                <input type="text" id="editSupplyDescription" placeholder="e.g., Foam Dressing 4x4">
            </div>
            <div class="form-group">
                <label>HCPCS Code</label>
                <input type="text" id="editSupplyHcpcs" placeholder="e.g., A6209">
            </div>
            <div class="form-group">
                <label>Unit Cost ($)</label>
                <input type="number" id="editSupplyUnitCost" placeholder="0.00" step="0.01" min="0">
            </div>
            <div id="editSupplyMessage" style="margin: 10px 0;"></div>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button class="btn btn-secondary" onclick="closeEditSupplyModal()">Cancel</button>
                <button class="btn btn-primary" onclick="saveSupplyEdit()" id="saveSupplyBtn">Save Changes</button>
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
            
            <div class="file-drop-zone" onclick="document.getElementById('excelFileInput').click()">
                <div class="file-icon">📁</div>
                <h3 style="color: #4299e1; margin-bottom: 10px;">Drag & Drop Excel File Here</h3>
                <p style="color: #718096; margin-bottom: 20px;">or click to browse for file</p>
                <input type="file" id="excelFileInput" accept=".xlsx,.xls" style="display: none;" onchange="handleExcelFile(this.files[0])">
                <button class="btn btn-primary">Choose Excel File</button>
            </div>

            <div id="importResults" style="display: none; margin-top: 20px; padding: 15px; border-radius: 8px; max-height: 200px; overflow-y: auto;"></div>

            <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
                <button class="btn btn-secondary" onclick="closeExcelImportModal()">Close</button>
                <button class="btn btn-primary" onclick="processExcelImport()" id="processImportBtn" disabled>Import Data</button>
            </div>
        </div>
    </div>

    <!-- Supply Import Modal -->
    <div id="supplyImportModal" class="modal">
        <div class="modal-content">
            <h2>Import Supplies from Excel</h2>
            
            <div class="file-drop-zone" onclick="document.getElementById('supplyFileInput').click()">
                <div class="file-icon">📋</div>
                <h3 style="color: #4299e1; margin-bottom: 10px;">Drag & Drop Excel File Here</h3>
                <p style="color: #718096; margin-bottom: 20px;">or click to browse for file</p>
                <input type="file" id="supplyFileInput" accept=".xlsx,.xls" style="display: none;" onchange="handleSupplyFile(this.files[0])">
                <button class="btn btn-primary">Choose Excel File</button>
            </div>

            <div id="supplyImportResults" style="display: none; margin-top: 20px; padding: 15px; border-radius: 8px; max-height: 200px; overflow-y: auto;"></div>

            <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
                <button class="btn btn-secondary" onclick="closeSupplyImportModal()">Close</button>
                <button class="btn btn-primary" onclick="processSupplyImport()" id="processSupplyImportBtn" disabled>Import Data</button>
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
        var editingPatientId = null;
        var editingSupplyId = null;
        var appData = {
            facilities: [],
            patients: [],
            supplies: [],
            selectedPatient: null,
            trackingData: {},
            currentFilters: {
                month: '',
                facility: ''
            },
            dashboardData: null
        };
        var excelData = null;
        var supplyExcelData = null;
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

        // Populate month/year dropdowns
        function populateMonthYearDropdowns() {
            var currentDate = new Date();
            var currentMonth = currentDate.getMonth();
            var currentYear = currentDate.getFullYear();
            
            var months = [];
            
            // Generate 15 months: current month + 2 future months + 12 past months
            var startDate = new Date(currentYear, currentMonth - 12);
            var endDate = new Date(currentYear, currentMonth + 3);
            
            var iterDate = new Date(startDate);
            while (iterDate < endDate) {
                var year = iterDate.getFullYear();
                var month = iterDate.getMonth();
                
                var monthStr = padStart(String(month + 1), 2, '0');
                var value = monthStr + '-' + year;
                var label = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                
                months.push({ value: value, label: label });
                
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
            
            var selectIds = ['patientMonth', 'trackingMonthSelect', 'summaryMonth', 'editPatientMonth', 'dashboardMonth'];
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
            var suppliesTabButton = document.getElementById('suppliesTabButton');
            var summaryFacilityGroup = document.getElementById('summaryFacilityGroup');
            var dashboardFacilityGroup = document.getElementById('dashboardFacilityGroup');
            var dashboardCostCard = document.getElementById('dashboardCostCard');

            if (user.role === 'admin') {
                adminTabButton.style.display = 'block';
                suppliesTabButton.style.display = 'block';
                summaryFacilityGroup.style.display = 'block';
                dashboardFacilityGroup.style.display = 'block';
                dashboardCostCard.style.display = 'block';
                
                // Update summary table header for admin
                document.getElementById('summaryTableHeader').innerHTML = 
                    '<th>Patient Name</th>' +
                    '<th>MRN</th>' +
                    '<th>Wound Diagnosis</th>' +
                    '<th>AR Codes</th>' +
                    '<th>HCPCS Codes</th>' +
                    '<th>Month/Year</th>' +
                    '<th>Facility</th>' +
                    '<th>Total Units</th>' +
                    '<th>Total Costs</th>' +
                    '<th>Last Updated</th>';
                
                // Update dashboard table header for admin
                document.getElementById('dashboardTableHeader').innerHTML = 
                    '<th>Patient Name</th>' +
                    '<th>MRN</th>' +
                    '<th>Wound Diagnosis</th>' +
                    '<th>Month/Year</th>' +
                    '<th>Facility</th>' +
                    '<th>Total Units</th>' +
                    '<th>Total Costs</th>' +
                    '<th>Last Updated</th>';
            } else {
                adminTabButton.style.display = 'none';
                suppliesTabButton.style.display = 'none';
                summaryFacilityGroup.style.display = 'none';
                dashboardFacilityGroup.style.display = 'none';
                dashboardCostCard.style.display = 'none';
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
            
            Promise.all(requests).then(function(results) {
                appData.facilities = results[0];
                appData.supplies = results[1];
                
                var allPatients = results[2];
                if (currentUser.role === 'admin') {
                    appData.patients = allPatients;
                } else if (currentUser.facility_id) {
                    appData.patients = allPatients.filter(function(p) {
                        return p.facility_id === currentUser.facility_id;
                    });
                } else {
                    appData.patients = [];
                }
                
                if (appData.patients && appData.patients.length > 0) {
                    appData.patients.sort(function(a, b) {
                        return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
                    });
                }

                populateDropdowns();
                refreshPatientList();
                refreshPatientSelect();
                refreshSuppliesList();
                loadDashboard();
                
                console.log('Data loading complete');
            }).catch(function(error) {
                console.error('Failed to load data:', error);
                showNotification('Failed to load data: ' + error.message, true);
            });
        }

        // Populate dropdowns
        function populateDropdowns() {
            populatePatientFacilityDropdown();
            populateEditFacilityDropdown();
            populateTrackingFacilitySelector();
            populateSummaryFacilities();
            populateDashboardFacilities();
        }

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

        function populateDashboardFacilities() {
            var select = document.getElementById('dashboardFacility');
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
                } else if (tabName === 'dashboard') {
                    setTimeout(function() { loadDashboard(); }, 100);
                } else if (tabName === 'summary') {
                    setTimeout(function() { updateSummaryReport(); }, 100);
                } else if (tabName === 'supplies') {
                    setTimeout(function() { refreshSuppliesList(); }, 100);
                }
            }

            if (clickedElement) {
                clickedElement.classList.add('active');
            }
        }

        // Enhanced Dashboard Functions
        function loadDashboard() {
            var month = document.getElementById('dashboardMonth') ? document.getElementById('dashboardMonth').value : '';
            var facility = document.getElementById('dashboardFacility') ? document.getElementById('dashboardFacility').value : '';
            
            var params = new URLSearchParams();
            if (month) params.append('month', convertMonthFormat(month));
            if (facility) params.append('facility', facility);
            
            var url = '/dashboard' + (params.toString() ? '?' + params.toString() : '');
            
            apiCall(url).then(function(response) {
                appData.dashboardData = response;
                updateDashboardCards(response.dashboard);
                updateDashboardTable(response.patients);
            }).catch(function(error) {
                console.error('Failed to load dashboard:', error);
                showNotification('Failed to load dashboard: ' + error.message, true);
            });
        }

        function updateDashboardCards(dashboard) {
            document.getElementById('dashboardTotalPatients').textContent = dashboard.total_patients || 0;
            document.getElementById('dashboardTotalUnits').textContent = dashboard.total_units || 0;
            document.getElementById('dashboardTotalFacilities').textContent = dashboard.total_facilities || 0;
            
            if (currentUser.role === 'admin') {
                var totalCosts = parseFloat(dashboard.total_costs || 0);
                document.getElementById('dashboardTotalCosts').textContent = '$' + totalCosts.toFixed(2);
            }
        }

        function updateDashboardTable(patients) {
            var tbody = document.getElementById('dashboardPatientsTableBody');
            tbody.innerHTML = '';

            if (patients.length === 0) {
                var colspan = currentUser.role === 'admin' ? 8 : 7;
                tbody.innerHTML = '<tr><td colspan="' + colspan + '" class="text-center" style="color: #718096;">No patients to display</td></tr>';
                return;
            }

            for (var i = 0; i < patients.length; i++) {
                var patient = patients[i];
                var monthParts = patient.month.split('-');
                var displayMonth = monthParts[1] + '-' + monthParts[0];
                var lastUpdated = new Date(patient.updated_at).toLocaleDateString();
                var woundDx = patient.wound_diagnoses || 'N/A';
                
                var row = document.createElement('tr');
                
                var html = 
                    '<td>' + patient.name + '</td>' +
                    '<td>' + (patient.mrn || 'N/A') + '</td>' +
                    '<td>' + woundDx + '</td>' +
                    '<td>' + displayMonth + '</td>' +
                    '<td>' + (patient.facility_name || 'Unknown') + '</td>' +
                    '<td>' + (patient.total_units || 0) + '</td>';
                
                if (currentUser.role === 'admin') {
                    var totalCosts = parseFloat(patient.total_costs || 0);
                    html += '<td>$' + totalCosts.toFixed(2) + '</td>';
                }
                
                html += '<td>' + lastUpdated + '</td>';
                
                row.innerHTML = html;
                tbody.appendChild(row);
            }
        }

        function applyDashboardFilters() {
            loadDashboard();
        }

        function clearDashboardFilters() {
            if (document.getElementById('dashboardMonth')) {
                document.getElementById('dashboardMonth').value = '';
            }
            if (document.getElementById('dashboardFacility')) {
                document.getElementById('dashboardFacility').value = '';
            }
            loadDashboard();
        }

        function exportDashboardData() {
            if (!appData.dashboardData) {
                showNotification('No dashboard data to export', true);
                return;
            }
            
            try {
                showNotification('Generating dashboard export...');
                
                var reportData = [];
                var fileName = 'Dashboard_Report_' + new Date().toISOString().split('T')[0];
                
                // Add header information
                reportData.push(['WOUND CARE DASHBOARD REPORT']);
                reportData.push(['Generated: ' + new Date().toLocaleDateString()]);
                reportData.push(['']);
                
                // Add summary statistics
                reportData.push(['SUMMARY STATISTICS']);
                reportData.push(['Total Patients', appData.dashboardData.dashboard.total_patients]);
                reportData.push(['Total Units', appData.dashboardData.dashboard.total_units]);
                reportData.push(['Total Facilities', appData.dashboardData.dashboard.total_facilities]);
                
                if (currentUser.role === 'admin') {
                    reportData.push(['Total Costs', '$' + parseFloat(appData.dashboardData.dashboard.total_costs || 0).toFixed(2)]);
                }
                
                reportData.push(['']);
                
                // Add patient details
                reportData.push(['PATIENT DETAILS']);
                
                var headers = ['Patient Name', 'MRN', 'Wound Diagnosis', 'Month/Year', 'Facility', 'Total Units'];
                if (currentUser.role === 'admin') {
                    headers.push('Total Costs');
                }
                headers.push('Last Updated');
                
                reportData.push(headers);
                
                for (var i = 0; i < appData.dashboardData.patients.length; i++) {
                    var patient = appData.dashboardData.patients[i];
                    var monthParts = patient.month.split('-');
                    var displayMonth = monthParts[1] + '-' + monthParts[0];
                    
                    var row = [
                        patient.name || 'Unknown',
                        patient.mrn || 'N/A',
                        patient.wound_diagnoses || 'N/A',
                        displayMonth,
                        patient.facility_name || 'Unknown',
                        patient.total_units || 0
                    ];
                    
                    if (currentUser.role === 'admin') {
                        row.push('$' + parseFloat(patient.total_costs || 0).toFixed(2));
                    }
                    
                    row.push(new Date(patient.updated_at).toLocaleDateString());
                    
                    reportData.push(row);
                }

                var worksheet = XLSX.utils.aoa_to_sheet(reportData);
                var workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, 'Dashboard');
                
                XLSX.writeFile(workbook, fileName + '.xlsx');
                
                showNotification('Dashboard data exported successfully!');
                
            } catch (error) {
                console.error('Failed to export dashboard:', error);
                showNotification('Failed to export dashboard: ' + error.message, true);
            }
        }

        // Continue with other functions...
        // [The rest of the JavaScript functions would continue here, including patient management, supply tracking, etc.]
        // [Due to length constraints, I'm showing the key parts - the full implementation would include all functions]

        // Convert month format between MM-YYYY and YYYY-MM
        function convertMonthFormat(monthStr) {
            var parts = monthStr.split('-');
            return parts[1] + '-' + parts[0];
        }

        // Drag and Drop File Handling
        function setupDragAndDrop() {
            var dropZones = document.querySelectorAll('.file-drop-zone');
            
            dropZones.forEach(function(dropZone) {
                dropZone.addEventListener('dragover', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    dropZone.classList.add('dragover');
                });

                dropZone.addEventListener('dragleave', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    dropZone.classList.remove('dragover');
                });

                dropZone.addEventListener('drop', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    dropZone.classList.remove('dragover');

                    var files = e.dataTransfer.files;
                    if (files.length > 0) {
                        var file = files[0];
                        
                        // Determine which modal is open
                        if (document.getElementById('excelImportModal').style.display === 'flex') {
                            handleExcelFile(file);
                        } else if (document.getElementById('supplyImportModal').style.display === 'flex') {
                            handleSupplyFile(file);
                        }
                    }
                });
            });
        }

        // Enhanced Bulk Operations
        function bulkUpdateSupplies(patientId) {
            if (currentUser.role !== 'admin') {
                showNotification('Admin access required', true);
                return;
            }
            
            var confirmation = confirm('Apply bulk quantity update to all supplies for this patient? This will set quantity 1 for all supplies on day 1.');
            if (!confirmation) return;
            
            var supplies = appData.supplies;
            var promises = [];
            
            for (var i = 0; i < supplies.length; i++) {
                var supply = supplies[i];
                promises.push(
                    apiCall('/patients/' + patientId + '/tracking', {
                        method: 'POST',
                        body: {
                            supplyId: supply.id,
                            dayOfMonth: 1,
                            quantity: 1,
                            woundDx: 'Bulk update - please specify diagnosis'
                        }
                    })
                );
            }
            
            Promise.all(promises).then(function() {
                showNotification('Bulk update completed successfully!');
                loadPatientTracking(); // Reload the tracking interface
            }).catch(function(error) {
                showNotification('Bulk update failed: ' + error.message, true);
            });
        }

        // Enhanced Search and Filter Functions
        function searchPatients(searchTerm) {
            if (!searchTerm) {
                refreshPatientList();
                return;
            }
            
            var filteredPatients = appData.patients.filter(function(patient) {
                return patient.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                       (patient.mrn && patient.mrn.toLowerCase().includes(searchTerm.toLowerCase())) ||
                       (patient.facility_name && patient.facility_name.toLowerCase().includes(searchTerm.toLowerCase()));
            });
            
            var tableBody = document.getElementById('patientTableBody');
            tableBody.innerHTML = '';
            
            if (filteredPatients.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #718096; padding: 40px;">No patients found matching "' + searchTerm + '"</td></tr>';
                return;
            }
            
            for (var i = 0; i < filteredPatients.length; i++) {
                var patient = filteredPatients[i];
                var row = document.createElement('tr');
                
                var monthParts = patient.month.split('-');
                var displayMonth = monthParts[1] + '-' + monthParts[0];
                
                row.innerHTML = 
                    '<td>' + patient.name + '</td>' +
                    '<td>' + (patient.mrn || 'N/A') + '</td>' +
                    '<td>' + displayMonth + '</td>' +
                    '<td>' + (patient.facility_name || 'Unknown') + '</td>' +
                    '<td>' + new Date(patient.updated_at).toLocaleDateString() + '</td>' +
                    '<td>' +
                        '<button class="btn btn-secondary btn-sm" onclick="viewPatientTracking(' + patient.id + ')" style="margin-right: 5px;">Track</button>' +
                        '<button class="btn btn-primary btn-sm" onclick="showEditPatientModal(' + patient.id + ')" style="margin-right: 5px;">Edit</button>' +
                        '<button class="btn btn-danger btn-sm" onclick="removePatient(' + patient.id + ')">Delete</button>' +
                    '</td>';

                tableBody.appendChild(row);
            }
        }

        // Keyboard shortcuts and accessibility
        function setupKeyboardShortcuts() {
            document.addEventListener('keydown', function(e) {
                // Ctrl/Cmd + S to save (prevent default)
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    e.preventDefault();
                    showNotification('Auto-save is enabled - no manual save needed');
                }
                
                // Escape to close modals
                if (e.key === 'Escape') {
                    var modals = document.querySelectorAll('.modal');
                    modals.forEach(function(modal) {
                        if (modal.style.display === 'flex') {
                            modal.style.display = 'none';
                        }
                    });
                }
            });
        }

        // Enhanced Error Handling
        function handleGlobalError(error) {
            console.error('Global error:', error);
            
            if (error.message && error.message.includes('401')) {
                logout();
                showNotification('Session expired. Please log in again.', true);
            } else if (error.message && error.message.includes('403')) {
                showNotification('Access denied. You may not have permission for this action.', true);
            } else if (error.message && error.message.includes('network')) {
                showNotification('Network error. Please check your connection.', true);
            } else {
                showNotification('An unexpected error occurred: ' + error.message, true);
            }
        }

        // Progress tracking for large operations
        function showProgressModal(title, message) {
            var existingModal = document.getElementById('progressModal');
            if (existingModal) {
                existingModal.remove();
            }
            
            var modal = document.createElement('div');
            modal.id = 'progressModal';
            modal.className = 'modal';
            modal.style.display = 'flex';
            modal.innerHTML = '<div class="modal-content" style="text-align: center; max-width: 400px;">' +
                '<h3>' + title + '</h3>' +
                '<p>' + message + '</p>' +
                '<div style="width: 100%; background: #e2e8f0; border-radius: 10px; margin: 20px 0;">' +
                '<div style="width: 0%; height: 10px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 10px; transition: width 0.3s ease;" id="progressBar"></div>' +
                '</div>' +
                '<p id="progressText">Initializing...</p>' +
                '</div>';
            document.body.appendChild(modal);
            
            return {
                updateProgress: function(percent, text) {
                    var bar = document.getElementById('progressBar');
                    var textEl = document.getElementById('progressText');
                    if (bar) bar.style.width = percent + '%';
                    if (textEl) textEl.textContent = text;
                },
                close: function() {
                    if (modal && modal.parentNode) {
                        modal.parentNode.removeChild(modal);
                    }
                }
            };
        }

        // Initialize when page loads
        window.addEventListener('DOMContentLoaded', function() {
            console.log('🚀 Initializing Wound Care RT Supply Tracker v2.0...');
            
            try {
                // Setup global error handling
                window.addEventListener('error', handleGlobalError);
                window.addEventListener('unhandledrejection', function(e) {
                    handleGlobalError(e.reason);
                });
                
                // Setup keyboard shortcuts
                setupKeyboardShortcuts();
                
                // Setup drag and drop
                setTimeout(setupDragAndDrop, 1000);
                
                // Handle enter key for login
                var loginInputs = [document.getElementById('loginEmail'), document.getElementById('loginPassword')];
                loginInputs.forEach(function(input) {
                    if (input) {
                        input.addEventListener('keypress', function(e) {
                            if (e.key === 'Enter') {
                                login();
                            }
                        });
                    }
                });
                
                if (authToken) {
                    console.log('🔐 Checking stored auth token...');
                    
                    var progress = showProgressModal('Loading Application', 'Verifying authentication...');
                    
                    apiCall('/auth/verify').then(function(response) {
                        currentUser = response.user;
                        progress.updateProgress(30, 'Loading user data...');
                        
                        console.log('✅ Token valid, auto-logging in user:', currentUser.email);
                        
                        document.getElementById('loginContainer').style.display = 'none';
                        document.getElementById('mainApp').style.display = 'block';
                        
                        progress.updateProgress(60, 'Loading application data...');
                        
                        initApp();
                        
                        progress.updateProgress(100, 'Complete!');
                        setTimeout(function() {
                            progress.close();
                        }, 500);
                        
                    }).catch(function(error) {
                        console.log('❌ Stored token invalid, showing login');
                        localStorage.removeItem('authToken');
                        authToken = null;
                        currentUser = null;
                        progress.close();
                    });
                } else {
                    console.log('📝 No stored token, showing login screen');
                }
                
                console.log('✨ Wound Care RT Supply Tracker v2.0 ready!');
            } catch (error) {
                console.error('❌ Initialization error:', error);
                showNotification('Application initialization failed. Please refresh the page.', true);
            }
        });

        // Add remaining functions for completeness...
        
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

        // Patient Management Functions
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
                tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #718096; padding: 40px;">No patients found. Add your first patient above or import from Excel.</td></tr>';
                return;
            }

            tableBody.innerHTML = '';

            for (var i = 0; i < appData.patients.length; i++) {
                var patient = appData.patients[i];
                var row = document.createElement('tr');
                
                var monthParts = patient.month.split('-');
                var displayMonth = monthParts[1] + '-' + monthParts[0];
                
                row.innerHTML = 
                    '<td>' + patient.name + '</td>' +
                    '<td>' + (patient.mrn || 'N/A') + '</td>' +
                    '<td>' + displayMonth + '</td>' +
                    '<td>' + (patient.facility_name || 'Unknown') + '</td>' +
                    '<td>' + new Date(patient.updated_at).toLocaleDateString() + '</td>' +
                    '<td>' +
                        '<button class="btn btn-secondary btn-sm" onclick="viewPatientTracking(' + patient.id + ')" style="margin-right: 5px;">Track</button>' +
                        '<button class="btn btn-primary btn-sm" onclick="showEditPatientModal(' + patient.id + ')" style="margin-right: 5px;">Edit</button>' +
                        '<button class="btn btn-danger btn-sm" onclick="removePatient(' + patient.id + ')">Delete</button>' +
                    '</td>';

                tableBody.appendChild(row);
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

        function viewPatientTracking(patientId) {
            showTab('tracking', document.querySelector('.tab:nth-child(3)'));
            document.getElementById('patientSelect').value = patientId;
            loadPatientTracking();
        }

        function removePatient(patientId) {
            if (confirm('Are you sure you want to remove this patient and all tracking data?')) {
                apiCall('/patients/' + patientId, {
                    method: 'DELETE'
                }).then(function() {
                    initApp();
                    showNotification('Patient removed successfully!');
                }).catch(function(error) {
                    showNotification('Failed to remove patient: ' + error.message, true);
                });
            }
        }

        // Enhanced Supply Tracking Functions
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

            Promise.all([
                apiCall('/patients/' + patientId + '/tracking'),
                appData.supplies
            ]).then(function(results) {
                var trackingData = results[0];
                var supplies = results[1];
                
                createEnhancedTrackingInterface(patient, supplies, trackingData, container);
            }).catch(function(error) {
                console.error('Failed to load tracking data:', error);
                
                var errorMessage = 'Failed to load tracking data: ' + error.message;
                
                if (error.message.indexOf('Access denied') !== -1) {
                    errorMessage = 'Access Denied: You may not have permission to view this patient data.';
                }
                
                container.innerHTML = '<div style="text-align: center; margin-top: 50px; padding: 20px; background: #fed7d7; border-radius: 10px; border-left: 4px solid #e53e3e;"><p style="color: #c53030; font-size: 16px; margin: 0;">' + errorMessage + '</p></div>';
            });
        }

        function createEnhancedTrackingInterface(patient, supplies, trackingData, container) {
            var monthParts = patient.month.split('-');
            var year = parseInt(monthParts[0]);
            var month = parseInt(monthParts[1]) - 1;
            var daysInMonth = new Date(year, month + 1, 0).getDate();
            
            var trackingMap = {};
            var woundDxMap = {};
            for (var i = 0; i < trackingData.length; i++) {
                var tracking = trackingData[i];
                var key = tracking.supply_id + '_' + tracking.day_of_month;
                trackingMap[key] = tracking.quantity;
                if (tracking.wound_dx) {
                    woundDxMap[tracking.supply_id] = tracking.wound_dx;
                }
            }
            
            var displayMonth = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            
            var html = '<div style="margin-bottom: 30px;">';
            html += '<h3 style="color: #667eea; margin-bottom: 15px;">Enhanced Supply Tracking - ' + patient.name + '</h3>';
            html += '<p style="color: #4a5568; margin-bottom: 10px;"><strong>Month:</strong> ' + displayMonth + '</p>';
            html += '<p style="color: #4a5568; margin-bottom: 10px;"><strong>Facility:</strong> ' + (patient.facility_name || 'Unknown') + '</p>';
            html += '<p style="color: #4a5568; margin-bottom: 20px;"><strong>MRN:</strong> ' + (patient.mrn || 'N/A') + '</p>';
            html += '</div>';
            
            html += '<div class="tracking-container">';
            html += '<div class="tracking-grid">';
            html += '<table class="tracking-table">';
            
            // Header row
            html += '<thead><tr>';
            html += '<th class="supply-info">AR Code</th>';
            html += '<th class="supply-info">Item Description</th>';
            html += '<th>HCPCS</th>';
            if (currentUser.role === 'admin') {
                html += '<th>Unit Cost</th>';
            }
            html += '<th>All Wound DX</th>';
            html += '<th>Total Units</th>';
            if (currentUser.role === 'admin') {
                html += '<th>Total Cost</th>';
            }
            
            for (var day = 1; day <= daysInMonth; day++) {
                html += '<th>' + day + '</th>';
            }
            html += '</tr></thead>';
            
            html += '<tbody>';
            
            for (var i = 0; i < supplies.length; i++) {
                var supply = supplies[i];
                html += '<tr>';
                
                // AR Code (frozen)
                html += '<td class="supply-info"><div class="ar-code">' + supply.ar_code + '</div></td>';
                
                // Item Description (frozen)
                html += '<td class="supply-info"><div class="item-desc" title="' + supply.item_description + '">' + supply.item_description + '</div></td>';
                
                // HCPCS Code (frozen)
                html += '<td>' + (supply.hcpcs_code || 'N/A') + '</td>';
                
                // Unit Cost (frozen, admin only)
                if (currentUser.role === 'admin') {
                    html += '<td>
    </script>
</body>
</html> + parseFloat(supply.unit_cost || 0).toFixed(2) + '</td>';
                }
                
                // Wound DX (frozen, editable)
                var woundDx = woundDxMap[supply.id] || '';
                if (currentUser.role === 'admin') {
                    html += '<td><textarea class="wound-dx-input" data-patient-id="' + patient.id + '" data-supply-id="' + supply.id + '" onchange="updateWoundDx(this)" placeholder="Enter wound diagnosis...">' + woundDx + '</textarea></td>';
                } else {
                    html += '<td><textarea class="wound-dx-input" data-patient-id="' + patient.id + '" data-supply-id="' + supply.id + '" onchange="updateWoundDx(this)" placeholder="Enter wound diagnosis...">' + woundDx + '</textarea></td>';
                }
                
                // Calculate totals
                var rowTotal = 0;
                for (var day = 1; day <= daysInMonth; day++) {
                    var key = supply.id + '_' + day;
                    var quantity = trackingMap[key] || 0;
                    rowTotal += parseInt(quantity) || 0;
                }
                
                // Total Units (frozen)
                html += '<td class="total-cell"><span id="total_' + supply.id + '">' + rowTotal + '</span></td>';
                
                // Total Cost (frozen, admin only)
                if (currentUser.role === 'admin') {
                    var totalCost = rowTotal * parseFloat(supply.unit_cost || 0);
                    html += '<td class="cost-cell"><span id="cost_' + supply.id + '">
    </script>
</body>
</html> + totalCost.toFixed(2) + '</span></td>';
                }
                
                // Day cells (scrollable)
                for (var day = 1; day <= daysInMonth; day++) {
                    var key = supply.id + '_' + day;
                    var quantity = trackingMap[key] || 0;
                    
                    html += '<td>';
                    if (currentUser.role === 'admin') {
                        html += '<input type="number" class="tracking-input" ';
                        html += 'data-patient-id="' + patient.id + '" ';
                        html += 'data-supply-id="' + supply.id + '" ';
                        html += 'data-day="' + day + '" ';
                        html += 'value="' + (quantity || '') + '" ';
                        html += 'min="0" max="99" ';
                        html += 'onchange="updateTracking(this)">';
                    } else {
                        html += '<span style="font-size: 12px; color: #4a5568;">' + (quantity || 0) + '</span>';
                    }
                    html += '</td>';
                }
                
                html += '</tr>';
            }
            
            html += '</tbody>';
            html += '</table>';
            html += '</div>';
            html += '</div>';
            
            // Add action buttons
            html += '<div style="margin-top: 30px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">';
            html += '<div style="color: #4a5568;">';
            html += '<strong>Auto-saved:</strong> Changes are saved automatically as you type';
            html += '</div>';
            html += '<div>';
            html += '<button class="btn btn-success" onclick="exportTrackingData(' + patient.id + ')">Export Tracking Data</button>';
            if (currentUser.role === 'admin') {
                html += '<button class="btn btn-primary" onclick="bulkUpdateSupplies(' + patient.id + ')" style="margin-left: 10px;">Bulk Update</button>';
            }
            html += '</div>';
            html += '</div>';
            
            container.innerHTML = html;
        }

        function updateTracking(input) {
            var patientId = input.dataset.patientId;
            var supplyId = input.dataset.supplyId;
            var day = input.dataset.day;
            var quantity = parseInt(input.value) || 0;
            
            if (quantity < 0) {
                input.value = 0;
                quantity = 0;
            }
            if (quantity > 99) {
                input.value = 99;
                quantity = 99;
            }
            
            updateSupplyTotal(supplyId);
            
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

        function updateWoundDx(textarea) {
            var patientId = textarea.dataset.patientId;
            var supplyId = textarea.dataset.supplyId;
            var woundDx = textarea.value;
            
            clearTimeout(textarea.saveTimeout);
            textarea.saveTimeout = setTimeout(function() {
                // Find first day with quantity > 0 or use day 1
                var dayToUpdate = 1;
                var inputs = document.querySelectorAll('[data-patient-id="' + patientId + '"][data-supply-id="' + supplyId + '"]');
                for (var i = 0; i < inputs.length; i++) {
                    if (inputs[i].value && parseInt(inputs[i].value) > 0) {
                        dayToUpdate = parseInt(inputs[i].dataset.day);
                        break;
                    }
                }
                
                apiCall('/patients/' + patientId + '/tracking', {
                    method: 'POST',
                    body: {
                        supplyId: parseInt(supplyId),
                        dayOfMonth: dayToUpdate,
                        quantity: 1, // Minimum to create record
                        woundDx: woundDx
                    }
                }).then(function() {
                    textarea.style.borderColor = '#38a169';
                    setTimeout(function() {
                        textarea.style.borderColor = '#e2e8f0';
                    }, 1000);
                }).catch(function(error) {
                    console.error('Failed to save wound diagnosis:', error);
                    textarea.style.borderColor = '#e53e3e';
                    showNotification('Failed to save wound diagnosis: ' + error.message, true);
                });
            }, 1000);
        }

        function updateSupplyTotal(supplyId) {
            var inputs = document.querySelectorAll('[data-supply-id="' + supplyId + '"]');
            var total = 0;
            
            for (var i = 0; i < inputs.length; i++) {
                if (inputs[i].type === 'number') {
                    total += parseInt(inputs[i].value) || 0;
                }
            }
            
            var totalElement = document.getElementById('total_' + supplyId);
            if (totalElement) {
                totalElement.textContent = total;
            }
            
            // Update cost if admin
            if (currentUser.role === 'admin') {
                var costElement = document.getElementById('cost_' + supplyId);
                if (costElement) {
                    var unitCostText = document.querySelector('[data-supply-id="' + supplyId + '"]').closest('tr').cells[3].textContent;
                    var unitCost = parseFloat(unitCostText.replace('
    </script>
</body>
</html>, '')) || 0;
                    var totalCost = total * unitCost;
                    costElement.textContent = '
    </script>
</body>
</html> + totalCost.toFixed(2);
                }
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
                reportData.push(['ENHANCED SUPPLY TRACKING REPORT']);
                reportData.push(['Patient: ' + patient.name]);
                reportData.push(['Month: ' + displayMonth]);
                reportData.push(['Facility: ' + (patient.facility_name || 'Unknown')]);
                reportData.push(['MRN: ' + (patient.mrn || 'N/A')]);
                reportData.push(['Generated: ' + new Date().toLocaleDateString()]);
                reportData.push([]);
                
                var headers = ['AR Code', 'Item Description', 'HCPCS Code', 'Day', 'Quantity', 'Wound Diagnosis'];
                if (currentUser.role === 'admin') {
                    headers.splice(3, 0, 'Unit Cost');
                    headers.push('Line Cost');
                }
                reportData.push(headers);
                
                for (var i = 0; i < trackingData.length; i++) {
                    var tracking = trackingData[i];
                    var row = [
                        tracking.ar_code,
                        tracking.item_description,
                        tracking.hcpcs_code || 'N/A',
                        tracking.day_of_month,
                        tracking.quantity,
                        tracking.wound_dx || 'N/A'
                    ];
                    
                    if (currentUser.role === 'admin') {
                        var unitCost = parseFloat(tracking.unit_cost || 0);
                        var lineCost = tracking.quantity * unitCost;
                        row.splice(3, 0, '
    </script>
</body>
</html> + unitCost.toFixed(2));
                        row.push('
    </script>
</body>
</html> + lineCost.toFixed(2));
                    }
                    
                    reportData.push(row);
                }
                
                var worksheet = XLSX.utils.aoa_to_sheet(reportData);
                var workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, 'Enhanced Tracking');
                
                var fileName = 'Enhanced_Tracking_' + patient.name.replace(/[^a-zA-Z0-9]/g, '_') + '_' + displayMonth.replace('-', '_') + '.xlsx';
                XLSX.writeFile(workbook, fileName);
                
                showNotification('Enhanced tracking data exported successfully!');
            }).catch(function(error) {
                showNotification('Failed to export: ' + error.message, true);
            });
        }

        // Supply Management Functions
        function refreshSuppliesList() {
            var tableBody = document.getElementById('suppliesTableBody');
            
            if (!tableBody) return;

            if (appData.supplies.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #718096; padding: 40px;">No supplies found. Add your first supply above or import from Excel.</td></tr>';
                return;
            }

            tableBody.innerHTML = '';

            for (var i = 0; i < appData.supplies.length; i++) {
                var supply = appData.supplies[i];
                var row = document.createElement('tr');
                
                var statusBadge = supply.is_active ? 
                    '<span style="background: #38a169; color: white; padding: 3px 8px; border-radius: 4px; font-size: 11px;">Active</span>' : 
                    '<span style="background: #e53e3e; color: white; padding: 3px 8px; border-radius: 4px; font-size: 11px;">Inactive</span>';
                
                row.innerHTML = 
                    '<td><strong>' + supply.ar_code + '</strong></td>' +
                    '<td>' + supply.item_description + '</td>' +
                    '<td>' + (supply.hcpcs_code || 'N/A') + '</td>' +
                    '<td>
    </script>
</body>
</html> + parseFloat(supply.unit_cost || 0).toFixed(2) + '</td>' +
                    '<td>' + statusBadge + '</td>' +
                    '<td>' +
                        '<button class="btn btn-primary btn-sm" onclick="showEditSupplyModal(' + supply.id + ')" style="margin-right: 5px;">Edit</button>' +
                        '<button class="btn btn-danger btn-sm" onclick="removeSupply(' + supply.id + ')">Delete</button>' +
                    '</td>';

                tableBody.appendChild(row);
            }
        }

        function addSupply() {
            var arCode = document.getElementById('supplyArCode').value.trim();
            var description = document.getElementById('supplyDescription').value.trim();
            var hcpcs = document.getElementById('supplyHcpcs').value.trim();
            var unitCost = parseFloat(document.getElementById('supplyUnitCost').value) || 0;
            var addBtn = document.getElementById('addSupplyBtn');

            if (!arCode || !description) {
                showNotification('AR Code and Item Description are required', true);
                return;
            }

            addBtn.disabled = true;
            addBtn.innerHTML = '<span class="loading"></span>Adding...';

            apiCall('/supplies', {
                method: 'POST',
                body: { 
                    ar_code: arCode, 
                    item_description: description, 
                    hcpcs_code: hcpcs, 
                    unit_cost: unitCost 
                }
            }).then(function() {
                clearSupplyForm();
                initApp();
                showNotification('Supply added successfully!');
            }).catch(function(error) {
                showNotification(error.message, true);
            }).finally(function() {
                addBtn.disabled = false;
                addBtn.innerHTML = 'Add Supply';
            });
        }

        function clearSupplyForm() {
            document.getElementById('supplyArCode').value = '';
            document.getElementById('supplyDescription').value = '';
            document.getElementById('supplyHcpcs').value = '';
            document.getElementById('supplyUnitCost').value = '';
        }

        function removeSupply(supplyId) {
            if (confirm('Are you sure you want to remove this supply? This may affect existing tracking data.')) {
                apiCall('/supplies/' + supplyId, {
                    method: 'DELETE'
                }).then(function() {
                    initApp();
                    showNotification('Supply removed successfully!');
                }).catch(function(error) {
                    showNotification('Failed to remove supply: ' + error.message, true);
                });
            }
        }

        // Enhanced Summary Report Functions
        function updateSummaryReport() {
            var month = document.getElementById('summaryMonth') ? document.getElementById('summaryMonth').value : '';
            var facility = document.getElementById('summaryFacility') ? document.getElementById('summaryFacility').value : '';
            
            var params = new URLSearchParams();
            if (month) params.append('month', convertMonthFormat(month));
            if (facility) params.append('facility', facility);
            
            var url = '/summary-report' + (params.toString() ? '?' + params.toString() : '');
            
            apiCall(url).then(function(data) {
                updateSummaryTable(data);
            }).catch(function(error) {
                console.error('Failed to load summary report:', error);
                showNotification('Failed to load summary report: ' + error.message, true);
            });
        }

        function updateSummaryTable(data) {
            var tbody = document.getElementById('summaryTableBody');
            tbody.innerHTML = '';

            if (data.length === 0) {
                var colspan = currentUser.role === 'admin' ? 10 : 7;
                tbody.innerHTML = '<tr><td colspan="' + colspan + '" style="text-align: center; color: #718096;">No data to display</td></tr>';
                return;
            }

            for (var i = 0; i < data.length; i++) {
                var item = data[i];
                var monthParts = item.month.split('-');
                var displayMonth = monthParts[1] + '-' + monthParts[0];
                var lastUpdated = new Date(item.updated_at).toLocaleDateString();

                var row = document.createElement('tr');
                
                var html = 
                    '<td>' + item.patient_name + '</td>' +
                    '<td>' + (item.mrn || 'N/A') + '</td>' +
                    '<td>' + (item.wound_dx || 'N/A') + '</td>';
                
                if (currentUser.role === 'admin') {
                    html += '<td>' + (item.ar_codes || 'N/A') + '</td>';
                    html += '<td>' + (item.hcpcs_codes || 'N/A') + '</td>';
                }
                
                html += '<td>' + displayMonth + '</td>';
                html += '<td>' + (item.facility_name || 'Unknown') + '</td>';
                html += '<td>' + (item.total_units || 0) + '</td>';
                
                if (currentUser.role === 'admin') {
                    var totalCosts = parseFloat(item.total_costs || 0);
                    html += '<td>
    </script>
</body>
</html> + totalCosts.toFixed(2) + '</td>';
                }
                
                html += '<td>' + lastUpdated + '</td>';
                
                row.innerHTML = html;
                tbody.appendChild(row);
            }
        }

        function applySummaryFilters() {
            updateSummaryReport();
        }

        function clearSummaryFilters() {
            if (document.getElementById('summaryMonth')) {
                document.getElementById('summaryMonth').value = '';
            }
            if (document.getElementById('summaryFacility')) {
                document.getElementById('summaryFacility').value = '';
            }
            updateSummaryReport();
        }

        function downloadSummaryReport() {
            try {
                showNotification('Generating summary report...');
                
                var month = document.getElementById('summaryMonth') ? document.getElementById('summaryMonth').value : '';
                var facility = document.getElementById('summaryFacility') ? document.getElementById('summaryFacility').value : '';
                
                var params = new URLSearchParams();
                if (month) params.append('month', convertMonthFormat(month));
                if (facility) params.append('facility', facility);
                
                var url = '/summary-report' + (params.toString() ? '?' + params.toString() : '');
                
                apiCall(url).then(function(data) {
                    var reportData = [];
                    var fileName = 'Summary_Report';
                    
                    if (month) {
                        var monthParts = month.split('-');
                        var monthName = new Date(monthParts[1], monthParts[0] - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                        fileName = 'Summary_Report_' + monthName.replace(' ', '_');
                    }
                    
                    reportData.push(['WOUND CARE SUMMARY REPORT - Generated ' + new Date().toLocaleDateString()]);
                    reportData.push([]);
                    
                    var headers = ['Patient Name', 'MRN', 'Wound Diagnosis'];
                    if (currentUser.role === 'admin') {
                        headers.push('AR Codes', 'HCPCS Codes');
                    }
                    headers.push('Month/Year', 'Facility', 'Total Units');
                    if (currentUser.role === 'admin') {
                        headers.push('Total Costs');
                    }
                    headers.push('Last Updated');
                    
                    reportData.push(headers);
                    
                    for (var i = 0; i < data.length; i++) {
                        var item = data[i];
                        var monthParts = item.month.split('-');
                        var displayMonth = monthParts[1] + '-' + monthParts[0];
                        
                        var row = [
                            item.patient_name || 'Unknown',
                            item.mrn || 'N/A',
                            item.wound_dx || 'N/A'
                        ];
                        
                        if (currentUser.role === 'admin') {
                            row.push(item.ar_codes || 'N/A');
                            row.push(item.hcpcs_codes || 'N/A');
                        }
                        
                        row.push(displayMonth);
                        row.push(item.facility_name || 'Unknown');
                        row.push(item.total_units || 0);
                        
                        if (currentUser.role === 'admin') {
                            row.push('
    </script>
</body>
</html> + parseFloat(item.total_costs || 0).toFixed(2));
                        }
                        
                        row.push(new Date(item.updated_at).toLocaleDateString());
                        
                        reportData.push(row);
                    }

                    var worksheet = XLSX.utils.aoa_to_sheet(reportData);
                    var workbook = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(workbook, worksheet, 'Summary');
                    
                    XLSX.writeFile(workbook, fileName + '.xlsx');
                    
                    showNotification('Summary report downloaded successfully!');
                }).catch(function(error) {
                    showNotification('Failed to generate report: ' + error.message, true);
                });
                
            } catch (error) {
                console.error('Failed to generate report:', error);
                showNotification('Failed to generate report: ' + error.message, true);
            }
        }

        // Excel Import/Export Functions
        function downloadExcelTemplate() {
            var worksheet = XLSX.utils.aoa_to_sheet([
                ['Name', 'Month', 'MRN', 'Facility'],
                ['Smith, John', '01-2025', 'MRN12345', 'Main Hospital'],
                ['Johnson, Mary', '01-2025', 'MRN67890', 'Clinic North']
            ]);

            var workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Patients');
            XLSX.writeFile(workbook, 'patient_import_template.xlsx');
        }

        function downloadSupplyTemplate() {
            try {
                fetch(API_BASE + '/supplies/template', {
                    method: 'GET',
                    headers: {
                        'Authorization': 'Bearer ' + authToken
                    }
                }).then(function(response) {
                    if (!response.ok) {
                        throw new Error('Failed to download template');
                    }
                    return response.blob();
                }).then(function(blob) {
                    var url = window.URL.createObjectURL(blob);
                    var a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = url;
                    a.download = 'supplies_template.xlsx';
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                    showNotification('Supply template downloaded successfully!');
                }).catch(function(error) {
                    showNotification('Failed to download template: ' + error.message, true);
                });
            } catch (error) {
                console.error('Template download error:', error);
                showNotification('Failed to download template: ' + error.message, true);
            }
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

        function showSupplyImportModal() {
            document.getElementById('supplyImportModal').style.display = 'flex';
        }

        function closeSupplyImportModal() {
            document.getElementById('supplyImportModal').style.display = 'none';
            document.getElementById('supplyFileInput').value = '';
            document.getElementById('supplyImportResults').style.display = 'none';
            document.getElementById('processSupplyImportBtn').disabled = true;
            supplyExcelData = null;
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

        function handleSupplyFile(file) {
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
                    supplyExcelData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                    showSupplyPreview(supplyExcelData, file.name);
                    document.getElementById('processSupplyImportBtn').disabled = false;
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

        function showSupplyPreview(data, fileName) {
            var resultsDiv = document.getElementById('supplyImportResults');
            
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

        function processSupplyImport() {
            var processBtn = document.getElementById('processSupplyImportBtn');
            var resultsDiv = document.getElementById('supplyImportResults');

            if (!supplyExcelData) {
                showNotification('No Excel data to process', true);
                return;
            }

            processBtn.disabled = true;
            processBtn.innerHTML = '<span class="loading"></span>Processing...';

            var worksheet = XLSX.utils.aoa_to_sheet(supplyExcelData);
            var workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Supplies');
            var excelBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

            var formData = new FormData();
            var blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            formData.append('excelFile', blob, 'supplies.xlsx');

            fetch(API_BASE + '/supplies/import-excel', {
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
                    closeSupplyImportModal();
                }, 3000);
            }).catch(function(error) {
                resultsDiv.innerHTML = '<h4 style="color: #e53e3e;">Import Failed</h4><p style="color: #e53e3e;">' + error.message + '</p>';
                resultsDiv.style.display = 'block';
            }).finally(function() {
                processBtn.disabled = false;
                processBtn.innerHTML = 'Import Data';
            });
        }

        // Edit Modal Functions
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

        function showEditSupplyModal(supplyId) {
            editingSupplyId = supplyId;
            var supply = null;
            for (var i = 0; i < appData.supplies.length; i++) {
                if (appData.supplies[i].id === supplyId) {
                    supply = appData.supplies[i];
                    break;
                }
            }
            
            if (!supply) {
                showNotification('Supply not found', true);
                return;
            }
            
            document.getElementById('editSupplyArCode').value = supply.ar_code;
            document.getElementById('editSupplyDescription').value = supply.item_description;
            document.getElementById('editSupplyHcpcs').value = supply.hcpcs_code || '';
            document.getElementById('editSupplyUnitCost').value = parseFloat(supply.unit_cost || 0).toFixed(2);
            document.getElementById('editSupplyMessage').innerHTML = '';
            
            document.getElementById('editSupplyModal').style.display = 'flex';
        }

        function closeEditSupplyModal() {
            document.getElementById('editSupplyModal').style.display = 'none';
            editingSupplyId = null;
        }

        function saveSupplyEdit() {
            if (!editingSupplyId) return;
            
            var arCode = document.getElementById('editSupplyArCode').value.trim();
            var description = document.getElementById('editSupplyDescription').value.trim();
            var hcpcs = document.getElementById('editSupplyHcpcs').value.trim();
            var unitCost = parseFloat(document.getElementById('editSupplyUnitCost').value) || 0;
            var saveBtn = document.getElementById('saveSupplyBtn');
            var messageEl = document.getElementById('editSupplyMessage');

            if (!arCode || !description) {
                messageEl.innerHTML = '<div class="error-message">AR Code and Item Description are required</div>';
                return;
            }

            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="loading"></span>Saving...';

            apiCall('/supplies/' + editingSupplyId, {
                method: 'PUT',
                body: { ar_code: arCode, item_description: description, hcpcs_code: hcpcs, unit_cost: unitCost }
            }).then(function() {
                messageEl.innerHTML = '<div class="success-message">Supply updated successfully!</div>';
                
                setTimeout(function() {
                    closeEditSupplyModal();
                    initApp();
                    showNotification('Supply updated successfully!');
                }, 1500);
            }).catch(function(error) {
                messageEl.innerHTML = '<div class="error-message">' + error.message + '</div>';
            }).finally(function() {
                saveBtn.disabled = false;
                saveBtn.innerHTML = 'Save Changes';
            });
        }

        // Admin Functions
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
    </script>
</body>
</html>
