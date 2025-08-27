const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

/**
 * Data Migration Script for Wound Care RT Supply Tracker
 * This script preserves existing data and ensures database integrity
 */

function runQuery(db, query, params = []) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function(err) {
            if (err) reject(err);
            else resolve({ id: this.lastID, changes: this.changes });
        });
    });
}

function getQuery(db, query, params = []) {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function getAllQuery(db, query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function migrateExistingData() {
    const dbPath = './wound_care.db';
    const backupPath = `./wound_care_backup_${Date.now()}.db`;
    
    try {
        console.log('🔄 Starting data migration and preservation...');
        
        // Create backup if database exists
        if (fs.existsSync(dbPath)) {
            console.log('💾 Creating backup of existing database...');
            fs.copyFileSync(dbPath, backupPath);
            console.log(`✅ Backup created: ${backupPath}`);
        }
        
        const db = new sqlite3.Database(dbPath);
        
        // Enable foreign keys
        await runQuery(db, "PRAGMA foreign_keys = ON");
        
        console.log('🔍 Checking existing database structure...');
        
        // Check existing tables
        const tables = await getAllQuery(db, `
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name NOT LIKE 'sqlite_%'
            ORDER BY name
        `);
        
        console.log('📋 Existing tables:', tables.map(t => t.name));
        
        // Get data counts before migration
        const beforeCounts = {};
        for (const table of tables) {
            try {
                const result = await getQuery(db, `SELECT COUNT(*) as count FROM ${table.name}`);
                beforeCounts[table.name] = result.count;
            } catch (err) {
                beforeCounts[table.name] = 'Error';
            }
        }
        
        console.log('📊 Data counts before migration:', beforeCounts);
        
        // Add missing columns for better data integrity
        console.log('🔧 Adding missing columns if needed...');
        
        // Add wound_dx column to tracking_data if it doesn't exist
        try {
            await runQuery(db, 'ALTER TABLE tracking_data ADD COLUMN wound_dx TEXT');
            console.log('✅ Added wound_dx column to tracking_data');
        } catch (err) {
            if (err.message.includes('duplicate column')) {
                console.log('ℹ️ wound_dx column already exists');
            } else {
                console.log('⚠️ Could not add wound_dx column:', err.message);
            }
        }
        
        // Ensure proper constraints and indexes
        console.log('🔧 Creating indexes for better performance...');
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
            'CREATE INDEX IF NOT EXISTS idx_users_facility ON users(facility_id)',
            'CREATE INDEX IF NOT EXISTS idx_patients_facility ON patients(facility_id)',
            'CREATE INDEX IF NOT EXISTS idx_patients_month ON patients(month)',
            'CREATE INDEX IF NOT EXISTS idx_tracking_patient ON tracking_data(patient_id)',
            'CREATE INDEX IF NOT EXISTS idx_tracking_supply ON tracking_data(supply_code)',
            'CREATE INDEX IF NOT EXISTS idx_supplies_code ON supplies(code)'
        ];
        
        for (const indexQuery of indexes) {
            try {
                await runQuery(db, indexQuery);
            } catch (err) {
                console.log('Index already exists or failed:', err.message);
            }
        }
        
        // Verify data integrity
        console.log('🔍 Verifying data integrity...');
        
        // Check for orphaned records
        const orphanedPatients = await getAllQuery(db, `
            SELECT p.id, p.name 
            FROM patients p 
            LEFT JOIN facilities f ON p.facility_id = f.id 
            WHERE f.id IS NULL
        `);
        
        if (orphanedPatients.length > 0) {
            console.log('⚠️ Found patients with missing facilities:', orphanedPatients.length);
            // You might want to handle this based on your business logic
        }
        
        const orphanedTracking = await getAllQuery(db, `
            SELECT COUNT(*) as count 
            FROM tracking_data t 
            LEFT JOIN patients p ON t.patient_id = p.id 
            WHERE p.id IS NULL
        `);
        
        if (orphanedTracking[0].count > 0) {
            console.log('⚠️ Found tracking records with missing patients:', orphanedTracking[0].count);
        }
        
        // Get final counts
        const afterCounts = {};
        for (const table of tables) {
            try {
                const result = await getQuery(db, `SELECT COUNT(*) as count FROM ${table.name}`);
                afterCounts[table.name] = result.count;
            } catch (err) {
                afterCounts[table.name] = 'Error';
            }
        }
        
        console.log('📊 Data counts after migration:', afterCounts);
        
        // Compare counts
        console.log('🔄 Migration summary:');
        for (const tableName of Object.keys(beforeCounts)) {
            const before = beforeCounts[tableName];
            const after = afterCounts[tableName];
            
            if (before === after) {
                console.log(`✅ ${tableName}: ${before} records (preserved)`);
            } else {
                console.log(`⚠️ ${tableName}: ${before} → ${after} records`);
            }
        }
        
        db.close();
        
        console.log('✅ Data migration completed successfully!');
        console.log(`💾 Backup available at: ${backupPath}`);
        console.log('🚀 Your existing data has been preserved');
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    }
}

// Export data to JSON for backup
async function exportDataToJSON() {
    const dbPath = './wound_care.db';
    
    if (!fs.existsSync(dbPath)) {
        console.log('No database found to export');
        return;
    }
    
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('📤 Exporting data to JSON...');
        
        const exportData = {
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            data: {}
        };
        
        const tables = ['facilities', 'supplies', 'users', 'patients', 'tracking_data'];
        
        for (const table of tables) {
            try {
                const data = await getAllQuery(db, `SELECT * FROM ${table}`);
                exportData.data[table] = data;
                console.log(`✅ Exported ${data.length} records from ${table}`);
            } catch (err) {
                console.log(`⚠️ Could not export ${table}:`, err.message);
                exportData.data[table] = [];
            }
        }
        
        const exportPath = `./data_export_${Date.now()}.json`;
        fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));
        
        console.log(`✅ Data exported to: ${exportPath}`);
        
    } catch (error) {
        console.error('❌ Export failed:', error);
    } finally {
        db.close();
    }
}

// Run migration if this script is executed directly
if (require.main === module) {
    const command = process.argv[2];
    
    if (command === 'export') {
        exportDataToJSON()
            .then(() => process.exit(0))
            .catch((error) => {
                console.error('Export failed:', error);
                process.exit(1);
            });
    } else {
        migrateExistingData()
            .then(() => process.exit(0))
            .catch((error) => {
                console.error('Migration failed:', error);
                process.exit(1);
            });
    }
}

module.exports = { migrateExistingData, exportDataToJSON };
