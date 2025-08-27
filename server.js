const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// Database initialization
const db = new sqlite3.Database('./wound_care.db', (err) => {
    if (err) {
        console.error('❌ Error opening database:', err);
    } else {
        console.log('✅ Connected to SQLite database');
        initializeDatabase();
    }
});

// Initialize database tables and data
async function initializeDatabase() {
    try {
        console.log('🔧 Initializing database tables...');

        // Create facilities table
        await runQuery(`
            CREATE TABLE IF NOT EXISTS facilities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create supplies table
        await runQuery(`
            CREATE TABLE IF NOT EXISTS supplies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code INTEGER NOT NULL UNIQUE,
                description TEXT NOT NULL,
                hcpcs TEXT,
                cost DECIMAL(10,2) DEFAULT 0.00,
                is_custom BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create users table
        await runQuery(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
                facility_id INTEGER,
                is_approved BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (facility_id) REFERENCES facilities (id)
            )
        `);

        // Create patients table
        await runQuery(`
            CREATE TABLE IF NOT EXISTS patients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                month TEXT NOT NULL,
                mrn TEXT,
                facility_id INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (facility_id) REFERENCES facilities (id)
            )
        `);

        // Create tracking_data table
        await runQuery(`
            CREATE TABLE IF NOT EXISTS tracking_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id INTEGER NOT NULL,
                supply_code INTEGER NOT NULL,
                day INTEGER NOT NULL,
                quantity INTEGER DEFAULT 0,
                month TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE,
                FOREIGN KEY (supply_code) REFERENCES supplies (code)
            )
        `);

        // Initialize default data
        await initializeDefaultData();
        
        console.log('🎉 Database initialization completed successfully!');
        
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        throw error;
    }
}

// Initialize default data
async function initializeDefaultData() {
    try {
        // Check and add default facilities
        const facilityCount = await getCount('facilities');
        if (facilityCount === 0) {
            console.log('📍 Adding default facilities...');
            const defaultFacilities = [
                'General Hospital',
                'Memorial Medical Center', 
                'St. Mary\'s Hospital',
                'University Medical Center',
                'Regional Health System'
            ];

            for (const facilityName of defaultFacilities) {
                await runQuery(
                    'INSERT INTO facilities (name) VALUES (?)',
                    [facilityName]
                );
            }
            console.log(`✅ Added ${defaultFacilities.length} default facilities`);
        }

        // Check and add all AR supplies
        const supplyCount = await getCount('supplies');
        if (supplyCount === 0) {
            console.log('📦 Adding complete AR supply list...');
            
            // Complete AR Code list from the document
            const arSupplies = [
                { code: 272, description: 'Med/Surgical Supplies', hcpcs: 'B4149', cost: 0.00 },
                { code: 400, description: 'HME filter holder for trach or vent', hcpcs: 'A7507', cost: 3.49 },
                { code: 401, description: 'HME housing & adhesive', hcpcs: 'A7509', cost: 1.97 },
                { code: 402, description: 'HMES/trach valve adhesive disk', hcpcs: 'A7506', cost: 0.45 },
                { code: 403, description: 'HMES filter holder or cap for tracheostoma', hcpcs: 'A7503', cost: 15.85 },
                { code: 404, description: 'HMES filter', hcpcs: 'A7504', cost: 0.95 },
                { code: 405, description: 'HMES/trach valve housing', hcpcs: 'A7505', cost: 6.55 },
                { code: 406, description: 'HME housing w/adhesive filter', hcpcs: 'A7508', cost: 4.01 },
                { code: 407, description: 'Lubricant per oz to insert trach', hcpcs: 'A4402', cost: 1.90 },
                { code: 408, description: 'Piston irrigation syringe irrigation trach ostomy, uro', hcpcs: 'A4322', cost: 4.16 },
                { code: 409, description: 'Sterile saline 10ml and 15ml bullets', hcpcs: 'A4216', cost: 0.62 },
                { code: 410, description: 'Sterile saline 100ml, 1000ml, 120ml, 250ml and 500ml', hcpcs: 'A4217', cost: 4.38 },
                { code: 411, description: 'Closed suction catheter for trach', hcpcs: 'A4605', cost: 22.92 },
                { code: 412, description: 'Open suction catheter for trach', hcpcs: 'A4624', cost: 3.69 },
                { code: 413, description: 'Tracheal suction catheter closed system (yankauers/ballards)', hcpcs: 'A4605', cost: 22.92 },
                { code: 414, description: 'Tracheostoma filter', hcpcs: 'A4481', cost: 0.50 },
                { code: 415, description: 'Tracheostomy inner cannula', hcpcs: 'A4623', cost: 8.74 },
                { code: 416, description: 'Trach kit new trach', hcpcs: 'A4625', cost: 9.68 },
                { code: 417, description: 'Trach mask', hcpcs: 'A7525', cost: 2.79 },
                { code: 418, description: 'Trach/laryn tube non-cuffed', hcpcs: 'A7520', cost: 66.33 },
                { code: 419, description: 'Tracheostoma stent/stud/button', hcpcs: 'A7524', cost: 108.17 },
                { code: 420, description: 'Trach ties', hcpcs: 'A7526', cost: 4.74 },
                { code: 421, description: 'Trach/laryn tube cuffed', hcpcs: 'A7521', cost: 65.73 },
                { code: 422, description: 'Trach/laryn tube plug/stop', hcpcs: 'A7527', cost: 5.00 },
                { code: 423, description: 'Trach kit established trach', hcpcs: 'A4629', cost: 6.58 },
                { code: 424, description: 'Tracheostomy speaking valve', hcpcs: 'L8501', cost: 175.90 },
                { code: 425, description: 'Yankauer oropharyngeal', hcpcs: 'A4628', cost: 5.23 },
                { code: 600, description: 'Sterile Gauze sponge 2x2 up to 4x4, EACH 2 in package', hcpcs: 'A6251', cost: 2.78 },
                { code: 601, description: 'Sterile gauze sponge greater than 4x4, each', hcpcs: 'A6252', cost: 4.55 },
                { code: 602, description: 'ABD dressing non bordered 16 sq inches', hcpcs: 'A6251', cost: 2.78 },
                { code: 603, description: 'ABD dressing non bordered greater than 48 sq inches', hcpcs: 'A6253', cost: 8.85 },
                { code: 604, description: 'ABD dressing non bordered 48 sq inches', hcpcs: 'A6252', cost: 4.55 },
                { code: 605, description: 'ABD dressing bordered up to 16 sq inches', hcpcs: 'A6254', cost: 1.67 },
                { code: 606, description: 'ABD dressing bordered 18 sq inches or greater', hcpcs: 'A6255', cost: 4.25 },
                { code: 607, description: 'Adhesive remover wipes', hcpcs: 'A4456', cost: 0.34 },
                { code: 608, description: 'Alginate/Fiber gelling sterile 4x4 each', hcpcs: 'A6196', cost: 10.28 },
                { code: 609, description: 'Alginate fiber gelling sterile dressing up to 6x6 each', hcpcs: 'A6197', cost: 22.98 },
                { code: 610, description: 'AMB antimicrobial drain sponges', hcpcs: 'A6222', cost: 2.98 },
                { code: 611, description: 'Any tape each 18" (framed 4x4) or steri strips', hcpcs: 'A4452', cost: 0.53 },
                { code: 612, description: 'Irrigation tubing set for continuous bladder irrigation tubing used with 3 way indwelling foley cath', hcpcs: 'A4355', cost: 12.46 },
                { code: 613, description: 'Border gauze island dressing medium 6x6 incision & 4x10 each', hcpcs: 'A6220', cost: 3.62 },
                { code: 614, description: 'Border gauze island dressing small 2x2, 3x3, 4x4 each', hcpcs: 'A6219', cost: 1.33 },
                { code: 615, description: 'calcium alginate rope per 6"', hcpcs: 'A6199', cost: 7.37 },
                { code: 616, description: 'cath foley 2 way all', hcpcs: 'A4344', cost: 19.01 },
                { code: 617, description: 'Cah foley 3 way cont\' irrigation', hcpcs: 'A4346', cost: 23.26 },
                { code: 618, description: 'Intermittent urinary cath with insertion supplies', hcpcs: 'A4353', cost: 9.77 },
                { code: 619, description: 'Cath insert tray w/drain bag', hcpcs: 'A4354', cost: 16.50 },
                { code: 620, description: 'Cath insert tray without drain bag', hcpcs: 'A4310', cost: 10.79 },
                { code: 621, description: 'Coflex compression bandage second layer per yard', hcpcs: 'A6452', cost: 8.24 },
                { code: 622, description: 'Coflex zinc impregnated bandage per yard', hcpcs: 'A6456', cost: 1.75 },
                { code: 623, description: 'Collagen dressing 16 inches', hcpcs: 'A6021', cost: 29.38 },
                { code: 624, description: 'Collagen dressing more than 48 inches', hcpcs: 'A6023', cost: 265.90 },
                { code: 625, description: 'Collagen gel or paste per gm', hcpcs: 'A6011', cost: 3.19 },
                { code: 626, description: 'Collagen powder per 1 gm', hcpcs: 'A6010', cost: 43.27 },
                { code: 627, description: 'Colostomy bag closed no barrier', hcpcs: 'A5052', cost: 2.08 },
                { code: 628, description: 'Composite bordered 16 sq inches or less (2x2, 4x4) each', hcpcs: 'A6203', cost: 4.71 },
                { code: 629, description: 'Composite dressing greater than 16 sq inches (6x6)', hcpcs: 'A6204', cost: 8.69 },
                { code: 630, description: 'Compression bandage 3" width per yard', hcpcs: 'A6448', cost: 1.61 },
                { code: 631, description: 'Condom catheter', hcpcs: 'A4326', cost: 15.07 },
                { code: 632, description: 'Drain bag', hcpcs: 'A4358', cost: 9.07 },
                { code: 633, description: 'Drain bag bedside', hcpcs: 'A4357', cost: 11.53 },
                { code: 634, description: 'Foam non bordered dressing medium 6x6, each Mepilex, Allevyn, xeroform', hcpcs: 'A6210', cost: 27.84 },
                { code: 635, description: 'Foam non bordered large dressing more than 48 sq inches large Mepilex, Allevyn, Xeroform, Optifoam', hcpcs: 'A6211', cost: 41.04 },
                { code: 636, description: 'Gauze stretch per yard>3"<5" Kerlix', hcpcs: 'A6449', cost: 2.45 },
                { code: 637, description: 'Gradient wrap (Circaid/Sigvaris) each', hcpcs: 'A6545', cost: 119.03 },
                { code: 638, description: 'High compression bandage per yard', hcpcs: 'A6452', cost: 8.24 },
                { code: 639, description: 'Honey gel per oz', hcpcs: 'A6248', cost: 22.70 },
                { code: 640, description: 'Hydrocolloid dressing pad 16 sq inches non bordered', hcpcs: 'A6234', cost: 9.15 },
                { code: 641, description: 'Hydrocolloid dressing large 6x6 non bordered', hcpcs: 'A6235', cost: 23.50 },
                { code: 642, description: 'Hydrocolloid bordered dressing 6x6 each', hcpcs: 'A6238', cost: 31.86 },
                { code: 643, description: 'Hydrocolloid bordered dressing 4x4 each', hcpcs: 'A6237', cost: 11.05 },
                { code: 644, description: 'Hydrogel dressing pad 4x4 each', hcpcs: 'A6242', cost: 8.46 },
                { code: 645, description: 'Hydrofiber rope per 6"', hcpcs: 'A6199', cost: 7.37 },
                { code: 646, description: 'Hydrogel per oz', hcpcs: 'A6248', cost: 22.70 },
                { code: 647, description: 'Hydrogel dressing greater than 4x4', hcpcs: 'A6243', cost: 17.22 },
                { code: 648, description: 'Saline impregnated gauze sponge >16 sq inches', hcpcs: 'A6252', cost: 4.55 },
                { code: 649, description: 'I0doform packing strip per yard', hcpcs: 'A6266', cost: 2.67 },
                { code: 650, description: 'Iodosorb gel (antimicrobial) per oz', hcpcs: 'A6248', cost: 22.70 },
                { code: 651, description: 'Irrigation syringe/bulb/piston', hcpcs: 'A4322', cost: 4.16 },
                { code: 652, description: 'Irrigation tray any purpose', hcpcs: 'A4320', cost: 6.59 },
                { code: 653, description: 'Kerlex roll gauze 3" to 5" per yard 4.1 yrd roll = 4 units', hcpcs: 'A6449', cost: 2.45 },
                { code: 654, description: 'Light compression elastic, woven bandage 3 to 5" w(ACE) per yard', hcpcs: 'A6449', cost: 2.45 },
                { code: 655, description: 'Male cath any type', hcpcs: 'A4326', cost: 15.07 },
                { code: 656, description: 'Manuka honey 4x4 each', hcpcs: 'A6242', cost: 8.46 },
                { code: 657, description: 'Negative pressure wound therapy dressing set', hcpcs: 'A6550', cost: 30.52 },
                { code: 658, description: 'Ostomy adhesive per oz', hcpcs: 'A4364', cost: 3.49 },
                { code: 659, description: 'Ostomy belt', hcpcs: 'A4367', cost: 10.28 },
                { code: 660, description: 'Ostomy face plate', hcpcs: 'A4361', cost: 22.55 },
                { code: 661, description: 'Ostomy pouch w/faceplate', hcpcs: 'A4375', cost: 23.99 },
                { code: 662, description: 'Ostomy skin barrier powder per oz', hcpcs: 'A4371', cost: 5.10 },
                { code: 663, description: 'Ostomy skin barrier solid', hcpcs: 'A4362', cost: 4.12 },
                { code: 664, description: 'Ostomy skin barrier w/flange', hcpcs: 'A4373', cost: 8.76 },
                { code: 665, description: 'Padding bandage per yard use with coflex', hcpcs: 'A6441', cost: 0.95 },
                { code: 666, description: 'Perianal fecal collection pouch', hcpcs: 'A4330', cost: 10.01 },
                { code: 667, description: 'Petrolatum dressing 5x9 xeroform', hcpcs: 'A6223', cost: 3.39 },
                { code: 668, description: 'Petro impregnated gauze sponge 4x4', hcpcs: 'A6222', cost: 2.98 },
                { code: 669, description: 'Piston irrigation syringe', hcpcs: 'A4322', cost: 4.16 },
                { code: 670, description: 'Plain 4x4 alginate gelling dressing each', hcpcs: 'A6196', cost: 10.28 },
                { code: 671, description: 'Puracol dressing 4x4', hcpcs: 'A6203', cost: 4.71 },
                { code: 672, description: 'Sterile saline 10ml and 15ml bullets', hcpcs: 'A4216', cost: 0.62 },
                { code: 673, description: 'Sterile saline 100ml, 120ml, 250ml, 500ml and 1000ml', hcpcs: 'A4217', cost: 4.38 },
                { code: 674, description: 'Silver 4x4 alginate gelling dressing each', hcpcs: 'A6196', cost: 10.28 },
                { code: 675, description: 'Skin prep wipe each', hcpcs: 'A5120', cost: 0.34 },
                { code: 676, description: 'Split gauze each 2 per package', hcpcs: 'A6251', cost: 2.78 },
                { code: 677, description: 'Steri strips per 18 inches', hcpcs: 'A4452', cost: 0.53 },
                { code: 678, description: 'Super absorbent sterile dressing', hcpcs: 'A6251', cost: 2.78 },
                { code: 679, description: 'Transparent film Tegaderm/opsite 16" or less', hcpcs: 'A6257', cost: 2.14 },
                { code: 680, description: 'Tegaderm opsite composite film 48"', hcpcs: 'A6204', cost: 8.69 },
                { code: 681, description: 'Tubular dressing non elastic any width per yard', hcpcs: 'A6457', cost: 1.59 },
                { code: 682, description: 'Wound drain collector pouch', hcpcs: 'A6154', cost: 20.09 },
                { code: 683, description: 'Xero/Optifoam/Mepilex 48"', hcpcs: 'A6211', cost: 41.04 },
                { code: 684, description: 'Mesalt cleansing dressing with 20% sodium chloride 1.1 yr', hcpcs: 'A6266', cost: 2.67 },
                { code: 685, description: 'Plurogel burn and wound dressing per oz', hcpcs: 'A4649', cost: 22.70 },
                { code: 686, description: 'Sorbex wound dressing 6x9 more than 48 sq in non adherent pansement', hcpcs: 'A6253', cost: 8.85 },
                { code: 687, description: 'Coban 3" wide per yard', hcpcs: 'A6452', cost: 8.24 },
                { code: 688, description: 'Black granufoam more than 48 sq inches', hcpcs: 'A6211', cost: 41.04 },
                { code: 689, description: 'Hydrofera Blue 4x4 or less', hcpcs: 'A6209', cost: 10.20 },
                { code: 690, description: 'Hydrofera Blue greater than 48 sq inches 6x6 8x8', hcpcs: 'A6211', cost: 41.04 },
                { code: 691, description: 'oil emulsion impregnated gauze', hcpcs: 'A6222', cost: 2.98 },
                { code: 692, description: 'Optiview transparent dressing', hcpcs: 'A6259', cost: 15.28 },
                { code: 706, description: 'silicone foam border dressing 2x2,4x4,6x6', hcpcs: 'A6132', cost: 13.57 },
                { code: 707, description: 'Silicone foam border dressing 6x6 or greater', hcpcs: 'A6214', cost: 14.39 },
                { code: 708, description: 'Calcium alginate dressing 2x2,4x4', hcpcs: 'A6196', cost: 10.28 },
                { code: 709, description: 'Calcium alginate dressing 6x6', hcpcs: 'A6197', cost: 22.98 }
            ];

            for (const supply of arSupplies) {
                await runQuery(
                    'INSERT INTO supplies (code, description, hcpcs, cost, is_custom) VALUES (?, ?, ?, ?, ?)',
                    [supply.code, supply.description, supply.hcpcs, supply.cost, 0]
                );
            }
            console.log(`✅ Added ${arSupplies.length} AR supplies (codes 272, 400-425, 600-709)`);
        }

        // Check and add default admin user
        const adminCount = await getCount('users', 'WHERE role = "admin"');
        if (adminCount === 0) {
            console.log('👤 Creating default admin user...');
            const hashedPassword = await bcrypt.hash('admin123', 10);
            
            await runQuery(
                'INSERT INTO users (name, email, password, role, is_approved) VALUES (?, ?, ?, ?, ?)',
                ['System Administrator', 'admin@system.com', hashedPassword, 'admin', 1]
            );
            console.log('✅ Default admin user created');
        }

        console.log('📊 Default data initialization completed!');
        
    } catch (error) {
        console.error('❌ Failed to initialize default data:', error);
        throw error;
    }
}

// Database helper functions
function runQuery(query, params = []) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function(err) {
            if (err) reject(err);
            else resolve({ id: this.lastID, changes: this.changes });
        });
    });
}

function getQuery(query, params = []) {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function getAllQuery(query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function getCount(table, whereClause = '') {
    const query = `SELECT COUNT(*) as count FROM ${table} ${whereClause}`;
    const result = await getQuery(query);
    return result.count;
}

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Admin middleware
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// ===== ROUTES =====

// Serve main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ===== AUTH ROUTES =====

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await getQuery(
            'SELECT u.*, f.name as facility_name FROM users u LEFT JOIN facilities f ON u.facility_id = f.id WHERE u.email = ?',
            [email]
        );

        if (!user || !await bcrypt.compare(password, user.password)) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        if (!user.is_approved) {
            return res.status(403).json({ success: false, message: 'Account pending approval' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                facility_id: user.facility_id,
                facility_name: user.facility_name
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password, facility_id } = req.body;
        
        const existingUser = await getQuery('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Email already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await runQuery(
            'INSERT INTO users (name, email, password, facility_id) VALUES (?, ?, ?, ?)',
            [name, email, hashedPassword, facility_id]
        );

        res.json({ success: true, message: 'Registration successful. Awaiting admin approval.' });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ===== FACILITY ROUTES =====

app.get('/api/facilities', async (req, res) => {
    try {
        const facilities = await getAllQuery('SELECT * FROM facilities ORDER BY name ASC');
        res.json({ success: true, facilities });
    } catch (error) {
        console.error('Error fetching facilities:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch facilities' });
    }
});

app.post('/api/facilities', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        
        if (!name) {
            return res.status(400).json({ success: false, error: 'Facility name is required' });
        }

        const result = await runQuery(
            'INSERT INTO facilities (name) VALUES (?)',
            [name]
        );

        res.json({ success: true, facility: { id: result.id, name } });

    } catch (error) {
        console.error('Error creating facility:', error);
        res.status(500).json({ success: false, error: 'Failed to create facility' });
    }
});

// ===== SUPPLY ROUTES =====

app.get('/api/supplies', authenticateToken, async (req, res) => {
    try {
        const supplies = await getAllQuery('SELECT * FROM supplies ORDER BY code ASC');
        res.json({ success: true, supplies });
    } catch (error) {
        console.error('Error fetching supplies:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch supplies' });
    }
});

app.post('/api/supplies', authenticateToken, async (req, res) => {
    try {
        const { code, description, hcpcs, cost } = req.body;
        
        if (!code || !description) {
            return res.status(400).json({ success: false, error: 'Code and description are required' });
        }

        const result = await runQuery(
            'INSERT INTO supplies (code, description, hcpcs, cost, is_custom) VALUES (?, ?, ?, ?, ?)',
            [code, description, hcpcs || '', parseFloat(cost) || 0, 1]
        );

        res.json({ success: true, supply: { id: result.id, code, description, hcpcs, cost } });

    } catch (error) {
        console.error('Error creating supply:', error);
        res.status(500).json({ success: false, error: 'Failed to create supply' });
    }
});

// ===== PATIENT ROUTES =====

app.get('/api/patients', authenticateToken, async (req, res) => {
    try {
        const { facility_id, month } = req.query;
        
        let query = `
            SELECT p.*, f.name as facility_name 
            FROM patients p 
            LEFT JOIN facilities f ON p.facility_id = f.id
        `;
        let params = [];
        let conditions = [];

        if (facility_id) {
            conditions.push('p.facility_id = ?');
            params.push(facility_id);
        }

        if (month) {
            conditions.push('p.month = ?');
            params.push(month);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY p.name ASC';

        const patients = await getAllQuery(query, params);
        res.json({ success: true, patients });

    } catch (error) {
        console.error('Error fetching patients:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch patients' });
    }
});

app.post('/api/patients', authenticateToken, async (req, res) => {
    try {
        const { name, month, mrn, facility_id } = req.body;
        
        if (!name || !month || !facility_id) {
            return res.status(400).json({ success: false, error: 'Name, month, and facility are required' });
        }

        const result = await runQuery(
            'INSERT INTO patients (name, month, mrn, facility_id) VALUES (?, ?, ?, ?)',
            [name, month, mrn || '', facility_id]
        );

        res.json({ success: true, patient: { id: result.id, name, month, mrn, facility_id } });

    } catch (error) {
        console.error('Error creating patient:', error);
        res.status(500).json({ success: false, error: 'Failed to create patient' });
    }
});

// ===== TRACKING ROUTES =====

app.get('/api/tracking/:patientId/:month', authenticateToken, async (req, res) => {
    try {
        const { patientId, month } = req.params;
        
        const tracking = await getAllQuery(`
            SELECT t.*, s.description as supply_description, s.cost as supply_cost
            FROM tracking_data t
            LEFT JOIN supplies s ON t.supply_code = s.code
            WHERE t.patient_id = ? AND t.month = ?
            ORDER BY t.supply_code ASC, t.day ASC
        `, [patientId, month]);

        res.json({ success: true, tracking });

    } catch (error) {
        console.error('Error fetching tracking data:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch tracking data' });
    }
});

app.get('/api/tracking', authenticateToken, async (req, res) => {
    try {
        const { facility_id, month } = req.query;
        
        let query = `
            SELECT t.*, p.name as patient_name, p.facility_id, f.name as facility_name,
                   s.description as supply_description, s.cost as supply_cost
            FROM tracking_data t
            LEFT JOIN patients p ON t.patient_id = p.id
            LEFT JOIN facilities f ON p.facility_id = f.id
            LEFT JOIN supplies s ON t.supply_code = s.code
        `;
        let params = [];
        let conditions = [];

        if (facility_id) {
            conditions.push('p.facility_id = ?');
            params.push(facility_id);
        }

        if (month) {
            conditions.push('t.month = ?');
            params.push(month);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY f.name ASC, p.name ASC, t.supply_code ASC, t.day ASC';

        const tracking = await getAllQuery(query, params);
        res.json({ success: true, tracking });

    } catch (error) {
        console.error('Error fetching tracking data:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch tracking data' });
    }
});

app.post('/api/tracking', authenticateToken, async (req, res) => {
    try {
        const { patient_id, supply_code, day, quantity, month } = req.body;
        
        if (!patient_id || !supply_code || !day || !month) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        // Upsert tracking data
        const existingRecord = await getQuery(
            'SELECT id FROM tracking_data WHERE patient_id = ? AND supply_code = ? AND day = ? AND month = ?',
            [patient_id, supply_code, day, month]
        );

        if (existingRecord) {
            await runQuery(
                'UPDATE tracking_data SET quantity = ? WHERE id = ?',
                [quantity, existingRecord.id]
            );
        } else {
            await runQuery(
                'INSERT INTO tracking_data (patient_id, supply_code, day, quantity, month) VALUES (?, ?, ?, ?, ?)',
                [patient_id, supply_code, day, quantity, month]
            );
        }

        res.json({ success: true });

    } catch (error) {
        console.error('Error saving tracking data:', error);
        res.status(500).json({ success: false, error: 'Failed to save tracking data' });
    }
});

// ===== ADMIN ROUTES =====

app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const users = await getAllQuery(`
            SELECT u.*, f.name as facility_name 
            FROM users u 
            LEFT JOIN facilities f ON u.facility_id = f.id 
            ORDER BY u.name ASC
        `);
        res.json({ success: true, users });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch users' });
    }
});

app.post('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name, email, password, role, facility_id } = req.body;
        
        if (!name || !email || !password) {
            return res.status(400).json({ success: false, error: 'Name, email, and password are required' });
        }

        const existingUser = await getQuery('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser) {
            return res.status(400).json({ success: false, error: 'Email already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await runQuery(
            'INSERT INTO users (name, email, password, role, facility_id, is_approved) VALUES (?, ?, ?, ?, ?, ?)',
            [name, email, hashedPassword, role || 'user', facility_id || null, 1]
        );

        res.json({ success: true, user: { id: result.id, name, email, role: role || 'user' } });

    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ success: false, error: 'Failed to create user' });
    }
});

app.put('/api/admin/users/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        await runQuery('UPDATE users SET is_approved = ? WHERE id = ?', [1, id]);
        res.json({ success: true });

    } catch (error) {
        console.error('Error approving user:', error);
        res.status(500).json({ success: false, error: 'Failed to approve user' });
    }
});

app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (parseInt(id) === req.user.id) {
            return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
        }
        
        await runQuery('DELETE FROM users WHERE id = ?', [id]);
        res.json({ success: true });

    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ success: false, error: 'Failed to delete user' });
    }
});

// ===== SERVER STARTUP =====

async function startServer() {
    try {
        app.listen(PORT, () => {
            console.log('');
            console.log('🎉 ================================');
            console.log('🏥 Wound Care RT Supply Tracker');
            console.log('🎉 ================================');
            console.log(`🌐 Server running on port ${PORT}`);
            console.log(`📱 Access your app at: http://localhost:${PORT}`);
            console.log('');
            console.log('📊 Complete AR Supply Database Loaded:');
            console.log('   • 272: Med/Surgical Supplies');
            console.log('   • 400-425: Respiratory/Trach Supplies');
            console.log('   • 600-709: Wound Care & Medical Supplies');
            console.log('');
            console.log('🔑 Default Login Credentials:');
            console.log('   📧 Email: admin@system.com');
            console.log('   🔐 Password: admin123');
            console.log('🎉 ================================');
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
