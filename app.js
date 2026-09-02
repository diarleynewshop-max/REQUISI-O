// Newshop Dashboard App Logic with Interactive Task Completion & Excel Sync
document.addEventListener('DOMContentLoaded', () => {
  const navItems = document.querySelectorAll('.nav-item');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const pageTitle = document.getElementById('page-title');
  const pageSubtitle = document.getElementById('page-subtitle');

  const titles = {
    overview: { title: 'Painel Geral de Estoque & Auditoria', sub: '35.361 produtos e 42.298 registros auditados (Loja 1, Depósito e CD)' },
    transfers: { title: '🚚 Transferências entre Lojas (Filtro 2)', sub: '423 movimentações calculadas para zerar saldos negativos sem compra' },
    reclassifications: { title: '🔄 Matriz de Reclassificação Fiscal por NCM (Filtro 4)', sub: '4.034 itens negativos com correspondentes de mesmo NCM (99,5% Cobertura)' },
    purchases: { title: '⚠️ Itens Críticos de Compra (Filtro 3)', sub: '23 produtos sem doador de mesmo NCM disponível na rede (R$ 1.974,91)' },
    positives: { title: '🛡️ Saldo Seguro & Base de Doadores (Filtro 1)', sub: '30.744 produtos com saldo 100% positivo em todas as lojas (R$ 18.39M)' },
    lookup: { title: '🔍 Consulta 360° de Produto no ERP', sub: 'Diagnóstico em tempo real por código ou código de barras' },
    downloads: { title: '📁 Central de Downloads & Planilhas Dinâmicas', sub: 'Baixe planilhas Excel oficiais com itens baixados pintados de verde' }
  };

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tabKey = item.getAttribute('data-tab');
      navItems.forEach(i => i.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      item.classList.add('active');
      const targetPane = document.getElementById(`tab-${tabKey}`);
      if (targetPane) targetPane.classList.add('active');

      if (titles[tabKey]) {
        pageTitle.innerText = titles[tabKey].title;
        pageSubtitle.innerText = titles[tabKey].sub;
      }

      if (tabKey === 'transfers') loadTransfers(1);
      if (tabKey === 'reclassifications') loadReclassifications(1);
      if (tabKey === 'purchases') loadPurchases();
      if (tabKey === 'positives') loadPositives(1);
    });
  });

  // Global Quick Search
  const globalSearch = document.getElementById('global-search-input');
  if (globalSearch) {
    globalSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = globalSearch.value.trim();
        if (val) {
          const lookupBtn = document.querySelector('[data-tab="lookup"]');
          if (lookupBtn) lookupBtn.click();
          const lookupInput = document.getElementById('lookup-code-input');
          if (lookupInput) {
            lookupInput.value = val;
            doProductLookup(val);
          }
        }
      }
    });
  }

  // Refresh Button
  const btnRefresh = document.getElementById('btn-refresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      loadOverview();
      loadTransfers(1);
      loadReclassifications(1);
      loadPurchases();
      loadPositives(1);
      showToast('Dados atualizados com sucesso!', 'success');
    });
  }

  // Modal Setup
  const modalBackdrop = document.getElementById('modal-backdrop');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  if (modalCloseBtn) modalCloseBtn.onclick = () => modalBackdrop.classList.add('hidden');
  if (modalBackdrop) {
    modalBackdrop.onclick = (e) => {
      if (e.target === modalBackdrop) modalBackdrop.classList.add('hidden');
    };
  }

  // Initial Load
  loadOverview();

  // -------------------------------------------------------------
  // Overview & Charts & Progress
  // -------------------------------------------------------------
  let distChart = null;
  let finChart = null;

  async function loadOverview() {
    try {
      const res = await fetch('/api/summary');
      const data = await res.json();

      if (data.summary && data.summary.metricas) {
        const m = data.summary.metricas;
        document.getElementById('kpi-g1-items').innerText = m.grupo1.qtdItens.toLocaleString('pt-BR');
        document.getElementById('kpi-g2-transfers').innerText = m.grupo2.qtdTransferenciasSugeridas.toLocaleString('pt-BR');
        document.getElementById('kpi-g4-coverage').innerText = m.grupo4_reclassificacao.taxaCoberturaRede;
        document.getElementById('kpi-g3-items').innerText = m.grupo3.qtdItens;

        renderDistributionChart([
          m.grupo1.qtdItens,
          m.grupo2.qtdItens,
          m.grupo4_reclassificacao.qtdItens,
          m.grupo3.qtdItens
        ]);

        renderFinancialChart(
          m.grupo2.valorTransferido,
          m.grupo4_reclassificacao.valorCustoFaltante,
          m.grupo3.valorCustoFaltante
        );
      }

      if (data.progress) {
        updateProgressUI(data.progress);
      }
    } catch (e) {
      console.error('Erro ao carregar resumo:', e);
    }
  }

  function updateProgressUI(prog) {
    if (!prog) return;

    // Transfers
    if (prog.transfers) {
      const t = prog.transfers;
      const tFill = document.getElementById('prog-bar-transfers');
      const tVal = document.getElementById('prog-val-transfers');
      const sideT = document.getElementById('side-badge-transfers');
      if (tFill) tFill.style.width = `${t.pct || 0}%`;
      if (tVal) tVal.innerText = `${t.done || 0} / ${(t.total || 0).toLocaleString('pt-BR')} (${t.pct || 0}%)`;
      if (sideT) sideT.innerText = `${t.done || 0} / ${(t.total || 0).toLocaleString('pt-BR')}`;
    }

    // Reclassifications
    if (prog.reclassifications) {
      const r = prog.reclassifications;
      const rFill = document.getElementById('prog-bar-reclass');
      const rVal = document.getElementById('prog-val-reclass');
      const sideR = document.getElementById('side-badge-reclass');
      if (rFill) rFill.style.width = `${r.pct || 0}%`;
      if (rVal) rVal.innerText = `${r.done || 0} / ${(r.total || 0).toLocaleString('pt-BR')} (${r.pct || 0}%)`;
      if (sideR) sideR.innerText = `${r.done || 0} / ${(r.total || 0).toLocaleString('pt-BR')}`;
    }

    // Purchases
    if (prog.purchases) {
      const p = prog.purchases;
      const pFill = document.getElementById('prog-bar-purchases');
      const pVal = document.getElementById('prog-val-purchases');
      const sideP = document.getElementById('side-badge-purchases');
      if (pFill) pFill.style.width = `${p.pct || 0}%`;
      if (pVal) pVal.innerText = `${p.done || 0} / ${p.total || 0} (${p.pct || 0}%)`;
      if (sideP) sideP.innerText = `${p.done || 0} / ${p.total || 0}`;
    }
  }

  function renderDistributionChart(dataVals) {
    const ctx = document.getElementById('chart-distribution');
    if (!ctx) return;
    if (distChart) distChart.destroy();

    distChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Filtro 1: Saldo Seguro', 'Filtro 2: Transferências', 'Filtro 4: Reclassificação NCM', 'Filtro 3: Compra Crítica'],
        datasets: [{
          data: dataVals,
          backgroundColor: ['#06b6d4', '#10b981', '#6366f1', '#f43f5e'],
          borderWidth: 2,
          borderColor: '#0b0f19'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 } }
          }
        }
      }
    });
  }

  function renderFinancialChart(transfVal, reclassVal, critVal) {
    const ctx = document.getElementById('chart-financial');
    if (!ctx) return;
    if (finChart) finChart.destroy();

    finChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Transferências (F2)', 'Reclassificação NCM (F4)', 'Compra Residual (F3)'],
        datasets: [{
          label: 'Valor Total (R$)',
          data: [transfVal, reclassVal, critVal],
          backgroundColor: ['rgba(16, 185, 129, 0.8)', 'rgba(99, 102, 241, 0.8)', 'rgba(244, 63, 94, 0.8)'],
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: { ticks: { color: '#94a3b8', font: { family: 'Inter', size: 11 } }, grid: { display: false } },
          y: {
            ticks: {
              color: '#94a3b8',
              font: { family: 'Inter', size: 11 },
              callback: (v) => 'R$ ' + (v / 1000).toFixed(0) + 'k'
            },
            grid: { color: 'rgba(255, 255, 255, 0.05)' }
          }
        }
      }
    });
  }

  // -------------------------------------------------------------
  // Toggle Status Helper & Toast
  // -------------------------------------------------------------
  async function toggleStatus(type, id, done, note = '') {
    try {
      const res = await fetch('/api/status/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id, done, note })
      });
      const data = await res.json();
      if (data.success) {
        updateProgressUI(data.progress);
        showToast(done ? `✓ Item ${id.split('_')[0]} marcado como CONCLUÍDO e salvo!` : `Item ${id.split('_')[0]} retornado para pendente.`, 'success');
        return true;
      }
    } catch (e) {
      console.error('Erro ao alternar status:', e);
      showToast('Erro ao salvar alteração.', 'error');
    }
    return false;
  }

  function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'success' ? 'toast-success' : ''}`;
    toast.innerHTML = `<span>${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  // -------------------------------------------------------------
  // TAB: TRANSFERS
  // -------------------------------------------------------------
  let currentTransferPage = 1;
  const transferSearch = document.getElementById('transfer-search');
  const transferOrigin = document.getElementById('transfer-origin-filter');
  const transferDest = document.getElementById('transfer-dest-filter');
  const transferStatus = document.getElementById('transfer-status-filter');

  let transferDebounce = null;
  [transferSearch, transferOrigin, transferDest, transferStatus].forEach(elem => {
    if (elem) {
      elem.addEventListener('input', () => {
        clearTimeout(transferDebounce);
        transferDebounce = setTimeout(() => loadTransfers(1), 300);
      });
    }
  });

  async function loadTransfers(page = 1) {
    currentTransferPage = page;
    const q = transferSearch ? transferSearch.value.trim() : '';
    const orig = transferOrigin ? transferOrigin.value : '';
    const dst = transferDest ? transferDest.value : '';
    const stFilter = transferStatus ? transferStatus.value : 'all';

    const tbody = document.getElementById('transfers-table-body');
    const metaBar = document.getElementById('transfers-meta-bar');
    const pagin = document.getElementById('transfers-pagination');

    tbody.innerHTML = '<tr><td colspan="11" class="text-center py-4">Buscando transferências...</td></tr>';

    try {
      const url = `/api/transfers?page=${page}&limit=50&search=${encodeURIComponent(q)}&origin=${encodeURIComponent(orig)}&dest=${encodeURIComponent(dst)}&statusFilter=${stFilter}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.progress) {
        updateProgressUI({ transfers: data.progress });
      }

      metaBar.innerHTML = `<span>Exibindo <strong>${data.items.length}</strong> de <strong>${data.total.toLocaleString('pt-BR')}</strong> transferências (${data.progress ? data.progress.done : 0} concluídas)</span> <span>Volume Total: <strong>${data.totalPecas.toLocaleString('pt-BR')} peças</strong> | Valor Total: <strong>R$ ${data.totalValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>`;

      if (data.items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="text-center py-4 text-muted">Nenhuma transferência encontrada para os filtros selecionados.</td></tr>';
        pagin.innerHTML = '';
        return;
      }

      tbody.innerHTML = data.items.map(t => `
        <tr class="${t.isDone ? 'row-done' : ''}" id="row-transf-${t.id.replace(/[^a-zA-Z0-9]/g, '_')}">
          <td style="text-align:center;">
            <input type="checkbox" class="item-checkbox" ${t.isDone ? 'checked' : ''} onchange="handleTransferToggle('${t.id}', this)">
          </td>
          <td><code style="color:#60a5fa; font-weight:600;">${t.codigo}</code></td>
          <td>
            <strong>${t.descricao}</strong>
            ${t.isDone ? '<span class="tag-status tag-success" style="margin-left:8px; font-size:0.68rem;">✓ CONCLUÍDO</span>' : ''}
          </td>
          <td><span class="badge badge-cyan">${t.ncm}</span></td>
          <td>
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="tag-status tag-info" style="font-size:0.75rem;">${t.origem}</span>
              <span style="color:#94a3b8;">➔</span>
              <span class="tag-status tag-success" style="font-size:0.75rem;">${t.destino}</span>
            </div>
          </td>
          <td><strong style="color:#34d399; font-size:0.95rem;">${t.qtd.toLocaleString('pt-BR')} un</strong></td>
          <td>R$ ${t.custoUnit.toFixed(2)}</td>
          <td><strong>R$ ${t.valorTotal.toFixed(2)}</strong></td>
          <td><span style="color:#94a3b8;">${t.saldoOrigemAntes}</span> ➔ <strong style="color:#38bdf8;">${t.saldoOrigemDepois}</strong></td>
          <td><span style="color:#fb7185;">${t.saldoDestinoAntes}</span> ➔ <strong style="color:#34d399;">${t.saldoDestinoDepois}</strong></td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="quickLookup('${t.codigo}')" style="padding:4px 8px; font-size:0.75rem;">
              Ficha
            </button>
          </td>
        </tr>
      `).join('');

      renderPagination(pagin, data.page, data.totalPages, loadTransfers);
    } catch (e) {
      console.error(e);
      tbody.innerHTML = '<tr><td colspan="11" class="text-center py-4 text-danger">Erro ao carregar transferências.</td></tr>';
    }
  }

  window.handleTransferToggle = async function(id, checkbox) {
    const isDone = checkbox.checked;
    const cleanId = id.replace(/[^a-zA-Z0-9]/g, '_');
    const row = document.getElementById(`row-transf-${cleanId}`);
    if (row) {
      if (isDone) row.classList.add('row-done');
      else row.classList.remove('row-done');
    }
    await toggleStatus('transfers', id, isDone);
  };

  // -------------------------------------------------------------
  // TAB: RECLASSIFICATIONS
  // -------------------------------------------------------------
  const reclassSearch = document.getElementById('reclass-search');
  const reclassStatus = document.getElementById('reclass-status-filter');
  const reclassDoneFilter = document.getElementById('reclass-done-filter');
  const reclassStoreFilter = document.getElementById('reclass-store-filter');
  const reclassDonorStoreFilter = document.getElementById('reclass-donor-store-filter');
  
  // Batch Manager Elements
  const reclassBatchDropdown = document.getElementById('reclass-batch-dropdown');
  const btnReclassBatchPrev = document.getElementById('btn-reclass-batch-prev');
  const btnReclassBatchNext = document.getElementById('btn-reclass-batch-next');
  const btnMarkReclassBatchDone = document.getElementById('btn-mark-reclass-batch-done');
  const btnUnmarkReclassBatchDone = document.getElementById('btn-unmark-reclass-batch-done');
  const btnBatchGenerateErp = document.getElementById('btn-batch-generate-erp');
  const reclassBatchBadge = document.getElementById('reclass-batch-badge');
  const reclassBatchProgressText = document.getElementById('reclass-batch-progress-text');
  const reclassBatchRangeText = document.getElementById('reclass-batch-range-text');
  const reclassBatchProgBar = document.getElementById('reclass-batch-prog-bar');

  let currentReclassBatch = '1';
  let currentReclassBatchSize = 100;
  let currentReclassBatchInfo = null;
  let reclassDebounce = null;

  if (reclassBatchDropdown) {
    reclassBatchDropdown.addEventListener('change', () => {
      currentReclassBatch = reclassBatchDropdown.value;
      loadReclassifications(1);
    });
  }

  if (btnReclassBatchPrev) {
    btnReclassBatchPrev.addEventListener('click', () => {
      if (currentReclassBatch !== 'all' && parseInt(currentReclassBatch, 10) > 1) {
        currentReclassBatch = String(parseInt(currentReclassBatch, 10) - 1);
        if (reclassBatchDropdown) reclassBatchDropdown.value = currentReclassBatch;
        loadReclassifications(1);
      }
    });
  }

  if (btnReclassBatchNext) {
    btnReclassBatchNext.addEventListener('click', () => {
      if (currentReclassBatch !== 'all' && currentReclassBatchInfo && parseInt(currentReclassBatch, 10) < currentReclassBatchInfo.totalBatches) {
        currentReclassBatch = String(parseInt(currentReclassBatch, 10) + 1);
        if (reclassBatchDropdown) reclassBatchDropdown.value = currentReclassBatch;
        loadReclassifications(1);
      }
    });
  }

  if (btnMarkReclassBatchDone) {
    btnMarkReclassBatchDone.addEventListener('click', async () => {
      if (!currentReclassBatchInfo || !currentReclassBatchInfo.ids || currentReclassBatchInfo.ids.length === 0) {
        showToast('Nenhum item encontrado no lote selecionado.', 'error');
        return;
      }
      const bName = currentReclassBatch === 'all' ? 'todos os itens filtrados' : `Lote ${currentReclassBatch}`;
      const ok = await batchToggleStatus('reclassifications', currentReclassBatchInfo.ids, true, `Baixa em lote (${bName})`);
      if (ok) {
        showToast(`✓ ${bName} (${currentReclassBatchInfo.ids.length} itens) marcado como CONCLUÍDO!`, 'success');
        loadReclassifications(currentReclassPage);
      }
    });
  }

  if (btnUnmarkReclassBatchDone) {
    btnUnmarkReclassBatchDone.addEventListener('click', async () => {
      if (!currentReclassBatchInfo || !currentReclassBatchInfo.ids || currentReclassBatchInfo.ids.length === 0) {
        showToast('Nenhum item encontrado no lote selecionado.', 'error');
        return;
      }
      const bName = currentReclassBatch === 'all' ? 'todos os itens filtrados' : `Lote ${currentReclassBatch}`;
      const ok = await batchToggleStatus('reclassifications', currentReclassBatchInfo.ids, false, `Desmarcação (${bName})`);
      if (ok) {
        showToast(`↩ ${bName} (${currentReclassBatchInfo.ids.length} itens) desmarcado.`, 'info');
        loadReclassifications(currentReclassPage);
      }
    });
  }

  if (btnBatchGenerateErp) {
    btnBatchGenerateErp.addEventListener('click', () => {
      const bIdx = currentReclassBatch === 'all' ? 1 : parseInt(currentReclassBatch, 10);
      const sc = currentReclassBatch === 'all' ? 'all' : 'batch';
      openReclassErpExportModal(sc, bIdx);
    });
  }

  [reclassSearch, reclassStatus, reclassDoneFilter, reclassStoreFilter, reclassDonorStoreFilter].forEach(elem => {
    if (elem) {
      elem.addEventListener('input', () => {
        clearTimeout(reclassDebounce);
        reclassDebounce = setTimeout(() => loadReclassifications(1), 300);
      });
      elem.addEventListener('change', () => {
        loadReclassifications(1);
      });
    }
  });

  async function loadReclassifications(page = 1) {
    currentReclassPage = page;
    const q = reclassSearch ? reclassSearch.value.trim() : '';
    const status = reclassStatus ? reclassStatus.value : '';
    const stFilter = reclassDoneFilter ? reclassDoneFilter.value : 'all';
    const store = reclassStoreFilter ? reclassStoreFilter.value : '';
    const donorStore = reclassDonorStoreFilter ? reclassDonorStoreFilter.value : '';

    const tbody = document.getElementById('reclass-table-body');
    const metaBar = document.getElementById('reclass-meta-bar');
    const pagin = document.getElementById('reclass-pagination');

    tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4">Buscando matriz de reclassificação...</td></tr>';

    try {
      const url = `/api/reclassifications?page=${page}&limit=50&search=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&statusFilter=${stFilter}&store=${encodeURIComponent(store)}&donorStore=${encodeURIComponent(donorStore)}&batch=${encodeURIComponent(currentReclassBatch)}&batchSize=${currentReclassBatchSize}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.progress) {
        updateProgressUI({ reclassifications: data.progress });
      }

      // Update Batch Manager UI
      if (data.batchInfo) {
        currentReclassBatchInfo = data.batchInfo;
        const bInfo = data.batchInfo;
        const isAll = bInfo.currentBatch === 'all';
        const bNum = isAll ? 'Todos' : bInfo.currentBatch;

        // Populate dropdown with all batches and completion stats
        if (data.batchesSummary && reclassBatchDropdown) {
          const currentVal = currentReclassBatch;
          reclassBatchDropdown.innerHTML = `
            ${data.batchesSummary.map(b => `
              <option value="${b.batchNum}" ${String(currentVal) === String(b.batchNum) ? 'selected' : ''}>
                ${b.isComplete ? '✓ ' : ''}📦 Lote ${b.batchNum} (${b.done}/${b.total} · ${b.pct}%${b.isComplete ? ' Feito' : ''})
              </option>
            `).join('')}
            <option value="all" ${currentVal === 'all' ? 'selected' : ''}>🌐 Todos os Lotes (${data.totalFiltered.toLocaleString('pt-BR')} itens)</option>
          `;
        }

        // Update badge
        if (reclassBatchBadge) {
          if (isAll) {
            reclassBatchBadge.className = 'batch-status-badge ' + (bInfo.isComplete ? 'badge-emerald' : 'badge-indigo');
            reclassBatchBadge.innerHTML = `Todos os Lotes: ${bInfo.done.toLocaleString('pt-BR')} / ${bInfo.count.toLocaleString('pt-BR')} (${bInfo.pct}%)`;
          } else if (bInfo.isComplete) {
            reclassBatchBadge.className = 'batch-status-badge badge-emerald';
            reclassBatchBadge.innerHTML = `✓ Lote ${bNum}: 100% Concluído (${bInfo.done}/${bInfo.count})`;
          } else if (bInfo.done > 0) {
            reclassBatchBadge.className = 'batch-status-badge badge-indigo';
            reclassBatchBadge.innerHTML = `⏳ Lote ${bNum}: Em Andamento (${bInfo.done}/${bInfo.count} · ${bInfo.pct}%)`;
          } else {
            reclassBatchBadge.className = 'batch-status-badge badge-rose';
            reclassBatchBadge.innerHTML = `⏳ Lote ${bNum}: Pendente (0/${bInfo.count})`;
          }
        }

        // Update progress text & bar
        if (reclassBatchProgressText) {
          reclassBatchProgressText.innerHTML = isAll 
            ? `Progresso Geral: <strong>${bInfo.done.toLocaleString('pt-BR')} de ${bInfo.count.toLocaleString('pt-BR')} itens concluídos (${bInfo.pct}%)</strong>`
            : `Progresso do Lote ${bNum}: <strong>${bInfo.done} de ${bInfo.count} itens concluídos (${bInfo.pct}%)</strong>`;
        }

        if (reclassBatchRangeText) {
          reclassBatchRangeText.innerText = isAll ? `${bInfo.count} itens no filtro` : `Itens #${bInfo.startItem} a #${bInfo.endItem}`;
        }

        if (reclassBatchProgBar) {
          reclassBatchProgBar.style.width = `${bInfo.pct}%`;
          if (bInfo.isComplete) {
            reclassBatchProgBar.className = 'prog-bar-fill bg-emerald';
          } else {
            reclassBatchProgBar.className = 'prog-bar-fill bg-indigo';
          }
        }

        // Nav buttons state
        if (btnReclassBatchPrev) {
          btnReclassBatchPrev.disabled = isAll || parseInt(bInfo.currentBatch, 10) <= 1;
        }
        if (btnReclassBatchNext) {
          btnReclassBatchNext.disabled = isAll || parseInt(bInfo.currentBatch, 10) >= bInfo.totalBatches;
        }

        // Action button labels
        if (btnMarkReclassBatchDone) {
          btnMarkReclassBatchDone.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span>✓ Marcar ${isAll ? 'Todos' : 'Lote ' + bNum} como Feito (${bInfo.count} itens)</span>
          `;
        }
        if (btnUnmarkReclassBatchDone) {
          btnUnmarkReclassBatchDone.innerHTML = `
            <span>↩ Desmarcar ${isAll ? 'Todos' : 'Lote ' + bNum}</span>
          `;
        }
      }

      const batchLabel = currentReclassBatch === 'all' ? 'todos os lotes' : `Lote ${currentReclassBatch}`;
      metaBar.innerHTML = `<span>Exibindo <strong>${data.items.length}</strong> de <strong>${data.total.toLocaleString('pt-BR')}</strong> itens (${batchLabel}) | Total concluídos no ERP: <strong>${data.progress ? data.progress.done : 0}</strong></span> <span>Déficit exibido: <strong>${data.totalDeficit.toLocaleString('pt-BR')} peças</strong></span>`;

      if (data.items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted">Nenhum registro encontrado para este lote/filtro.</td></tr>';
        pagin.innerHTML = '';
        return;
      }

      tbody.innerHTML = data.items.map(r => {
        const sL1 = Number(r.saldoLoja1) || 0;
        const sL2 = Number(r.saldoLoja2) || 0;
        const sL3 = Number(r.saldoLoja3) || 0;
        const d1 = r.doador1 || {};
        const d1_l1 = Number(d1.saldoLoja1) || 0;
        const d1_l2 = Number(d1.saldoLoja2) || 0;
        const d1_l3 = Number(d1.saldoLoja3) || 0;
        const d1_saldo = Number(d1.saldo) || 0;
        const d2 = r.doador2 || {};
        const d3 = r.doador3 || {};
        const deficit = Number(r.deficit) || 0;
        const saldoDispNcm = Number(r.saldoDisponivelNcm) || 0;

        return `
        <tr class="${r.isDone ? 'row-done' : ''}" id="row-reclass-${r.codigo}">
          <td style="text-align:center;">
            <input type="checkbox" class="item-checkbox" ${r.isDone ? 'checked' : ''} onchange="handleReclassToggle('${r.codigo}', this)">
          </td>
          <td>
            <div style="font-weight:600; color:#fff;">${r.descricao || ''}</div>
            <div style="font-size:0.75rem; color:#60a5fa; font-family:var(--font-mono); margin-top:2px;">
              Cód: ${r.codigo} ${r.isDone ? '<span class="tag-status tag-success" style="margin-left:6px; font-size:0.68rem;">✓ RECLASSIFICADO</span>' : ''}
            </div>
            <!-- Separação de Estoque por Loja (Item Negativo) -->
            <div style="margin-top:5px; display:flex; gap:4px; flex-wrap:wrap; font-size:0.7rem;">
              <span class="badge ${sL1 < 0 ? 'badge-rose' : 'badge-dim'}" title="Saldo Loja 1 (Loja)">Loja 1: ${sL1.toFixed(0)}</span>
              <span class="badge ${sL2 < 0 ? 'badge-rose' : 'badge-dim'}" title="Saldo Loja 2 (Depósito)">Dep: ${sL2.toFixed(0)}</span>
              <span class="badge ${sL3 < 0 ? 'badge-rose' : 'badge-dim'}" title="Saldo Loja 3 (CD)">CD: ${sL3.toFixed(0)}</span>
            </div>
          </td>
          <td><span class="badge badge-indigo">${r.ncm || ''}</span></td>
          <td><strong style="color:#fb7185;">${deficit.toLocaleString('pt-BR')} un</strong></td>
          <td>
            <span class="tag-status ${r.status === 'COBERTURA_TOTAL' ? 'tag-success' : 'tag-danger'}">
              ${r.status === 'COBERTURA_TOTAL' ? '✓ Cobertura Total' : 'Parcial'}
            </span>
          </td>
          <td><strong style="color:#38bdf8;">${saldoDispNcm.toLocaleString('pt-BR')} un</strong></td>
          <td>
            ${d1.codigo ? `
              <div style="font-size:0.8rem; font-weight:600; color:#34d399;">Cód ${d1.codigo} (${d1_saldo.toLocaleString('pt-BR')} un)</div>
              <div style="font-size:0.72rem; color:#94a3b8; max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${d1.descricao || ''}</div>
              <!-- Separação de Estoque por Loja (Doador 1) -->
              <div style="margin-top:4px; display:flex; gap:4px; flex-wrap:wrap; font-size:0.68rem;">
                <span class="badge ${d1_l3 > 0 ? 'badge-emerald' : 'badge-dim'}" title="Saldo no CD (Loja 3)">CD: ${d1_l3.toFixed(0)}</span>
                <span class="badge ${d1_l1 > 0 ? 'badge-cyan' : 'badge-dim'}" title="Saldo na Loja 1">L1: ${d1_l1.toFixed(0)}</span>
                <span class="badge ${d1_l2 > 0 ? 'badge-cyan' : 'badge-dim'}" title="Saldo no Depósito">Dep: ${d1_l2.toFixed(0)}</span>
              </div>
            ` : '<span style="color:#64748b;">Nenhum</span>'}
          </td>
          <td>
            ${d2.codigo ? `
              <div style="margin-bottom:3px;"><span class="badge badge-cyan" title="${d2.descricao || ''}">Cód ${d2.codigo} (${Number(d2.saldo || 0)} un)</span></div>
              <div style="font-size:0.65rem; color:#64748b;">CD: ${Number(d2.saldoLoja3 || 0)} | L1: ${Number(d2.saldoLoja1 || 0)}</div>
            ` : ''}
            ${d3.codigo ? `
              <div style="margin-top:4px;"><span class="badge badge-cyan" title="${d3.descricao || ''}">Cód ${d3.codigo} (${Number(d3.saldo || 0)} un)</span></div>
              <div style="font-size:0.65rem; color:#64748b;">CD: ${Number(d3.saldoLoja3 || 0)} | L1: ${Number(d3.saldoLoja1 || 0)}</div>
            ` : ''}
          </td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="showReclassModal('${r.codigo}')" style="padding:4px 10px; font-size:0.75rem;">
              Simular
            </button>
          </td>
        </tr>`;
      }).join('');

      renderPagination(pagin, data.page, data.totalPages, loadReclassifications);
    } catch (e) {
      console.error(e);
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-danger">Erro ao carregar reclassificações.</td></tr>';
    }
  }

  window.handleReclassToggle = async function(codigo, checkbox) {
    const isDone = checkbox.checked;
    const row = document.getElementById(`row-reclass-${codigo}`);
    if (row) {
      if (isDone) row.classList.add('row-done');
      else row.classList.remove('row-done');
    }
    await toggleStatus('reclassifications', codigo, isDone);
    // Reload slightly to update batch progress accurately
    loadReclassifications(currentReclassPage);
  };

  // -------------------------------------------------------------
  // TAB: CRITICAL PURCHASES
  // -------------------------------------------------------------
  const purchaseSearch = document.getElementById('purchases-search');
  const purchasesStatus = document.getElementById('purchases-status-filter');

  [purchaseSearch, purchasesStatus].forEach(elem => {
    if (elem) elem.addEventListener('input', () => loadPurchases());
  });

  async function loadPurchases() {
    const q = purchaseSearch ? purchaseSearch.value.trim() : '';
    const stFilter = purchasesStatus ? purchasesStatus.value : 'all';
    const tbody = document.getElementById('purchases-table-body');
    const metaBar = document.getElementById('purchases-meta-bar');

    tbody.innerHTML = '<tr><td colspan="11" class="text-center py-4">Buscando compras críticas...</td></tr>';

    try {
      const res = await fetch(`/api/purchases?search=${encodeURIComponent(q)}&statusFilter=${stFilter}`);
      const data = await res.json();

      if (data.progress) {
        updateProgressUI({ purchases: data.progress });
      }

      metaBar.innerHTML = `<span>Total: <strong>${data.total} itens</strong> (${data.progress ? data.progress.done : 0} comprados)</span> <span>Déficit: <strong>${data.totalPecas.toLocaleString('pt-BR')} peças</strong> | Valor Total Compra: <strong style="color:#fb7185;">R$ ${data.totalValor.toFixed(2)}</strong></span>`;

      if (data.items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="text-center py-4 text-muted">Nenhum item crítico encontrado.</td></tr>';
        return;
      }

      tbody.innerHTML = data.items.map(p => `
        <tr class="${p.isDone ? 'row-done' : ''}" id="row-purchase-${p.codigo}">
          <td style="text-align:center;">
            <input type="checkbox" class="item-checkbox" ${p.isDone ? 'checked' : ''} onchange="handlePurchaseToggle('${p.codigo}', this)">
          </td>
          <td><code style="color:#fb7185; font-weight:600;">${p.codigo}</code></td>
          <td>
            <strong>${p.descricao}</strong>
            ${p.isDone ? '<span class="tag-status tag-success" style="margin-left:6px; font-size:0.68rem;">✓ COMPRADO</span>' : ''}
          </td>
          <td><span class="badge badge-rose">${p.ncm}</span></td>
          <td style="color:${p.saldoLoja1 < 0 ? '#fb7185' : '#94a3b8'};">${p.saldoLoja1.toFixed(2)}</td>
          <td style="color:${p.saldoLoja2 < 0 ? '#fb7185' : '#94a3b8'};">${p.saldoLoja2.toFixed(2)}</td>
          <td style="color:${p.saldoLoja3 < 0 ? '#fb7185' : '#94a3b8'};">${p.saldoLoja3.toFixed(2)}</td>
          <td><strong style="color:#fb7185; font-size:0.95rem;">${p.deficitPecas.toFixed(2)} un</strong></td>
          <td>R$ ${p.custoUnit.toFixed(2)}</td>
          <td><strong style="color:#fb7185;">R$ ${p.valorTotal.toFixed(2)}</strong></td>
          <td><span class="tag-status tag-danger" style="font-size:0.72rem;">${p.motivo}</span></td>
        </tr>
      `).join('');
    } catch (e) {
      console.error(e);
      tbody.innerHTML = '<tr><td colspan="11" class="text-center py-4 text-danger">Erro ao carregar compras críticas.</td></tr>';
    }
  }

  window.handlePurchaseToggle = async function(codigo, checkbox) {
    const isDone = checkbox.checked;
    const row = document.getElementById(`row-purchase-${codigo}`);
    if (row) {
      if (isDone) row.classList.add('row-done');
      else row.classList.remove('row-done');
    }
    await toggleStatus('purchases', codigo, isDone);
  };

  // -------------------------------------------------------------
  // TAB: POSITIVE STOCK (FILTRO 1)
  // -------------------------------------------------------------
  const positiveSearch = document.getElementById('positive-search');
  let posDebounce = null;
  if (positiveSearch) {
    positiveSearch.addEventListener('input', () => {
      clearTimeout(posDebounce);
      posDebounce = setTimeout(() => loadPositives(1), 300);
    });
  }

  async function loadPositives(page = 1) {
    const q = positiveSearch ? positiveSearch.value.trim() : '';
    const tbody = document.getElementById('positive-table-body');
    const metaBar = document.getElementById('positive-meta-bar');
    const pagin = document.getElementById('positive-pagination');

    tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4">Buscando itens positivos...</td></tr>';

    try {
      const res = await fetch(`/api/positive?page=${page}&limit=50&search=${encodeURIComponent(q)}`);
      const data = await res.json();

      metaBar.innerHTML = `<span>Exibindo <strong>${data.items.length}</strong> de <strong>${data.total.toLocaleString('pt-BR')}</strong> produtos com saldo seguro</span>`;

      if (data.items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted">Nenhum produto encontrado.</td></tr>';
        pagin.innerHTML = '';
        return;
      }

      tbody.innerHTML = data.items.map(p => `
        <tr>
          <td><code style="color:#22d3ee; font-weight:600;">${p.codigo}</code></td>
          <td><strong>${p.descricao}</strong></td>
          <td><span class="badge badge-cyan">${p.ncm}</span></td>
          <td>${p.saldoLoja1.toFixed(2)}</td>
          <td>${p.saldoLoja2.toFixed(2)}</td>
          <td>${p.saldoLoja3.toFixed(2)}</td>
          <td><strong style="color:#34d399; font-size:0.95rem;">${p.saldoTotal.toLocaleString('pt-BR')} un</strong></td>
          <td>R$ ${p.custoUnit.toFixed(2)}</td>
          <td><strong style="color:#38bdf8;">R$ ${p.valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></td>
        </tr>
      `).join('');

      renderPagination(pagin, data.page, data.totalPages, loadPositives);
    } catch (e) {
      console.error(e);
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-danger">Erro ao carregar dados.</td></tr>';
    }
  }

  // -------------------------------------------------------------
  // Quick Lookup helper
  // -------------------------------------------------------------
  window.quickLookup = function(code) {
    const lookupBtn = document.querySelector('[data-tab="lookup"]');
    if (lookupBtn) lookupBtn.click();
    const lookupInput = document.getElementById('lookup-code-input');
    if (lookupInput) {
      lookupInput.value = code;
      doProductLookup(code);
    }
  };

  // -------------------------------------------------------------
  // TAB: 360 PRODUCT LOOKUP
  // -------------------------------------------------------------
  const lookupInput = document.getElementById('lookup-code-input');
  const btnLookup = document.getElementById('btn-do-lookup');
  const lookupResultArea = document.getElementById('lookup-result-area');

  if (btnLookup && lookupInput) {
    btnLookup.onclick = () => doProductLookup(lookupInput.value.trim());
    lookupInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doProductLookup(lookupInput.value.trim());
    });
  }

  document.querySelectorAll('.tag-btn').forEach(btn => {
    btn.onclick = () => {
      const code = btn.getAttribute('data-code');
      lookupInput.value = code;
      doProductLookup(code);
    };
  });

  async function doProductLookup(code) {
    if (!code) return;
    lookupResultArea.classList.remove('hidden');
    lookupResultArea.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8;">Consultando produto no catálogo...</div>';

    try {
      const res = await fetch(`/api/product/${encodeURIComponent(code)}`);
      if (!res.ok) {
        lookupResultArea.innerHTML = `
          <div style="padding:20px; text-align:center; color:#fb7185;">
            <h3>Produto não encontrado</h3>
            <p>O código "${code}" não foi localizado na base de dados auditada.</p>
          </div>
        `;
        return;
      }
      const prod = await res.json();

      let transfersHtml = '';
      if (prod.transferencias && prod.transferencias.length > 0) {
        transfersHtml = `
          <div style="margin-top:16px; background:rgba(16,185,129,0.06); padding:16px; border-radius:8px; border:1px solid rgba(16,185,129,0.2);">
            <h4 style="color:#34d399; margin-bottom:8px;">🚚 Transferência Sugerida para este Produto:</h4>
            ${prod.transferencias.map(t => `
              <div style="display:flex; justify-content:space-between; font-size:0.85rem; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
                <span>Transferir <strong>${t.qtd} un</strong> de <strong>${t.origem}</strong> para <strong>${t.destino}</strong></span>
                <span>Valor: <strong>R$ ${t.valorTotal.toFixed(2)}</strong></span>
              </div>
            `).join('')}
          </div>
        `;
      }

      let reclassHtml = '';
      if (prod.reclassificacao) {
        const r = prod.reclassificacao;
        reclassHtml = `
          <div style="margin-top:16px; background:rgba(99,102,241,0.06); padding:16px; border-radius:8px; border:1px solid rgba(99,102,241,0.2);">
            <h4 style="color:#818cf8; margin-bottom:8px;">🔄 Reclassificação NCM Sugerida (${r.status}):</h4>
            <p style="font-size:0.85rem; color:#cbd5e1;">Déficit de <strong>${r.deficit} un</strong> pode ser compensado usando:</p>
            <ul style="margin-top:8px; padding-left:20px; font-size:0.85rem; color:#94a3b8;">
              ${r.doador1.codigo ? `<li><strong>Doador Principal:</strong> Cód ${r.doador1.codigo} - ${r.doador1.descricao} (Saldo: <span style="color:#34d399;">${r.doador1.saldo} un</span>)</li>` : ''}
              ${r.doador2.codigo ? `<li><strong>Doador Secundário:</strong> Cód ${r.doador2.codigo} - ${r.doador2.descricao} (Saldo: ${r.doador2.saldo} un)</li>` : ''}
            </ul>
          </div>
        `;
      }

      lookupResultArea.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; border-bottom:1px solid var(--border-color); padding-bottom:16px;">
          <div>
            <span class="badge badge-cyan" style="font-size:0.8rem;">Código: ${prod.codigo}</span>
            <h2 style="font-size:1.3rem; margin-top:6px; color:#fff;">${prod.descricao}</h2>
            <div style="font-size:0.85rem; color:#94a3b8; margin-top:4px;">NCM: <strong style="color:#fff;">${prod.ncm}</strong> | Classificação: <strong style="color:#38bdf8;">${prod.filtro}</strong></div>
          </div>
          <button class="btn btn-primary" onclick="window.print()">Imprimir Ficha</button>
        </div>

        ${prod.saldos ? `
          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; margin-bottom:16px;">
            <div style="background:rgba(255,255,255,0.03); padding:12px; border-radius:8px; border:1px solid var(--border-color);">
              <div style="font-size:0.75rem; color:#94a3b8;">Loja 1 (Loja)</div>
              <div style="font-size:1.2rem; font-weight:700; color:${prod.saldos.loja1 < 0 ? '#fb7185' : '#34d399'};">${prod.saldos.loja1} un</div>
            </div>
            <div style="background:rgba(255,255,255,0.03); padding:12px; border-radius:8px; border:1px solid var(--border-color);">
              <div style="font-size:0.75rem; color:#94a3b8;">Loja 2 (Depósito)</div>
              <div style="font-size:1.2rem; font-weight:700; color:${prod.saldos.loja2 < 0 ? '#fb7185' : '#34d399'};">${prod.saldos.loja2} un</div>
            </div>
            <div style="background:rgba(255,255,255,0.03); padding:12px; border-radius:8px; border:1px solid var(--border-color);">
              <div style="font-size:0.75rem; color:#94a3b8;">Loja 3 (CD)</div>
              <div style="font-size:1.2rem; font-weight:700; color:${prod.saldos.loja3 < 0 ? '#fb7185' : '#34d399'};">${prod.saldos.loja3} un</div>
            </div>
          </div>
        ` : ''}

        ${transfersHtml}
        ${reclassHtml}
      `;
    } catch (e) {
      console.error(e);
      lookupResultArea.innerHTML = '<div style="padding:20px; color:#fb7185;">Erro ao realizar busca do produto.</div>';
    }
  }

  // -------------------------------------------------------------
  // Reclassification Simulation Modal
  // -------------------------------------------------------------
  window.showReclassModal = async function(code) {
    const modalBackdrop = document.getElementById('modal-backdrop');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.innerText = `Simulação de Reclassificação Fiscal - Cód ${code}`;
    modalBody.innerHTML = '<div style="text-align:center; padding:20px; color:#94a3b8;"><div class="spinner" style="margin:0 auto 10px auto;"></div>Carregando detalhes fiscais e custos...</div>';
    modalBackdrop.classList.remove('hidden');

    try {
      // 1. Busca dados do produto e da matriz
      const resProd = await fetch(`/api/product/${encodeURIComponent(code)}`);
      const prod = await resProd.json();
      const r = prod.reclassificacao;

      if (!r) {
        modalBody.innerHTML = '<p>Nenhuma reclassificação cadastrada para este código.</p>';
        return;
      }

      // 2. Busca os 2 blocos já calculados com taxa e custo rateado
      const resTxt = await fetch(`/api/export/reclass-erp-txt?code=${encodeURIComponent(code)}&format=json`);
      const txtData = await resTxt.json();

      const b1 = txtData.block1 || { text: '', count: 0, totalPecas: 0, totalValor: 0 };
      const b2 = txtData.block2 || { text: '', count: 0, totalPecas: 0, totalValor: 0 };

      modalBody.innerHTML = `
        <div class="modal-info-grid">
          <div class="modal-info-item">
            <div class="modal-info-label">Item com Déficit</div>
            <div class="modal-info-val">${prod.descricao}</div>
          </div>
          <div class="modal-info-item">
            <div class="modal-info-label">Código NCM</div>
            <div class="modal-info-val"><span class="badge badge-indigo">${prod.ncm}</span></div>
          </div>
          <div class="modal-info-item">
            <div class="modal-info-label">Déficit a Regularizar</div>
            <div class="modal-info-val" style="color:#fb7185;">${r.deficit} peças</div>
          </div>
          <div class="modal-info-item">
            <div class="modal-info-label">Saldo Disponível no NCM</div>
            <div class="modal-info-val" style="color:#34d399;">${r.saldoDisponivelNcm} peças</div>
          </div>
        </div>

        <h4 style="color:#fff; margin:16px 0 8px 0;">Doadores de Estoque Sugeridos:</h4>
        ${r.doador1 && r.doador1.codigo ? `
          <div class="modal-donor-card">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <strong style="color:#34d399;">Doador 1 (Prioritário): Cód ${r.doador1.codigo}</strong>
              <span class="badge badge-emerald">Saldo Total: ${r.doador1.saldo} un</span>
            </div>
            <p style="font-size:0.85rem; color:#cbd5e1; margin-top:4px;">${r.doador1.descricao}</p>
            <p style="font-size:0.75rem; color:#94a3b8; margin-top:6px;">
              Compensação: Subtrair <strong>${Math.min(r.deficit, r.doador1.saldo)} un</strong> do Cód ${r.doador1.codigo} e creditar no Cód ${r.codigo} com o mesmo custo do doador.
            </p>
          </div>
        ` : ''}

        ${r.doador2 && r.doador2.codigo ? `
          <div class="modal-donor-card" style="margin-top:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <strong style="color:#60a5fa;">Doador 2 (Reserva): Cód ${r.doador2.codigo}</strong>
              <span class="badge badge-cyan">Saldo: ${r.doador2.saldo} un</span>
            </div>
            <p style="font-size:0.85rem; color:#cbd5e1; margin-top:4px;">${r.doador2.descricao}</p>
          </div>
        ` : ''}

        <!-- 2 BLOCOS CODIGO;QTD OU CODIGO;QTD;CUSTO PARA ERP -->
        <div style="margin-top:16px; background:#070a12; border:1px solid var(--border-color); border-radius:8px; padding:12px;">
          <div style="font-size:0.8rem; font-weight:700; color:#fff; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
            <span>📄 Padrão ERP (CODIGO;QTD ou CODIGO;QTD;CUSTO em 2 Blocos):</span>
            <span class="badge badge-emerald" style="font-size:0.7rem;">✓ Custo Rateado 100% Equalizado</span>
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <div style="background:#0f172a; border:1px solid rgba(239,68,68,0.3); border-radius:6px; padding:10px; display:flex; flex-direction:column; justify-content:space-between;">
              <div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                  <span style="font-size:0.7rem; color:#fca5a5; font-weight:800;">🔴 BLOCO 1: SAÍDA / DOAR</span>
                  <span style="font-size:0.7rem; color:#f87171;">R$ ${b1.totalValor.toFixed(2)}</span>
                </div>
                <textarea id="modal-single-b1" readonly style="width:100%; height:70px; font-size:0.82rem; color:#fca5a5; background:#05070c; border:1px solid rgba(239,68,68,0.2); border-radius:4px; padding:6px; font-family:var(--font-mono); resize:none;">${b1.text}</textarea>
              </div>
              <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText(document.getElementById('modal-single-b1').value); showToast('✓ Bloco 1 (Saída) copiado!', 'success');" style="width:100%; font-size:0.72rem; padding:4px; margin-top:6px; border-color:rgba(239,68,68,0.4); color:#fca5a5;">
                📋 Copiar Saída
              </button>
            </div>
            <div style="background:#0f172a; border:1px solid rgba(16,185,129,0.3); border-radius:6px; padding:10px; display:flex; flex-direction:column; justify-content:space-between;">
              <div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                  <span style="font-size:0.7rem; color:#6ee7b7; font-weight:800;">🟢 BLOCO 2: ENTRADA / RECEBER</span>
                  <span style="font-size:0.7rem; color:#34d399;">R$ ${b2.totalValor.toFixed(2)}</span>
                </div>
                <textarea id="modal-single-b2" readonly style="width:100%; height:70px; font-size:0.82rem; color:#6ee7b7; background:#05070c; border:1px solid rgba(16,185,129,0.2); border-radius:4px; padding:6px; font-family:var(--font-mono); resize:none;">${b2.text}</textarea>
              </div>
              <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText(document.getElementById('modal-single-b2').value); showToast('✓ Bloco 2 (Entrada) copiado!', 'success');" style="width:100%; font-size:0.72rem; padding:4px; margin-top:6px; border-color:rgba(16,185,129,0.4); color:#6ee7b7;">
                📋 Copiar Entrada
              </button>
            </div>
          </div>
        </div>

        <div style="margin-top:20px; display:flex; justify-content:flex-end; gap:10px;">
          <button class="btn btn-secondary" onclick="document.getElementById('modal-backdrop').classList.add('hidden')">Fechar</button>
          <button class="btn btn-primary" onclick="approveReclassModal('${code}')">Aprovar & Marcar como Concluído</button>
        </div>
      `;
    } catch (e) {
      console.error(e);
      modalBody.innerHTML = '<p style="color:#fb7185;">Erro ao obter dados do modal.</p>';
    }
  };

  window.approveReclassModal = async function(code) {
    await toggleStatus('reclassifications', code, true);
    document.getElementById('modal-backdrop').classList.add('hidden');
    loadReclassifications(currentReclassPage);
  };
  // -------------------------------------------------------------
  // Bulk Select All Handlers for Tables
  // -------------------------------------------------------------
  window.handleSelectAllTransfers = async function(headerCheckbox) {
    const isDone = headerCheckbox.checked;
    const checkboxes = document.querySelectorAll('#transfers-table-body .item-checkbox');
    const ids = [];

    checkboxes.forEach(cb => {
      cb.checked = isDone;
      const row = cb.closest('tr');
      if (row) {
        if (isDone) row.classList.add('row-done');
        else row.classList.remove('row-done');
        const idAttr = row.id.replace('row-transf-', '');
        // find matching transfer id
        const onchangeAttr = cb.getAttribute('onchange') || '';
        const match = onchangeAttr.match(/handleTransferToggle\('([^']+)'/);
        if (match && match[1]) ids.push(match[1]);
      }
    });

    if (ids.length > 0) {
      await batchToggleStatus('transfers', ids, isDone);
    }
  };

  window.handleSelectAllReclass = async function(headerCheckbox) {
    const isDone = headerCheckbox.checked;
    const checkboxes = document.querySelectorAll('#reclass-table-body .item-checkbox');
    const ids = [];

    checkboxes.forEach(cb => {
      cb.checked = isDone;
      const row = cb.closest('tr');
      if (row) {
        if (isDone) row.classList.add('row-done');
        else row.classList.remove('row-done');
        const onchangeAttr = cb.getAttribute('onchange') || '';
        const match = onchangeAttr.match(/handleReclassToggle\('([^']+)'/);
        if (match && match[1]) ids.push(match[1]);
      }
    });

    if (ids.length > 0) {
      await batchToggleStatus('reclassifications', ids, isDone);
    }
  };

  window.handleSelectAllPurchases = async function(headerCheckbox) {
    const isDone = headerCheckbox.checked;
    const checkboxes = document.querySelectorAll('#purchases-table-body .item-checkbox');
    const ids = [];

    checkboxes.forEach(cb => {
      cb.checked = isDone;
      const row = cb.closest('tr');
      if (row) {
        if (isDone) row.classList.add('row-done');
        else row.classList.remove('row-done');
        const onchangeAttr = cb.getAttribute('onchange') || '';
        const match = onchangeAttr.match(/handlePurchaseToggle\('([^']+)'/);
        if (match && match[1]) ids.push(match[1]);
      }
    });

    if (ids.length > 0) {
      await batchToggleStatus('purchases', ids, isDone);
    }
  };

  async function batchToggleStatus(type, ids, done, note = '') {
    try {
      const res = await fetch('/api/status/batch-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, ids, done, note })
      });
      const data = await res.json();
      if (data.success) {
        updateProgressUI(data.progress);
        showToast(done ? `✓ ${ids.length} itens marcados como CONCLUÍDOS!` : `${ids.length} itens desmarcados.`, 'success');
        return true;
      }
    } catch (e) {
      console.error('Erro ao atualizar itens em lote:', e);
      showToast('Erro ao atualizar itens em lote.', 'error');
    }
    return false;
  }

  // -------------------------------------------------------------
  // ERP TXT Export Modal (Scope: All vs Page + Copy & Mark Done)
  // -------------------------------------------------------------
  let currentErpData = { ids: [], text: '', scope: 'all' };

  const btnOpenErpModal = document.getElementById('btn-open-erp-modal');
  if (btnOpenErpModal) {
    btnOpenErpModal.addEventListener('click', () => openErpExportModal('all'));
  }

  window.openErpExportModal = async function(initialScope = 'all') {
    const modalBackdrop = document.getElementById('modal-backdrop');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.innerText = `📄 Gerador TXT/CSV para ERP (Padrão: Codigo;qtd)`;
    modalBody.innerHTML = '<div style="text-align:center; padding:20px; color:#94a3b8;">Gerando lista formatada...</div>';
    modalBackdrop.classList.remove('hidden');

    await fetchAndRenderErpExport(initialScope);
  };

  window.fetchAndRenderErpExport = async function(scope) {
    const q = transferSearch ? transferSearch.value.trim() : '';
    const orig = transferOrigin ? transferOrigin.value : '';
    const dst = transferDest ? transferDest.value : '';
    const stFilter = transferStatus ? transferStatus.value : 'all';

    const modalBody = document.getElementById('modal-body');

    try {
      const url = `/api/export/erp-txt?search=${encodeURIComponent(q)}&origin=${encodeURIComponent(orig)}&dest=${encodeURIComponent(dst)}&statusFilter=${stFilter}&scope=${scope}&page=${currentTransferPage}&limit=50&format=json`;
      const res = await fetch(url);
      const data = await res.json();

      currentErpData = {
        ids: data.ids || [],
        text: data.text || '',
        scope: scope
      };

      const downloadTxtUrl = `/api/export/erp-txt?search=${encodeURIComponent(q)}&origin=${encodeURIComponent(orig)}&dest=${encodeURIComponent(dst)}&statusFilter=${stFilter}&scope=${scope}&page=${currentTransferPage}&limit=50`;

      modalBody.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
          <div>
            <div style="font-size:0.9rem; font-weight:700; color:#fff;">
              ${data.count.toLocaleString('pt-BR')} itens gerados (${orig || 'Todas as Origens'} ➔ ${dst || 'Todos os Destinos'})
            </div>
            <div style="font-size:0.75rem; color:#94a3b8;">Total correspondente no filtro: ${data.totalFiltered.toLocaleString('pt-BR')} itens</div>
          </div>

          <!-- Scope Switcher Pills -->
          <div style="display:flex; background:rgba(255,255,255,0.05); padding:3px; border-radius:8px; border:1px solid var(--border-color); gap:4px;">
            <button class="tag-btn ${scope === 'all' ? 'active-scope' : ''}" onclick="fetchAndRenderErpExport('all')" style="${scope === 'all' ? 'background:#059669; color:#fff; font-weight:700;' : ''}">
              🌐 Todos Filtrados (${data.totalFiltered.toLocaleString('pt-BR')})
            </button>
            <button class="tag-btn ${scope === 'page' ? 'active-scope' : ''}" onclick="fetchAndRenderErpExport('page')" style="${scope === 'page' ? 'background:#059669; color:#fff; font-weight:700;' : ''}">
              📄 Apenas Página Atual (${Math.min(50, data.totalFiltered)})
            </button>
          </div>
        </div>

        <textarea id="erp-txt-preview" readonly style="width:100%; height:220px; background:#070a12; border:1px solid var(--border-color); border-radius:8px; color:#34d399; font-family:var(--font-mono); font-size:0.85rem; padding:12px; resize:vertical; outline:none;">${data.text}</textarea>

        <div style="margin-top:16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:0.75rem; color:#94a3b8;">💡 Escolha uma ação rápida:</span>
          </div>

          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn btn-secondary" onclick="copyErpTxtOnly()">
              📋 Apenas Copiar
            </button>
            <button class="btn btn-primary" onclick="copyAndMarkAllDone('transfers')" style="background:linear-gradient(135deg, #059669 0%, #10b981 100%);">
              ✨ Copiar & Marcar ${data.count} Itens como Feito
            </button>
            <a href="${downloadTxtUrl}" class="btn btn-secondary" download>
              💾 Baixar .txt
            </a>
          </div>
        </div>
      `;
    } catch (e) {
      console.error(e);
      modalBody.innerHTML = '<p style="color:#fb7185;">Erro ao gerar arquivo para ERP.</p>';
    }
  };

  window.copyErpTxtOnly = function() {
    const txt = document.getElementById('erp-txt-preview');
    if (txt) {
      txt.select();
      navigator.clipboard.writeText(txt.value);
      showToast(`✓ ${currentErpData.ids.length} itens copiados no padrão Codigo;qtd!`, 'success');
    }
  };

  window.copyAndMarkAllDone = async function(type) {
    if (!currentErpData || currentErpData.ids.length === 0) {
      showToast('Nenhum item para copiar.', 'error');
      return;
    }

    // 1. Copy to clipboard
    const txt = document.getElementById('erp-txt-preview');
    if (txt) {
      txt.select();
      navigator.clipboard.writeText(txt.value);
    } else if (currentErpData.text) {
      navigator.clipboard.writeText(currentErpData.text);
    }

    // 2. Batch mark as done in backend
    const ok = await batchToggleStatus(type, currentErpData.ids, true, 'Baixa automática via exportação ERP');

    if (ok) {
      showToast(`✓ ${currentErpData.ids.length} itens copiados e marcados como CONCLUÍDOS!`, 'success');
      document.getElementById('modal-backdrop').classList.add('hidden');
      if (type === 'transfers') loadTransfers(currentTransferPage);
      if (type === 'reclassifications') loadReclassifications(currentReclassPage);
      if (type === 'purchases') loadPurchases();
    }
  };

  window.copyFileContentToClipboard = async function(fileUrl) {
    try {
      const res = await fetch(fileUrl);
      const content = await res.text();
      await navigator.clipboard.writeText(content);
      showToast('✓ Arquivo Codigo;qtd copiado para a área de transferência!', 'success');
    } catch (e) {
      console.error(e);
      showToast('Erro ao copiar conteúdo.', 'error');
    }
  };

  // -------------------------------------------------------------
  // RECLASSIFICATION ERP TXT EXPORT (2 BLOCKS: SAIR/DOAR & ENTRAR/RECEBER)
  // -------------------------------------------------------------
  let currentReclassErpData = { ids: [], block1: null, block2: null, scope: 'batch', batchIndex: 1, totalBatches: 1 };
  let reclassIncludeCostBlock1 = true;
  let reclassIncludeCostBlock2 = true;

  const btnOpenReclassErpModal = document.getElementById('btn-open-reclass-erp-modal');
  if (btnOpenReclassErpModal) {
    btnOpenReclassErpModal.addEventListener('click', () => openReclassErpExportModal('batch', 1));
  }

  window.openReclassErpExportModal = async function(initialScope = 'batch', initialBatch = 1) {
    const modalBackdrop = document.getElementById('modal-backdrop');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.innerText = `🔄 Gerador TXT ERP Reclassificação (CODIGO;QTD ou CODIGO;QTD;CUSTO em 2 Blocos)`;
    modalBody.innerHTML = '<div style="text-align:center; padding:30px; color:#94a3b8;"><div class="spinner" style="margin:0 auto 10px auto;"></div>Calculando lotes de 100 itens e rateio de custos fiscais...</div>';
    modalBackdrop.classList.remove('hidden');

    await fetchAndRenderReclassErpExport(initialScope, initialBatch);
  };

  window.fetchAndRenderReclassErpExport = async function(scope = 'batch', batchIndex = 1) {
    const q = reclassSearch ? reclassSearch.value.trim() : '';
    const status = reclassStatus ? reclassStatus.value : '';
    const stFilter = reclassDoneFilter ? reclassDoneFilter.value : 'all';
    const store = reclassStoreFilter ? reclassStoreFilter.value : '';
    const donorStore = reclassDonorStoreFilter ? reclassDonorStoreFilter.value : '';

    const modalBody = document.getElementById('modal-body');

    try {
      const costParams = `&includeCostBlock1=${reclassIncludeCostBlock1 ? '1' : '0'}&includeCostBlock2=${reclassIncludeCostBlock2 ? '1' : '0'}`;
      const url = `/api/export/reclass-erp-txt?search=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&statusFilter=${stFilter}&store=${encodeURIComponent(store)}&donorStore=${encodeURIComponent(donorStore)}&scope=${scope}&batchIndex=${batchIndex}&batchSize=100&page=${currentReclassPage}&limit=50&format=json${costParams}`;
      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || 'Erro ao consultar dados da exportação.');
      }

      const totalFiltered = typeof data.totalFiltered === 'number' ? data.totalFiltered : 0;
      const b1 = data.block1 || { text: '', count: 0, totalPecas: 0, totalValor: 0 };
      const b2 = data.block2 || { text: '', count: 0, totalPecas: 0, totalValor: 0 };
      const bInfo = data.batchInfo || { currentBatch: 1, totalBatches: 1, batchSize: 100, startItem: 1, endItem: totalFiltered };

      currentReclassErpData = {
        ids: data.ids || [],
        block1: b1,
        block2: b2,
        scope: scope,
        batchIndex: bInfo.currentBatch,
        totalBatches: bInfo.totalBatches
      };

      const downloadB1Url = `/api/export/reclass-erp-txt?search=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&statusFilter=${stFilter}&store=${encodeURIComponent(store)}&donorStore=${encodeURIComponent(donorStore)}&scope=${scope}&batchIndex=${bInfo.currentBatch}&batchSize=100&page=${currentReclassPage}&limit=50&format=block1${costParams}`;
      const downloadB2Url = `/api/export/reclass-erp-txt?search=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&statusFilter=${stFilter}&store=${encodeURIComponent(store)}&donorStore=${encodeURIComponent(donorStore)}&scope=${scope}&batchIndex=${bInfo.currentBatch}&batchSize=100&page=${currentReclassPage}&limit=50&format=block2${costParams}`;
      const downloadAllUrl = `/api/export/reclass-erp-txt?search=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&statusFilter=${stFilter}&store=${encodeURIComponent(store)}&donorStore=${encodeURIComponent(donorStore)}&scope=${scope}&batchIndex=${bInfo.currentBatch}&batchSize=100&page=${currentReclassPage}&limit=50&format=all${costParams}`;
      const b1Format = b1.format || (reclassIncludeCostBlock1 ? 'CODIGO;QTD;CUSTO' : 'CODIGO;QTD');
      const b2Format = b2.format || (reclassIncludeCostBlock2 ? 'CODIGO;QTD;CUSTO' : 'CODIGO;QTD');

      modalBody.innerHTML = `
        <!-- Cabeçalho de Controle e Seleção de Lote -->
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
          <div>
            <div style="font-size:0.95rem; font-weight:700; color:#fff;">
              ${scope === 'batch' ? `📦 Lote ${bInfo.currentBatch} de ${bInfo.totalBatches} (${data.count || 0} itens · #${bInfo.startItem} a #${bInfo.endItem})` : `${data.count || 0} itens selecionados`}
              ${store ? `· Déficit L${store}` : ''} ${donorStore ? `· Doador L${donorStore}` : ''}
            </div>
            <div style="font-size:0.75rem; color:#94a3b8; margin-top:2px;">
              Total no filtro: <strong>${totalFiltered.toLocaleString('pt-BR')} itens</strong>
            </div>
          </div>

          <!-- Scope Switcher Pills -->
          <div style="display:flex; background:rgba(255,255,255,0.05); padding:3px; border-radius:8px; border:1px solid var(--border-color); gap:4px;">
            <button class="tag-btn ${scope === 'batch' ? 'active-scope' : ''}" onclick="fetchAndRenderReclassErpExport('batch', ${bInfo.currentBatch})" style="${scope === 'batch' ? 'background:#3b82f6; color:#fff; font-weight:700;' : ''}">
              📦 Lotes de 100
            </button>
            <button class="tag-btn ${scope === 'page' ? 'active-scope' : ''}" onclick="fetchAndRenderReclassErpExport('page', 1)" style="${scope === 'page' ? 'background:#3b82f6; color:#fff; font-weight:700;' : ''}">
              📄 Página Atual (50)
            </button>
            <button class="tag-btn ${scope === 'all' ? 'active-scope' : ''}" onclick="fetchAndRenderReclassErpExport('all', 1)" style="${scope === 'all' ? 'background:#3b82f6; color:#fff; font-weight:700;' : ''}">
              🌐 Todos (${totalFiltered.toLocaleString('pt-BR')})
            </button>
          </div>
        </div>

        <!-- Seletor e Navegador de Lotes de 100 Itens -->
        ${scope === 'batch' && bInfo.totalBatches > 1 ? `
          <div style="background:#070a12; border:1px solid rgba(59,130,246,0.3); border-radius:8px; padding:8px 12px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <button class="btn btn-secondary btn-sm" ${bInfo.currentBatch <= 1 ? 'disabled' : ''} onclick="fetchAndRenderReclassErpExport('batch', ${bInfo.currentBatch - 1})" style="padding:4px 10px; font-size:0.75rem;">
              ◀ Lote Anterior
            </button>
            <div style="display:flex; align-items:center; gap:8px; font-size:0.8rem; color:#cbd5e1;">
              <span>Ir para Lote:</span>
              <select onchange="fetchAndRenderReclassErpExport('batch', parseInt(this.value, 10))" style="background:#1e293b; color:#fff; border:1px solid var(--border-color); border-radius:4px; padding:3px 8px; font-size:0.8rem; outline:none; cursor:pointer;">
                ${Array.from({ length: bInfo.totalBatches }, (_, i) => i + 1).map(bNum => `
                  <option value="${bNum}" ${bNum === bInfo.currentBatch ? 'selected' : ''}>Lote ${bNum} (itens ${(bNum-1)*100 + 1} a ${Math.min(bNum*100, totalFiltered)})</option>
                `).join('')}
              </select>
            </div>
            <button class="btn btn-secondary btn-sm" ${bInfo.currentBatch >= bInfo.totalBatches ? 'disabled' : ''} onclick="fetchAndRenderReclassErpExport('batch', ${bInfo.currentBatch + 1})" style="padding:4px 10px; font-size:0.75rem;">
              Próximo Lote ▶
            </button>
          </div>
        ` : ''}

        <!-- Cards de Auditoria e Equalização Financeira -->
        <div style="display:grid; grid-template-columns: 1fr 1fr 1.2fr; gap:10px; margin-bottom:14px;">
          <div style="background:#0f172a; border:1px solid rgba(239,68,68,0.3); border-radius:8px; padding:10px;">
            <div style="font-size:0.7rem; color:#fca5a5; font-weight:700;">🔴 TOTAL BLOCO 1 (SAÍDA)</div>
            <div style="font-size:1.05rem; font-weight:800; color:#fff; margin-top:2px;">
              ${(b1.totalPecas || 0).toLocaleString('pt-BR')} <span style="font-size:0.75rem; font-weight:400; color:#94a3b8;">un</span>
            </div>
            <div style="font-size:0.75rem; color:#f87171; font-weight:600; margin-top:2px;">
              R$ ${(b1.totalValor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          <div style="background:#0f172a; border:1px solid rgba(16,185,129,0.3); border-radius:8px; padding:10px;">
            <div style="font-size:0.7rem; color:#6ee7b7; font-weight:700;">🟢 TOTAL BLOCO 2 (ENTRADA)</div>
            <div style="font-size:1.05rem; font-weight:800; color:#fff; margin-top:2px;">
              ${(b2.totalPecas || 0).toLocaleString('pt-BR')} <span style="font-size:0.75rem; font-weight:400; color:#94a3b8;">un</span>
            </div>
            <div style="font-size:0.75rem; color:#34d399; font-weight:600; margin-top:2px;">
              R$ ${(b2.totalValor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          <div style="background:#0f172a; border:1px solid ${data.isBalanced ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}; border-radius:8px; padding:10px; display:flex; flex-direction:column; justify-content:center;">
            <div style="font-size:0.7rem; color:#94a3b8; font-weight:700;">⚖️ EQUALIZAÇÃO FISCAL</div>
            <div style="font-size:0.8rem; font-weight:700; color:${data.isBalanced ? '#34d399' : '#f87171'}; margin-top:4px; display:flex; align-items:center; gap:4px;">
              ${data.isBalanced ? '✓ 100% Rateado & Equilibrado' : '⚠️ Diferença Detectada'}
            </div>
            <div style="font-size:0.68rem; color:#94a3b8; margin-top:2px;">
              Qtd e custos unitários coincidem exatamente entre os 2 blocos.
            </div>
          </div>
        </div>

        <!-- Visualização dos 2 Blocos lado a lado -->
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:14px;">
          
          <!-- BLOCO 1: SAÍDA / DOADORES -->
          <div style="background:#0b0f19; border:1px solid rgba(239, 68, 68, 0.3); border-radius:10px; padding:12px; display:flex; flex-direction:column; gap:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div style="display:flex; align-items:center; gap:6px;">
                <span style="background:#ef4444; color:#fff; font-size:0.68rem; font-weight:800; padding:2px 6px; border-radius:4px;">BLOCO 1</span>
                <strong style="color:#fca5a5; font-size:0.82rem;">ITENS QUE VÃO SAIR / DOAR</strong>
              </div>
              <span class="badge" style="background:rgba(239,68,68,0.2); color:#fca5a5; border:1px solid rgba(239,68,68,0.4); font-size:0.72rem;">
                ${b1.count} linhas (${(b1.totalPecas || 0).toLocaleString('pt-BR')} un)
              </span>
            </div>
            <label style="display:flex; align-items:center; gap:6px; width:max-content; max-width:100%; font-size:0.72rem; color:#fca5a5; font-weight:700; cursor:pointer;">
              <input type="checkbox" ${reclassIncludeCostBlock1 ? 'checked' : ''} onchange="toggleReclassBlockCost(1, this.checked)" style="width:14px; height:14px; accent-color:#ef4444;">
              CUSTO
            </label>
            <p style="font-size:0.7rem; color:#94a3b8; margin:0;">Formato: <code>${b1Format}</code> (Estoque subtraído do doador)</p>
            
            <textarea id="reclass-block1-preview" readonly style="width:100%; height:180px; background:#05070c; border:1px solid rgba(239,68,68,0.2); border-radius:6px; color:#fca5a5; font-family:var(--font-mono); font-size:0.82rem; padding:10px; resize:vertical; outline:none;">${b1.text}</textarea>
            
            <div style="display:flex; gap:8px; margin-top:4px;">
              <button class="btn btn-secondary btn-sm" onclick="copyReclassBlock(1)" style="flex:1; justify-content:center; border-color:rgba(239,68,68,0.4); color:#fca5a5; font-size:0.75rem;">
                📋 Copiar Bloco 1 (Saída)
              </button>
              <a href="${downloadB1Url}" class="btn btn-secondary btn-sm" download style="padding:4px 10px; font-size:0.75rem;" title="Baixar .txt Bloco 1">
                💾 .txt
              </a>
            </div>
          </div>

          <!-- BLOCO 2: ENTRADA / RECEBIMENTO -->
          <div style="background:#0b0f19; border:1px solid rgba(16, 185, 129, 0.3); border-radius:10px; padding:12px; display:flex; flex-direction:column; gap:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div style="display:flex; align-items:center; gap:6px;">
                <span style="background:#10b981; color:#fff; font-size:0.68rem; font-weight:800; padding:2px 6px; border-radius:4px;">BLOCO 2</span>
                <strong style="color:#6ee7b7; font-size:0.82rem;">ITENS QUE VÃO ENTRAR / RECEBER</strong>
              </div>
              <span class="badge" style="background:rgba(16,185,129,0.2); color:#6ee7b7; border:1px solid rgba(16,185,129,0.4); font-size:0.72rem;">
                ${b2.count} linhas (${(b2.totalPecas || 0).toLocaleString('pt-BR')} un)
              </span>
            </div>
            <label style="display:flex; align-items:center; gap:6px; width:max-content; max-width:100%; font-size:0.72rem; color:#6ee7b7; font-weight:700; cursor:pointer;">
              <input type="checkbox" ${reclassIncludeCostBlock2 ? 'checked' : ''} onchange="toggleReclassBlockCost(2, this.checked)" style="width:14px; height:14px; accent-color:#10b981;">
              CUSTO
            </label>
            <p style="font-size:0.7rem; color:#94a3b8; margin:0;">Formato: <code>${b2Format}</code> (Estoque acrescido para zerar o negativo)</p>
            
            <textarea id="reclass-block2-preview" readonly style="width:100%; height:180px; background:#05070c; border:1px solid rgba(16,185,129,0.2); border-radius:6px; color:#6ee7b7; font-family:var(--font-mono); font-size:0.82rem; padding:10px; resize:vertical; outline:none;">${b2.text}</textarea>
            
            <div style="display:flex; gap:8px; margin-top:4px;">
              <button class="btn btn-secondary btn-sm" onclick="copyReclassBlock(2)" style="flex:1; justify-content:center; border-color:rgba(16,185,129,0.4); color:#6ee7b7; font-size:0.75rem;">
                📋 Copiar Bloco 2 (Entrada)
              </button>
              <a href="${downloadB2Url}" class="btn btn-secondary btn-sm" download style="padding:4px 10px; font-size:0.75rem;" title="Baixar .txt Bloco 2">
                💾 .txt
              </a>
            </div>
          </div>

        </div>

        <!-- Ações Globais do Modal -->
        <div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <a href="${downloadAllUrl}" class="btn btn-secondary btn-sm" download style="font-size:0.75rem;">
              💾 Baixar TXT Completo
            </a>
          </div>

          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" onclick="copyBothReclassBlocks()" style="font-size:0.8rem;">
              📋 Copiar Ambos os Blocos
            </button>
            <button class="btn btn-secondary btn-sm" onclick="markReclassErpBatchDone(true)" style="color:#34d399; border-color:rgba(16,185,129,0.4); font-size:0.8rem;" title="Marca este lote como concluído no sistema sem copiar">
              ✓ Marcar Lote como Feito
            </button>
            <button class="btn btn-secondary btn-sm" onclick="markReclassErpBatchDone(false)" style="color:#fb7185; border-color:rgba(244,63,94,0.4); font-size:0.8rem;" title="Desmarca os itens deste lote">
              ↩ Desmarcar Lote
            </button>
            <button class="btn btn-primary btn-sm" onclick="copyReclassAndMarkAllDone()" style="background:linear-gradient(135deg, #2563eb 0%, #3b82f6 100%); font-size:0.8rem;">
              ✨ Copiar & Marcar Lote (${data.count || 0} Itens) como Feito
            </button>
          </div>
        </div>
      `;
    } catch (e) {
      console.error(e);
      modalBody.innerHTML = '<p style="color:#fb7185;">Erro ao gerar blocos de reclassificação para ERP.</p>';
    }
  };

  window.toggleReclassBlockCost = function(blockNum, checked) {
    if (blockNum === 1) reclassIncludeCostBlock1 = checked;
    if (blockNum === 2) reclassIncludeCostBlock2 = checked;
    fetchAndRenderReclassErpExport(currentReclassErpData.scope, currentReclassErpData.batchIndex);
  };

  window.copyReclassBlock = function(blockNum) {
    const elemId = blockNum === 1 ? 'reclass-block1-preview' : 'reclass-block2-preview';
    const txt = document.getElementById(elemId);
    if (txt) {
      txt.select();
      navigator.clipboard.writeText(txt.value);
      const name = blockNum === 1 ? 'BLOCO 1 (SAÍDA / DOADORES)' : 'BLOCO 2 (ENTRADA / RECEBIMENTO)';
      const formato = blockNum === 1
        ? (currentReclassErpData.block1?.format || 'CODIGO;QTD;CUSTO')
        : (currentReclassErpData.block2?.format || 'CODIGO;QTD;CUSTO');
      showToast(`✓ ${name} copiado no formato ${formato}!`, 'success');
    }
  };

  window.copyBothReclassBlocks = function() {
    if (!currentReclassErpData || !currentReclassErpData.block1 || !currentReclassErpData.block2) {
      showToast('Dados não disponíveis.', 'error');
      return;
    }
    const formatoB1 = currentReclassErpData.block1.format || 'CODIGO;QTD;CUSTO';
    const formatoB2 = currentReclassErpData.block2.format || 'CODIGO;QTD;CUSTO';
    const combined = `# ========================================================\r\n# BLOCO 1 - ITENS QUE VÃO SAIR / DOAR\r\n# Formato: ${formatoB1}\r\n# ========================================================\r\n${currentReclassErpData.block1.text}\r\n\r\n# ========================================================\r\n# BLOCO 2 - ITENS QUE VÃO ENTRAR / RECEBER\r\n# Formato: ${formatoB2}\r\n# ========================================================\r\n${currentReclassErpData.block2.text}`;
    navigator.clipboard.writeText(combined);
    showToast('✓ Ambos os blocos copiados com sucesso!', 'success');
  };

  window.markReclassErpBatchDone = async function(done = true) {
    if (!currentReclassErpData || currentReclassErpData.ids.length === 0) {
      showToast('Nenhum item para processar.', 'error');
      return;
    }
    const bName = currentReclassErpData.scope === 'batch' ? `Lote ${currentReclassErpData.batchIndex}` : `${currentReclassErpData.ids.length} itens`;
    const ok = await batchToggleStatus('reclassifications', currentReclassErpData.ids, done, done ? `Baixa via ERP (${bName})` : `Desmarcação (${bName})`);
    if (ok) {
      showToast(done ? `✓ ${bName} (${currentReclassErpData.ids.length} itens) marcado como CONCLUÍDO!` : `↩ ${bName} desmarcado.`, done ? 'success' : 'info');
      document.getElementById('modal-backdrop').classList.add('hidden');
      loadReclassifications(currentReclassPage);
    }
  };

  window.copyReclassAndMarkAllDone = async function() {
    if (!currentReclassErpData || currentReclassErpData.ids.length === 0) {
      showToast('Nenhum item para processar.', 'error');
      return;
    }

    copyBothReclassBlocks();

    const ok = await batchToggleStatus('reclassifications', currentReclassErpData.ids, true, 'Baixa via exportação ERP Reclassificação');
    if (ok) {
      showToast(`✓ ${currentReclassErpData.ids.length} itens reclassificados marcados como CONCLUÍDOS!`, 'success');
      document.getElementById('modal-backdrop').classList.add('hidden');
      loadReclassifications(currentReclassPage);
    }
  };

  // Helper Pagination
  function renderPagination(container, page, totalPages, callback) {
    if (!container || totalPages <= 1) {
      if (container) container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <button ${page <= 1 ? 'disabled' : ''} id="pag-prev">Anterior</button>
      <span>Página <strong>${page}</strong> de <strong>${totalPages}</strong></span>
      <button ${page >= totalPages ? 'disabled' : ''} id="pag-next">Próxima</button>
    `;

    const prev = document.getElementById('pag-prev');
    const next = document.getElementById('pag-next');
    if (prev) prev.onclick = () => callback(page - 1);
    if (next) next.onclick = () => callback(page + 1);
  }
});
