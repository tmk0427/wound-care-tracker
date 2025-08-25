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
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// Database initialization
const db = new sqlite3.Database('./wound_care.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database tables
function initializeDatabase() {
  const tables = [
    // Facilities table
    `CREATE TABLE IF NOT EXISTS facilities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    
    // Users table
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user' CHECK(role IN ('user', 'admin')),
      facility_id INTEGER,
      is_approved BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (facility_id) REFERENCES facilities (id)
    )`,
    
    // Supplies table
    `CREATE TABLE IF NOT EXISTS supplies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code INTEGER NOT NULL UNIQUE,
      description TEXT NOT NULL,
      hcpcs TEXT,
      cost DECIMAL(10,2) DEFAULT 0,
      is_custom BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    
    // Patients table
    `CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      mrn TEXT,
      month TEXT NOT NULL,
      facility_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (facility_id) REFERENCES facilities (id),
      UNIQUE(name, month, facility_id)
    )`,
    
    // Supply tracking table
    `CREATE TABLE IF NOT EXISTS supply_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      supply_id INTEGER NOT NULL,
      day_of_month INTEGER NOT NULL CHECK(day_of_month >= 1 AND day_of_month <= 31),
      quantity INTEGER DEFAULT 0,
      wound_dx TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE,
      FOREIGN KEY (supply_id) REFERENCES supplies (id),
      UNIQUE(patient_id, supply_id, day_of_month)
    )`
  ];

  tables.forEach((table, index) => {
    db.run(table, (err) => {
      if (err) {
        console.error(`Error creating table ${index + 1}:`, err);
      }
    });
  });

  // Insert default data
  setTimeout(() => {
    insertDefaultData();
  }, 1000);
}

// Insert default facilities, admin user, and supplies
function insertDefaultData() {
  // Default facilities
  const facilities = [
    'General Hospital',
    'City Medical Center', 
    'Regional Health Center',
    'Community Hospital',
    'University Medical Center'
  ];

  facilities.forEach(facility => {
    db.run('INSERT OR IGNORE INTO facilities (name) VALUES (?)', [facility], (err) => {
      if (err && !err.message.includes('UNIQUE constraint failed')) {
        console.error('Error inserting facility:', err);
      }
    });
  });

  // Create default admin user
  bcrypt.hash('admin123', 10, (err, hash) => {
    if (err) {
      console.error('Error hashing password:', err);
      return;
    }
    
    db.run(
      'INSERT OR IGNORE INTO users (name, email, password, role, is_approved) VALUES (?, ?, ?, ?, ?)',
      ['Admin User', 'admin@woundcare.com', hash, 'admin', 1],
      (err) => {
        if (err && !err.message.includes('UNIQUE constraint failed')) {
          console.error('Error creating admin user:', err);
        } else if (!err) {
          console.log('Default admin user created - Email: admin@woundcare.com, Password: admin123');
        }
      }
    );
  });

  // Default supplies
  const supplies = [
    { code: 1001, description: 'Hydrocolloid Dressing 4x4', hcpcs: 'A6234', cost: 15.50 },
    { code: 1002, description: 'Alginate Dressing 2x2', hcpcs: 'A6196', cost: 8.75 },
    { code: 1003, description: 'Foam Dressing 6x6', hcpcs: 'A6209', cost: 22.30 },
    { code: 1004, description: 'Silver Antimicrobial Dressing', hcpcs: 'A6212', cost: 35.00 },
    { code: 1005, description: 'Transparent Film Dressing', hcpcs: 'A6257', cost: 5.25 },
    { code: 1006, description: 'Wound Cleanser 8oz', hcpcs: 'A6260', cost: 12.00 },
    { code: 1007, description: 'Medical Tape 1 inch', hcpcs: '', cost: 3.50 },
    { code: 1008, description: 'Gauze Pads 4x4 Sterile', hcpcs: 'A6402', cost: 0.75 },
    { code: 1009, description: 'Compression Bandage 3 inch', hcpcs: 'A6448', cost: 4.25 },
    { code: 1010, description: 'Wound Gel 1oz', hcpcs: 'A6248', cost: 18.90 }
  ];

  supplies.forEach(supply => {
    db.run(
      'INSERT OR IGNORE INTO supplies (code, description, hcpcs, cost, is_custom) VALUES (?, ?, ?, ?, ?)',
      [supply.code, supply.description, supply.hcpcs, supply.cost, 0],
      (err) => {
        if (err && !err.message.includes('UNIQUE constraint failed')) {
          console.error('Error inserting supply:', err);
        }
      }
    );
  });
}

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token.' });
    }
    req.user = user;
    next();
  });
};

// Admin middleware
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
};

// Routes

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, facilityId } = req.body;

    if (!name || !email || !password || !facilityId) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    db.run(
      'INSERT INTO users (name, email, password, facility_id, is_approved) VALUES (?, ?, ?, ?, ?)',
      [name, email, hashedPassword, facilityId, 0],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Email already exists' });
          }
          return res.status(500).json({ error: 'Registration failed' });
        }
        res.json({ message: 'Registration successful. Please wait for admin approval.' });
      }
    );
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    db.get(
      `SELECT u.*, f.name as facility_name 
       FROM users u 
       LEFT JOIN facilities f ON u.facility_id = f.id 
       WHERE u.email = ?`,
      [email],
      async (err, user) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        if (!user || !(await bcrypt.compare(password, user.password))) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }

        if (!user.is_approved) {
          return res.status(401).json({ error: 'Account not approved. Please contact an administrator.' });
        }

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

        const userResponse = {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          facilityId: user.facility_id,
          facilityName: user.facility_name
        };

        res.json({ token, user: userResponse });
      }
    );
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/auth/verify', authenticateToken, (req, res) => {
  db.get(
    `SELECT u.*, f.name as facility_name 
     FROM users u 
     LEFT JOIN facilities f ON u.facility_id = f.id 
     WHERE u.id = ?`,
    [req.user.id],
    (err, user) => {
      if (err || !user) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      const userResponse = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        facilityId: user.facility_id,
        facilityName: user.facility_name
      };

      res.json({ user: userResponse });
    }
  );
});

// Facilities routes
app.get('/api/facilities/public', (req, res) => {
  db.all('SELECT id, name FROM facilities ORDER BY name', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

app.get('/api/facilities', authenticateToken, (req, res) => {
  db.all('SELECT * FROM facilities ORDER BY name', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

app.post('/api/facilities', authenticateToken, requireAdmin, (req, res) => {
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Facility name is required' });
  }

  db.run('INSERT INTO facilities (name) VALUES (?)', [name], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return res.status(400).json({ error: 'Facility name already exists' });
      }
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ id: this.lastID, name, created_at: new Date().toISOString() });
  });
});

app.put('/api/facilities/:id', authenticateToken, requireAdmin, (req, res) => {
  const { name } = req.body;
  const facilityId = req.params.id;

  if (!name) {
    return res.status(400).json({ error: 'Facility name is required' });
  }

  db.run(
    'UPDATE facilities SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [name, facilityId],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'Facility name already exists' });
        }
        return res.status(500).json({ error: 'Database error' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Facility not found' });
      }
      res.json({ message: 'Facility updated successfully' });
    }
  );
});

app.delete('/api/facilities/:id', authenticateToken, requireAdmin, (req, res) => {
  const facilityId = req.params.id;

  db.run('DELETE FROM facilities WHERE id = ?', [facilityId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Facility not found' });
    }
    res.json({ message: 'Facility deleted successfully' });
  });
});

// Supplies routes
app.get('/api/supplies', authenticateToken, (req, res) => {
  db.all('SELECT * FROM supplies ORDER BY code', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

app.post('/api/supplies', authenticateToken, requireAdmin, (req, res) => {
  const { code, description, hcpcs, cost } = req.body;
  
  if (!code || !description) {
    return res.status(400).json({ error: 'Code and description are required' });
  }

  db.run(
    'INSERT INTO supplies (code, description, hcpcs, cost) VALUES (?, ?, ?, ?)',
    [code, description, hcpcs || null, cost || 0],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'Supply code already exists' });
        }
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ 
        id: this.lastID, 
        code, 
        description, 
        hcpcs, 
        cost: cost || 0,
        created_at: new Date().toISOString() 
      });
    }
  );
});

app.put('/api/supplies/:id', authenticateToken, requireAdmin, (req, res) => {
  const { code, description, hcpcs, cost } = req.body;
  const supplyId = req.params.id;

  if (!code || !description) {
    return res.status(400).json({ error: 'Code and description are required' });
  }

  db.run(
    'UPDATE supplies SET code = ?, description = ?, hcpcs = ?, cost = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [code, description, hcpcs || null, cost || 0, supplyId],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'Supply code already exists' });
        }
        return res.status(500).json({ error: 'Database error' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Supply not found' });
      }
      res.json({ message: 'Supply updated successfully' });
    }
  );
});

app.delete('/api/supplies/:id', authenticateToken, requireAdmin, (req, res) => {
  const supplyId = req.params.id;

  db.run('DELETE FROM supplies WHERE id = ?', [supplyId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Supply not found' });
    }
    res.json({ message: 'Supply deleted successfully' });
  });
});

// Patients routes
app.get('/api/patients', authenticateToken, (req, res) => {
  let query = `
    SELECT p.*, f.name as facility_name 
    FROM patients p 
    LEFT JOIN facilities f ON p.facility_id = f.id
  `;
  let params = [];

  // Filter by facility if user is not admin
  if (req.user.role !== 'admin' && req.user.facilityId) {
    query += ' WHERE p.facility_id = ?';
    params.push(req.user.facilityId);
  }

  query += ' ORDER BY p.created_at DESC';

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

app.post('/api/patients', authenticateToken, (req, res) => {
  const { name, mrn, month, facilityId } = req.body;
  
  if (!name || !month || !facilityId) {
    return res.status(400).json({ error: 'Name, month, and facility are required' });
  }

  // Check if user has permission to add to this facility
  if (req.user.role !== 'admin' && req.user.facilityId !== facilityId) {
    return res.status(403).json({ error: 'Access denied for this facility' });
  }

  db.run(
    'INSERT INTO patients (name, mrn, month, facility_id) VALUES (?, ?, ?, ?)',
    [name, mrn || null, month, facilityId],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'Patient already exists for this month and facility' });
        }
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ 
        id: this.lastID, 
        name, 
        mrn, 
        month, 
        facility_id: facilityId,
        created_at: new Date().toISOString() 
      });
    }
  );
});

app.put('/api/patients/:id', authenticateToken, (req, res) => {
  const { name, mrn } = req.body;
  const patientId = req.params.id;

  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  // First check if patient exists and user has permission
  db.get(
    'SELECT * FROM patients WHERE id = ?',
    [patientId],
    (err, patient) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!patient) {
        return res.status(404).json({ error: 'Patient not found' });
      }

      // Check permission
      if (req.user.role !== 'admin' && req.user.facilityId !== patient.facility_id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Update patient
      db.run(
        'UPDATE patients SET name = ?, mrn = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [name, mrn || null, patientId],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }
          res.json({ message: 'Patient updated successfully' });
        }
      );
    }
  );
});

app.delete('/api/patients/:id', authenticateToken, (req, res) => {
  const patientId = req.params.id;

  // First check if patient exists and user has permission
  db.get(
    'SELECT * FROM patients WHERE id = ?',
    [patientId],
    (err, patient) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!patient) {
        return res.status(404).json({ error: 'Patient not found' });
      }

      // Check permission
      if (req.user.role !== 'admin' && req.user.facilityId !== patient.facility_id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Delete patient (cascade will handle tracking data)
      db.run('DELETE FROM patients WHERE id = ?', [patientId], function(err) {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.json({ message: 'Patient deleted successfully' });
      });
    }
  );
});

// Supply tracking routes
app.get('/api/tracking/:patientId', authenticateToken, (req, res) => {
  const patientId = req.params.patientId;

  // First check if user has permission to view this patient
  db.get(
    'SELECT * FROM patients WHERE id = ?',
    [patientId],
    (err, patient) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!patient) {
        return res.status(404).json({ error: 'Patient not found' });
      }

      // Check permission
      if (req.user.role !== 'admin' && req.user.facilityId !== patient.facility_id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Get tracking data
      db.all(
        'SELECT * FROM supply_tracking WHERE patient_id = ? ORDER BY supply_id, day_of_month',
        [patientId],
        (err, rows) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }
          res.json(rows);
        }
      );
    }
  );
});

app.post('/api/tracking', authenticateToken, (req, res) => {
  const { patientId, supplyId, dayOfMonth, quantity, woundDx } = req.body;

  if (!patientId || !supplyId || !dayOfMonth) {
    return res.status(400).json({ error: 'Patient ID, supply ID, and day are required' });
  }

  // First check if user has permission
  db.get(
    'SELECT * FROM patients WHERE id = ?',
    [patientId],
    (err, patient) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!patient) {
        return res.status(404).json({ error: 'Patient not found' });
      }

      // Check permission
      if (req.user.role !== 'admin' && req.user.facilityId !== patient.facility_id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Upsert tracking data
      db.run(
        `INSERT OR REPLACE INTO supply_tracking 
         (patient_id, supply_id, day_of_month, quantity, wound_dx, updated_at) 
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [patientId, supplyId, dayOfMonth, quantity || 0, woundDx || null],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }
          res.json({ message: 'Tracking data updated successfully' });
        }
      );
    }
  );
});

