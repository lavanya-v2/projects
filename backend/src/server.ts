import 'reflect-metadata';
import fs from 'fs';
import http from 'http';
import { createApp } from './app';
import sequelize from './config/connection';
import { config } from './config';
import { initIO, closeIO } from './realtime/io';
import { registerRetroGateway } from './modules/retro/realtime/retroGateway';
import './modules/reports/queues/dsrQueue';
import './modules/reports/queues/accountReportQueue';
import './modules/reports/queues/weeklyReportQueue';
import './modules/reports/queues/monthlyReportQueue';

/**
 * Confirm uploaded files can actually be retained, and say so plainly at boot if they cannot.
 *
 * Retention failures otherwise surface only per-upload, long after the fact, as an import that
 * imported fine but has no file to download. Deliberately non-fatal: imports must keep working with
 * retention degraded rather than the server refusing to start.
 */
function checkUploadsWritable(): void {
  const uploadPath = config.uploads.path;

  try {
    fs.mkdirSync(uploadPath, { recursive: true });
    fs.accessSync(uploadPath, fs.constants.W_OK);
    console.log(`✅ Upload retention directory writable: ${uploadPath}`);
  } catch (e) {
    console.warn(
      `⚠️  Upload directory is not writable: ${uploadPath}\n` +
        `   ${e instanceof Error ? e.message : String(e)}\n` +
        '   Imports will still work, but uploaded files cannot be retained for download or resubmit.\n' +
        '   Set UPLOAD_PATH to a writable location, or grant write access to this path.'
    );
  }
}

async function startServer() {
  try {
    // Test database connection
    await sequelize.authenticate();
    console.log('✅ Database connection established');

    // Sync models (Disabled in favor of migrations)
    // if (process.env.NODE_ENV === 'development') {
    //     await sequelize.sync({ alter: false });
    //     console.log('✅ Database models synced');
    // }
    console.log('ℹ️  Database sync disabled (using migrations)');

    checkUploadsWritable();

    // Create Express app
    const app = createApp();

    // Background queues are registered by the static imports at the top of this
    // file (dsrQueue, accountReportQueue, weeklyReportQueue, monthlyReportQueue) —
    // no need to re-import them here, that would just re-run an already-cached
    // module with no effect.

    // Start server. An explicit http.Server (rather than app.listen) is needed
    // so socket.io can attach to the same port for the retro board's realtime
    // updates. If the socket layer fails to start, the API still serves and the
    // board falls back to polling.
    const port = config.server.port;
    const httpServer = http.createServer(app);

    try {
      const io = initIO(httpServer);
      registerRetroGateway(io);
    } catch (e) {
      console.warn(
        '⚠️  Realtime layer failed to start; retro boards will fall back to polling:',
        e instanceof Error ? e.message : String(e)
      );
    }

    httpServer.listen(port, () => {
      console.log(`\n🚀 Server running on port ${port}`);
      console.log(`📊 API: http://localhost:${port}/api`);
      console.log(`💚 Health: http://localhost:${port}/api/health`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

/**
 * Handle graceful shutdown.
 *
 * The scheduler is deliberately absent here: it runs in its own process
 * (schedulerWorker.ts) and stops itself there. Closing the socket layer before
 * the database matters now that the API also serves realtime — otherwise a PM2
 * restart drops live retro connections mid-write rather than closing them.
 */
process.on('SIGTERM', async () => {
  console.log('\n🛑 SIGTERM received. Shutting down gracefully...');
  await closeIO();
  await sequelize.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 SIGINT received. Shutting down gracefully...');
  await closeIO();
  await sequelize.close();
  process.exit(0);
});

startServer();
