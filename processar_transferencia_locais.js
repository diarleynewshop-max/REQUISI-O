const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const WORKSPACE_DIR = __dirname;
const DOWNLOADS_CSV = 'C:/Users/diarl/Downloads/ATUALZIADO.csv';
const COPIA_WORKSPACE_CSV = path.join(WORKSPACE_DIR, '0_estoque_atualizado_locais.csv');

console.log('🚀 Iniciando processamento de transferência de estoque por local...');

// 1. Copiar CSV mais recente de Downloads para o Workspace
if (fs.existsSync(DOWNLOADS_CSV)) {
  fs.copyFileSync(DOWNLOADS_CSV, COPIA_WORKSPACE_CSV);
  console.log(`✅ Arquivo copiado de "${DOWNLOADS_CSV}" para "${COPIA_WORKSPACE_CSV}"`);
} else if (fs.existsSync(COPIA_WORKSPACE_CSV)) {
  console.log(`ℹ️ Utilizando arquivo existente no workspace: "${COPIA_WORKSPACE_CSV}"`);
} else {
  console.error(`❌ Arquivo não encontrado: ${DOWNLOADS_CSV} nem ${COPIA_WORKSPACE_CSV}`);
  process.exit(1);
}

// 2. Parser CSV robusto com suporte a aspas duplas e quebras de linha
function parseCSV(content) {
  const rows = [];
  let cur = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '"') {
      if (inQuotes && content[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ';' && !inQuotes) {
      row.push(cur.trim());
      cur = '';
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && content[i + 1] === '\n') {
        i++;
      }
      row.push(cur.trim());
      cur = '';
      if (row.some(x => x !== '')) {
        rows.push(row);
      }
      row = [];
    } else {
      cur += c;
    }
  }

  if (cur !== '' || row.length > 0) {
    row.push(cur.trim());
    if (row.some(x => x !== '')) {
      rows.push(row);
    }
  }

  return rows;
}

