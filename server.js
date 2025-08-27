const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Fix Content Security Policy to allow API calls
app.use((req, res, next) => {
    // Remove restrictive CSP that blocks API calls
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('X-Content-Security-Policy');
    res.removeHeader('X-WebKit-CSP');
    
    // Set permissive CSP for development
    res.setHeader('Content-Security-Policy', 
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; " +
        "connect-src 'self' https:; " +
        "img-src 'self' data: https:; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
        "style-src 'self' 'unsafe-inline'"
    );
    
    next();
});

app.use(express.static(path.join(__dirname)));

// In-memory data storage (temporary)
let facilities = [
    { id: 1, name: 'General Hospital' },
    { id: 2, name: 'Memorial Medical Center' },
    { id: 3, name: 'St. Mary\'s Hospital' }
];

let supplies = [
    { id: 1, code: 272, description: 'Med/Surgical Supplies', hcpcs: 'B4149', cost: 0.00, is_custom: 0 },
    { id: 2, code: 400, description: 'HME filter holder for trach or vent', hcpcs: 'A7507', cost: 3.49, is_custom: 0 },
    { id: 3, code: 401, description: 'HME housing & adhesive', hcpcs: 'A7509', cost: 1.97, is_custom: 0 },
    { id: 4, code: 402, description: 'HMES/trach valve adhesive disk', hcpcs: 'A7506', cost: 0.45, is_custom: 0 },
    { id: 5, code: 403, description: 'HMES filter holder or cap for tracheostoma', hcpcs: 'A7503', cost: 15.85, is_custom: 0 }
];

let patients = [
    { id: 1, name: 'John Doe', month: '2024-08', mrn: '12345', facility_id: 1, facility_name: 'General Hospital' },
    { id: 2, name: 'Jane Smith', month: '2024-08', mrn: '12346', facility_id: 2, facility_name: 'Memorial Medical Center' }
];

let tracking = [];

let users = [
    { 
        id: 1, 
        name: 'System Administrator', 
        email: 'admin@system.com', 
        role: 'admin', 
        is_approved: 1,
        facility_name: null
    }
];

// Simple auth token (no JWT for now)
const validTokens = new Set();

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Ultra-simple server running with in-memory data',
        timestamp: new Date().toISOString() 
    });
});

// Simple auth
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    
    console.log('Login attempt:', email);
    
    if (email === 'admin@system.com' && password === 'admin123') {
        const token = 'simple-token-' + Date.now();
        validTokens.add(token);
        
        res.json({
            success: true,
            token,
            user: {
                id: 1,
                name: 'System Administrator',
                email: 'admin@system.com',
                role: 'admin',
                facility_id: null,
                facility_name: null
            }
        });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

// Simple auth middleware
const auth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token || !validTokens.has(token)) {
        return res.status(401).json({ success: false, error: 'Invalid token' });
    }
    
    req.user = { id: 1, role: 'admin' }; // Simple user object
    next();
};

// API Routes
app.get('/api/facilities', (req, res) => {
    console.log('✅ Facilities requested');
    res.json({ success: true, facilities });
});

app.get('/api/supplies', auth, (req, res) => {
    console.log('✅ Supplies requested');
    res.json({ success: true, supplies });
});

app.get('/api/patients', auth, (req, res) => {
    console.log('✅ Patients requested');
    res.json({ success: true, patients });
});

app.get('/api/tracking', auth, (req, res) => {
    console.log('✅ Tracking requested');
    res.json({ success: true, tracking });
});

app.get('/api/admin/users', auth, (req, res) => {
    console.log('✅ Users requested');
    res.json({ success: true, users });
});

// POST routes (basic implementation)
app.post('/api/facilities', auth, (req, res) => {
    const { name } = req.body;
    const newFacility = { id: facilities.length + 1, name };
    facilities.push(newFacility);
    console.log('✅ Created facility:', name);
    res.json({ success: true, facility: newFacility });
});

app.post('/api/supplies', auth, (req, res) => {
    const { code, description, hcpcs, cost } = req.body;
    const newSupply = {
        id: supplies.length + 1,
        code: parseInt(code),
        description,
        hcpcs: hcpcs || '',
        cost: parseFloat(cost) || 0,
        is_custom: 1
    };
    supplies.push(newSupply);
    console.log('✅ Created supply:', code, description);
    res.json({ success: true, supply: newSupply });
});

app.post('/api/patients', auth, (req, res) => {
    const { name, month, mrn, facility_id } = req.body;
    const facility = facilities.find(f => f.id === parseInt(facility_id));
    const newPatient = {
        id: patients.length + 1,
        name,
        month,
        mrn: mrn || '',
        facility_id: parseInt(facility_id),
        facility_name: facility ? facility.name : 'Unknown'
    };
    patients.push(newPatient);
    console.log('✅ Created patient:', name);
    res.json({ success: true, patient: newPatient });
});

app.post('/api/admin/users', auth, (req, res) => {
    const { name, email, password, role, facility_id } = req.body;
    
    // Check if email exists
    if (users.find(u => u.email === email)) {
        return res.status(400).json({ success: false, error: 'Email already exists' });
    }
    
    const facility = facilities.find(f => f.id === parseInt(facility_id));
    const newUser = {
        id: users.length + 1,
        name,
        email,
        role: role || 'user',
        is_approved: 1,
        facility_name: facility ? facility.name : null
    };
    users.push(newUser);
    console.log('✅ Created user:', name, email);
    res.json({ success: true, user: newUser });
});

// Start server
app.listen(PORT, () => {
    console.log('');
    console.log('🎉 ================================');
    console.log('🏥 ULTRA-SIMPLE WOUND CARE TRACKER');
    console.log('🎉 ================================');
    console.log(`✅ Server running on port ${PORT}`);
    console.log('✅ Using in-memory data storage');
    console.log('✅ No database dependencies');
    console.log('');
    console.log('🔑 Login Credentials:');
    console.log('   📧 Email: admin@system.com');
    console.log('   🔐 Password: admin123');
    console.log('');
    console.log('📊 Available Data:');
    console.log(`   • ${facilities.length} facilities`);
    console.log(`   • ${supplies.length} supplies`);
    console.log(`   • ${patients.length} patients`);
    console.log('🎉 ================================');
});

// Error handling
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled Rejection:', error);
});
