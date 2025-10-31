require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3001;

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'ABOI Backend API'
    });
});

app.listen(PORT, () => {
    console.log(`🚀 ABOI Backend API running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
});
