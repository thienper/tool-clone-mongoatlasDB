const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store SSE clients
const sseClients = new Map();

// SSE endpoint for real-time progress
app.get('/api/progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  sseClients.set(jobId, res);

  req.on('close', () => {
    sseClients.delete(jobId);
  });
});

function sendProgress(jobId, data) {
  const client = sseClients.get(jobId);
  if (client) {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

// List databases endpoint - auto-connect and return all databases
app.post('/api/list-databases', async (req, res) => {
  const { connectionString } = req.body;
  let client = null;
  try {
    client = new MongoClient(connectionString, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    const adminDb = client.db('admin');
    const result = await adminDb.admin().listDatabases();
    const SYSTEM_DBS = ['admin', 'local', 'config'];
    const databases = result.databases
      .filter(db => !SYSTEM_DBS.includes(db.name))
      .map(db => ({
        name: db.name,
        sizeOnDisk: db.sizeOnDisk,
        sizeLabel: formatBytes(db.sizeOnDisk)
      }));
    res.json({ success: true, databases });
  } catch (err) {
    res.json({ success: false, error: err.message });
  } finally {
    if (client) await client.close();
  }
});

// Get collections info for a specific database
app.post('/api/collections-info', async (req, res) => {
  const { connectionString, dbName } = req.body;
  let client = null;
  try {
    client = new MongoClient(connectionString, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    const db = client.db(dbName);
    const collections = await db.listCollections().toArray();

    const info = [];
    for (const col of collections) {
      const count = await db.collection(col.name).countDocuments();
      info.push({ name: col.name, count });
    }

    res.json({ success: true, collections: info });
  } catch (err) {
    res.json({ success: false, error: err.message });
  } finally {
    if (client) await client.close();
  }
});

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Main migration endpoint
app.post('/api/migrate', async (req, res) => {
  const { sourceUri, sourceDb, destUri, destDb, selectedCollections, dropExisting, jobId } = req.body;

  res.json({ success: true, message: 'Migration started', jobId });

  // Run migration in background
  runMigration({ sourceUri, sourceDb, destUri, destDb, selectedCollections, dropExisting, jobId });
});

async function runMigration({ sourceUri, sourceDb, destUri, destDb, selectedCollections, dropExisting, jobId }) {
  let sourceClient = null;
  let destClient = null;

  const log = (message, type = 'info', data = {}) => {
    sendProgress(jobId, { type, message, timestamp: new Date().toISOString(), ...data });
    console.log(`[${type.toUpperCase()}] ${message}`);
  };

  try {
    log('🔌 Đang kết nối tới Source MongoDB...', 'info');
    sourceClient = new MongoClient(sourceUri, { serverSelectionTimeoutMS: 15000 });
    await sourceClient.connect();
    log('✅ Kết nối Source thành công!', 'success');

    log('🔌 Đang kết nối tới Destination MongoDB...', 'info');
    destClient = new MongoClient(destUri, { serverSelectionTimeoutMS: 15000 });
    await destClient.connect();
    log('✅ Kết nối Destination thành công!', 'success');

    const srcDb = sourceClient.db(sourceDb);
    const dstDb = destClient.db(destDb);

    // Get collections to migrate
    let collectionsToMigrate = selectedCollections;
    if (!collectionsToMigrate || collectionsToMigrate.length === 0) {
      const allCollections = await srcDb.listCollections().toArray();
      collectionsToMigrate = allCollections.map(c => c.name);
    }

    log(`📦 Tổng số collections cần migrate: ${collectionsToMigrate.length}`, 'info', {
      collections: collectionsToMigrate
    });

    let totalDocsMigrated = 0;
    let totalErrors = 0;

    for (let i = 0; i < collectionsToMigrate.length; i++) {
      const colName = collectionsToMigrate[i];
      const progress = Math.round(((i) / collectionsToMigrate.length) * 100);

      log(`\n📂 [${i + 1}/${collectionsToMigrate.length}] Đang xử lý collection: "${colName}"`, 'collection', {
        collection: colName,
        progress
      });

      try {
        const srcCol = srcDb.collection(colName);
        const dstCol = dstDb.collection(colName);

        // Count source documents
        const totalDocs = await srcCol.countDocuments();
        log(`   📊 Tổng documents: ${totalDocs.toLocaleString()}`, 'info');

        if (dropExisting) {
          await dstCol.drop().catch(() => {}); // ignore if not exists
          log(`   🗑️  Đã xóa collection cũ tại destination`, 'info');
        }

        if (totalDocs === 0) {
          log(`   ⚠️  Collection rỗng, bỏ qua`, 'warning');
          continue;
        }

        // Copy indexes first
        const indexes = await srcCol.indexes();
        const nonDefaultIndexes = indexes.filter(idx => idx.name !== '_id_');
        if (nonDefaultIndexes.length > 0) {
          for (const idx of nonDefaultIndexes) {
            try {
              const indexOptions = { name: idx.name };
              if (idx.unique === true) indexOptions.unique = true;
              if (idx.sparse === true) indexOptions.sparse = true;
              if (idx.expireAfterSeconds != null) indexOptions.expireAfterSeconds = idx.expireAfterSeconds;
              await dstCol.createIndex(idx.key, indexOptions);
            } catch (idxErr) {
              log(`   ⚠️  Lỗi tạo index ${idx.name}: ${idxErr.message}`, 'warning');
            }
          }
          log(`   🔑 Đã tạo ${nonDefaultIndexes.length} index(es)`, 'success');
        }

        // Migrate documents in batches
        const BATCH_SIZE = 500;
        let migratedCount = 0;
        let cursor = srcCol.find({});

        while (true) {
          const batch = await cursor.limit(BATCH_SIZE).toArray();
          if (batch.length === 0) break;

          cursor = srcCol.find({}).skip(migratedCount + batch.length);

          try {
            if (batch.length > 0) {
              await dstCol.insertMany(batch, { ordered: false });
            }
          } catch (bulkErr) {
            // Handle duplicate key errors gracefully
            if (bulkErr.code === 11000) {
              const inserted = bulkErr.result?.nInserted || 0;
              migratedCount += inserted;
              log(`   ⚠️  Một số documents bị trùng key, đã bỏ qua`, 'warning');
              continue;
            }
            throw bulkErr;
          }

          migratedCount += batch.length;
          const colProgress = Math.round((migratedCount / totalDocs) * 100);

          sendProgress(jobId, {
            type: 'batch',
            collection: colName,
            migratedCount,
            totalDocs,
            colProgress,
            timestamp: new Date().toISOString()
          });

          if (batch.length < BATCH_SIZE) break;
        }

        totalDocsMigrated += migratedCount;
        log(`   ✅ Hoàn thành! Đã migrate ${migratedCount.toLocaleString()}/${totalDocs.toLocaleString()} documents`, 'success', {
          collection: colName,
          migratedCount,
          totalDocs
        });

      } catch (colErr) {
        totalErrors++;
        log(`   ❌ Lỗi khi migrate "${colName}": ${colErr.message}`, 'error', {
          collection: colName,
          error: colErr.message
        });
      }
    }

    const finalProgress = 100;
    log(`\n🎉 Migration hoàn tất!`, 'complete', {
      progress: finalProgress,
      totalDocsMigrated,
      totalErrors,
      totalCollections: collectionsToMigrate.length
    });

  } catch (err) {
    log(`❌ Lỗi nghiêm trọng: ${err.message}`, 'fatal', { error: err.message });
  } finally {
    if (sourceClient) await sourceClient.close();
    if (destClient) await destClient.close();
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 MongoDB Migration Tool đang chạy tại: http://localhost:${PORT}`);
  console.log(`   Mở trình duyệt và truy cập địa chỉ trên để bắt đầu!\n`);
});
