
import sequelize from '../config/connection';

async function fixSeedHistory() {
    try {
        console.log('Connecting to database...');
        await sequelize.authenticate();
        console.log('Connection established successfully.');

        console.log('Creating "sequelize_data" table if not exists...');
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS "sequelize_data" (
                "name" VARCHAR(255) PRIMARY KEY,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            );
        `);

        console.log('Marking initial seed as executed...');
        await sequelize.query(`
            INSERT INTO "sequelize_data" ("name", "createdAt", "updatedAt")
            VALUES ('20260204000001-initial-seed.js', NOW(), NOW())
            ON CONFLICT ("name") DO NOTHING;
        `);

        console.log('SUCCESS: Initial seed marked as executed. You can now run "npm run db:seed" safely.');
    } catch (error) {
        console.error('ERROR: Failed to fix seed history:', error);
    } finally {
        await sequelize.close();
    }
}

fixSeedHistory();
