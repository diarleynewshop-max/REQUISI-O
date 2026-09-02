const fs = require('fs');
const path = require('path');

// Re-use logic from local_server.js to parse exact data
const { db, loadData } = require('./local_server.js');
loadData();

console.log('Generating static data bundle...');

const exportData = {
  summary: db.summary,
  transfers: db.transfers,
  criticalPurchases: db.criticalPurchases,
  reclassifications: db.reclassifications,
  positiveStock: db.positiveStock,
  status: db.status
};

// Write data.js directly
const jsContent = 'window.NEWSHOP_DATA = ' + JSON.stringify(exportData) + ';\n';
fs.writeFileSync(path.join(__dirname, 'data.js'), jsContent, 'utf8');
fs.writeFileSync(path.join(__dirname, 'public', 'data.js'), jsContent, 'utf8');

const sizeMb = (Buffer.byteLength(jsContent, 'utf8') / (1024 * 1024)).toFixed(2);
console.log(`✅ data.js generated successfully! Size: ${sizeMb} MB`);