function parseNumber(val) {
  if (!val) return 0;
  let clean = String(val).replace(/"/g, '').trim();
  clean = clean.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

function formatNumberBR(num, decimals = 2) {
  if (num === null || num === undefined || isNaN(num)) return '0,00';
  const parts = Number(num).toFixed(decimals).split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimals > 0 ? `${intPart},${parts[1]}` : intPart;
}

function formatQtdSimple(num) {
  if (Number.isInteger(num)) return String(num);
  return String(num).replace('.', ',');
}

// 3. Leitura e parsing do arquivo
console.log('⏳ Lendo arquivo CSV...');
const rawContent = fs.readFileSync(COPIA_WORKSPACE_CSV, 'utf8');
const allRows = parseCSV(rawContent);
console.log(`📊 Total de linhas lidas (incluindo cabeçalho): ${allRows.length}`);

// Definição dos lotes de transferência
const lotes = {
  L3_MIDI_GERAL: {
    id: 'L3_MIDI_GERAL',
    nome: 'Loja 3 (CD) - Galpão MIDI para GERAL',
    nomeCurto: 'L3 CD - MIDI p Geral',
    arquivo: 'transferencia_L3_CD_GalpaoMIDI_para_GERAL',
    lojaOrigem: 'Loja 3 (CD)',
    localOrigem: '20 - GALPÃO MIDI',
    localDestino: '4 - GERAL',
    itens: []
  },
  L3_GALPAO_PADRAO: {
    id: 'L3_GALPAO_PADRAO',
    nome: 'Loja 3 (CD) - Galpão para PADRÃO',
    nomeCurto: 'L3 CD - Galpão p Padrão',
    arquivo: 'transferencia_L3_CD_Galpao_para_PADRAO',
    lojaOrigem: 'Loja 3 (CD)',
    localOrigem: '15 - GALPÃO',
    localDestino: '1 - PADRÃO',
    itens: []
  },
  L1_MIDI_GERAL: {
    id: 'L1_MIDI_GERAL',
    nome: 'Loja 1 (LOJA) - Galpão MIDI para GERAL',
    nomeCurto: 'L1 LOJA - Galpão MIDI p Geral',
    arquivo: 'transferencia_L1_Loja_GalpaoMIDI_para_GERAL',
    lojaOrigem: 'Loja 1 (LOJA)',
    localOrigem: '20 - GALPÃO MIDI',
    localDestino: '4 - GERAL',
    itens: []
  },
  L1_CDMIDI_GERAL: {
    id: 'L1_CDMIDI_GERAL',
    nome: 'Loja 1 (LOJA) - CD MIDI para GERAL',
    nomeCurto: 'L1 LOJA - CD MIDI p Geral',
    arquivo: 'transferencia_L1_Loja_CDMIDI_para_GERAL',
    lojaOrigem: 'Loja 1 (LOJA)',
    localOrigem: '23 - CD MIDI',
    localDestino: '4 - GERAL',
    itens: []
  },
  L1_GALPAO_PADRAO: {
    id: 'L1_GALPAO_PADRAO',
    nome: 'Loja 1 (LOJA) - Galpão para PADRÃO',
    nomeCurto: 'L1 LOJA - Galpão p Padrão',
    arquivo: 'transferencia_L1_Loja_Galpao_para_PADRAO',
    lojaOrigem: 'Loja 1 (LOJA)',
    localOrigem: '15 - GALPÃO',
    localDestino: '1 - PADRÃO',
    itens: []
  },
  L2_GALPAO_PADRAO: {
    id: 'L2_GALPAO_PADRAO',
    nome: 'Loja 2 (DEPÓSITO) - Galpão para PADRÃO',
    nomeCurto: 'L2 DEPÓSITO - Galpão p Padrão',
    arquivo: 'transferencia_L2_Deposito_Galpao_para_PADRAO',
    lojaOrigem: 'Loja 2 (DEPÓSITO)',
    localOrigem: '15 - GALPÃO',
    localDestino: '1 - PADRÃO',
    itens: []
  }
};

const ignorados = [];
const negativos = [];

// Para mapear compensação interna na Loja 3 (CD)
const l3GalpaoMap = new Map();
const l3MidiMap = new Map();

for (let i = 1; i < allRows.length; i++) {
  const row = allRows[i];
  if (row.length < 7) continue;

  const quebra1 = (row[0] || '').trim();
  const quebra2 = (row[1] || '').trim();
  const codigo = (row[2] || '').replace(/"/g, '').trim();
  const descricao = (row[3] || '').replace(/"/g, '').trim();
  const emb = (row[4] || 'UN').replace(/"/g, '').trim();
  const ncm = (row[5] || '').replace(/"/g, '').trim();
  const estoque = parseNumber(row[6]);
  const custoUnit = parseNumber(row[9]);
  const precoUnit = parseNumber(row[10]);

  if (!codigo) continue;

  const itemObj = {
    loja: quebra1,
    local: quebra2,
    codigo,
    descricao,
    emb,
    ncm,
    estoque,
    custoUnit,
    precoUnit,
    totalCusto: estoque * custoUnit,
    totalVenda: estoque * precoUnit
  };

  // 1. Ignorar Gerencial e Quebrados
  const q2Upper = quebra2.toUpperCase();
  if (q2Upper.includes('GERENCIAL') || q2Upper.includes('QUEBRADO')) {
    ignorados.push(itemObj);
    continue;
  }

  // 2. Rastrear para compensação da Loja 3
  if (quebra1.includes('Loja: 3') || quebra1.includes('CD')) {
    if (q2Upper.includes('15 - GALPÃO')) {
      l3GalpaoMap.set(codigo, itemObj);
    } else if (q2Upper.includes('20 - GALPÃO MIDI')) {
      l3MidiMap.set(codigo, itemObj);
    }
  }

  // 3. Tratar negativos (não podem ser transferidos via rotina de transferências positivas)
  if (estoque < 0) {
    negativos.push(itemObj);
    continue;
  }

  // Se estoque for 0, ignora movimentação
  if (estoque === 0) continue;

  // 4. Separar por Lote Positivo
  if (quebra1.includes('Loja: 3') || quebra1.includes('CD')) {
    if (q2Upper.includes('GALPÃO MIDI')) {
      lotes.L3_MIDI_GERAL.itens.push(itemObj);
    } else {
      lotes.L3_GALPAO_PADRAO.itens.push(itemObj);
    }
  } else if (quebra1.includes('Loja: 1') || quebra1.includes('LOJA')) {
    if (q2Upper.includes('GALPÃO MIDI')) {
      lotes.L1_MIDI_GERAL.itens.push(itemObj);
    } else if (q2Upper.includes('CD MIDI')) {
      lotes.L1_CDMIDI_GERAL.itens.push(itemObj);
    } else {
      lotes.L1_GALPAO_PADRAO.itens.push(itemObj);
    }
  } else if (quebra1.includes('Loja: 2') || quebra1.includes('DEPOSITO')) {
    lotes.L2_GALPAO_PADRAO.itens.push(itemObj);
  }
}

// Compensação interna Loja 3: Negativo no Galpão (15) que possui saldo no MIDI (20)
const compensacoesL3 = [];
for (const [cod, itemG] of l3GalpaoMap.entries()) {
  if (itemG.estoque < 0 && l3MidiMap.has(cod)) {
    const itemM = l3MidiMap.get(cod);
    if (itemM.estoque > 0) {
      const deficitGalpao = Math.abs(itemG.estoque);
      const saldoDisponivelMidi = itemM.estoque;
      const qtdCompensar = Math.min(deficitGalpao, saldoDisponivelMidi);
      const saldoFinalGalpao = itemG.estoque + qtdCompensar;
      const saldoFinalMidi = saldoDisponivelMidi - qtdCompensar;

      compensacoesL3.push({
        codigo: cod,
        descricao: itemG.descricao,
        ncm: itemG.ncm,
        emb: itemG.emb,
        deficitGalpao: itemG.estoque,
        saldoMidi: itemM.estoque,
        qtdCompensada: qtdCompensar,
        saldoFinalGalpao,
        saldoFinalMidi,
        status: saldoFinalGalpao === 0 ? 'ZERADO_TOTAL' : 'PARCIAL',
        custoUnit: itemG.custoUnit,
        valorCompensado: qtdCompensar * itemG.custoUnit
      });
    }
  }
}

// 4. Gerar Arquivos CSV & TXT de Digitação Rápida (Codigo;qtd)
console.log('✍️ Gerando arquivos de digitação rápida para Auto Clicker e Extensão...');

for (const lote of Object.values(lotes)) {
  const content = [
    'Codigo;qtd',
    ...lote.itens.map(it => `${it.codigo};${formatQtdSimple(it.estoque)}`)
  ].join('\r\n');

  const csvPath = path.join(WORKSPACE_DIR, `${lote.arquivo}.csv`);
  const txtPath = path.join(WORKSPACE_DIR, `${lote.arquivo}.txt`);

  fs.writeFileSync(csvPath, content, 'utf8');
  fs.writeFileSync(txtPath, content, 'utf8');
  console.log(`  ✅ ${lote.arquivo} (${lote.itens.length} itens)`);
}

// Arquivos consolidados
const todosMidi = [
  ...lotes.L3_MIDI_GERAL.itens,
  ...lotes.L1_MIDI_GERAL.itens,
  ...lotes.L1_CDMIDI_GERAL.itens
];
const contentMidi = [
  'Codigo;qtd',
  ...todosMidi.map(it => `${it.codigo};${formatQtdSimple(it.estoque)}`)
].join('\r\n');
fs.writeFileSync(path.join(WORKSPACE_DIR, 'transferencia_CONSOLIDADO_MIDI_para_GERAL.csv'), contentMidi, 'utf8');
fs.writeFileSync(path.join(WORKSPACE_DIR, 'transferencia_CONSOLIDADO_MIDI_para_GERAL.txt'), contentMidi, 'utf8');

const todosNaoMidi = [
  ...lotes.L3_GALPAO_PADRAO.itens,
  ...lotes.L1_GALPAO_PADRAO.itens,
  ...lotes.L2_GALPAO_PADRAO.itens
];
const contentNaoMidi = [
  'Codigo;qtd',
  ...todosNaoMidi.map(it => `${it.codigo};${formatQtdSimple(it.estoque)}`)
].join('\r\n');
fs.writeFileSync(path.join(WORKSPACE_DIR, 'transferencia_CONSOLIDADO_NAO_MIDI_para_PADRAO.csv'), contentNaoMidi, 'utf8');
fs.writeFileSync(path.join(WORKSPACE_DIR, 'transferencia_CONSOLIDADO_NAO_MIDI_para_PADRAO.txt'), contentNaoMidi, 'utf8');

const todosGerais = [...todosMidi, ...todosNaoMidi];
const contentTodos = [
  'Codigo;qtd',
  ...todosGerais.map(it => `${it.codigo};${formatQtdSimple(it.estoque)}`)
].join('\r\n');
fs.writeFileSync(path.join(WORKSPACE_DIR, 'transferencia_CONSOLIDADO_TODOS_LOCAIS.csv'), contentTodos, 'utf8');
fs.writeFileSync(path.join(WORKSPACE_DIR, 'transferencia_CONSOLIDADO_TODOS_LOCAIS.txt'), contentTodos, 'utf8');

console.log(`✅ Arquivos consolidados gravados (MIDI->GERAL: ${todosMidi.length}, NÃO-MIDI->PADRÃO: ${todosNaoMidi.length}, TOTAL: ${todosGerais.length})`);

// 5. Gerar Planilha Excel Mestra Profissional (.xlsx)
async function generateExcelWorkbook() {
  console.log('📊 Criando pasta de trabalho Excel "plano_transferencia_locais_estoque.xlsx"...');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Newshop Automations';
  wb.created = new Date();

  const headerStyle = {
    font: { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } },
    alignment: { vertical: 'middle', horizontal: 'center' }
  };

  const totalRowStyle = {
    font: { name: 'Segoe UI', size: 10, bold: true },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
  };

  // Helper para adicionar aba de itens
  function addItemsWorksheet(sheetName, loteInfo, itens) {
    const ws = wb.addWorksheet(sheetName);
    ws.views = [{ showGridLines: true }];

    ws.columns = [
      { header: 'Código', key: 'codigo', width: 12 },
      { header: 'Descrição', key: 'descricao', width: 45 },
      { header: 'EMB', key: 'emb', width: 8, style: { alignment: { horizontal: 'center' } } },
      { header: 'NCM', key: 'ncm', width: 14, style: { alignment: { horizontal: 'center' } } },
      { header: 'Loja Origem', key: 'loja', width: 30 },
      { header: 'Local Origem', key: 'localOrigem', width: 22 },
      { header: 'Local Destino', key: 'localDestino', width: 18 },
      { header: 'Qtd a Transferir', key: 'estoque', width: 16, style: { numFmt: '#,##0' } },
      { header: 'Custo Unit (R$)', key: 'custoUnit', width: 16, style: { numFmt: 'R$ #,##0.00' } },
      { header: 'Total Custo (R$)', key: 'totalCusto', width: 18, style: { numFmt: 'R$ #,##0.00' } },
      { header: 'Preço Venda (R$)', key: 'precoUnit', width: 16, style: { numFmt: 'R$ #,##0.00' } },
      { header: 'Total Venda (R$)', key: 'totalVenda', width: 18, style: { numFmt: 'R$ #,##0.00' } }
    ];

    ws.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));
    ws.getRow(1).height = 25;

    let totPecas = 0;
    let totCusto = 0;
    let totVenda = 0;

    itens.forEach(it => {
      totPecas += it.estoque;
      totCusto += it.totalCusto;
      totVenda += it.totalVenda;

      ws.addRow({
        codigo: it.codigo,
        descricao: it.descricao,
        emb: it.emb,
        ncm: it.ncm,
        loja: loteInfo.lojaOrigem || it.loja,
        localOrigem: loteInfo.localOrigem || it.local,
        localDestino: loteInfo.localDestino || 'PADRÃO',
        estoque: it.estoque,
        custoUnit: it.custoUnit,
        totalCusto: it.totalCusto,
        precoUnit: it.precoUnit,
        totalVenda: it.totalVenda
      });
    });

    const totRow = ws.addRow({
      codigo: 'TOTAL',
      descricao: `${itens.length} itens listados`,
      emb: '',
      ncm: '',
      loja: '',
      localOrigem: '',
      localDestino: '',
      estoque: totPecas,
      custoUnit: null,
      totalCusto: totCusto,
      precoUnit: null,
      totalVenda: totVenda
    });
    totRow.eachCell(cell => Object.assign(cell, totalRowStyle));
    totRow.height = 22;

    return { itens: itens.length, pecas: totPecas, custo: totCusto, venda: totVenda };
  }

  // 1. Resumo Executivo
  const wsResumo = wb.addWorksheet('Resumo Executivo');
  wsResumo.views = [{ showGridLines: true }];
  wsResumo.columns = [
    { header: 'Lote / Movimentação Operacional', key: 'lote', width: 42 },
    { header: 'Loja', key: 'loja', width: 22 },
    { header: 'Origem', key: 'origem', width: 22 },
    { header: 'Destino', key: 'destino', width: 16 },
    { header: 'Itens', key: 'itens', width: 12, style: { numFmt: '#,##0' } },
    { header: 'Peças a Transferir', key: 'pecas', width: 18, style: { numFmt: '#,##0' } },
    { header: 'Custo Total (R$)', key: 'custo', width: 20, style: { numFmt: 'R$ #,##0.00' } },
    { header: 'Venda Total (R$)', key: 'venda', width: 20, style: { numFmt: 'R$ #,##0.00' } }
  ];
  wsResumo.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));
  wsResumo.getRow(1).height = 26;

  const statsL3Midi = addItemsWorksheet('L3 CD - MIDI p Geral', lotes.L3_MIDI_GERAL, lotes.L3_MIDI_GERAL.itens);
  const statsL3Galpao = addItemsWorksheet('L3 CD - Galpão p Padrão', lotes.L3_GALPAO_PADRAO, lotes.L3_GALPAO_PADRAO.itens);
  const statsL1Midi = addItemsWorksheet('L1 LOJA - MIDI p Geral', {
    lojaOrigem: 'Loja 1 (LOJA)',
    localOrigem: 'GALPÃO MIDI / CD MIDI',
    localDestino: '4 - GERAL'
  }, [...lotes.L1_MIDI_GERAL.itens, ...lotes.L1_CDMIDI_GERAL.itens]);
  const statsL1Galpao = addItemsWorksheet('L1 LOJA - Galpão p Padrão', lotes.L1_GALPAO_PADRAO, lotes.L1_GALPAO_PADRAO.itens);
  const statsL2Galpao = addItemsWorksheet('L2 DEPÓSITO - Galpão', lotes.L2_GALPAO_PADRAO, lotes.L2_GALPAO_PADRAO.itens);

  // Preencher Resumo Executivo
  const resumoRows = [
    { lote: lotes.L3_MIDI_GERAL.nome, loja: 'Loja 3 (CD)', origem: '20 - GALPÃO MIDI', destino: '4 - GERAL', ...statsL3Midi },
    { lote: lotes.L3_GALPAO_PADRAO.nome, loja: 'Loja 3 (CD)', origem: '15 - GALPÃO', destino: '1 - PADRÃO', ...statsL3Galpao },
    { lote: 'Loja 1 (LOJA) - Galpão MIDI para GERAL', loja: 'Loja 1 (LOJA)', origem: '20 - GALPÃO MIDI', destino: '4 - GERAL', itens: lotes.L1_MIDI_GERAL.itens.length, pecas: lotes.L1_MIDI_GERAL.itens.reduce((a,b)=>a+b.estoque,0), custo: lotes.L1_MIDI_GERAL.itens.reduce((a,b)=>a+b.totalCusto,0), venda: lotes.L1_MIDI_GERAL.itens.reduce((a,b)=>a+b.totalVenda,0) },
    { lote: 'Loja 1 (LOJA) - CD MIDI para GERAL', loja: 'Loja 1 (LOJA)', origem: '23 - CD MIDI', destino: '4 - GERAL', itens: lotes.L1_CDMIDI_GERAL.itens.length, pecas: lotes.L1_CDMIDI_GERAL.itens.reduce((a,b)=>a+b.estoque,0), custo: lotes.L1_CDMIDI_GERAL.itens.reduce((a,b)=>a+b.totalCusto,0), venda: lotes.L1_CDMIDI_GERAL.itens.reduce((a,b)=>a+b.totalVenda,0) },
    { lote: lotes.L1_GALPAO_PADRAO.nome, loja: 'Loja 1 (LOJA)', origem: '15 - GALPÃO', destino: '1 - PADRÃO', ...statsL1Galpao },
    { lote: lotes.L2_GALPAO_PADRAO.nome, loja: 'Loja 2 (DEPÓSITO)', origem: '15 - GALPÃO', destino: '1 - PADRÃO', ...statsL2Galpao }
  ];

  resumoRows.forEach(r => wsResumo.addRow(r));

  const totalGeralPecas = resumoRows.reduce((a, b) => a + b.pecas, 0);
  const totalGeralCusto = resumoRows.reduce((a, b) => a + b.custo, 0);
  const totalGeralVenda = resumoRows.reduce((a, b) => a + b.venda, 0);
  const totalGeralItens = resumoRows.reduce((a, b) => a + b.itens, 0);

  const totResRow = wsResumo.addRow({
    lote: 'TOTAL GERAL DAS TRANSFERÊNCIAS',
    loja: 'Todas as Lojas',
    origem: 'Todos os Locais',
    destino: 'GERAL / PADRÃO',
    itens: totalGeralItens,
    pecas: totalGeralPecas,
    custo: totalGeralCusto,
    venda: totalGeralVenda
  });
  totResRow.eachCell(cell => Object.assign(cell, totalRowStyle));
  totResRow.height = 24;

  // Aba Compensação Interna Loja 3
  const wsComp = wb.addWorksheet('Compensação Galpão x MIDI (L3)');
  wsComp.views = [{ showGridLines: true }];
  wsComp.columns = [
    { header: 'Código', key: 'codigo', width: 12 },
    { header: 'Descrição', key: 'descricao', width: 45 },
    { header: 'EMB', key: 'emb', width: 8, style: { alignment: { horizontal: 'center' } } },
    { header: 'NCM', key: 'ncm', width: 14, style: { alignment: { horizontal: 'center' } } },
    { header: 'Déficit Galpão (15)', key: 'deficitGalpao', width: 18, style: { numFmt: '#,##0' } },
    { header: 'Saldo MIDI (20)', key: 'saldoMidi', width: 16, style: { numFmt: '#,##0' } },
    { header: 'Qtd Compensada', key: 'qtdCompensada', width: 16, style: { numFmt: '#,##0' } },
    { header: 'Saldo Restante Galpão', key: 'saldoFinalGalpao', width: 22, style: { numFmt: '#,##0' } },
    { header: 'Saldo Restante MIDI', key: 'saldoFinalMidi', width: 20, style: { numFmt: '#,##0' } },
    { header: 'Status', key: 'status', width: 16, style: { alignment: { horizontal: 'center' } } },
    { header: 'Custo Unit (R$)', key: 'custoUnit', width: 16, style: { numFmt: 'R$ #,##0.00' } },
    { header: 'Valor Compensado (R$)', key: 'valorCompensado', width: 22, style: { numFmt: 'R$ #,##0.00' } }
  ];
  wsComp.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));
  wsComp.getRow(1).height = 25;
  compensacoesL3.forEach(c => wsComp.addRow(c));

  // Aba Auditoria de Negativos
  const wsNeg = wb.addWorksheet('Auditoria Itens Negativos');
  wsNeg.views = [{ showGridLines: true }];
  wsNeg.columns = [
    { header: 'Código', key: 'codigo', width: 12 },
    { header: 'Descrição', key: 'descricao', width: 45 },
    { header: 'EMB', key: 'emb', width: 8, style: { alignment: { horizontal: 'center' } } },
    { header: 'NCM', key: 'ncm', width: 14, style: { alignment: { horizontal: 'center' } } },
    { header: 'Loja', key: 'loja', width: 30 },
    { header: 'Local com Déficit', key: 'local', width: 24 },
    { header: 'Saldo Negativo', key: 'estoque', width: 16, style: { numFmt: '#,##0' } },
    { header: 'Custo Unit (R$)', key: 'custoUnit', width: 16, style: { numFmt: 'R$ #,##0.00' } },
    { header: 'Preço Venda (R$)', key: 'precoUnit', width: 16, style: { numFmt: 'R$ #,##0.00' } },
    { header: 'Valor Déficit (R$)', key: 'totalCusto', width: 18, style: { numFmt: 'R$ #,##0.00' } }
  ];
  wsNeg.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));
  wsNeg.getRow(1).height = 25;
  negativos.forEach(n => wsNeg.addRow(n));

  // Aba Locais Ignorados
  const wsIgn = wb.addWorksheet('Locais Ignorados (3 e 21)');
  wsIgn.views = [{ showGridLines: true }];
  wsIgn.columns = [
    { header: 'Código', key: 'codigo', width: 12 },
    { header: 'Descrição', key: 'descricao', width: 45 },
    { header: 'EMB', key: 'emb', width: 8, style: { alignment: { horizontal: 'center' } } },
    { header: 'NCM', key: 'ncm', width: 14, style: { alignment: { horizontal: 'center' } } },
    { header: 'Loja', key: 'loja', width: 30 },
    { header: 'Local Ignorado', key: 'local', width: 26 },
    { header: 'Saldo Estoque', key: 'estoque', width: 16, style: { numFmt: '#,##0' } },
    { header: 'Custo Unit (R$)', key: 'custoUnit', width: 16, style: { numFmt: 'R$ #,##0.00' } },
    { header: 'Total Custo (R$)', key: 'totalCusto', width: 18, style: { numFmt: 'R$ #,##0.00' } }
  ];
  wsIgn.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));
  wsIgn.getRow(1).height = 25;
  ignorados.forEach(ig => wsIgn.addRow(ig));

  const excelPath = path.join(WORKSPACE_DIR, 'plano_transferencia_locais_estoque.xlsx');
  await wb.xlsx.writeFile(excelPath);
  console.log(`✅ Planilha Excel gerada com sucesso: "${excelPath}"`);
}

