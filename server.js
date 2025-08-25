// Replace the existing PUT /api/supplies/:id route in your server.js with this updated version:

// Update supply (admin only) - UPDATED to allow editing system supplies
app.put('/api/supplies/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { id } = req.params;
        const { code, description, hcpcs, cost } = req.body;

        if (!code || !description) {
            return res.status(400).json({ error: 'Code and description are required' });
        }

        // Log system supply changes for audit
        const supplyCheck = await pool.query('SELECT is_custom, description FROM supplies WHERE id = $1', [id]);
        if (supplyCheck.rows.length > 0 && !supplyCheck.rows[0].is_custom) {
            console.log(`⚠️ Admin ${req.user.email} (ID: ${req.user.userId}) editing SYSTEM supply: ${supplyCheck.rows[0].description} (ID: ${id})`);
        }

        // REMOVED the restriction that only allowed editing custom supplies
        // Now admins can edit both system and custom supplies
        const result = await pool.query(
            'UPDATE supplies SET code = $1, description = $2, hcpcs = $3, cost = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *',
            [code, description, hcpcs || null, cost || 0, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Supply not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating supply:', error);
        if (error.code === '23505') { // Unique violation
            res.status(400).json({ error: 'Supply code already exists' });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// Delete supply (admin only) - UPDATED to allow deleting system supplies with warning
app.delete('/api/supplies/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { id } = req.params;

        // Check if supply exists and get details
        const supplyCheck = await pool.query('SELECT is_custom, description, code FROM supplies WHERE id = $1', [id]);
        if (supplyCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Supply not found' });
        }

        const supply = supplyCheck.rows[0];

        // Check if supply is being used in tracking
        const trackingCheck = await pool.query('SELECT COUNT(*) FROM tracking WHERE supply_id = $1', [id]);
        const usageCount = parseInt(trackingCheck.rows[0].count);

        // Log system supply deletion for audit
        if (!supply.is_custom) {
            console.log(`⚠️ Admin ${req.user.email} (ID: ${req.user.userId}) deleting SYSTEM supply: ${supply.description} (Code: ${supply.code}, ID: ${id})`);
            console.log(`   Usage in tracking: ${usageCount} records`);
        }

        // Allow deletion but warn about tracking data
        const result = await pool.query('DELETE FROM supplies WHERE id = $1 RETURNING *', [id]);

        let message = `Supply "${supply.description}" deleted successfully`;
        if (usageCount > 0) {
            message += `. Note: ${usageCount} tracking records were using this supply.`;
        }

        res.json({ 
            message: message,
            deletedSupply: result.rows[0],
            affectedTrackingRecords: usageCount
        });
    } catch (error) {
        console.error('Error deleting supply:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
