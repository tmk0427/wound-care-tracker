require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Trust Heroku proxy
app.set('trust proxy', 1);

// Enhanced middleware for production
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
}));

app.use(compression());

// CORS configuration for production
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? true // Allow all origins for now
    : true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Temporarily disable rate limiting to fix Heroku issues
// TODO: Re-enable with proper Heroku configuration later
console.log('⚠️ Rate limiting temporarily disabled for Heroku compatibility');

// Multer configuration for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.includes('spreadsheet') || file.mimetype.includes('excel') || 
        file.originalname.endsWith('.xlsx') || file.originalname.endsWith('.xls')) {
      cb(null, true);
    } else {
      cb(new Error('Please upload only Excel files'), false);
    }
  }
});

// JWT Secret with validation
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET environment variable is required');
  process.exit(1);
}

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ status: 'ERROR', error: 'Database connection failed' });
  }
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
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

    // Check if user already exists
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Insert user
    const result = await pool.query(
      'INSERT INTO users (name, email, password, facility_id, role, is_approved) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [name, email, hashedPassword, facilityId || null, 'user', false]
    );

    res.status(201).json({ 
      message: 'Registration successful! Please wait for admin approval.',
      userId: result.rows[0].id 
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Get user with facility info
    const result = await pool.query(`
      SELECT u.*, f.name as facility_name 
      FROM users u 
      LEFT JOIN facilities f ON u.facility_id = f.id 
      WHERE u.email = $1
    `, [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];

    // Check if user is approved
    if (!user.is_approved) {
      return res.status(401).json({ error: 'Account pending approval. Please contact your administrator.' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Create token
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        role: user.role,
        facilityId: user.facility_id 
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Remove password from user object
    delete user.password;

    res.json({ token, user });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Change password
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new passwords are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long' });
    }

    // Get current user
    const userResult = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedNewPassword, req.user.id]);

    res.json({ message: 'Password changed successfully' });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Server error changing password' });
  }
});

// ==================== FACILITY ROUTES ====================

// Get all facilities (public)
app.get('/api/facilities/public', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM facilities ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Get facilities error:', error);
    res.status(500).json({ error: 'Server error fetching facilities' });
  }
});

// Get facilities (authenticated)
app.get('/api/facilities', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM facilities ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Get facilities error:', error);
    res.status(500).json({ error: 'Server error fetching facilities' });
  }
});

// Add facility (admin only)
app.post('/api/facilities', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Facility name is required' });
    }

    // Check if facility already exists
    const existing = await pool.query('SELECT id FROM facilities WHERE LOWER(name) = LOWER($1)', [name.trim()]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Facility with this name already exists' });
    }

    const result = await pool.query(
      'INSERT INTO facilities (name) VALUES ($1) RETURNING *',
      [name.trim()]
    );

    res.status(201).json(result.rows[0]);

  } catch (error) {
    console.error('Add facility error:', error);
    res.status(500).json({ error: 'Server error adding facility' });
  }
});

// Delete facility (admin only)
app.delete('/api/facilities/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const facilityId = parseInt(req.params.id);

    // Check if facility has patients
    const patientCheck = await pool.query('SELECT COUNT(*) FROM patients WHERE facility_id = $1', [facilityId]);
    if (parseInt(patientCheck.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Cannot delete facility with existing patients' });
    }

    const result = await pool.query('DELETE FROM facilities WHERE id = $1 RETURNING *', [facilityId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Facility not found' });
    }

    res.json({ message: 'Facility deleted successfully' });

  } catch (error) {
    console.error('Delete facility error:', error);
    res.status(500).json({ error: 'Server error deleting facility' });
  }
});

// ==================== SUPPLY ROUTES ====================

// Get all supplies
app.get('/api/supplies', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM supplies ORDER BY code');
    res.json(result.rows);
  } catch (error) {
    console.error('Get supplies error:', error);
    res.status(500).json({ error: 'Server error fetching supplies' });
  }
});

