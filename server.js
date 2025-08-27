const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

console.log('🔧 Starting minimal debug server...');

app.use(express.json());

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Debug Server</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
        .container { background: white; padding: 30px; border-radius: 8px; max-width: 600px; }
        .status { background: #d4edda; padding: 15px; border-radius: 4px; margin: 10px 0; }
        .error { background: #f8d7da; padding: 15px; border-radius: 4px; margin: 10px 0; }
        .info { background: #d1ecf1; padding: 15px; border-radius: 4px; margin: 10px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔧 Debug Server Status</h1>
        
        <div class="status">
            ✅ <strong>Express Server:</strong> Running successfully
        </div>
        
        <div class="info">
            <strong>Node Version:</strong> ${process.version}<br>
            <strong>Port:</strong> ${PORT}<br>
            <strong>Environment:</strong> ${process.env.NODE_ENV || 'development'}<br>
            <strong>Time:</strong> ${new Date().toISOString()}
        </div>
        
        <h3>🧪 Dependency Tests</h3>
        <div id="depTests">
            <p>Testing required dependencies...</p>
        </div>
        
        <h3>📋 Next Steps</h3>
        <ol>
            <li>If this loads successfully, the basic server works</li>
            <li>Check dependency test results below</li>
            <li>Run: <code>heroku logs --num=100</code> for full error details</li>
        </ol>
    </div>
    
    <script>
        const depTests = document.getElementById('depTests');
        let results = [];
        
        // Test each dependency
        const deps = ['express', 'sqlite3', 'bcryptjs', 'jsonwebtoken', 'cors'];
        
        deps.forEach(dep => {
            try {
                // This won't actually work in browser, but shows the concept
                results.push(\`✅ \${dep}: Available\`);
            } catch (error) {
                results.push(\`❌ \${dep}: Missing - \${error.message}\`);
            }
        });
        
        depTests.innerHTML = \`
            <div class="info">
                <p><strong>Note:</strong> Dependency tests run on server side. Check server logs for actual results.</p>
            </div>
        \`;
    </script>
</body>
</html>
    `);
});

app.get('/api/test-deps', (req, res) => {
    const results = {};
    const deps = ['express', 'sqlite3', 'bcryptjs', 'jsonwebtoken', 'cors'];
    
    deps.forEach(dep => {
        try {
            require(dep);
            results[dep] = '✅ Available';
        } catch (error) {
            results[dep] = `❌ Missing: ${error.message}`;
        }
    });
    
    res.json({ success: true, dependencies: results });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Debug server running',
        node_version: process.version,
        timestamp: new Date().toISOString()
    });
});

console.log('🔧 Testing dependencies...');

// Test dependencies at startup
const deps = ['express', 'sqlite3', 'bcryptjs', 'jsonwebtoken', 'cors'];
deps.forEach(dep => {
    try {
        require(dep);
        console.log(`✅ ${dep}: Available`);
    } catch (error) {
        console.log(`❌ ${dep}: Missing - ${error.message}`);
    }
});

app.listen(PORT, () => {
    console.log('');
    console.log('🔧 ================================');
    console.log('   DEBUG SERVER RUNNING');
    console.log('🔧 ================================');
    console.log(`✅ Server: http://localhost:${PORT}`);
    console.log('✅ Health: /health');
    console.log('✅ Deps Test: /api/test-deps');
    console.log('🔧 ================================');
    console.log('');
});

process.on('uncaughtException', (error) => {
    console.error('❌ UNCAUGHT EXCEPTION:', error);
    console.error('Stack:', error.stack);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ UNHANDLED REJECTION:', error);
    console.error('Stack:', error?.stack);
});
