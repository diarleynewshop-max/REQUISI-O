// api/logs.js - Vercel Serverless Function: Logs Centralizados (IP & Última Ação)
// Todos os dispositivos que acessam na Vercel compartilham este store em memória.

// Global in-memory store (persiste enquanto a Lambda estiver "quente")
if (!global._newshopLogs) {
  global._newshopLogs = { ips: {}, history: [] };
}
const logStore = global._newshopLogs;

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || '0.0.0.0';
}

function recordLog(ip, action, details, deviceId) {
  const now = Date.now();
  const horario = new Date(now).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const key = deviceId || ip;

  if (!logStore.ips[key]) {
    logStore.ips[key] = {
      ip,
      deviceId: deviceId || '',
      ultimaAcao: action,
      detalhes: details || '',
      horario,
      timestamp: now,
      totalAcoes: 1,
      primeiroAcesso: horario
    };
  } else {
    const entry = logStore.ips[key];
    entry.ip = ip;
    entry.ultimaAcao = action;
    entry.detalhes = details || '';
    entry.horario = horario;
    entry.timestamp = now;
    entry.totalAcoes = (entry.totalAcoes || 0) + 1;
  }

  logStore.history.unshift({
    id: `${now}_${Math.random().toString(36).substring(2, 7)}`,
    horario,
    timestamp: now,
    ip,
    deviceId: deviceId || '',
    acao: action,
    detalhes: details || ''
  });

  if (logStore.history.length > 500) {
    logStore.history = logStore.history.slice(0, 500);
  }
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Device-Id');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const clientIp = getClientIp(req);
  const deviceId = req.headers['x-device-id'] || '';

  // Parse pathname from original URL
  const rawUrl = req.headers['x-matched-path'] || req.headers['x-invoke-path'] || req.url || '/api/logs';
  let pathname = '/api/logs';
  try {
    const url = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);
    pathname = url.pathname;
  } catch (e) {
    pathname = rawUrl.split('?')[0];
  }

  try {
    // GET /api/logs — Lista de IPs e histórico
    if ((pathname === '/api/logs' || pathname === '/api/logs/') && req.method === 'GET') {
      // Registra a conexão desse device automaticamente
      const connKey = deviceId || clientIp;
      if (!logStore.ips[connKey] || (Date.now() - (logStore.ips[connKey].timestamp || 0)) > 15000) {
        recordLog(clientIp, 'Conectou ao Painel', '', deviceId);
      }

      const ipList = Object.values(logStore.ips).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return res.status(200).json({
        currentIp: clientIp,
        currentDeviceId: deviceId,
        totalIps: ipList.length,
        totalActions: logStore.history.length,
        ips: ipList,
        history: logStore.history.slice(0, 100)
      });
    }

    // POST /api/logs/action — Registrar ação
    if (pathname === '/api/logs/action' && req.method === 'POST') {
      let body = req.body;
      if (!body) {
        body = await new Promise((resolve) => {
          let d = '';
          req.on('data', c => d += c);
          req.on('end', () => {
            try { resolve(JSON.parse(d)); } catch (e) { resolve({}); }
          });
        });
      }
      const { action, details } = body || {};
      if (action) {
        recordLog(clientIp, action, details || '', deviceId);
      }
      return res.status(200).json({ success: true, ip: clientIp, deviceId });
    }

    // POST /api/logs/clear — Limpar histórico
    if (pathname === '/api/logs/clear' && req.method === 'POST') {
      logStore.ips = {};
      logStore.history = [];
      return res.status(200).json({ success: true, message: 'Logs limpos com sucesso' });
    }

    // GET /api/logs/download — Baixar atividades.log
    if (pathname === '/api/logs/download') {
      recordLog(clientIp, 'Baixou arquivo de logs', 'atividades.log', deviceId);
      const lines = logStore.history.map(h =>
        `[${h.horario}] IP: ${h.ip}${h.deviceId ? ' (Dev:' + h.deviceId.substring(0, 6) + ')' : ''} | Ação: ${h.acao}${h.detalhes ? ' (' + h.detalhes + ')' : ''}`
      );
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="atividades.log"');
      return res.status(200).send(lines.join('\r\n') || 'Nenhum log registrado.');
    }

    return res.status(404).json({ error: 'Rota de logs não encontrada' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
