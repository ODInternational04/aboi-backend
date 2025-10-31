const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const database = require('../database');

async function initializeDatabase() {
    try {
        console.log('🚀 Initializing ABOI database...');

        // Initialize database with schema
        await database.initialize();

        // Check if we need to create default admin user
        const existingAdmin = await database.get(
            'SELECT id FROM admin_users WHERE role = ?',
            ['super_admin']
        );

        if (!existingAdmin) {
            console.log('📝 Creating default admin user...');
            
            const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
            const passwordHash = await bcrypt.hash(defaultPassword, 10);

            await database.run(`
                INSERT INTO admin_users (username, email, password_hash, role)
                VALUES (?, ?, ?, ?)
            `, [
                'admin',
                process.env.DEFAULT_ADMIN_EMAIL || 'admin@aboi.com',
                passwordHash,
                'super_admin'
            ]);

            console.log('✅ Default admin user created');
            console.log(`   Username: admin`);
            console.log(`   Password: ${defaultPassword}`);
            console.log('   ⚠️  Please change the default password after first login!');
        }

        // Load sample data if no commodities exist
        const existingCommodities = await database.get('SELECT COUNT(*) as count FROM commodities');
        
        if (existingCommodities.count === 0) {
            console.log('📊 Loading sample data...');
            
            const sampleDataPath = path.join(__dirname, '..', '..', 'database', 'sample_data.sql');
            
            if (fs.existsSync(sampleDataPath)) {
                const sampleData = fs.readFileSync(sampleDataPath, 'utf8');
                
                // Split by semicolon and execute each statement
                const statements = sampleData
                    .split(';')
                    .map(stmt => stmt.trim())
                    .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

                for (const statement of statements) {
                    try {
                        await database.run(statement);
                    } catch (error) {
                        // Skip errors for INSERT OR REPLACE statements that might conflict
                        if (!error.message.includes('UNIQUE constraint failed')) {
                            console.warn('Warning executing statement:', error.message);
                        }
                    }
                }
                
                console.log('✅ Sample data loaded successfully');
            } else {
                console.log('⚠️  Sample data file not found, skipping...');
            }
        }

        // Verify database setup
        const commodityCount = await database.get('SELECT COUNT(*) as count FROM commodities WHERE is_active = 1');
        const categoryCount = await database.get('SELECT COUNT(*) as count FROM commodity_categories');
        const adminCount = await database.get('SELECT COUNT(*) as count FROM admin_users WHERE is_active = 1');

        console.log('\n📈 Database Statistics:');
        console.log(`   Categories: ${categoryCount.count}`);
        console.log(`   Active Commodities: ${commodityCount.count}`);
        console.log(`   Admin Users: ${adminCount.count}`);

        console.log('\n✅ Database initialization completed successfully!');
        console.log('\n🌐 You can now start the server with: npm run dev');

    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        process.exit(1);
    } finally {
        await database.close();
    }
}

// Run initialization if this script is executed directly
if (require.main === module) {
    initializeDatabase();
}

module.exports = { initializeDatabase };