// Add supply (admin only)
app.post('/api/supplies', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { code, description, hcpcs, cost } = req.body;

    if (!code || !description) {
      return res.status(400).json({ error: 'AR Code and description are required' });
    }

    // Check if code already exists
    const existing = await pool.query('SELECT id FROM supplies WHERE code = $1', [code]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Supply with this AR Code already exists' });
    }

    const result = await pool.query(
      'INSERT INTO supplies (code, description, hcpcs, cost, is_custom) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [code, description, hcpcs || null, cost || 0, true]
    );

    res.status(201).json(result.rows[0]);

  } catch (error) {
    console.error('Add supply error:', error);
    res.status(500).json({ error: 'Server error adding supply' });
  }
});

// Update supply cost (admin only)
app.put('/api/supplies/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const supplyId = parseInt(req.params.id);
    const { cost } = req.body;

    const result = await pool.query(
      'UPDATE supplies SET cost = $1 WHERE id = $2 RETURNING *',
      [cost || 0, supplyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Supply not found' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Update supply error:', error);
    res.status(500).json({ error: 'Server error updating supply' });
  }
});

// Delete supply (admin only)
app.delete('/api/supplies/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const supplyId = parseInt(req.params.id);

    const result = await pool.query('DELETE FROM supplies WHERE id = $1 AND is_custom = true RETURNING *', [supplyId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Custom supply not found or cannot be deleted' });
    }

    res.json({ message: 'Supply deleted successfully' });

  } catch (error) {
    console.error('Delete supply error:', error);
    res.status(500).json({ error: 'Server error deleting supply' });
  }
});

// ==================== PATIENT ROUTES ====================

// Get patients
app.get('/api/patients', authenticateToken, async (req, res) => {
  try {
    let query = `
      SELECT p.*, f.name as facility_name 
      FROM patients p 
      LEFT JOIN facilities f ON p.facility_id = f.id
    `;
    let params = [];

    // If not admin, filter by user's facility
    if (req.user.role !== 'admin' && req.user.facilityId) {
      query += ' WHERE p.facility_id = $1';
      params.push(req.user.facilityId);
    }

    query += ' ORDER BY p.name';

    const result = await pool.query(query, params);
    res.json(result.rows);

  } catch (error) {
    console.error('Get patients error:', error);
    res.status(500).json({ error: 'Server error fetching patients' });
  }
});

// Add patient
app.post('/api/patients', authenticateToken, async (req, res) => {
  try {
    const { name, month, mrn, facilityId } = req.body;

    if (!name || !month || !facilityId) {
      return res.status(400).json({ error: 'Name, month, and facility are required' });
    }

    // Check if patient already exists for this month/facility
    const existing = await pool.query(
      'SELECT id FROM patients WHERE LOWER(name) = LOWER($1) AND month = $2 AND facility_id = $3',
      [name.trim(), month, facilityId]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Patient already exists for this month and facility' });
    }

    // Get facility name
    const facilityResult = await pool.query('SELECT name FROM facilities WHERE id = $1', [facilityId]);
    const facilityName = facilityResult.rows[0]?.name || 'Unknown';

    const result = await pool.query(
      'INSERT INTO patients (name, month, mrn, facility_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [name.trim(), month, mrn || null, facilityId]
    );

    const patient = { ...result.rows[0], facility_name: facilityName };
    res.status(201).json(patient);

  } catch (error) {
    console.error('Add patient error:', error);
    res.status(500).json({ error: 'Server error adding patient' });
  }
});