// Dashboard routes
app.get('/api/dashboard/summary', authenticateToken, (req, res) => {
  const { facilityId, month } = req.query;
  
  let query = `
    SELECT 
      p.id,
      p.name,
      p.mrn,
      p.month,
      f.name as facility_name,
      p.created_at,
      COALESCE(SUM(st.quantity), 0) as total_units,
      COALESCE(SUM(st.quantity * s.cost), 0) as total_cost,
      GROUP_CONCAT(DISTINCT st.wound_dx) as wound_diagnoses,
      GROUP_CONCAT(DISTINCT s.code) as supply_codes,
      GROUP_CONCAT(DISTINCT s.hcpcs) as hcpcs_codes
    FROM patients p
    LEFT JOIN facilities f ON p.facility_id = f.id
    LEFT JOIN supply_tracking st ON p.id = st.patient_id
    LEFT JOIN supplies s ON st.supply_id = s.id
    WHERE 1=1
  `;
  
  const params = [];
  
  // Apply filters
  if (req.user.role !== 'admin' && req.user.facilityId) {
    query += ' AND p.facility_id = ?';
    params.push(req.user.facilityId);
  } else if (facilityId) {
    query += ' AND p.facility_id = ?';
    params.push(facilityId);
  }
  
  if (month) {
    query += ' AND p.month = ?';
    params.push(month);
  }
  
  query += ' GROUP BY p.id ORDER BY p.created_at DESC';

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Reports routes
app.get('/api/reports/itemized-summary', authenticateToken, (req, res) => {
  const { facilityId, month } = req.query;
  
  let query = `
    SELECT 
      p.name as patient_name,
      p.mrn,
      f.name as facility_name,
      s.code as ar_code,
      s.description as item_description,
      s.hcpcs,
      SUM(st.quantity) as total_units,
      s.cost as unit_cost,
      SUM(st.quantity * s.cost) as total_cost,
      st.wound_dx
    FROM patients p
    JOIN supply_tracking st ON p.id = st.patient_id
    JOIN supplies s ON st.supply_id = s.id
    LEFT JOIN facilities f ON p.facility_id = f.id
    WHERE st.quantity > 0
  `;
  
  const params = [];
  
  // Apply filters
  if (req.user.role !== 'admin' && req.user.facilityId) {
    query += ' AND p.facility_id = ?';
    params.push(req.user.facilityId);
  } else if (facilityId) {
    query += ' AND p.facility_id = ?';
    params.push(facilityId);
  }
  
  if (month) {
    query += ' AND p.month = ?';
    params.push(month);
  }
  
  query += ' GROUP BY p.id, s.id ORDER BY p.name, s.code';

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Users management routes (admin only)
app.get('/api/users', authenticateToken, requireAdmin, (req, res) => {
  db.all(
    `SELECT u.*, f.name as facility_name 
     FROM users u 
     LEFT JOIN facilities f ON u.facility_id = f.id 
     ORDER BY u.created_at DESC`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      // Remove password from response
      const users = rows.map(user => {
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
      });
      res.json(users);
    }
  );
});

app.put('/api/users/:id/approval', authenticateToken, requireAdmin, (req, res) => {
  const { isApproved } = req.body;
  const userId = req.params.id;

  db.run(
    'UPDATE users SET is_approved = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [isApproved ? 1 : 0, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({ message: 'User approval status updated successfully' });
    }
  );
});

app.delete('/api/users/:id', authenticateToken, requireAdmin, (req, res) => {
  const userId = req.params.id;

  // Prevent deleting yourself
  if (parseInt(userId) === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ message: 'User deleted successfully' });
  });
});

// Serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🏥 Wound Care RT Supply Tracker running on port ${PORT}`);
  console.log(`🌐 Server URL: http://localhost:${PORT}`);
  console.log(`👤 Default admin: admin@woundcare.com / admin123`);
});

module.exports = app;
