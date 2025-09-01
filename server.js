// Replace the existing checkMRNDuplicate function and related validation logic

// Updated helper function to check for MRN duplicates within the same month
async function checkMRNDuplicate(mrn, month, facility_id, excludePatientId = null) {
    if (!mrn || mrn.trim() === '') {
        return false; // Empty MRNs are allowed
    }
    
    let query = 'SELECT id, name, month FROM patients WHERE TRIM(mrn) = TRIM($1) AND month = $2';
    let params = [mrn, month];
    
    // If facility_id is provided, also check facility constraint
    if (facility_id) {
        query += ' AND facility_id = $' + (params.length + 1);
        params.push(facility_id);
    }
    
    if (excludePatientId) {
        query += ' AND id != $' + (params.length + 1);
        params.push(excludePatientId);
    }
    
    const result = await safeQuery(query, params);
    return result.rows.length > 0 ? result.rows[0] : false;
}

// Updated CREATE patient endpoint
app.post('/api/patients', authenticateToken, async (req, res) => {
    try {
        const { name, month, mrn, facility_id } = req.body;
        
        if (!name || !month || !facility_id) {
            return res.status(400).json({ success: false, error: 'Name, month, and facility are required' });
        }

        if (req.user.role !== 'admin' && req.user.facilityId && req.user.facilityId != facility_id) {
            return res.status(403).json({ success: false, error: 'Cannot add patients to this facility' });
        }

        if (req.user.role !== 'admin' && month < '2025-09') {
            return res.status(400).json({ success: false, error: 'Can only add patients for September 2025 onwards' });
        }

        // Check for MRN duplicate within the same month and facility
        if (mrn && mrn.trim()) {
            const duplicate = await checkMRNDuplicate(mrn.trim(), month, facility_id);
            if (duplicate) {
                return res.status(400).json({ 
                    success: false, 
                    error: `MRN "${mrn.trim()}" already exists for patient "${duplicate.name}" in ${duplicate.month}` 
                });
            }
        }

        const result = await safeQuery(
            'INSERT INTO patients (name, month, mrn, facility_id) VALUES ($1, $2, $3, $4) RETURNING *',
            [name, month, mrn ? mrn.trim() : null, facility_id]
        );

        res.json({ success: true, patient: result.rows[0] });

    } catch (error) {
        console.error('Error creating patient:', error);
        res.status(500).json({ success: false, error: 'Failed to create patient' });
    }
});

// Updated UPDATE patient endpoint
app.put('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
        const patientId = req.params.id;
        const { name, month, mrn, facility_id } = req.body;
        
        if (!name || !month || !facility_id) {
            return res.status(400).json({ success: false, error: 'Name, month, and facility are required' });
        }

        if (req.user.role !== 'admin' && req.user.facilityId && req.user.facilityId != facility_id) {
            return res.status(403).json({ success: false, error: 'Cannot modify patients from this facility' });
        }

        if (req.user.role !== 'admin' && month < '2025-09') {
            return res.status(400).json({ success: false, error: 'Can only modify patients for September 2025 onwards' });
        }

        // Check for MRN duplicate within the same month and facility (excluding current patient)
        if (mrn && mrn.trim()) {
            const duplicate = await checkMRNDuplicate(mrn.trim(), month, facility_id, parseInt(patientId));
            if (duplicate) {
                return res.status(400).json({ 
                    success: false, 
                    error: `MRN "${mrn.trim()}" already exists for patient "${duplicate.name}" in ${duplicate.month}` 
                });
            }
        }

        const result = await safeQuery(
            'UPDATE patients SET name = $1, month = $2, mrn = $3, facility_id = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *',
            [name, month, mrn ? mrn.trim() : null, facility_id, patientId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Patient not found' });
        }

        res.json({ success: true, patient: result.rows[0] });

    } catch (error) {
        console.error('Error updating patient:', error);
        res.status(500).json({ success: false, error: 'Failed to update patient' });
    }
});

// Updated BULK PATIENT UPLOAD endpoint
app.post('/api/patients/bulk', authenticateToken, async (req, res) => {
    try {
        const { patients } = req.body;
        
        if (!patients || !Array.isArray(patients) || patients.length === 0) {
            return res.status(400).json({ success: false, error: 'No patient data provided' });
        }

        console.log(`Starting bulk upload for ${patients.length} patients`);

        const facilitiesResult = await safeQuery('SELECT id, name FROM facilities');
        const facilityMap = {};
        facilitiesResult.rows.forEach(facility => {
            const cleanName = facility.name.toLowerCase().trim();
            facilityMap[cleanName] = facility.id;
            facilityMap[facility.name] = facility.id;
        });

        const results = { successful: 0, failed: [] };

        for (let i = 0; i < patients.length; i++) {
            const patient = patients[i];
            
            try {
                const name = (patient.name || patient.Name || '').toString().trim();
                const mrn = (patient.mrn || patient.MRN || '').toString().trim();
                const month = (patient.month || patient.Month || '').toString().trim();
                const facilityName = (patient.facilityName || patient.Facility || patient.facility || '').toString().trim();

                if (!name || !month || !facilityName) {
                    results.failed.push({ 
                        name: name || 'Row ' + (i + 1), 
                        error: 'Missing required fields (Name, Month, Facility)' 
                    });
                    continue;
                }

                let dbMonth = month;
                if (month.match(/^\d{2}-\d{4}$/)) {
                    const parts = month.split('-');
                    dbMonth = `${parts[1]}-${parts[0]}`;
                }

                if (req.user.role !== 'admin' && dbMonth < '2025-09') {
                    results.failed.push({ 
                        name: name, 
                        error: `Month ${dbMonth} is before September 2025 (non-admin restriction)` 
                    });
                    continue;
                }

                const facilityKey = facilityName.toLowerCase().trim();
                const facilityId = facilityMap[facilityKey];
                
                if (!facilityId) {
                    results.failed.push({ 
                        name: name, 
                        error: `Facility "${facilityName}" not found` 
                    });
                    continue;
                }

                if (req.user.role !== 'admin' && req.user.facilityId && req.user.facilityId != facilityId) {
                    results.failed.push({ 
                        name: name, 
                        error: 'No permission to add patients to this facility' 
                    });
                    continue;
                }

                // Updated MRN validation - only check within the same month and facility
                if (mrn && mrn.length > 0) {
                    const duplicate = await checkMRNDuplicate(mrn, dbMonth, facilityId);
                    if (duplicate) {
                        results.failed.push({ 
                            name: name, 
                            error: `MRN "${mrn}" already exists for patient "${duplicate.name}" in ${duplicate.month}` 
                        });
                        continue;
                    }
                }

                await safeQuery(
                    'INSERT INTO patients (name, mrn, month, facility_id) VALUES ($1, $2, $3, $4)',
                    [name, mrn || null, dbMonth, facilityId]
                );

                results.successful++;

            } catch (error) {
                results.failed.push({ 
                    name: patient.name || patient.Name || ('Row ' + (i + 1)), 
                    error: 'Database error: ' + error.message 
                });
            }
        }

        res.json({
            success: true,
            message: `Upload completed. ${results.successful} successful, ${results.failed.length} failed.`,
            successful: results.successful,
            failed: results.failed.slice(0, 20)
        });

    } catch (error) {
        console.error('Bulk upload error:', error);
        res.status(500).json({ success: false, error: 'Server error during bulk upload: ' + error.message });
    }
});