// Delete patient
app.delete('/api/patients/:id', authenticateToken, async (req, res) => {
  try {
    const patientId = parseInt(req.params.id);

    // Delete tracking data first
    await pool.query('DELETE FROM tracking WHERE patient_id = $1', [patientId]);

    // Delete patient
    const result = await pool.query('DELETE FROM patients WHERE id = $1 RETURNING *', [patientId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    res.json({ message: 'Patient and associated tracking data deleted successfully' });

  } catch (error) {
    console.error('Delete patient error:', error);
    res.status(500).json({ error: 'Server error deleting patient' });
  }
});

// Excel import
app.post('/api/patients/import-excel', authenticateToken, upload.single('excelFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No Excel file uploaded' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    if (data.length === 0) {
      return res.status(400).json({ error: 'Excel file is empty' });
    }

    const results = { success: [], errors: [] };
    
    // Get all facilities for lookup
    const facilities = await pool.query('SELECT id, name FROM facilities');
    const facilityMap = {};
    facilities.rows.forEach(f => {
      facilityMap[f.name.toLowerCase()] = f.id;
    });

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNum = i + 2; // Excel row number (header is row 1)

      try {
        const name = row.Name?.toString().trim();
        const month = row.Month?.toString().trim();
        const mrn = row.MRN?.toString().trim() || null;
        const facilityName = row.Facility?.toString().trim();

        if (!name || !month || !facilityName) {
          results.errors.push(`Row ${rowNum}: Missing required fields (Name, Month, Facility)`);
          continue;
        }

        // Find facility ID
        const facilityId = facilityMap[facilityName.toLowerCase()];
        if (!facilityId) {
          results.errors.push(`Row ${rowNum}: Facility "${facilityName}" not found`);
          continue;
        }

        // Check if patient already exists
        const existing = await pool.query(
          'SELECT id FROM patients WHERE LOWER(name) = LOWER($1) AND month = $2 AND facility_id = $3',
          [name, month, facilityId]
        );

        if (existing.rows.length > 0) {
          results.errors.push(`Row ${rowNum}: Patient "${name}" already exists for ${month}`);
          continue;
        }

        // Insert patient
        await pool.query(
          'INSERT INTO patients (name, month, mrn, facility_id) VALUES ($1, $2, $3, $4)',
          [name, month, mrn, facilityId]
        );

        results.success.push(`Row ${rowNum}: Added patient "${name}"`);

      } catch (error) {
        results.errors.push(`Row ${rowNum}: ${error.message}`);
      }
    }

    const message = `Import completed. ${results.success.length} patients added, ${results.errors.length} errors.`;
    
    res.json({ message, results });

  } catch (error) {
    console.error('Excel import error:', error);
    res.status(500).json({ error: 'Server error processing Excel file' });
  }
});

// ==================== TRACKING ROUTES ====================

// Get tracking data for patient
app.get('/api/patients/:id/tracking', authenticateToken, async (req, res) => {
  try {
    const patientId = parseInt(req.params.id);

    const result = await pool.query(`
      SELECT t.*, s.code, s.description, s.hcpcs, s.cost, s.is_custom
      FROM tracking t
      JOIN supplies s ON t.supply_id = s.id
      WHERE t.patient_id = $1
      ORDER BY s.code, t.day_of_month
    `, [patientId]);

    res.json(result.rows);

  } catch (error) {
    console.error('Get tracking error:', error);
    res.status(500).json({ error: 'Server error fetching tracking data' });
  }
});

// Update tracking data
app.post('/api/patients/:id/tracking', authenticateToken, async (req, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const { supplyId, dayOfMonth, quantity } = req.body;

    if (quantity > 0) {
      // Insert or update
      await pool.query(`
        INSERT INTO tracking (patient_id, supply_id, day_of_month, quantity)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (patient_id, supply_id, day_of_month)
        DO UPDATE SET quantity = $4, updated_at = CURRENT_TIMESTAMP
      `, [patientId, supplyId, dayOfMonth, quantity]);
    } else {
      // Delete if quantity is 0
      await pool.query(
        'DELETE FROM tracking WHERE patient_id = $1 AND supply_id = $2 AND day_of_month = $3',
        [patientId, supplyId, dayOfMonth]
      );
    }

    res.json({ success: true });

  } catch (error) {
    console.error('Update tracking error:', error);
    res.status(500).json({ error: 'Server error updating tracking data' });
  }
});

// Update wound diagnosis
app.post('/api/patients/:id/wound-dx', authenticateToken, async (req, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const { supplyId, woundDx } = req.body;

    // Update wound_dx for all tracking entries of this patient/supply
    await pool.query(
      'UPDATE tracking SET wound_dx = $1 WHERE patient_id = $2 AND supply_id = $3',
      [woundDx || null, patientId, supplyId]
    );

    res.json({ success: true });

  } catch (error) {
    console.error('Update wound dx error:', error);
    res.status(500).json({ error: 'Server error updating wound diagnosis' });
  }
});

// ==================== USER MANAGEMENT ROUTES ====================

