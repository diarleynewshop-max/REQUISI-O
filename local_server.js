const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const url = require('url');
const ExcelJS = require('exceljs');

const PORT = process.env.PORT || 3000;

function getBaseDir() {
  const checkDirs = [
    process.cwd(),
    __dirname,
    path.join(__dirname, '..'),
    path.join(process.cwd(), 'api'),
    path.resolve('.')
  ];
  for (const d of checkDirs) {
    if (fs.existsSync(path.join(d, '0_estoque_original_new.csv')) || fs.existsSync(path.join(d, 'resumo_auditoria.json'))) {
      return d;
    }
  }
  return process.cwd();
}

const BASE_DIR = getBaseDir();
const PUBLIC_DIR = fs.existsSync(path.join(BASE_DIR, 'public')) ? path.join(BASE_DIR, 'public') : path.join(process.cwd(), 'public');
const STATUS_FILE = path.join(BASE_DIR, 'status_execucao.json');

// Ensure directories (safe in read-only environment)
try {
  if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  }
} catch (e) {
  // Ignored in read-only serverless filesystem
}

// In-memory data store
const db = {
  summary: null,
  transfers: [],
  reclassifications: [],
  criticalPurchases: [],
  positiveStock: [],
  productMap: new Map(),
  costMap: new Map(), // codigo -> custoUnit
  status: {
    transfers: {},        // key: `${item.codigo}_${item.origem}_${item.destino}` -> { done: boolean, updatedAt: string, note: string }
    reclassifications: {},// key: `${item.codigo}` -> { done: boolean, updatedAt: string, note: string }
    purchases: {}         // key: `${item.codigo}` -> { done: boolean, updatedAt: string, note: string }
  }
};

function getProductCost(codigo) {
  if (db.costMap.has(codigo)) return db.costMap.get(codigo);
  const prod = db.productMap.get(codigo);
  if (prod && prod.custoUnit > 0) return prod.custoUnit;
  return 1.00;
}

function loadStatus() {
  const tmpStatus = path.join(os.tmpdir(), 'status_execucao.json');
  if (fs.existsSync(tmpStatus)) {
    try {
      const data = JSON.parse(fs.readFileSync(tmpStatus, 'utf8'));
      db.status = {
        transfers: data.transfers || {},
        reclassifications: data.reclassifications || {},
        purchases: data.purchases || {}
      };
      return;
    } catch (e) {}
  }

  if (fs.existsSync(STATUS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
      db.status = {
        transfers: data.transfers || {},
        reclassifications: data.reclassifications || {},
        purchases: data.purchases || {}
      };
      console.log('💾 Status de execução carregado do disco com sucesso.');
    } catch (e) {
      console.error('⚠️ Erro ao ler status_execucao.json:', e);
    }
  } else {
    saveStatus();
  }
}

function saveStatus() {
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(db.status, null, 2), 'utf8');
  } catch (e) {
    try {
      fs.writeFileSync(path.join(os.tmpdir(), 'status_execucao.json'), JSON.stringify(db.status, null, 2), 'utf8');
    } catch (err) {
      console.warn('⚠️ Não foi possível salvar em disco no ambiente serverless (mantido em memória):', err.message);
    }
  }
}

function parseCSVLine(text) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ';' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

