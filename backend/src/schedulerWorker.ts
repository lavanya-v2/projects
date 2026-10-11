import 'reflect-metadata';
import sequelize from './config/connection';
import { schedulerService } from './modules/scheduler';
import { config } from './config';

async function startScheduler() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected');

    if (config.environment === 'production') {
      console.log('🚀 Starting scheduler service...');
      schedulerService.start();
    }
  } catch (error) {
    console.error('❌ Failed to start scheduler worker', error);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  console.log('Stopping scheduler worker...');
  schedulerService.stop();
  await sequelize.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Stopping scheduler worker...');
  schedulerService.stop();
  await sequelize.close();
  process.exit(0);
});

startScheduler();