// Get all users (admin only)
app.get('/api/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.role, u.facility_id, u.is_approved, u.created_at, f.name as facility_name
      FROM users u
      LEFT JOIN facilities f ON u.facility_id = f.id
      ORDER BY u.created_at DESC
    `);

    res.json(result.rows);

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Server error fetching users' });
  }
});

// Get pending users (admin only)
app.get('/api/users/pending', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.facility_id, u.created_at, f.name as facility_name
      FROM users u
      LEFT JOIN facilities f ON u.facility_id = f.id
      WHERE u.is_approved = false
      ORDER BY u.created_at ASC
    `);

    res.json(result.rows);

  } catch (error) {
    console.error('Get pending users error:', error);
    res.status(500).json({ error: 'Server error fetching pending users' });
  }
});

// Approve user (admin only)
app.post('/api/users/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    const result = await pool.query(
      'UPDATE users SET is_approved = true WHERE id = $1 RETURNING *',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User approved successfully' });

  } catch (error) {
    console.error('Approve user error:', error);
    res.status(500).json({ error: 'Server error approving user' });
  }
});

// Update user facility (admin only)
app.put('/api/users/:id/facility', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { facilityId } = req.body;

    const result = await pool.query(
      'UPDATE users SET facility_id = $1 WHERE id = $2 RETURNING *',
      [facilityId || null, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User facility updated successfully' });

  } catch (error) {
    console.error('Update user facility error:', error);
    res.status(500).json({ error: 'Server error updating user facility' });
  }
});

// Delete user (admin only)
app.delete('/api/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    // Prevent deletion of admin@system.com
    const userCheck = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length > 0 && userCheck.rows[0].email === 'admin@system.com') {
      return res.status(400).json({ error: 'Cannot delete system administrator account' });
    }

    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING *', [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted successfully' });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Server error deleting user' });
  }
});

// ==================== STATISTICS ROUTE ====================

app.get('/api/statistics', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [facilities, users, pendingUsers, patients, supplies] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM facilities'),
      pool.query('SELECT COUNT(*) FROM users WHERE is_approved = true'),
      pool.query('SELECT COUNT(*) FROM users WHERE is_approved = false'),
      pool.query('SELECT COUNT(*) FROM patients'),
      pool.query('SELECT COUNT(*) FROM supplies')
    ]);

    res.json({
      totalFacilities: parseInt(facilities.rows[0].count),
      totalUsers: parseInt(users.rows[0].count),
      pendingUsers: parseInt(pendingUsers.rows[0].count),
      totalPatients: parseInt(patients.rows[0].count),
      totalSupplies: parseInt(supplies.rows[0].count)
    });

  } catch (error) {
    console.error('Get statistics error:', error);
    res.status(500).json({ error: 'Server error fetching statistics' });
  }
});

// ==================== STATIC FILES ====================

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0',
  etag: true,
  lastModified: true
}));

// Catch all handler: send back index.html file for any non-API routes
app.get('*', (req, res) => {
  if (!req.url.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'API endpoint not found' });
  }
});

// Enhanced error handler
app.use((error, req, res, next) => {
  console.error('Global error handler:', error);
  
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
  }
  
  if (error.message.includes('Please upload only Excel files')) {
    return res.status(400).json({ error: 'Please upload only Excel files (.xlsx or .xls)' });
  }

  // Don't expose internal errors in production
  const message = process.env.NODE_ENV === 'production' 
    ? 'Something went wrong on the server'
    : error.message;

  res.status(500).json({ error: message });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  pool.end(() => {
    console.log('✅ Database pool closed');
    process.exit(0);
  });
});

// Initialize database and start server
async function startServer() {
  try {
    // Test database connection
    await pool.query('SELECT NOW()');
    console.log('✅ Database connected successfully');

    // Start server
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 App URL: ${process.env.NODE_ENV === 'production' ? 'https://terence-wound-care-tracker-0ee111d0e54a.herokuapp.com' : `http://localhost:${PORT}`}`);
      console.log('🔑 Default Login Credentials:');
      console.log('   Admin: admin@system.com / admin123');
      console.log('   User:  user@demo.com / user123');
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
