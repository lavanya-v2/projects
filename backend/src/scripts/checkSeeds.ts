
import sequelize from '../config/connection';
import { QueryTypes } from 'sequelize';

async function checkSeeds() {
    try {
        await sequelize.authenticate();
        console.log('Connected to DB.');

        const seeds = await sequelize.query('SELECT * FROM "SequelizeData"', { type: QueryTypes.SELECT });
        // Default table is SequelizeMeta. But sometimes it is SequelizeMetas or similar.
        // Actually, let's try to query it. The output from CLI showed "Sequelize CLI ... ORM: ...".

        console.log('Executed Seeds:', seeds);

    } catch (error) {
        console.error('Error checking seeds:', error);
        // Fallback or try different table name if needed, but default is SequelizeMeta
    } finally {
        process.exit(0);
    }
}

checkSeeds();
