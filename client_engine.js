// client_engine.js - Motor 100% Estático Local (Zero Serverless, Zero 500 no Vercel)
(function() {
  console.log('🚀 Inicializando Motor de Dados Local Newshop (100% Estático no Navegador)...');

  const STATUS_KEY = 'newshop_status_v1';

  function getLocalStatus() {
    try {
      const saved = localStorage.getItem(STATUS_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return (window.NEWSHOP_DATA && window.NEWSHOP_DATA.status) || {
      transfers: {},
      reclassifications: {},
      purchases: {}
    };
  }

  function saveLocalStatus(st) {
    try {
      localStorage.setItem(STATUS_KEY, JSON.stringify(st));
    } catch (e) {}
  }

  let dbStatus = getLocalStatus();

  let costMap = null;
  function getCostMap() {
    if (!costMap && window.NEWSHOP_DATA) {
      costMap = new Map();
      const d = window.NEWSHOP_DATA;
      if (d.positiveStock) d.positiveStock.forEach(p => { if (p.custoUnit) costMap.set(p.codigo, p.custoUnit); });
      if (d.transfers) d.transfers.forEach(t => { if (t.custoUnit) costMap.set(t.codigo, t.custoUnit); });
      if (d.criticalPurchases) d.criticalPurchases.forEach(p => { if (p.custoUnit) costMap.set(p.codigo, p.custoUnit); });
    }
    return costMap || new Map();
  }

  function getProductCost(codigo) {
    const cm = getCostMap();
    if (cm.has(codigo)) return cm.get(codigo);
    return 1.00;
  }

  function getProgressStats() {
    const data = window.NEWSHOP_DATA;
    if (!data) return { transfers: { done: 0, total: 0, pct: '0.0' }, reclassifications: { done: 0, total: 0, pct: '0.0' }, purchases: { done: 0, total: 0, pct: '0.0' }, totalDone: 0 };

    const transfDone = data.transfers.filter(t => dbStatus.transfers[t.id] && dbStatus.transfers[t.id].done).length;
    const reclassDone = data.reclassifications.filter(r => dbStatus.reclassifications[r.codigo] && dbStatus.reclassifications[r.codigo].done).length;
    const purchDone = data.criticalPurchases.filter(p => dbStatus.purchases[p.codigo] && dbStatus.purchases[p.codigo].done).length;

    return {
      transfers: {
        done: transfDone,
        total: data.transfers.length,
        pct: data.transfers.length ? ((transfDone / data.transfers.length) * 100).toFixed(1) : '0.0'
      },
      reclassifications: {
        done: reclassDone,
        total: data.reclassifications.length,
        pct: data.reclassifications.length ? ((reclassDone / data.reclassifications.length) * 100).toFixed(1) : '0.0'
      },
      purchases: {
        done: purchDone,
        total: data.criticalPurchases.length,
        pct: data.criticalPurchases.length ? ((purchDone / data.criticalPurchases.length) * 100).toFixed(1) : '0.0'
      },
      totalDone: transfDone + reclassDone + purchDone
    };
  }

  const originalFetch = window.fetch;
  window.fetch = async function(resource, init) {
    const urlStr = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');
    if (!urlStr || !urlStr.includes('/api/')) {
      return originalFetch.apply(this, arguments);
    }

    const parsed = new URL(urlStr, window.location.origin);
    const pathname = parsed.pathname;
    const searchParams = parsed.searchParams;
    const method = (init && init.method) ? init.method.toUpperCase() : 'GET';
    const data = window.NEWSHOP_DATA;

    if (!data) {
      console.warn('Dados estáticos ainda carregando...');
      return new Response(JSON.stringify({ error: 'Carregando dados...' }), { status: 503 });
    }

    const jsonRes = (obj, status = 200) => {
      return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    };

    // 1. /api/summary
    if (pathname === '/api/summary') {
      return jsonRes({
        summary: data.summary,
        counts: {
          filtro1: data.positiveStock.length,
          filtro2: data.transfers.length,
          filtro3: data.criticalPurchases.length,
          filtro4: data.reclassifications.length,
          totalProdutos: data.positiveStock.length + data.transfers.length + data.criticalPurchases.length
        },
        progress: getProgressStats()
      });
    }

    // 2. /api/status
    if (pathname === '/api/status' && method === 'GET') {
      return jsonRes({
        status: dbStatus,
        progress: getProgressStats()
      });
    }

    // 3. /api/status/toggle
    if (pathname === '/api/status/toggle' && method === 'POST') {
      const payload = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      const { type, id, done, note } = payload;
      if (dbStatus[type]) {
        dbStatus[type][id] = {
          done: Boolean(done),
          updatedAt: new Date().toISOString(),
          note: note || ''
        };
        saveLocalStatus(dbStatus);
        return jsonRes({
          success: true,
          itemStatus: dbStatus[type][id],
          progress: getProgressStats()
        });
      }
      return jsonRes({ error: 'Tipo inválido' }, 400);
    }

    // 4. /api/status/batch-toggle
    if (pathname === '/api/status/batch-toggle' && method === 'POST') {
      const payload = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      const { type, ids, done, note } = payload;
      if (dbStatus[type] && Array.isArray(ids)) {
        const now = new Date().toISOString();
        ids.forEach(id => {
          dbStatus[type][id] = {
            done: Boolean(done),
            updatedAt: now,
            note: note || 'Baixa em lote'
          };
        });
        saveLocalStatus(dbStatus);
        return jsonRes({
          success: true,
          count: ids.length,
          progress: getProgressStats()
        });
      }
      return jsonRes({ error: 'Inválido' }, 400);
    }

    // 5. /api/transfers
    if (pathname === '/api/transfers') {
      const q = (searchParams.get('search') || '').toLowerCase();
      const origin = searchParams.get('origin') || '';
      const dest = searchParams.get('dest') || '';
      const statusFilter = searchParams.get('statusFilter') || 'all';
      const page = parseInt(searchParams.get('page') || '1', 10);
      const limit = parseInt(searchParams.get('limit') || '50', 10);

      let filtered = data.transfers.map(t => {
        const st = dbStatus.transfers[t.id];
        return {
          ...t,
          isDone: Boolean(st && st.done),
          doneAt: st ? st.updatedAt : null
        };
      });

      if (statusFilter === 'done') filtered = filtered.filter(t => t.isDone);
      if (statusFilter === 'pending') filtered = filtered.filter(t => !t.isDone);
      if (origin) filtered = filtered.filter(t => t.origem.includes(origin));
      if (dest) filtered = filtered.filter(t => t.destino.includes(dest));
      if (q) {
        filtered = filtered.filter(t =>
          t.codigo.toLowerCase().includes(q) ||
          t.descricao.toLowerCase().includes(q) ||
          t.ncm.includes(q)
        );
      }

      const total = filtered.length;
      const totalPecas = filtered.reduce((acc, t) => acc + t.qtd, 0);
      const totalValor = filtered.reduce((acc, t) => acc + t.valorTotal, 0);
      const start = (page - 1) * limit;
      const items = filtered.slice(start, start + limit);

      return jsonRes({
        total,
        totalPecas,
        totalValor,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        items,
        progress: getProgressStats().transfers
      });
    }

    // 6. /api/reclassifications
    if (pathname === '/api/reclassifications') {
      const q = (searchParams.get('search') || '').toLowerCase();
      const status = searchParams.get('status') || '';
      const statusFilter = searchParams.get('statusFilter') || 'all';
      const page = parseInt(searchParams.get('page') || '1', 10);
      const limit = parseInt(searchParams.get('limit') || '50', 10);
      const store = searchParams.get('store') || '';
      const donorStore = searchParams.get('donorStore') || '';
      const batchParam = searchParams.get('batch') || 'all';
      const batchSize = parseInt(searchParams.get('batchSize') || '100', 10);

      let filtered = data.reclassifications.map(r => {
        const st = dbStatus.reclassifications[r.codigo] || dbStatus.reclassifications[r.id];
        return {
          ...r,
          isDone: Boolean(st && st.done),
          doneAt: st ? st.updatedAt : null
        };
      });

      if (statusFilter === 'done') filtered = filtered.filter(r => r.isDone);
      if (statusFilter === 'pending') filtered = filtered.filter(r => !r.isDone);
      if (status) filtered = filtered.filter(r => r.status === status);
      if (store === '1') filtered = filtered.filter(r => r.saldoLoja1 < 0);
      if (store === '2') filtered = filtered.filter(r => r.saldoLoja2 < 0);
      if (store === '3') filtered = filtered.filter(r => r.saldoLoja3 < 0);

      if (donorStore === '1') filtered = filtered.filter(r => (r.doador1 && r.doador1.saldoLoja1 > 0) || (r.doador2 && r.doador2.saldoLoja1 > 0) || (r.doador3 && r.doador3.saldoLoja1 > 0));
      if (donorStore === '2') filtered = filtered.filter(r => (r.doador1 && r.doador1.saldoLoja2 > 0) || (r.doador2 && r.doador2.saldoLoja2 > 0) || (r.doador3 && r.doador3.saldoLoja2 > 0));
      if (donorStore === '3') filtered = filtered.filter(r => (r.doador1 && r.doador1.saldoLoja3 > 0) || (r.doador2 && r.doador2.saldoLoja3 > 0) || (r.doador3 && r.doador3.saldoLoja3 > 0));

      if (q) {
        filtered = filtered.filter(r =>
          r.codigo.toLowerCase().includes(q) ||
          r.descricao.toLowerCase().includes(q) ||
          r.ncm.includes(q) ||
          (r.doador1 && r.doador1.codigo && r.doador1.codigo.toLowerCase().includes(q)) ||
          (r.doador1 && r.doador1.descricao && r.doador1.descricao.toLowerCase().includes(q))
        );
      }

      const totalFiltered = filtered.length;
      const totalBatches = Math.max(1, Math.ceil(totalFiltered / batchSize));

      const batchesSummary = [];
      for (let b = 1; b <= totalBatches; b++) {
        const bStart = (b - 1) * batchSize;
        const bSlice = filtered.slice(bStart, bStart + batchSize);
        const bDone = bSlice.filter(x => x.isDone).length;
        batchesSummary.push({
          batchNum: b,
          startItem: bStart + 1,
          endItem: Math.min(b * batchSize, totalFiltered),
          total: bSlice.length,
          done: bDone,
          pending: bSlice.length - bDone,
          isComplete: bSlice.length > 0 && bDone === bSlice.length,
          pct: bSlice.length > 0 ? Math.round((bDone / bSlice.length) * 100) : 0,
          ids: bSlice.map(x => x.codigo)
        });
      }

      let activeItems = filtered;
      let currentBatchInfo = null;

      if (batchParam !== 'all' && !isNaN(parseInt(batchParam, 10))) {
        const bNum = Math.max(1, Math.min(parseInt(batchParam, 10), totalBatches));
        const bStart = (bNum - 1) * batchSize;
        activeItems = filtered.slice(bStart, bStart + batchSize);
        const bDone = activeItems.filter(x => x.isDone).length;
        currentBatchInfo = {
          currentBatch: bNum,
          totalBatches,
          batchSize,
          startItem: bStart + 1,
          endItem: Math.min(bNum * batchSize, totalFiltered),
          count: activeItems.length,
          done: bDone,
          pending: activeItems.length - bDone,
          isComplete: activeItems.length > 0 && bDone === activeItems.length,
          pct: activeItems.length > 0 ? Math.round((bDone / activeItems.length) * 100) : 0,
          ids: activeItems.map(x => x.codigo)
        };
      } else {
        currentBatchInfo = {
          currentBatch: 'all',
          totalBatches,
          batchSize,
          count: totalFiltered,
          done: filtered.filter(x => x.isDone).length,
          pending: filtered.filter(x => !x.isDone).length,
          isComplete: totalFiltered > 0 && filtered.filter(x => x.isDone).length === totalFiltered,
          pct: totalFiltered > 0 ? Math.round((filtered.filter(x => x.isDone).length / totalFiltered) * 100) : 0,
          ids: filtered.map(x => x.codigo)
        };
      }

      const total = activeItems.length;
      const totalDeficit = activeItems.reduce((acc, r) => acc + r.deficit, 0);
      const start = (page - 1) * limit;
      const items = activeItems.slice(start, start + limit);

      return jsonRes({
        total,
        totalFiltered,
        totalDeficit,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        items,
        batchInfo: currentBatchInfo,
        batchesSummary,
        progress: getProgressStats().reclassifications
      });
    }

    // 7. /api/purchases
    if (pathname === '/api/purchases') {
      const q = (searchParams.get('search') || '').toLowerCase();
      const statusFilter = searchParams.get('statusFilter') || 'all';

      let filtered = data.criticalPurchases.map(p => {
        const st = dbStatus.purchases[p.id];
        return {
          ...p,
          isDone: Boolean(st && st.done),
          doneAt: st ? st.updatedAt : null
        };
      });

      if (statusFilter === 'done') filtered = filtered.filter(p => p.isDone);
      if (statusFilter === 'pending') filtered = filtered.filter(p => !p.isDone);
      if (q) {
        filtered = filtered.filter(p =>
          p.codigo.toLowerCase().includes(q) ||
          p.descricao.toLowerCase().includes(q) ||
          p.ncm.includes(q)
        );
      }

      const totalPecas = filtered.reduce((acc, p) => acc + p.deficitPecas, 0);
      const totalValor = filtered.reduce((acc, p) => acc + p.valorTotal, 0);

      return jsonRes({
        total: filtered.length,
        totalPecas,
        totalValor,
        items: filtered,
        progress: getProgressStats().purchases
      });
    }

    // 8. /api/positive
    if (pathname === '/api/positive') {
      const q = (searchParams.get('search') || '').toLowerCase();
      const ncm = searchParams.get('ncm') || '';
      const page = parseInt(searchParams.get('page') || '1', 10);
      const limit = parseInt(searchParams.get('limit') || '50', 10);

      let filtered = data.positiveStock;
      if (ncm) filtered = filtered.filter(p => p.ncm.includes(ncm));
      if (q) {
        filtered = filtered.filter(p =>
          p.codigo.toLowerCase().includes(q) ||
          p.descricao.toLowerCase().includes(q) ||
          p.ncm.includes(q)
        );
      }

      const total = filtered.length;
      const start = (page - 1) * limit;
      const items = filtered.slice(start, start + limit);

      return jsonRes({
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        items
      });
    }

    // 9. /api/product/:id
    if (pathname.startsWith('/api/product/')) {
      const code = decodeURIComponent(pathname.replace('/api/product/', '')).trim();
      const itemReclass = data.reclassifications.find(r => r.codigo === code);
      const itemTransfers = data.transfers.filter(t => t.codigo === code);
      const itemCrit = data.criticalPurchases.find(p => p.codigo === code);
      const itemPos = data.positiveStock.find(p => p.codigo === code);

      if (!itemReclass && itemTransfers.length === 0 && !itemCrit && !itemPos) {
        return jsonRes({ error: 'Produto não encontrado', code }, 404);
      }

      const base = itemReclass || itemCrit || itemPos || itemTransfers[0];
      const prod = {
        codigo: code,
        descricao: base.descricao,
        ncm: base.ncm,
        emb: base.emb || 'UN',
        filtro: itemTransfers.length > 0 ? 'Filtro 2 (Transferências)' : (itemReclass ? 'Filtro 4 (Reclassificação)' : (itemCrit ? 'Filtro 3 (Compra Crítica)' : 'Filtro 1 (Saldo Seguro)')),
        transferencias: itemTransfers,
        reclassificacao: itemReclass || null,
        saldos: base.saldos || { loja1: base.saldoLoja1 || 0, loja2: base.saldoLoja2 || 0, loja3: base.saldoLoja3 || 0 },
        deficit: itemCrit ? itemCrit.deficitPecas : (itemReclass ? itemReclass.deficit : 0),
        custoUnit: base.custoUnit || 0,
        valorDeficit: itemCrit ? itemCrit.valorTotal : 0,
        motivo: base.motivo || ''
      };
      return jsonRes(prod);
    }

    // 10. /api/export/reclass-erp-txt
    if (pathname === '/api/export/reclass-erp-txt') {
      const status = searchParams.get('status') || '';
      const statusFilter = searchParams.get('statusFilter') || 'all';
      const q = (searchParams.get('search') || '').toLowerCase();
      const scope = searchParams.get('scope') || 'batch'; // 'batch', 'page', 'all'
      const page = parseInt(searchParams.get('page') || '1', 10);
      const limit = parseInt(searchParams.get('limit') || '50', 10);
      const batchSize = parseInt(searchParams.get('batchSize') || '100', 10);
      const batchIndex = parseInt(searchParams.get('batchIndex') || '1', 10);
      const format = searchParams.get('format') || 'json';
      const singleCode = searchParams.get('code') || '';
      const store = searchParams.get('store') || '';
      const donorStore = searchParams.get('donorStore') || '';
      const includeCostBlock1 = searchParams.get('includeCostBlock1') !== '0';
      const includeCostBlock2 = searchParams.get('includeCostBlock2') !== '0';

      let filtered = data.reclassifications.map(r => {
        const st = dbStatus.reclassifications[r.codigo] || dbStatus.reclassifications[r.id];
        return {
          ...r,
          isDone: Boolean(st && st.done)
        };
      });

      if (singleCode) {
        filtered = filtered.filter(r => r.codigo === singleCode);
      } else {
        if (statusFilter === 'done') filtered = filtered.filter(r => r.isDone);
        if (statusFilter === 'pending') filtered = filtered.filter(r => !r.isDone);
        if (status) filtered = filtered.filter(r => r.status === status);
        if (store === '1') filtered = filtered.filter(r => r.saldoLoja1 < 0);
        if (store === '2') filtered = filtered.filter(r => r.saldoLoja2 < 0);
        if (store === '3') filtered = filtered.filter(r => r.saldoLoja3 < 0);

        if (donorStore === '1') filtered = filtered.filter(r => (r.doador1 && r.doador1.saldoLoja1 > 0) || (r.doador2 && r.doador2.saldoLoja1 > 0) || (r.doador3 && r.doador3.saldoLoja1 > 0));
        if (donorStore === '2') filtered = filtered.filter(r => (r.doador1 && r.doador1.saldoLoja2 > 0) || (r.doador2 && r.doador2.saldoLoja2 > 0) || (r.doador3 && r.doador3.saldoLoja2 > 0));
        if (donorStore === '3') filtered = filtered.filter(r => (r.doador1 && r.doador1.saldoLoja3 > 0) || (r.doador2 && r.doador2.saldoLoja3 > 0) || (r.doador3 && r.doador3.saldoLoja3 > 0));

        if (q) {
          filtered = filtered.filter(r =>
            r.codigo.toLowerCase().includes(q) ||
            r.descricao.toLowerCase().includes(q) ||
            r.ncm.includes(q) ||
            (r.doador1 && r.doador1.codigo && r.doador1.codigo.toLowerCase().includes(q)) ||
            (r.doador1 && r.doador1.descricao && r.doador1.descricao.toLowerCase().includes(q))
          );
        }
      }

      const totalFiltered = filtered.length;
      const totalBatches = Math.max(1, Math.ceil(totalFiltered / batchSize));

      let exportItems = filtered;
      if (singleCode) {
        exportItems = filtered.filter(r => r.codigo === singleCode);
      } else if (scope === 'batch') {
        const start = (batchIndex - 1) * batchSize;
        exportItems = filtered.slice(start, start + batchSize);
      } else if (scope === 'page') {
        const start = (page - 1) * limit;
        exportItems = filtered.slice(start, start + limit);
      }

      const donorBalances = new Map();
      const block1Map = new Map(); // donorCode -> { codigo, qtd, valor }
      const block2Map = new Map(); // recCode -> { codigo, qtd, valor }
      const ids = [];

      let totalPecasBlock1 = 0;
      let totalValorBlock1 = 0;
      let totalPecasBlock2 = 0;
      let totalValorBlock2 = 0;

      exportItems.forEach(r => {
        ids.push(r.codigo);
        let needed = r.deficit;
        if (needed <= 0) return;

        const donors = [r.doador1, r.doador2, r.doador3].filter(d => d && d.codigo && d.saldo > 0);

        for (const d of donors) {
          if (needed <= 0) break;

          if (!donorBalances.has(d.codigo)) {
            donorBalances.set(d.codigo, d.saldo);
          }

          const available = donorBalances.get(d.codigo);
          if (available <= 0) continue;

          const donateQty = Math.min(needed, available);
          if (donateQty > 0) {
            const custo = getProductCost(d.codigo);
            const valorSubtotal = donateQty * custo;

            if (!block1Map.has(d.codigo)) {
              block1Map.set(d.codigo, { codigo: d.codigo, qtd: 0, valor: 0 });
            }
            const b1Item = block1Map.get(d.codigo);
            b1Item.qtd += donateQty;
            b1Item.valor += valorSubtotal;

            if (!block2Map.has(r.codigo)) {
              block2Map.set(r.codigo, { codigo: r.codigo, qtd: 0, valor: 0 });
            }
            const b2Item = block2Map.get(r.codigo);
            b2Item.qtd += donateQty;
            b2Item.valor += valorSubtotal;

            totalPecasBlock1 += donateQty;
            totalValorBlock1 += valorSubtotal;
            totalPecasBlock2 += donateQty;
            totalValorBlock2 += valorSubtotal;

            donorBalances.set(d.codigo, available - donateQty);
            needed -= donateQty;
          }
        }
      });

      const block1Header = includeCostBlock1 ? 'CODIGO;QTD;CUSTO' : 'CODIGO;QTD';
      const block1Lines = [block1Header];
      for (const item of block1Map.values()) {
        const qtdStr = Number.isInteger(item.qtd) ? String(item.qtd) : item.qtd.toFixed(2).replace('.', ',');
        if (includeCostBlock1) {
          const custoMedio = item.qtd > 0 ? (item.valor / item.qtd) : 0;
          const custoStr = custoMedio.toFixed(2).replace('.', ',');
          block1Lines.push(`${item.codigo};${qtdStr};${custoStr}`);
        } else {
          block1Lines.push(`${item.codigo};${qtdStr}`);
        }
      }

      const block2Header = includeCostBlock2 ? 'CODIGO;QTD;CUSTO' : 'CODIGO;QTD';
      const block2Lines = [block2Header];
      for (const item of block2Map.values()) {
        const qtdStr = Number.isInteger(item.qtd) ? String(item.qtd) : item.qtd.toFixed(2).replace('.', ',');
        if (includeCostBlock2) {
          const custoMedio = item.qtd > 0 ? (item.valor / item.qtd) : 0;
          const custoStr = custoMedio.toFixed(2).replace('.', ',');
          block2Lines.push(`${item.codigo};${qtdStr};${custoStr}`);
        } else {
          block2Lines.push(`${item.codigo};${qtdStr}`);
        }
      }

      const block1Text = block1Lines.join('\r\n');
      const block2Text = block2Lines.join('\r\n');

      if (format === 'json') {
        const currentItem = exportItems[0] || null;
        return jsonRes({
          totalFiltered,
          count: exportItems.length,
          scope,
          batchInfo: {
            currentBatch: batchIndex,
            totalBatches,
            batchSize,
            startItem: totalFiltered > 0 ? (batchIndex - 1) * batchSize + 1 : 0,
            endItem: Math.min(batchIndex * batchSize, totalFiltered)
          },
          ids,
          isBalanced: totalPecasBlock1 === totalPecasBlock2 && Math.abs(totalValorBlock1 - totalValorBlock2) < 0.05,
          block1: {
            title: 'BLOCO 1 - ITENS QUE VÃO SAIR / DOAR (SAÍDA)',
            count: block1Lines.length - 1,
            totalPecas: totalPecasBlock1,
            totalValor: totalValorBlock1,
            includeCost: includeCostBlock1,
            format: block1Header,
            text: block1Text
          },
          block2: {
            title: 'BLOCO 2 - ITENS QUE VÃO ENTRAR / RECEBER (ENTRADA)',
            count: block2Lines.length - 1,
            totalPecas: totalPecasBlock2,
            totalValor: totalValorBlock2,
            includeCost: includeCostBlock2,
            format: block2Header,
            text: block2Text
          },
          product: currentItem ? { codigo: currentItem.codigo, descricao: currentItem.descricao, ncm: currentItem.ncm, deficit: currentItem.deficit } : null,
          donor1: currentItem ? currentItem.doador1 : null,
          block1Text: block1Text,
          block2Text: block2Text,
          block1Count: block1Lines.length - 1,
          block2Count: block2Lines.length - 1,
          block1Pieces: totalPecasBlock1,
          block2Pieces: totalPecasBlock2
        });
      }

      if (format === 'block1') {
        return new Response(block1Text, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': 'attachment; filename="reclassificacao_BLOCO1_SAIDA_DOADORES.txt"'
          }
        });
      }

      if (format === 'block2') {
        return new Response(block2Text, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': 'attachment; filename="reclassificacao_BLOCO2_ENTRADA_RECEBIMENTO.txt"'
          }
        });
      }

      const combined = [
        '# ========================================================',
        '# BLOCO 1 - ITENS QUE VÃO SAIR / DOAR (DEDUÇÃO DOADOR)',
        `# Formato: ${block1Header}`,
        '# ========================================================',
        block1Text,
        '',
        '# ========================================================',
        '# BLOCO 2 - ITENS QUE VÃO ENTRAR / RECEBER (ENTRADA FISCAL)',
        `# Formato: ${block2Header}`,
        '# ========================================================',
        block2Text
      ].join('\r\n');

      return new Response(combined, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': 'attachment; filename="reclassificacao_2_BLOCOS_COMPLETO.txt"'
        }
      });
    }

    // 11. /api/export/erp-txt
    if (pathname === '/api/export/erp-txt') {
      const format = searchParams.get('format') || 'text';
      const items = data.transfers;
      if (format === 'json') {
        const text = items.map(t => `${t.codigo};${t.qtd}`).join('\r\n') + '\r\n';
        return jsonRes({
          text,
          itemCount: items.length,
          totalPieces: items.reduce((a, b) => a + b.qtd, 0)
        });
      }
      const text = items.map(t => `${t.codigo};${t.qtd}`).join('\r\n') + '\r\n';
      return new Response(text, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': 'attachment; filename="transferencias_erp.txt"'
        }
      });
    }

    // 12. /api/export/excel
    if (pathname === '/api/export/excel') {
      const type = searchParams.get('type') || 'all';
      if (window.XLSX) {
        const wb = XLSX.utils.book_new();
        if (type === 'transfers' || type === 'all') {
          const wsTransf = XLSX.utils.json_to_sheet(data.transfers.map(t => ({
            Status: dbStatus.transfers[t.id]?.done ? 'CONCLUÍDO' : 'PENDENTE',
            Código: t.codigo,
            Descrição: t.descricao,
            NCM: t.ncm,
            Origem: t.origem,
            Destino: t.destino,
            Quantidade: t.qtd,
            'Custo Unit': t.custoUnit,
            'Valor Total': t.valorTotal
          })));
          XLSX.utils.book_append_sheet(wb, wsTransf, 'Transferências');
        }
        if (type === 'reclassifications' || type === 'all') {
          const wsReclass = XLSX.utils.json_to_sheet(data.reclassifications.map(r => ({
            Status: dbStatus.reclassifications[r.codigo]?.done ? 'CONCLUÍDO' : 'PENDENTE',
            Código: r.codigo,
            Descrição: r.descricao,
            NCM: r.ncm,
            Déficit: r.deficit,
            'Doador 1 Código': r.doador1?.codigo || '',
            'Doador 1 Saldo': r.doador1?.saldo || 0
          })));
          XLSX.utils.book_append_sheet(wb, wsReclass, 'Reclassificações');
        }
        if (type === 'purchases' || type === 'all') {
          const wsPurch = XLSX.utils.json_to_sheet(data.criticalPurchases.map(p => ({
            Status: dbStatus.purchases[p.id]?.done ? 'CONCLUÍDO' : 'PENDENTE',
            Código: p.codigo,
            Descrição: p.descricao,
            NCM: p.ncm,
            Déficit: p.deficitPecas,
            'Custo Unit': p.custoUnit,
            'Valor Total': p.valorTotal,
            Motivo: p.motivo
          })));
          XLSX.utils.book_append_sheet(wb, wsPurch, 'Compras Críticas');
        }
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        return new Response(wbout, {
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="newshop_${type}.xlsx"`
          }
        });
      }
      return jsonRes({ error: 'SheetJS indisponível' });
    }

    // 13. /api/download/:filename
    if (pathname.startsWith('/api/download/')) {
      const filename = pathname.replace('/api/download/', '');
      let csvContent = '';
      if (filename.includes('transferencia')) {
        csvContent = 'Codigo;Quantidade;Origem;Destino\r\n' + data.transfers.map(t => `${t.codigo};${t.qtd};${t.origem};${t.destino}`).join('\r\n');
      } else if (filename.includes('reclassificacao')) {
        csvContent = 'Codigo;Deficit;Doador1\r\n' + data.reclassifications.map(r => `${r.codigo};${r.deficit};${r.doador1?.codigo || ''}`).join('\r\n');
      } else if (filename.includes('compra')) {
        csvContent = 'Codigo;Deficit;ValorTotal\r\n' + data.criticalPurchases.map(p => `${p.codigo};${p.deficitPecas};${p.valorTotal}`).join('\r\n');
      } else {
        csvContent = 'Código;Descrição\r\n' + data.positiveStock.slice(0, 500).map(p => `${p.codigo};${p.descricao}`).join('\r\n');
      }
      return new Response(csvContent, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`
        }
      });
    }

    return jsonRes({ error: 'Rota não encontrada' }, 404);
  };

  // Interceptador global de cliques em links de download /api/ para funcionar 100% no cliente estático
  document.addEventListener('click', async function(e) {
    const a = e.target.closest('a[href^="/api/"]');
    if (!a) return;
    e.preventDefault();
    try {
      const res = await window.fetch(a.getAttribute('href'));
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      let filename = 'download';
      const match = disposition.match(/filename="?([^"]+)"?/);
      if (match) {
        filename = match[1];
      } else if (a.hasAttribute('download') && a.getAttribute('download')) {
        filename = a.getAttribute('download');
      }
      const blobUrl = URL.createObjectURL(blob);
      const tempLink = document.createElement('a');
      tempLink.href = blobUrl;
      tempLink.download = filename;
      document.body.appendChild(tempLink);
      tempLink.click();
      document.body.removeChild(tempLink);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } catch (err) {
      console.error('Erro ao baixar arquivo no cliente:', err);
    }
  });
})();
