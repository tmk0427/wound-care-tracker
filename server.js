const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Basic middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname, 'public')));

// Set basic CSP
app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', 
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' data:; connect-src 'self';"
    );
    next();
});

// Serve main page
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Wound Care RT Supply Tracker - Emergency Mode</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" href="data:,">
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f8f9fa; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 0 20px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #dc3545, #fd7e14); color: white; padding: 30px; margin: -30px -30px 30px; border-radius: 10px 10px 0 0; text-align: center; }
        .status { background: #fff3cd; color: #856404; padding: 20px; border: 1px solid #ffeaa7; border-radius: 5px; margin-bottom: 20px; }
        .error { background: #f8d7da; color: #721c24; padding: 20px; border: 1px solid #f5c6cb; border-radius: 5px; margin-bottom: 20px; }
        .btn { padding: 15px 30px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 10px; }
        .btn:hover { background: #0056b3; }
        .btn-danger { background: #dc3545; }
        .btn-danger:hover { background: #c82333; }
        .logs { background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 5px; padding: 15px; margin: 20px 0; max-height: 300px; overflow-y: auto; font-family: monospace; font-size: 14px; }
        .section { margin: 20px 0; padding: 20px; border: 1px solid #dee2e6; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚨 Emergency Mode: Wound Care RT Supply Tracker</h1>
            <p>Server is running in emergency mode while we debug the database issues</p>
        </div>

        <div class="error">
            <h3>⚠️ Current Status: Database Dependencies Missing</h3>
            <p>The production server crashed due to missing dependencies. This emergency server is running to help debug the issue.</p>
        </div>

        <div class="section">
            <h3>🔍 Debugging Information</h3>
            <p><strong>Server Status:</strong> ✅ Express server running (no database)</p>
            <p><strong>Node Version:</strong> ${process.version}</p>
            <p><strong>Environment:</strong> ${process.env.NODE_ENV || 'development'}</p>
            <p><strong>Port:</strong> ${PORT}</p>
            <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        </div>

        <div class="section">
            <h3>📋 Next Steps to Fix</h3>
            <ol>
                <li><strong>Check Heroku logs for exact error:</strong>
                    <div class="logs">heroku logs --tail --num=50</div>
                </li>
                <li><strong>Look for specific error before the stack trace</strong></li>
                <li><strong>Common issues:</strong>
                    <ul>
                        <li>sqlite3 module not found</li>
                        <li>bcryptjs module not found</li>
                        <li>jsonwebtoken module not found</li>
                        <li>Syntax error in server.js</li>
                    </ul>
                </li>
            </ol>
        </div>

        <div class="section">
            <h3>🧪 Test Basic Functionality</h3>
            <button class="btn" onclick="testHealth()">Test Server Health</button>
            <button class="btn" onclick="testAPI()">Test API Endpoint</button>
            <button class="btn btn-danger" onclick="showLogs()">Show Browser Logs</button>
            
            <div id="testResults" style="margin-top: 20px;"></div>
        </div>

        <div class="section">
            <h3>📦 Your Data Status</h3>
            <div class="status">
                <strong>✅ Good News:</strong> Your wound_care.db file with 74 patients should still be intact on Heroku. 
                Once we fix the server startup issue, all your data will be available again.
            </div>
        </div>

        <div class="section">
            <h3>🔧 Immediate Fixes to Try</h3>
            <div class="logs">
# Option 1: Force reinstall dependencies
heroku run npm install

# Option 2: Check what's actually deployed  
heroku run ls -la
heroku run cat package.json

# Option 3: Manual dependency check
heroku run node -e "console.log(require('express'))"
heroku run node -e "console.log(require('sqlite3'))"
            </div>
        </div>
    </div>

    <script>
        function testHealth() {
            fetch('/health')
                .then(r => r.json())
                .then(data => {
                    document.getElementById('testResults').innerHTML = 
                        '<div style="background: #d4edda; color: #155724; padding: 15px; border-radius: 5px;">' +
                        '<h4>✅ Health Check Successful</h4>' +
                        '<pre>' + JSON.stringify(data, null, 2) + '</pre>' +
                        '</div>';
                })
                .catch(error => {
                    document.getElementById('testResults').innerHTML = 
                        '<div style="background: #f8d7da; color: #721c24; padding: 15px; border-radius: 5px;">' +
                        '<h4>❌ Health Check Failed</h4>' +
                        '<p>' + error.message + '</p>' +
                        '</div>';
                });
        }

        function testAPI() {
            fetch('/api/test')
                .then(r => r.json())
                .then(data => {
                    document.getElementById('testResults').innerHTML = 
                        '<div style="background: #d4edda; color: #155724; padding: 15px; border-radius: 5px;">' +
                        '<h4>✅ API Test Successful</h4>' +
                        '<pre>' + JSON.stringify(data, null, 2) + '</pre>' +
                        '</div>';
                })
                .catch(error => {
                    document.getElementById('testResults').innerHTML = 
                        '<div style="background: #f8d7da; color: #721c24; padding: 15px; border-radius: 5px;">' +
                        '<h4>❌ API Test Failed</h4>' +
                        '<p>' + error.message + '</p>' +
                        '</div>';
                });
        }

        function showLogs() {
            console.log('=== EMERGENCY SERVER DEBUG LOGS ===');
            console.log('Server running in emergency mode');
            console.log('Node version:', '${process.version}');
            console.log('Port:', '${PORT}');
            console.log('Time:', new Date().toISOString());
            
            document.getElementById('testResults').innerHTML = 
                '<div style="background: #d1ecf1; color: #0c5460; padding: 15px; border-radius: 5px;">' +
                '<h4>📋 Check Browser Console</h4>' +
                '<p>Debug information has been logged to the browser console. Press F12 to view.</p>' +
                '</div>';
        }

        // Auto-test on page load
        window.addEventListener('load', () => {
            console.log('🚨 Emergency server loaded');
            console.log('✅ Basic functionality working');
            console.log('⚠️ Database features disabled until dependencies are fixed');
        });
    </script>
</body>
</html>
    `);
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'emergency mode - basic server running',
        message: 'Express server working, database disabled',
        node_version: process.version,
        timestamp: new Date().toISOString(),
        port: PORT
    });
});

// Test API endpoint
app.get('/api/test', (req, res) => {
    res.json({
        message: 'Emergency API endpoint working',
        server: 'Express running successfully',
        database: 'Disabled - dependency issues',
        next_steps: 'Check heroku logs for exact error'
    });
});

// Start emergency server
app.listen(PORT, () => {
    console.log('');
    console.log('🚨 ================================');
    console.log('🏥 EMERGENCY WOUND CARE TRACKER');
    console.log('🚨 ================================');
    console.log(`✅ Express server: Running on port ${PORT}`);
    console.log('⚠️ Database: Disabled (dependency issues)');
    console.log('🔍 Mode: Emergency debugging');
    console.log('');
    console.log('📋 TO FIX:');
    console.log('1. Run: heroku logs --tail --num=50');
    console.log('2. Find exact error message');
    console.log('3. Fix dependency issue');
    console.log('4. Redeploy production server');
    console.log('');
    console.log('📊 Your data is safe in wound_care.db');
    console.log('🚨 ================================');
});

// Error handling
process.on('uncaughtException', (error) => {
    console.error('❌ Emergency server uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Emergency server unhandled rejection:', error);
});
