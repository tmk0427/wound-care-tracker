// Add this debug route to your server.js to see what's in the database
app.get('/api/debug/patients', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin only' });
        }

        const allPatients = await safeQuery(`
            SELECT p.*, f.name as facility_name 
            FROM patients p 
            LEFT JOIN facilities f ON p.facility_id = f.id
            ORDER BY p.month DESC, p.name
        `);

        const userInfo = await safeQuery(`
            SELECT id, name, email, role, facility_id, f.name as facility_name
            FROM users u
            LEFT JOIN facilities f ON u.facility_id = f.id
            WHERE u.role != 'admin'
        `);

        res.json({ 
            success: true, 
            allPatients: allPatients.rows,
            nonAdminUsers: userInfo.rows,
            patientCount: allPatients.rows.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add this cleanup route to clear all patient data
app.post('/api/debug/clear-patients', authenticateToken, requireAdmin, async (req, res) => {
    try {
        // First delete all tracking data (due to foreign key constraints)
        const trackingResult = await safeQuery('DELETE FROM tracking');
        
        // Then delete all patients
        const patientsResult = await safeQuery('DELETE FROM patients');
        
        res.json({ 
            success: true, 
            message: `Cleared ${trackingResult.rowCount} tracking records and ${patientsResult.rowCount} patients`,
            trackingDeleted: trackingResult.rowCount,
            patientsDeleted: patientsResult.rowCount
        });
    } catch (error) {
        console.error('Error clearing data:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update the existing /api/patients route with better logging
app.get('/api/patients', authenticateToken, async (req, res) => {
    try {
        const { facility_id, month } = req.query;
        
        console.log('=== PATIENT QUERY DEBUG ===');
        console.log('User ID:', req.user.id);
        console.log('User Role:', req.user.role);
        console.log('User Facility ID:', req.user.facilityId);
        console.log('Query facility_id:', facility_id);
        console.log('Query month:', month);
        
        let query = `
            SELECT p.*, f.name as facility_name 
            FROM patients p 
            LEFT JOIN facilities f ON p.facility_id = f.id
        `;
        let params = [];
        let conditions = [];

        // Apply facility filter if user is not admin - STRICT FILTERING
        if (req.user.role !== 'admin') {
            if (req.user.facilityId) {
                conditions.push('p.facility_id = $' + (params.length + 1));
                params.push(req.user.facilityId);
                console.log('Added facility filter:', req.user.facilityId);
            } else {
                console.log('User has no facility - returning empty');
                return res.json({ success: true, patients: [] });
            }
        } else if (facility_id) {
            conditions.push('p.facility_id = $' + (params.length + 1));
            params.push(facility_id);
            console.log('Admin facility filter:', facility_id);
        }

        // Additional month filtering for non-admin users (September 2025 onwards only)
        if (req.user.role !== 'admin') {
            conditions.push("p.month >= '2025-09'");
            console.log('Added month filter: >= 2025-09');
        }

        if (month) {
            conditions.push('p.month = $' + (params.length + 1));
            params.push(month);
            console.log('Added specific month filter:', month);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY p.name ASC';

        console.log('Final query:', query);
        console.log('Query params:', params);

        const result = await safeQuery(query, params);
        
        console.log('Query result count:', result.rows.length);
        if (result.rows.length > 0) {
            console.log('Sample results:', result.rows.slice(0, 3));
        }
        console.log('=== END DEBUG ===');

        res.json({ success: true, patients: result.rows });

    } catch (error) {
        console.error('Error fetching patients:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch patients' });
    }
});
