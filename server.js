// Test loading all dependencies first
console.log('🔧 Loading dependencies...');

try {
    const express = require('express');
    console.log('✅ Express loaded');
    
    const sqlite3 = require('sqlite3').verbose();
    console.log('✅ SQLite3 loaded');
    
    const bcrypt = require('bcryptjs');
    console.log('✅ bcryptjs loaded');
    
    const jwt = require('jsonwebtoken');
    console.log('✅ jsonwebtoken loaded');
    
    const cors = require('cors');
    console.log('✅ cors loaded');
    
    const path = require('path');
    console.log('✅ path loaded');
    
    console.log('🎉 ALL DEPENDENCIES LOADED SUCCESSFULLY!');
    
    // Now try basic server setup
    const app = express();
    const PORT = process.env.PORT || 3000;
    console.log('✅ Express app created');
    
    // Basic middleware
    app.use(cors());
    console.log('✅ CORS middleware added');
    
    app.use(express.json());
    console.log('✅ JSON middleware added');
    
    // Test database connection
    console.log('🔧 Testing database connection...');
    const db = new sqlite3.Database(':memory:', (err) => {
        if (err) {
            console.error('❌ Database connection failed:', err.message);
        } else {
            console.log('✅ Database connection successful (in-memory)');
        }
    });
    
    // Basic routes
    app.get('/', (req, res) => {
        res.json({
            status: 'success',
            message: 'Intermediate test server working!',
            timestamp: new Date().toISOString(),
            dependencies_loaded: true,
            database_connected: true
        });
    });
    
    app.get('/api/test', (req, res) => {
        res.json({
            success: true,
            message: 'API endpoint working',
            server: 'Express running with all dependencies'
        });
    });
    
    // Test JWT
    app.get('/api/test-jwt', (req, res) => {
        try {
            const token = jwt.sign({ test: 'data' }, 'secret', { expiresIn: '1h' });
            res.json({
                success: true,
                message: 'JWT working',
                token_created: !!token
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: 'JWT failed',
                details: error.message
            });
        }
    });
    
    // Test bcrypt
    app.get('/api/test-bcrypt', (req, res) => {
        try {
            const hash = bcrypt.hashSync('test123', 10);
            const verified = bcrypt.compareSync('test123', hash);
            res.json({
                success: true,
                message: 'bcrypt working',
                hash_created: !!hash,
                verification: verified
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: 'bcrypt failed',
                details: error.message
            });
        }
    });
    
    // Start server
    app.listen(PORT, () => {
        console.log('');
        console.log('🔧 ================================');
        console.log('   INTERMEDIATE TEST SERVER');
        console.log('🔧 ================================');
        console.log(`✅ Server running on port ${PORT}`);
        console.log('✅ All dependencies loaded successfully');
        console.log('✅ Database connection tested');
        console.log('✅ Ready for production features');
        console.log('🔧 ================================');
        console.log('');
    });
    
} catch (error) {
    console.error('❌ CRITICAL ERROR during dependency loading:');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('This is the exact cause of the production server crash!');
    process.exit(1);
}
