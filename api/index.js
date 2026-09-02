const { handleRequest, loadData, db } = require('../server.js');

module.exports = async (req, res) => {
  try {
    if (!db.summary && db.transfers.length === 0) {
      loadData();
    }
    await handleRequest(req, res);
  } catch (err) {
    console.error('💥 Vercel Serverless Function Error:', err);
    if (!res.headersSent) {
      res.writeHead(500, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({
        error: 'Erro na função serverless',
        message: err.message,
        stack: err.stack
      }));
    }
  }
};
