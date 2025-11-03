require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cron = require('node-cron');

const supabase = require('./supabase');
const authRoutes = require('./routes/auth');
const commodityRoutes = require('./routes/commodities-supabase');
const priceRoutes = require('./routes/prices');
const adminRoutes = require('./routes/admin');
const currencyRoutes = require('./routes/currency');
const priceService = require('./services/priceService');

const app = express();
const PORT = process.env.PORT || 3001;

const defaultOrigins = process.env.NODE_ENV === 'production'
    ? [
        'https://aboi-admin-panel-qpza54uia-odinternational04s-projects.vercel.app',
        'https://aboi-admin-panel-k242hic86-odinternational04s-projects.vercel.app',
        'https://aboi-admin-panel.vercel.app',
        'https://aboi-backend-79tbaugmg-odinternational04s-projects.vercel.app'
      ]
    : ['http://localhost:5173', 'http://localhost:5174'];

const envOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
    : [];

const allowedOrigins = envOrigins.length > 0 ? envOrigins : defaultOrigins;

// Middleware
app.use(helmet());
app.use(cors({
    origin: (origin, callback) => {
        if (!origin) {
            // Allow non-browser clients (e.g., curl, mobile apps without origin header)
            return callback(null, true);
        }

        // Check if origin matches allowed origins or is a Vercel preview deployment
        const isAllowed = allowedOrigins.includes(origin) || 
                         origin.includes('odinternational04s-projects.vercel.app');

        if (isAllowed) {
            return callback(null, true);
        }

        console.warn(`CORS blocked request from origin: ${origin}`);
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'Backend API'
    });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/commodities', commodityRoutes);
app.use('/api/prices', priceRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/currency', currencyRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        error: {
            message: err.message || 'Internal Server Error',
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        }
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: {
            message: 'Route not found',
            path: req.originalUrl
        }
    });
});

const priceUpdateTime = process.env.PRICE_UPDATE_TIME || '09:00';
const priceUpdateTimezone = process.env.PRICE_UPDATE_TIMEZONE || 'Africa/Johannesburg';

const buildCronExpression = (time) => {
    const [hours, minutes] = time.split(':');
    const hour = Number.parseInt(hours, 10);
    const minute = Number.parseInt(minutes, 10);

    if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        console.warn(`Invalid PRICE_UPDATE_TIME "${time}" supplied. Falling back to 09:00.`);
        return '0 9 * * *';
    }

    return `${minute} ${hour} * * *`;
};

// Schedule daily price updates at configured time
cron.schedule(buildCronExpression(priceUpdateTime), async () => {
    console.log(`Running scheduled price update for ${new Date().toISOString()}...`);
    try {
        await priceService.updateDailyPrices({ triggerSource: 'cron' });
        console.log('Daily price update completed successfully');
    } catch (error) {
        console.error('Daily price update failed:', error);
    }
}, {
    timezone: priceUpdateTimezone,
});

// Initialize Supabase connection and start server
async function startServer() {
    try {
        // Test Supabase connection
        const connected = await supabase.testConnection();
        if (!connected) {
            throw new Error('Failed to connect to Supabase');
        }

        app.listen(PORT, () => {
            console.log(` Green Oil Index Backend API running on port ${PORT}`);
            console.log(` Health check: http://localhost:${PORT}/health`);
            console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`  Database: Supabase`);
            console.log(` Allowed origins: ${allowedOrigins.join(', ')}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n Shutting down gracefully...');
    console.log('Server shutdown complete');
    process.exit(0);
});

startServer();