// 6. Gravar resumo em JSON
const resumoJSON = {
  dataProcessamento: new Date().toISOString(),
  totalRegistrosCSV: allRows.length - 1,
  totalTransferenciasPositivas: todosGerais.length,
  totalPecasTransferir: todosGerais.reduce((a, b) => a + b.estoque, 0),
  valorCustoTotalTransferir: parseFloat(todosGerais.reduce((a, b) => a + b.totalCusto, 0).toFixed(2)),
  valorVendaTotalTransferir: parseFloat(todosGerais.reduce((a, b) => a + b.totalVenda, 0).toFixed(2)),
  lotes: {
    L3_CD_GalpaoMIDI_para_GERAL: {
      itens: lotes.L3_MIDI_GERAL.itens.length,
      pecas: lotes.L3_MIDI_GERAL.itens.reduce((a, b) => a + b.estoque, 0),
      valorCusto: parseFloat(lotes.L3_MIDI_GERAL.itens.reduce((a, b) => a + b.totalCusto, 0).toFixed(2)),
      valorVenda: parseFloat(lotes.L3_MIDI_GERAL.itens.reduce((a, b) => a + b.totalVenda, 0).toFixed(2))
    },
    L3_CD_Galpao_para_PADRAO: {
      itens: lotes.L3_GALPAO_PADRAO.itens.length,
      pecas: lotes.L3_GALPAO_PADRAO.itens.reduce((a, b) => a + b.estoque, 0),
      valorCusto: parseFloat(lotes.L3_GALPAO_PADRAO.itens.reduce((a, b) => a + b.totalCusto, 0).toFixed(2)),
      valorVenda: parseFloat(lotes.L3_GALPAO_PADRAO.itens.reduce((a, b) => a + b.totalVenda, 0).toFixed(2))
    },
    L1_LOJA_GalpaoMIDI_para_GERAL: {
      itens: lotes.L1_MIDI_GERAL.itens.length,
      pecas: lotes.L1_MIDI_GERAL.itens.reduce((a, b) => a + b.estoque, 0),
      valorCusto: parseFloat(lotes.L1_MIDI_GERAL.itens.reduce((a, b) => a + b.totalCusto, 0).toFixed(2)),
      valorVenda: parseFloat(lotes.L1_MIDI_GERAL.itens.reduce((a, b) => a + b.totalVenda, 0).toFixed(2))
    },
    L1_LOJA_CDMIDI_para_GERAL: {
      itens: lotes.L1_CDMIDI_GERAL.itens.length,
      pecas: lotes.L1_CDMIDI_GERAL.itens.reduce((a, b) => a + b.estoque, 0),
      valorCusto: parseFloat(lotes.L1_CDMIDI_GERAL.itens.reduce((a, b) => a + b.totalCusto, 0).toFixed(2)),
      valorVenda: parseFloat(lotes.L1_CDMIDI_GERAL.itens.reduce((a, b) => a + b.totalVenda, 0).toFixed(2))
    },
    L1_LOJA_Galpao_para_PADRAO: {
      itens: lotes.L1_GALPAO_PADRAO.itens.length,
      pecas: lotes.L1_GALPAO_PADRAO.itens.reduce((a, b) => a + b.estoque, 0),
      valorCusto: parseFloat(lotes.L1_GALPAO_PADRAO.itens.reduce((a, b) => a + b.totalCusto, 0).toFixed(2)),
      valorVenda: parseFloat(lotes.L1_GALPAO_PADRAO.itens.reduce((a, b) => a + b.totalVenda, 0).toFixed(2))
    },
    L2_DEPOSITO_Galpao_para_PADRAO: {
      itens: lotes.L2_GALPAO_PADRAO.itens.length,
      pecas: lotes.L2_GALPAO_PADRAO.itens.reduce((a, b) => a + b.estoque, 0),
      valorCusto: parseFloat(lotes.L2_GALPAO_PADRAO.itens.reduce((a, b) => a + b.totalCusto, 0).toFixed(2)),
      valorVenda: parseFloat(lotes.L2_GALPAO_PADRAO.itens.reduce((a, b) => a + b.totalVenda, 0).toFixed(2))
    }
  },
  compensacoesInternasLoja3: {
    qtdItens: compensacoesL3.length,
    qtdPecasCompensadas: compensacoesL3.reduce((a, b) => a + b.qtdCompensada, 0),
    valorCompensado: parseFloat(compensacoesL3.reduce((a, b) => a + b.valorCompensado, 0).toFixed(2))
  },
  itensNegativos: {
    qtdItens: negativos.length,
    qtdPecas: negativos.reduce((a, b) => a + b.estoque, 0),
    valorDeficit: parseFloat(negativos.reduce((a, b) => a + b.totalCusto, 0).toFixed(2))
  },
  locaisIgnorados: {
    qtdItens: ignorados.length,
    qtdPecas: ignorados.reduce((a, b) => a + b.estoque, 0),
    valorTotal: parseFloat(ignorados.reduce((a, b) => a + b.totalCusto, 0).toFixed(2))
  }
};

fs.writeFileSync(path.join(WORKSPACE_DIR, 'resumo_transferencia_locais.json'), JSON.stringify(resumoJSON, null, 2), 'utf8');
console.log('✅ resumo_transferencia_locais.json gravado com sucesso!');

// Executa geração da planilha Excel
generateExcelWorkbook().then(() => {
  console.log('🎉 TODAS AS TRANSFERÊNCIAS POR LOCAL FORAM PROCESSADAS E GERADAS COM SUCESSO!');
}).catch(err => {
  console.error('❌ Erro ao gerar planilha Excel:', err);
});