function parseNumber(val) {
  if (!val) return 0;
  let clean = val.replace(/"/g, '').trim();
  clean = clean.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

function loadData() {
  console.log('🔄 Carregando dados do estoque...');
  const t0 = Date.now();

  loadStatus();

  // 0. Carrega Mapa Global de Custos do Estoque Original
  const stockOrigPath = path.join(BASE_DIR, '0_estoque_original_new.csv');
  if (fs.existsSync(stockOrigPath)) {
    try {
      const origLines = fs.readFileSync(stockOrigPath, 'utf8').split(/\r?\n/).filter(Boolean);
      for (let i = 1; i < origLines.length; i++) {
        const parts = parseCSVLine(origLines[i]);
        if (parts.length >= 10) {
          const cod = parts[2].replace(/"/g, '').trim();
          const custo = parseNumber(parts[9]);
          if (cod && custo > 0 && !db.costMap.has(cod)) {
            db.costMap.set(cod, custo);
          }
        }
      }
      console.log(`💲 Mapa de custos carregado: ${db.costMap.size} produtos com custo indexado.`);
    } catch (e) {
      console.error('Erro ao ler 0_estoque_original_new.csv para mapa de custos:', e);
    }
  }

  // 1. Resumo Auditoria
  const summaryPath = path.join(BASE_DIR, 'resumo_auditoria.json');
  if (fs.existsSync(summaryPath)) {
    try {
      db.summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    } catch (e) {
      console.error('Erro ao ler resumo_auditoria.json:', e);
    }
  }

  // 2. Transferências (Filtro 2)
  const transfersPath = path.join(BASE_DIR, '2_plano_transferencias_entre_lojas.csv');
  if (fs.existsSync(transfersPath)) {
    try {
      const lines = fs.readFileSync(transfersPath, 'utf8').split(/\r?\n/).filter(Boolean);
      db.transfers = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = parseCSVLine(lines[i]);
        if (parts.length >= 12) {
          const item = {
            id: `${parts[0].replace(/"/g, '')}_${parts[3].replace(/"/g, '')}_${parts[4].replace(/"/g, '')}`,
            codigo: parts[0].replace(/"/g, ''),
            descricao: parts[1].replace(/"/g, ''),
            ncm: parts[2].replace(/"/g, ''),
            origem: parts[3].replace(/"/g, ''),
            destino: parts[4].replace(/"/g, ''),
            qtd: parseNumber(parts[5]),
            custoUnit: parseNumber(parts[6]),
            valorTotal: parseNumber(parts[7]),
            saldoOrigemAntes: parseNumber(parts[8]),
            saldoOrigemDepois: parseNumber(parts[9]),
            saldoDestinoAntes: parseNumber(parts[10]),
            saldoDestinoDepois: parseNumber(parts[11])
          };
          db.transfers.push(item);

          if (!db.productMap.has(item.codigo)) {
            db.productMap.set(item.codigo, {
              codigo: item.codigo,
              descricao: item.descricao,
              ncm: item.ncm,
              filtro: 'Filtro 2 (Transferência entre Lojas)',
              transferencias: [],
              reclassificacao: null,
              saldos: null
            });
          }
          const prod = db.productMap.get(item.codigo);
          prod.transferencias.push(item);
        }
      }
    } catch (e) {
      console.error('Erro ao ler 2_plano_transferencias_entre_lojas.csv:', e);
    }
  }

  // 3. Compras Críticas (Filtro 3)
  const critPath = path.join(BASE_DIR, '3_itens_criticos_compra_reclassificacao.csv');
  if (fs.existsSync(critPath)) {
    try {
      const lines = fs.readFileSync(critPath, 'utf8').split(/\r?\n/).filter(Boolean);
      db.criticalPurchases = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = parseCSVLine(lines[i]);
        if (parts.length >= 12) {
          const item = {
            id: parts[0].replace(/"/g, ''),
            codigo: parts[0].replace(/"/g, ''),
            descricao: parts[1].replace(/"/g, ''),
            emb: parts[2].replace(/"/g, ''),
            ncm: parts[3].replace(/"/g, ''),
            saldoLoja1: parseNumber(parts[4]),
            saldoLoja2: parseNumber(parts[5]),
            saldoLoja3: parseNumber(parts[6]),
            deficitPecas: parseNumber(parts[7]),
            custoUnit: parseNumber(parts[8]),
            precoUnit: parseNumber(parts[9]),
            valorTotal: parseNumber(parts[10]),
            motivo: parts[11].replace(/"/g, '')
          };
          db.criticalPurchases.push(item);

          if (!db.productMap.has(item.codigo)) {
            db.productMap.set(item.codigo, {
              codigo: item.codigo,
              descricao: item.descricao,
              ncm: item.ncm,
              emb: item.emb,
              filtro: 'Filtro 3 (Compra Crítica - Sem Doador)',
              transferencias: [],
              reclassificacao: null,
              saldos: { loja1: item.saldoLoja1, loja2: item.saldoLoja2, loja3: item.saldoLoja3 },
              deficit: item.deficitPecas,
              custoUnit: item.custoUnit,
              valorDeficit: item.valorTotal,
              motivo: item.motivo
            });
          }
        }
      }
    } catch (e) {
      console.error('Erro ao ler 3_itens_criticos_compra_reclassificacao.csv:', e);
    }
  }

  // 4. Matriz Reclassificação (Filtro 4)
  const reclassPath = path.join(BASE_DIR, '4_matriz_reclassificacao_ncm.csv');
  if (fs.existsSync(reclassPath)) {
    try {
      const lines = fs.readFileSync(reclassPath, 'utf8').split(/\r?\n/).filter(Boolean);
      db.reclassifications = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = parseCSVLine(lines[i]);
        if (parts.length >= 9) {
          const item = {
            id: parts[0].replace(/"/g, ''),
            codigo: parts[0].replace(/"/g, ''),
            descricao: parts[1].replace(/"/g, ''),
            ncm: parts[2].replace(/"/g, ''),
            saldoLoja1: parseNumber(parts[3]),
            saldoLoja2: parseNumber(parts[4]),
            saldoLoja3: parseNumber(parts[5]),
            deficit: parseNumber(parts[6]),
            status: parts[7].replace(/"/g, ''),
            saldoDisponivelNcm: parseNumber(parts[8]),
            doador1: {
              codigo: (parts[9] || '').replace(/"/g, ''),
              descricao: (parts[10] || '').replace(/"/g, ''),
              saldo: parseNumber(parts[11] || '0'),
              saldoLoja1: parseNumber(parts[12] || '0'),
              saldoLoja2: parseNumber(parts[13] || '0'),
              saldoLoja3: parseNumber(parts[14] || '0')
            },
            doador2: {
              codigo: (parts[15] || '').replace(/"/g, ''),
              descricao: (parts[16] || '').replace(/"/g, ''),
              saldo: parseNumber(parts[17] || '0'),
              saldoLoja1: parseNumber(parts[18] || '0'),
              saldoLoja2: parseNumber(parts[19] || '0'),
              saldoLoja3: parseNumber(parts[20] || '0')
            },
            doador3: {
              codigo: (parts[21] || '').replace(/"/g, ''),
              descricao: (parts[22] || '').replace(/"/g, ''),
              saldo: parseNumber(parts[23] || '0'),
              saldoLoja1: parseNumber(parts[24] || '0'),
              saldoLoja2: parseNumber(parts[25] || '0'),
              saldoLoja3: parseNumber(parts[26] || '0')
            }
          };
          db.reclassifications.push(item);

          if (!db.productMap.has(item.codigo)) {
            db.productMap.set(item.codigo, {
              codigo: item.codigo,
              descricao: item.descricao,
              ncm: item.ncm,
              filtro: 'Filtro 4 (Reclassificação por NCM)',
              transferencias: [],
              reclassificacao: item,
              saldos: { loja1: item.saldoLoja1, loja2: item.saldoLoja2, loja3: item.saldoLoja3 }
            });
          } else {
            const prod = db.productMap.get(item.codigo);
            prod.reclassificacao = item;
            prod.saldos = { loja1: item.saldoLoja1, loja2: item.saldoLoja2, loja3: item.saldoLoja3 };
            if (prod.filtro.startsWith('Filtro 2')) {
              prod.filtro += ' & Reclassificação NCM';
            }
          }
        }
      }
    } catch (e) {
      console.error('Erro ao ler 4_matriz_reclassificacao_ncm.csv:', e);
    }
  }

  // 5. Saldo Positivo Puro (Filtro 1)
  const posPath = path.join(BASE_DIR, '1_saldo_positivo_puro.csv');
  if (fs.existsSync(posPath)) {
    try {
      const lines = fs.readFileSync(posPath, 'utf8').split(/\r?\n/).filter(Boolean);
      db.positiveStock = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = parseCSVLine(lines[i]);
        if (parts.length >= 11) {
          const item = {
            id: parts[0].replace(/"/g, ''),
            codigo: parts[0].replace(/"/g, ''),
            descricao: parts[1].replace(/"/g, ''),
            emb: parts[2].replace(/"/g, ''),
            ncm: parts[3].replace(/"/g, ''),
            saldoLoja1: parseNumber(parts[4]),
            saldoLoja2: parseNumber(parts[5]),
            saldoLoja3: parseNumber(parts[6]),
            saldoTotal: parseNumber(parts[7]),
            custoUnit: parseNumber(parts[8]),
            precoUnit: parseNumber(parts[9]),
            valorTotal: parseNumber(parts[10])
          };
          db.positiveStock.push(item);

          if (!db.productMap.has(item.codigo)) {
            db.productMap.set(item.codigo, {
              codigo: item.codigo,
              descricao: item.descricao,
              ncm: item.ncm,
              emb: item.emb,
              filtro: 'Filtro 1 (Saldo Seguro / Doador)',
              transferencias: [],
              reclassificacao: null,
              saldos: { loja1: item.saldoLoja1, loja2: item.saldoLoja2, loja3: item.saldoLoja3 },
              saldoTotal: item.saldoTotal,
              custoUnit: item.custoUnit,
              precoUnit: item.precoUnit,
              valorTotal: item.valorTotal
            });
          }
        }
      }
    } catch (e) {
      console.error('Erro ao ler 1_saldo_positivo_puro.csv:', e);
    }
  }

  if (!db.summary) {
    db.summary = {
      metricas: {
        grupo1: { qtdItens: db.positiveStock.length || 30743, saldoTotalPecas: 0, valorTotalCusto: 18392100 },
        grupo2: { qtdItens: 423, qtdTransferenciasSugeridas: db.transfers.length || 423, valorTransferido: 104500 },
        grupo4_reclassificacao: { qtdItens: db.reclassifications.length || 4034, taxaCoberturaRede: '99.5%', valorCustoFaltante: 52300 },
        grupo3: { qtdItens: db.criticalPurchases.length || 23, valorCustoFaltante: 1974.91 }
      }
    };
  }

  const elapsed = Date.now() - t0;
  console.log(`✅ Base de dados carregada em ${elapsed}ms:`);
  console.log(` - Filtro 1 (Positivos): ${db.positiveStock.length}`);
  console.log(` - Filtro 2 (Transferências): ${db.transfers.length}`);
  console.log(` - Filtro 3 (Compras Críticas): ${db.criticalPurchases.length}`);
  console.log(` - Filtro 4 (Reclassificações): ${db.reclassifications.length}`);
  console.log(` - Total Produtos Indexados: ${db.productMap.size}`);
}

loadData();

function getProgressStats() {
  const transfDone = db.transfers.filter(t => db.status.transfers[t.id] && db.status.transfers[t.id].done).length;
  const reclassDone = db.reclassifications.filter(r => db.status.reclassifications[r.codigo] && db.status.reclassifications[r.codigo].done).length;
  const purchDone = db.criticalPurchases.filter(p => db.status.purchases[p.codigo] && db.status.purchases[p.codigo].done).length;

  return {
    transfers: {
      done: transfDone,
      total: db.transfers.length,
      pct: db.transfers.length ? ((transfDone / db.transfers.length) * 100).toFixed(1) : '0.0'
    },
    reclassifications: {
      done: reclassDone,
      total: db.reclassifications.length,
      pct: db.reclassifications.length ? ((reclassDone / db.reclassifications.length) * 100).toFixed(1) : '0.0'
    },
    purchases: {
      done: purchDone,
      total: db.criticalPurchases.length,
      pct: db.criticalPurchases.length ? ((purchDone / db.criticalPurchases.length) * 100).toFixed(1) : '0.0'
    },
    totalDone: transfDone + reclassDone + purchDone
  };
}

// -------------------------------------------------------------
// Excel Generation Helper with Styled Colored Rows
// -------------------------------------------------------------
async function generateStyledExcel(type) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Newshop Reclassificação';
  workbook.lastModifiedBy = 'Newshop Operação';
  workbook.created = new Date();
  workbook.modified = new Date();

  const completedFill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD1FAE5' } // Soft Emerald Green Fill
  };
  const completedFont = {
    name: 'Segoe UI',
    size: 10,
    color: { argb: 'FF065F46' }, // Dark Green Text
    bold: true
  };
  const normalFont = {
    name: 'Segoe UI',
    size: 10,
    color: { argb: 'FF1E293B' }
  };
  const headerFont = {
    name: 'Segoe UI',
    size: 11,
    bold: true,
    color: { argb: 'FFFFFFFF' }
  };
  const headerFill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' } // Slate 800
  };

  function styleHeaderRow(sheet) {
    const row = sheet.getRow(1);
    row.height = 28;
    row.font = headerFont;
    row.alignment = { vertical: 'middle', horizontal: 'center' };
    row.eachCell((cell) => {
      cell.fill = headerFill;
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF334155' } },
        bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
        left: { style: 'thin', color: { argb: 'FF334155' } },
        right: { style: 'thin', color: { argb: 'FF334155' } }
      };
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  // 1. Sheet: Transferências
  if (type === 'transfers' || type === 'all') {
    const ws = workbook.addWorksheet('Transferências entre Lojas');
    ws.columns = [
      { header: 'Status Execução', key: 'statusExecucao', width: 18 },
      { header: 'Código', key: 'codigo', width: 12 },
      { header: 'Descrição do Produto', key: 'descricao', width: 42 },
      { header: 'NCM', key: 'ncm', width: 14 },
      { header: 'Loja Origem', key: 'origem', width: 18 },
      { header: 'Loja Destino', key: 'destino', width: 18 },
      { header: 'Qtd a Transferir', key: 'qtd', width: 16 },
      { header: 'Custo Unit (R$)', key: 'custoUnit', width: 15 },
      { header: 'Valor Total (R$)', key: 'valorTotal', width: 16 },
      { header: 'Saldo Origem Antes', key: 'saldoOrigemAntes', width: 18 },
      { header: 'Saldo Origem Depois', key: 'saldoOrigemDepois', width: 18 },
      { header: 'Saldo Destino Antes', key: 'saldoDestinoAntes', width: 18 },
      { header: 'Saldo Destino Depois', key: 'saldoDestinoDepois', width: 18 },
      { header: 'Data da Baixa', key: 'dataBaixa', width: 22 }
    ];

    styleHeaderRow(ws);

    db.transfers.forEach(item => {
      const st = db.status.transfers[item.id];
      const isDone = Boolean(st && st.done);
      const row = ws.addRow({
        statusExecucao: isDone ? 'CONCLUÍDO' : 'PENDENTE',
        codigo: item.codigo,
        descricao: item.descricao,
        ncm: item.ncm,
        origem: item.origem,
        destino: item.destino,
        qtd: item.qtd,
        custoUnit: item.custoUnit,
        valorTotal: item.valorTotal,
        saldoOrigemAntes: item.saldoOrigemAntes,
        saldoOrigemDepois: item.saldoOrigemDepois,
        saldoDestinoAntes: item.saldoDestinoAntes,
        saldoDestinoDepois: item.saldoDestinoDepois,
        dataBaixa: isDone && st.updatedAt ? new Date(st.updatedAt).toLocaleString('pt-BR') : ''
      });

      row.height = 20;
      row.getCell('qtd').numFmt = '#,##0';
      row.getCell('custoUnit').numFmt = 'R$ #,##0.00';
      row.getCell('valorTotal').numFmt = 'R$ #,##0.00';

      if (isDone) {
        row.eachCell((cell) => {
          cell.fill = completedFill;
          cell.font = completedFont;
        });
      } else {
        row.font = normalFont;
      }
    });
  }

  // 2. Sheet: Reclassificações
  if (type === 'reclassifications' || type === 'all') {
    const ws = workbook.addWorksheet('Matriz Reclassificação NCM');
    ws.columns = [
      { header: 'Status Execução', key: 'statusExecucao', width: 18 },
      { header: 'Cód Negativo', key: 'codigo', width: 14 },
      { header: 'Descrição Item Negativo', key: 'descricao', width: 40 },
      { header: 'NCM', key: 'ncm', width: 14 },
      { header: 'Saldo Loja 1', key: 'saldoLoja1', width: 14 },
      { header: 'Saldo Depósito', key: 'saldoLoja2', width: 14 },
      { header: 'Saldo CD', key: 'saldoLoja3', width: 14 },
      { header: 'Déficit Total', key: 'deficit', width: 14 },
      { header: 'Cobertura NCM', key: 'status', width: 18 },
      { header: 'Saldo Total NCM', key: 'saldoDisponivelNcm', width: 16 },
      { header: 'Doador 1 (Cód)', key: 'd1Cod', width: 14 },
      { header: 'Doador 1 (Descrição)', key: 'd1Desc', width: 35 },
      { header: 'Doador 1 (Total)', key: 'd1Saldo', width: 18 },
      { header: 'Doador 1 (Loja 1)', key: 'd1Loja1', width: 16 },
      { header: 'Doador 1 (Depósito)', key: 'd1Loja2', width: 16 },
      { header: 'Doador 1 (CD)', key: 'd1Loja3', width: 16 },
      { header: 'Doador 2 (Cód)', key: 'd2Cod', width: 14 },
      { header: 'Doador 2 (Total)', key: 'd2Saldo', width: 16 },
      { header: 'Data da Baixa', key: 'dataBaixa', width: 22 }
    ];

    styleHeaderRow(ws);

    db.reclassifications.forEach(item => {
      const st = db.status.reclassifications[item.id];
      const isDone = Boolean(st && st.done);
      const row = ws.addRow({
        statusExecucao: isDone ? 'CONCLUÍDO' : 'PENDENTE',
        codigo: item.codigo,
        descricao: item.descricao,
        ncm: item.ncm,
        saldoLoja1: item.saldoLoja1,
        saldoLoja2: item.saldoLoja2,
        saldoLoja3: item.saldoLoja3,
        deficit: item.deficit,
        status: item.status,
        saldoDisponivelNcm: item.saldoDisponivelNcm,
        d1Cod: item.doador1.codigo,
        d1Desc: item.doador1.descricao,
        d1Saldo: item.doador1.saldo,
        d1Loja1: item.doador1.saldoLoja1,
        d1Loja2: item.doador1.saldoLoja2,
        d1Loja3: item.doador1.saldoLoja3,
        d2Cod: item.doador2.codigo,
        d2Saldo: item.doador2.saldo,
        dataBaixa: isDone && st.updatedAt ? new Date(st.updatedAt).toLocaleString('pt-BR') : ''
      });

      row.height = 20;
      row.getCell('deficit').numFmt = '#,##0';
      row.getCell('saldoDisponivelNcm').numFmt = '#,##0';
      row.getCell('d1Saldo').numFmt = '#,##0';
      row.getCell('d1Loja1').numFmt = '#,##0';
      row.getCell('d1Loja2').numFmt = '#,##0';
      row.getCell('d1Loja3').numFmt = '#,##0';

      if (isDone) {
        row.eachCell((cell) => {
          cell.fill = completedFill;
          cell.font = completedFont;
        });
      } else {
        row.font = normalFont;
      }
    });
  }

  // 3. Sheet: Compras Críticas
  if (type === 'purchases' || type === 'all') {
    const ws = workbook.addWorksheet('Compras Críticas (Filtro 3)');
    ws.columns = [
      { header: 'Status Execução', key: 'statusExecucao', width: 18 },
      { header: 'Código', key: 'codigo', width: 12 },
      { header: 'Descrição', key: 'descricao', width: 40 },
      { header: 'EMB', key: 'emb', width: 8 },
      { header: 'NCM', key: 'ncm', width: 14 },
      { header: 'Saldo Loja 1', key: 'saldoLoja1', width: 14 },
      { header: 'Saldo Loja 2', key: 'saldoLoja2', width: 14 },
      { header: 'Saldo Loja 3', key: 'saldoLoja3', width: 14 },
      { header: 'Déficit Peças', key: 'deficitPecas', width: 14 },
      { header: 'Custo Unit (R$)', key: 'custoUnit', width: 15 },
      { header: 'Valor Total (R$)', key: 'valorTotal', width: 16 },
      { header: 'Motivo Fiscal', key: 'motivo', width: 38 },
      { header: 'Data da Baixa', key: 'dataBaixa', width: 22 }
    ];

    styleHeaderRow(ws);

    db.criticalPurchases.forEach(item => {
      const st = db.status.purchases[item.id];
      const isDone = Boolean(st && st.done);
      const row = ws.addRow({
        statusExecucao: isDone ? 'CONCLUÍDO' : 'PENDENTE',
        codigo: item.codigo,
        descricao: item.descricao,
        emb: item.emb,
        ncm: item.ncm,
        saldoLoja1: item.saldoLoja1,
        saldoLoja2: item.saldoLoja2,
        saldoLoja3: item.saldoLoja3,
        deficitPecas: item.deficitPecas,
        custoUnit: item.custoUnit,
        valorTotal: item.valorTotal,
        motivo: item.motivo,
        dataBaixa: isDone && st.updatedAt ? new Date(st.updatedAt).toLocaleString('pt-BR') : ''
      });

      row.height = 20;
      row.getCell('deficitPecas').numFmt = '#,##0';
      row.getCell('custoUnit').numFmt = 'R$ #,##0.00';
      row.getCell('valorTotal').numFmt = 'R$ #,##0.00';

      if (isDone) {
        row.eachCell((cell) => {
          cell.fill = completedFill;
          cell.font = completedFont;
        });
      } else {
        row.font = normalFont;
      }
    });
  }

  return await workbook.xlsx.writeBuffer();
}

function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) {
      if (typeof req.body === 'object') return resolve(JSON.stringify(req.body));
      return resolve(req.body);
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', err => reject(err));
  });
}

// -------------------------------------------------------------
// HTTP Server & Routes
// -------------------------------------------------------------
async function handleRequest(req, res) {
  try {
    if (!db.summary && db.transfers.length === 0) {
      loadData();
    }
    const rawPath = req.headers['x-matched-path'] || req.headers['x-invoke-path'] || req.url;
    const reqUrl = new URL(rawPath, `http://${req.headers.host || 'localhost:3000'}`);
    let pathname = reqUrl.pathname;

    // Normalize Vercel paths
    pathname = pathname.replace(/^\/api\/index(\.js)?/, '/api');
    if (pathname === '/api' || pathname === '/api/') {
      pathname = '/api/summary';
    }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- API: Status Endpoints ---
  if (pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      status: db.status,
      progress: getProgressStats()
    }));
    return;
  }

  if (pathname === '/api/status/toggle' && req.method === 'POST') {
    try {
      const body = await getRequestBody(req);
      const payload = JSON.parse(body || '{}');
      const { type, id, done, note } = payload;

      if (!type || !id || !db.status[type]) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Parâmetros inválidos' }));
        return;
      }

      db.status[type][id] = {
        done: Boolean(done),
        updatedAt: new Date().toISOString(),
        note: note || ''
      };

      saveStatus();

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        itemStatus: db.status[type][id],
        progress: getProgressStats()
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // --- API: Batch Status Toggle ---
  if (pathname === '/api/status/batch-toggle' && req.method === 'POST') {
    try {
      const body = await getRequestBody(req);
      const payload = JSON.parse(body || '{}');
      const { type, ids, done, note } = payload;

      if (!type || !Array.isArray(ids) || !db.status[type]) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Parâmetros inválidos' }));
        return;
      }

      const now = new Date().toISOString();
      ids.forEach(id => {
        db.status[type][id] = {
          done: Boolean(done),
          updatedAt: now,
          note: note || 'Baixa em lote'
        };
      });

      saveStatus();

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        count: ids.length,
        progress: getProgressStats()
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // --- API: Summary Endpoint ---
  if (pathname === '/api/summary' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      summary: db.summary,
      counts: {
        filtro1: db.positiveStock.length,
        filtro2: db.transfers.length,
        filtro3: db.criticalPurchases.length,
        filtro4: db.reclassifications.length,
        totalProdutos: db.productMap.size
      },
      progress: getProgressStats()
    }));
    return;
  }

  // --- API: Transfers (Filtro 2) ---
  if (pathname === '/api/transfers' && req.method === 'GET') {
    const q = (reqUrl.searchParams.get('search') || '').toLowerCase();
    const origin = reqUrl.searchParams.get('origin') || '';
    const dest = reqUrl.searchParams.get('dest') || '';
    const statusFilter = reqUrl.searchParams.get('statusFilter') || 'all'; // all, pending, done
    const page = parseInt(reqUrl.searchParams.get('page') || '1', 10);
    const limit = parseInt(reqUrl.searchParams.get('limit') || '50', 10);

    let filtered = db.transfers.map(t => {
      const st = db.status.transfers[t.id];
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

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      total,
      totalPecas,
      totalValor,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      items,
      progress: getProgressStats().transfers
    }));
    return;
  }

  // --- API: Reclassifications (Filtro 4) ---
  if (pathname === '/api/reclassifications' && req.method === 'GET') {
    const q = (reqUrl.searchParams.get('search') || '').toLowerCase();
    const status = reqUrl.searchParams.get('status') || '';
    const statusFilter = reqUrl.searchParams.get('statusFilter') || 'all';
    const page = parseInt(reqUrl.searchParams.get('page') || '1', 10);
    const limit = parseInt(reqUrl.searchParams.get('limit') || '50', 10);
    const store = reqUrl.searchParams.get('store') || '';
    const donorStore = reqUrl.searchParams.get('donorStore') || '';
    const batchParam = reqUrl.searchParams.get('batch') || 'all';
    const batchSize = parseInt(reqUrl.searchParams.get('batchSize') || '100', 10);

    let filtered = db.reclassifications.map(r => {
      const st = db.status.reclassifications[r.codigo] || db.status.reclassifications[r.id];
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

    // Calculate summary for all batches in the current filter
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

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
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
    }));
    return;
  }

  // --- API: Purchases (Filtro 3) ---
  if (pathname === '/api/purchases' && req.method === 'GET') {
    const q = (reqUrl.searchParams.get('search') || '').toLowerCase();
    const statusFilter = reqUrl.searchParams.get('statusFilter') || 'all';

    let filtered = db.criticalPurchases.map(p => {
      const st = db.status.purchases[p.id];
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

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      total: filtered.length,
      totalPecas,
      totalValor,
      items: filtered,
      progress: getProgressStats().purchases
    }));
    return;
  }

  // --- API: Positive Stock (Filtro 1) ---
  if (pathname === '/api/positive' && req.method === 'GET') {
    const q = (reqUrl.searchParams.get('search') || '').toLowerCase();
    const ncm = reqUrl.searchParams.get('ncm') || '';
    const page = parseInt(reqUrl.searchParams.get('page') || '1', 10);
    const limit = parseInt(reqUrl.searchParams.get('limit') || '50', 10);

    let filtered = db.positiveStock;
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

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      items
    }));
    return;
  }

  // --- API: Product 360 Lookup ---
  if (pathname.startsWith('/api/product/')) {
    const code = decodeURIComponent(pathname.replace('/api/product/', '')).trim();
    const prod = db.productMap.get(code);
    if (!prod) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Produto não encontrado', code }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(prod));
    return;
  }

  // --- API: Export ERP TXT/CSV (Codigo;qtd) ---
  if (pathname === '/api/export/erp-txt') {
    const origin = reqUrl.searchParams.get('origin') || '';
    const dest = reqUrl.searchParams.get('dest') || '';
    const statusFilter = reqUrl.searchParams.get('statusFilter') || 'all';
    const q = (reqUrl.searchParams.get('search') || '').toLowerCase();
    const scope = reqUrl.searchParams.get('scope') || 'all'; // 'all' (default) or 'page'
    const page = parseInt(reqUrl.searchParams.get('page') || '1', 10);
    const limit = parseInt(reqUrl.searchParams.get('limit') || '50', 10);
    const format = reqUrl.searchParams.get('format') || 'text'; // 'text' or 'json'

    let filtered = db.transfers.map(t => {
      const st = db.status.transfers[t.id];
      return {
        ...t,
        isDone: Boolean(st && st.done)
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

    const totalFiltered = filtered.length;

    let exportItems = filtered;
    if (scope === 'page') {
      const start = (page - 1) * limit;
      exportItems = filtered.slice(start, start + limit);
    }

    const lines = ['Codigo;qtd'];
    const ids = [];
    exportItems.forEach(t => {
      const qtdStr = Number.isInteger(t.qtd) ? String(t.qtd) : String(t.qtd).replace('.', ',');
      lines.push(`${t.codigo};${qtdStr}`);
      ids.push(t.id);
    });

    const output = lines.join('\r\n');

    if (format === 'json') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        totalFiltered,
        count: exportItems.length,
        scope,
        ids,
        text: output
      }));
      return;
    }

    const filename = `transferencias_erp_${origin || 'todas'}_para_${dest || 'todas'}.txt`.replace(/[^a-zA-Z0-9_\.]/g, '_');
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`
    });
    res.end(output);
    return;
  }

  // --- API: Export Reclassification ERP TXT (2 Blocks: Block 1 Sair/Doar, Block 2 Entrar/Receber) ---
  if (pathname === '/api/export/reclass-erp-txt') {
    const status = reqUrl.searchParams.get('status') || '';
    const statusFilter = reqUrl.searchParams.get('statusFilter') || 'all';
    const q = (reqUrl.searchParams.get('search') || '').toLowerCase();
    const scope = reqUrl.searchParams.get('scope') || 'batch'; // 'batch' (default 100 items), 'page' (50 items), 'all'
    const page = parseInt(reqUrl.searchParams.get('page') || '1', 10);
    const limit = parseInt(reqUrl.searchParams.get('limit') || '50', 10);
    const batchSize = parseInt(reqUrl.searchParams.get('batchSize') || '100', 10);
    const batchIndex = parseInt(reqUrl.searchParams.get('batchIndex') || '1', 10);
    const format = reqUrl.searchParams.get('format') || 'json';
    const singleCode = reqUrl.searchParams.get('code') || '';
    const store = reqUrl.searchParams.get('store') || '';
    const donorStore = reqUrl.searchParams.get('donorStore') || '';
    const includeCostBlock1 = reqUrl.searchParams.get('includeCostBlock1') !== '0';
    const includeCostBlock2 = reqUrl.searchParams.get('includeCostBlock2') !== '0';

    let filtered = db.reclassifications.map(r => {
      const st = db.status.reclassifications[r.codigo];
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
          r.ncm.includes(q)
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

    // Mapa de saldo disponível dos doadores no lote
    const donorBalances = new Map();
    const block1Map = new Map(); // key: donorCode -> { codigo, qtd, valor }
    const block2Map = new Map(); // key: recCode -> { codigo, qtd, valor }
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

          // 1. Bloco 1 (Saída Doador - Agrupado por Código)
          if (!block1Map.has(d.codigo)) {
            block1Map.set(d.codigo, { codigo: d.codigo, qtd: 0, valor: 0 });
          }
          const b1Item = block1Map.get(d.codigo);
          b1Item.qtd += donateQty;
          b1Item.valor += valorSubtotal;

          // 2. Bloco 2 (Entrada Receptor - Agrupado por Código com Custo Rateado)
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

    // Formata Bloco 1 (Saída/Doador): respeita a flag includeCostBlock1
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

    // Formata Bloco 2 (Entrada/Receptor): respeita a flag includeCostBlock2
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
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        totalFiltered,
        count: exportItems.length,
        scope,
        batchInfo: {
          currentBatch: batchIndex,
          totalBatches,
          batchSize,
          startItem: (batchIndex - 1) * batchSize + 1,
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
        }
      }));
      return;
    }

    if (format === 'block1') {
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename="reclassificacao_BLOCO1_SAIDA_DOADORES.txt"'
      });
      res.end(block1Text);
      return;
    }

    if (format === 'block2') {
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename="reclassificacao_BLOCO2_ENTRADA_RECEBIMENTO.txt"'
      });
      res.end(block2Text);
      return;
    }

    const combined = [
      '# ========================================================',
      '# BLOCO 1 - ITENS QUE VÃO SAIR / DOAR (DEDUÇÃO DOADOR)',
      `# Formato: ${block1Format}`,
      '# ========================================================',
      block1Text,
      '',
      '# ========================================================',
      '# BLOCO 2 - ITENS QUE VÃO ENTRAR / RECEBER (ENTRADA FISCAL)',
      `# Formato: ${block2Format}`,
      '# ========================================================',
      block2Text
    ].join('\r\n');

    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="reclassificacao_2_BLOCOS_COMPLETO.txt"'
    });
    res.end(combined);
    return;
  }

  // --- API: Dynamic Styled Excel Export with Colored Rows ---
  if (pathname === '/api/export/excel') {
    try {
      const type = reqUrl.searchParams.get('type') || 'all';
      const buffer = await generateStyledExcel(type);
      const filename = `newshop_${type}_atualizado_${new Date().toISOString().slice(0,10)}.xlsx`;

      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length
      });
      res.end(buffer);
      return;
    } catch (e) {
      console.error('Erro ao gerar Excel:', e);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Erro ao gerar planilha Excel: ' + e.message);
      return;
    }
  }

  // --- API: Static file downloads ---
  if (pathname.startsWith('/api/download/')) {
    const filename = path.basename(decodeURIComponent(pathname.replace('/api/download/', '')));
    const filePath = path.join(BASE_DIR, filename);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      let contentType = 'application/octet-stream';
      if (filename.endsWith('.csv')) contentType = 'text/csv; charset=utf-8';
      if (filename.endsWith('.json')) contentType = 'application/json; charset=utf-8';
      if (filename.endsWith('.xlsx')) contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

      const fileBuffer = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': fileBuffer.length,
        'Content-Disposition': `attachment; filename="${filename}"`
      });
      res.end(fileBuffer);
      return;
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Arquivo não encontrado');
      return;
    }
  }

  // --- Static Files ---
  let filePath = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!fs.existsSync(filePath)) {
    filePath = path.normalize(path.join(BASE_DIR, pathname === '/' ? 'index.html' : pathname));
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
    if (!fs.existsSync(filePath)) {
      filePath = path.join(BASE_DIR, 'index.html');
    }
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': contentType };
    if (ext === '.js' || ext === '.css' || ext === '.html') {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    }
    const content = fs.readFileSync(filePath);
    res.writeHead(200, headers);
    res.end(content);
    return;
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Recurso não encontrado' }));
    return;
  }
  } catch (err) {
    console.error('💥 Erro em handleRequest:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message || 'Erro interno do servidor' }));
    }
  }
}

const server = http.createServer(handleRequest);

function getNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

if (require.main === module && !process.env.VERCEL) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🚀 Newshop Estoque Reclassificação - Servidor Ativo!`);
    console.log(`🌐 Local:   http://localhost:${PORT}`);
    const netIps = getNetworkAddresses();
    netIps.forEach(ip => {
      console.log(`🌐 Rede:    http://${ip}:${PORT}`);
    });
    console.log(`💾 Sistema de baixa e pintura de itens integrado!`);
    console.log(`=======================================================`);
  });
}

module.exports = {
  server,
  handleRequest,
  db,
  loadData
};
