require('dotenv').config();
const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function cleanupSupplies() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Starting supply cleanup - Removing ONLY AR codes 700-714...');
    console.log('📋 This will PRESERVE all 600-692 wound care supplies');
    
    await client.query('BEGIN');

    // First, check what supplies exist in the 700-714 range
    const existingSupplies = await client.query(`
      SELECT code, description, id 
      FROM supplies 
      WHERE code >= 700 AND code <= 714 
      ORDER BY code
    `);

    if (existingSupplies.rows.length === 0) {
      console.log('✅ No supplies found in range 700-714. Nothing to clean up.');
      await client.query('ROLLBACK');
      return;
    }

    console.log(`📋 Found ${existingSupplies.rows.length} supplies to remove (700-714 ONLY):`);
    existingSupplies.rows.forEach(supply => {
      console.log(`   - ${supply.code}: ${supply.description}`);
    });

    // Verify that 600-692 supplies will be preserved
    const preservedSupplies = await client.query(`
      SELECT COUNT(*) as count
      FROM supplies 
      WHERE code >= 600 AND code <= 692
    `);

    console.log(`\n✅ Preserving ${preservedSupplies.rows[0].count} wound care supplies (600-692)`);

    // Check for any tracking data that uses the 700-714 supplies
    const trackingData = await client.query(`
      SELECT COUNT(*) as count, s.code, s.description
      FROM tracking t
      JOIN supplies s ON t.supply_id = s.id
      WHERE s.code >= 700 AND s.code <= 714
      GROUP BY s.code, s.description
      ORDER BY s.code
    `);

    if (trackingData.rows.length > 0) {
      console.log('\n⚠️  WARNING: Found tracking data for supplies 700-714:');
      trackingData.rows.forEach(row => {
        console.log(`   - ${row.code}: ${row.description} (${row.count} tracking records)`);
      });
      console.log('\n🔄 Removing tracking data for 700-714 supplies...');
      
      // Remove tracking data for supplies 700-714 ONLY
      const deletedTracking = await client.query(`
        DELETE FROM tracking 
        WHERE supply_id IN (
          SELECT id FROM supplies WHERE code >= 700 AND code <= 714
        )
      `);
      
      console.log(`✅ Removed ${deletedTracking.rowCount} tracking records from 700-714 supplies`);
    }

    // Now remove ONLY the 700-714 supplies
    const deletedSupplies = await client.query(`
      DELETE FROM supplies 
      WHERE code >= 700 AND code <= 714
    `);

    console.log(`✅ Removed ${deletedSupplies.rowCount} supply records (700-714 ONLY)`);

    // Update any patient records to current timestamp (for cache invalidation)
    await client.query(`
      UPDATE patients 
      SET updated_at = CURRENT_TIMESTAMP
    `);

    await client.query('COMMIT');

    // Final verification of what remains
    const finalCounts = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM supplies WHERE code >= 600 AND code <= 692) as wound_care_600_692,
        (SELECT COUNT(*) FROM supplies WHERE code >= 400 AND code <= 414) as respiratory_400_414,
        (SELECT COUNT(*) FROM supplies WHERE code = 272) as med_surgical_272,
        (SELECT COUNT(*) FROM supplies WHERE code >= 700 AND code <= 714) as removed_700_714,
        (SELECT COUNT(*) FROM supplies) as total_supplies
    `);

    const counts = finalCounts.rows[0];

    console.log('\n🎉 Cleanup completed successfully!');
    console.log('📋 Summary:');
    console.log(`   - Supplies removed (700-714): ${deletedSupplies.rowCount}`);
    console.log(`   - Tracking records removed: ${trackingData.rows.length > 0 ? trackingData.rows.reduce((sum, row) => sum + parseInt(row.count), 0) : 0}`);
    
    console.log('\n📊 Remaining supplies:');
    console.log(`   - Wound Care (600-692): ${counts.wound_care_600_692} supplies ✅ PRESERVED`);
    console.log(`   - Respiratory (400-414): ${counts.respiratory_400_414} supplies ✅ PRESERVED`);
    console.log(`   - Med-Surgical (272): ${counts.med_surgical_272} supply ✅ PRESERVED`);
    console.log(`   - Removed (700-714): ${counts.removed_700_714} supplies (should be 0)`);
    console.log(`   - Total supplies remaining: ${counts.total_supplies}`);

    if (counts.removed_700_714 > 0) {
      console.log('\n⚠️  WARNING: Some 700-714 supplies may still exist!');
    } else {
      console.log('\n✅ All 700-714 supplies successfully removed!');
    }
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Cleanup failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run cleanup if called directly
if (require.main === module) {
  cleanupSupplies()
    .then(() => {
      console.log('✅ Cleanup script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Cleanup script failed:', error);
      process.exit(1);
    });
}

module.exports = { cleanupSupplies };
