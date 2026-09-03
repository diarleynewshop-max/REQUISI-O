const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const candidateFiles = [
  'C:/Users/diarl/Downloads/relatorioSaldoEstoque.csv',
  'C:/Users/diarl/Downloads/Estoque atualizado.csv'
];

let DOWNLOADS_CSV = null;
let newestMtime = 0;
for (const f of candidateFiles) {
  if (fs.existsSync(f)) {
    const stat = fs.statSync(f);
    if (stat.mtimeMs > newestMtime) {
      newestMtime = stat.mtimeMs;
      DOWNLOADS_CSV = f;
    }
  }
}

const WORKSPACE_DIR = __dirname;
const ORIGINAL_CSV = path.join(WORKSPACE_DIR, '0_estoque_original_new.csv');

console.log('🚀 Iniciando processamento do estoque atualizado...');

// 1. Copiar arquivo de Downloads para o Workspace
if (DOWNLOADS_CSV && fs.existsSync(DOWNLOADS_CSV)) {
  fs.copyFileSync(DOWNLOADS_CSV, ORIGINAL_CSV);
  console.log(`✅ Arquivo copiado de "${DOWNLOADS_CSV}" para "${ORIGINAL_CSV}"`);
} else {
  console.error(`❌ Nenhum arquivo de estoque encontrado em Downloads (${candidateFiles.join(', ')})`);
  process.exit(1);
}

// 2. Parser CSV robusto para lidar com aspas, quebras de linha e ponto-e-vírgula
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

// Lê o CSV
console.log('⏳ Lendo conteúdo do arquivo CSV...');
const rawContent = fs.readFileSync(ORIGINAL_CSV, 'utf8');
const allRows = parseCSV(rawContent);
console.log(`📊 Total de linhas lidas (incluindo cabeçalho): ${allRows.length}`);

const header = allRows[0];
console.log('Cabeçalho:', header.join(' | '));

// Mapeamento de colunas
// Quebra 1;Quebra 2;Código;Descrição;EMB;NCM;Estoque;Estoque Mínimo;Estoque Máximo;Custo (R$);Preço (R$);Total Custo (R$);Total Venda (R$)
const productsMap = new Map(); // key: codigo -> product data

let totalRegistros = 0;

for (let i = 1; i < allRows.length; i++) {
  const row = allRows[i];
  if (row.length < 7) continue;

  totalRegistros++;
  const quebra1 = row[0] || '';
  const codigo = (row[2] || '').replace(/"/g, '').trim();
  const descricao = (row[3] || '').replace(/"/g, '').trim();
  const emb = (row[4] || 'UN').replace(/"/g, '').trim();
  const ncm = (row[5] || '').replace(/"/g, '').trim();
  const estoque = parseNumber(row[6]);
  const custoUnit = parseNumber(row[9]);
  const precoUnit = parseNumber(row[10]);

  if (!codigo) continue;

  // Identificar Loja
  let storeId = 1;
  const qLower = quebra1.toLowerCase();
  if (qLower.includes('loja: 2') || qLower.includes('deposito') || qLower.includes('depósito')) {
    storeId = 2;
  } else if (qLower.includes('loja: 3') || qLower.includes('cd')) {
    storeId = 3;
  } else if (qLower.includes('loja: 1') || qLower.includes('loja')) {
    storeId = 1;
  }

  if (!productsMap.has(codigo)) {
    productsMap.set(codigo, {
      codigo,
      descricao,
      emb,
      ncm,
      custoUnit,
      precoUnit,
      saldoLoja1: 0,
      saldoLoja2: 0,
      saldoLoja3: 0,
      hasStore1: false,
      hasStore2: false,
      hasStore3: false
    });
  }

  const prod = productsMap.get(codigo);
  if (descricao && (!prod.descricao || prod.descricao.length < descricao.length)) {
    prod.descricao = descricao;
  }
  if (ncm && !prod.ncm) prod.ncm = ncm;
  if (emb && !prod.emb) prod.emb = emb;
  if (custoUnit > 0) prod.custoUnit = custoUnit;
  if (precoUnit > 0) prod.precoUnit = precoUnit;

  if (storeId === 1) {
    prod.saldoLoja1 += estoque;
    prod.hasStore1 = true;
  } else if (storeId === 2) {
    prod.saldoLoja2 += estoque;
    prod.hasStore2 = true;
  } else if (storeId === 3) {
    prod.saldoLoja3 += estoque;
    prod.hasStore3 = true;
  }
}

console.log(`✅ Produtos únicos consolidados: ${productsMap.size}`);

// Consolidar saldos totais
const products = Array.from(productsMap.values());
products.forEach(p => {
  p.saldoTotal = p.saldoLoja1 + p.saldoLoja2 + p.saldoLoja3;
  p.valorEstoqueTotal = p.saldoTotal * p.custoUnit;
});

// --- CLASSIFICAÇÃO DOS 4 FILTROS ---
const grupo1_positivos = [];
const grupo2_transferencias = [];
const transferenciasRows = [];
const grupo3_criticos = [];
const grupo4_reclassificacao = [];

// Índice de doadores por NCM (somente itens do Grupo 1)
const donorsByNCM = new Map(); // key: NCM -> array of products

for (const p of products) {
  const isAllPositive = p.saldoLoja1 >= 0 && p.saldoLoja2 >= 0 && p.saldoLoja3 >= 0;
  const hasNegative = p.saldoLoja1 < 0 || p.saldoLoja2 < 0 || p.saldoLoja3 < 0;
  const hasPositive = p.saldoLoja1 > 0 || p.saldoLoja2 > 0 || p.saldoLoja3 > 0;

  if (isAllPositive) {
    grupo1_positivos.push(p);
    if (p.ncm && p.saldoTotal > 0) {
      if (!donorsByNCM.has(p.ncm)) donorsByNCM.set(p.ncm, []);
      donorsByNCM.get(p.ncm).push(p);
    }
  } else if (hasNegative && hasPositive) {
    // Filtro 2: Transferências
    grupo2_transferencias.push(p);

    // Calcular transferências necessárias
    // Prioridade de doação: Loja 3 (CD) -> Loja 2 (Depósito) -> Loja 1 (Loja)
    let s1 = p.saldoLoja1;
    let s2 = p.saldoLoja2;
    let s3 = p.saldoLoja3;

    const donorStores = [
      { id: 3, name: 'Loja 3 (CD)', getSaldo: () => s3, setSaldo: (v) => { s3 = v; } },
      { id: 2, name: 'Loja 2 (Depósito)', getSaldo: () => s2, setSaldo: (v) => { s2 = v; } },
      { id: 1, name: 'Loja 1 (Loja)', getSaldo: () => s1, setSaldo: (v) => { s1 = v; } }
    ];

    const recipientStores = [
      { id: 1, name: 'Loja 1 (Loja)', getSaldo: () => s1, setSaldo: (v) => { s1 = v; } },
      { id: 2, name: 'Loja 2 (Depósito)', getSaldo: () => s2, setSaldo: (v) => { s2 = v; } },
      { id: 3, name: 'Loja 3 (CD)', getSaldo: () => s3, setSaldo: (v) => { s3 = v; } }
    ];

    for (const rec of recipientStores) {
      if (rec.getSaldo() < 0) {
        let deficit = Math.abs(rec.getSaldo());

        for (const don of donorStores) {
          if (don.id !== rec.id && don.getSaldo() > 0 && deficit > 0) {
            const transferQty = Math.min(don.getSaldo(), deficit);
            const origAntes = don.getSaldo();
            const destAntes = rec.getSaldo();

            don.setSaldo(don.getSaldo() - transferQty);
            rec.setSaldo(rec.getSaldo() + transferQty);
            deficit -= transferQty;

            const origDepois = don.getSaldo();
            const destDepois = rec.getSaldo();

            transferenciasRows.push({
              codigo: p.codigo,
              descricao: p.descricao,
              ncm: p.ncm,
              origem: don.name,
              destino: rec.name,
              qtd: transferQty,
              custoUnit: p.custoUnit,
              valorTotal: transferQty * p.custoUnit,
              saldoOrigemAntes: origAntes,
              saldoOrigemDepois: origDepois,
              saldoDestinoAntes: destAntes,
              saldoDestinoDepois: destDepois
            });
          }
        }
      }
    }
  }
}

// Filtro 3 e 4: Itens que não têm saldo positivo suficiente na rede (saldo negativo total ou puramente negativos)
const negativeProducts = products.filter(p => {
  const isAllNonPositive = p.saldoLoja1 <= 0 && p.saldoLoja2 <= 0 && p.saldoLoja3 <= 0 && (p.saldoLoja1 < 0 || p.saldoLoja2 < 0 || p.saldoLoja3 < 0);
  return isAllNonPositive;
});

// Ordenar doadores de cada NCM por saldo desc
for (const [ncm, list] of donorsByNCM.entries()) {
  list.sort((a, b) => b.saldoTotal - a.saldoTotal);
}

for (const p of negativeProducts) {
  const deficit = Math.abs(p.saldoTotal);
  const potentialDonors = donorsByNCM.get(p.ncm) || [];

  if (potentialDonors.length > 0) {
    // Filtro 4: Reclassificação NCM
    const totalDisponivelNcm = potentialDonors.reduce((acc, d) => acc + d.saldoTotal, 0);
    const status = totalDisponivelNcm >= deficit ? 'COBERTURA_TOTAL' : 'COBERTURA_PARCIAL';

    const d1 = potentialDonors[0] || null;
    const d2 = potentialDonors[1] || null;
    const d3 = potentialDonors[2] || null;

    grupo4_reclassificacao.push({
      codigo: p.codigo,
      descricao: p.descricao,
      emb: p.emb,
      ncm: p.ncm,
      saldoLoja1: p.saldoLoja1,
      saldoLoja2: p.saldoLoja2,
      saldoLoja3: p.saldoLoja3,
      saldoTotal: p.saldoTotal,
      deficit: deficit,
      status: status,
      saldoDisponivelNcm: totalDisponivelNcm,
      doador1: d1 ? {
        codigo: d1.codigo,
        descricao: d1.descricao,
        saldo: d1.saldoTotal,
        saldoLoja1: d1.saldoLoja1,
        saldoLoja2: d1.saldoLoja2,
        saldoLoja3: d1.saldoLoja3
      } : { codigo: '', descricao: '', saldo: 0, saldoLoja1: 0, saldoLoja2: 0, saldoLoja3: 0 },
      doador2: d2 ? {
        codigo: d2.codigo,
        descricao: d2.descricao,
        saldo: d2.saldoTotal,
        saldoLoja1: d2.saldoLoja1,
        saldoLoja2: d2.saldoLoja2,
        saldoLoja3: d2.saldoLoja3
      } : { codigo: '', descricao: '', saldo: 0, saldoLoja1: 0, saldoLoja2: 0, saldoLoja3: 0 },
      doador3: d3 ? {
        codigo: d3.codigo,
        descricao: d3.descricao,
        saldo: d3.saldoTotal,
        saldoLoja1: d3.saldoLoja1,
        saldoLoja2: d3.saldoLoja2,
        saldoLoja3: d3.saldoLoja3
      } : { codigo: '', descricao: '', saldo: 0, saldoLoja1: 0, saldoLoja2: 0, saldoLoja3: 0 },
      custoUnit: p.custoUnit,
      precoUnit: p.precoUnit,
      valorDeficit: deficit * p.custoUnit
    });
  } else {
    // Filtro 3: Compra Crítica (Sem Doador no Grupo 1)
    grupo3_criticos.push({
      codigo: p.codigo,
      descricao: p.descricao,
      emb: p.emb,
      ncm: p.ncm,
      saldoLoja1: p.saldoLoja1,
      saldoLoja2: p.saldoLoja2,
      saldoLoja3: p.saldoLoja3,
      deficitPecas: deficit,
      custoUnit: p.custoUnit,
      precoUnit: p.precoUnit,
      valorTotal: deficit * p.custoUnit,
      motivo: 'Sem doador de mesmo NCM com saldo no Grupo 1'
    });
  }
}

console.log('📈 Estatísticas de Classificação:');
console.log(` - Filtro 1 (Saldos 100% Positivos): ${grupo1_positivos.length} itens`);
console.log(` - Filtro 2 (Transferências Mistas): ${grupo2_transferencias.length} itens (${transferenciasRows.length} transferências)`);
console.log(` - Filtro 3 (Compras Críticas sem Doador): ${grupo3_criticos.length} itens`);
console.log(` - Filtro 4 (Reclassificação NCM com Doador): ${grupo4_reclassificacao.length} itens`);

// 3. Gerar resumo_auditoria.json
const totalPecasG1 = grupo1_positivos.reduce((acc, p) => acc + p.saldoTotal, 0);
const totalValorG1 = grupo1_positivos.reduce((acc, p) => acc + p.valorEstoqueTotal, 0);

const pecasTransf = transferenciasRows.reduce((acc, t) => acc + t.qtd, 0);
const valorTransf = transferenciasRows.reduce((acc, t) => acc + t.valorTotal, 0);

const pecasFaltG3 = grupo3_criticos.reduce((acc, c) => acc + c.deficitPecas, 0);
const valorFaltG3 = grupo3_criticos.reduce((acc, c) => acc + c.valorTotal, 0);

const pecasFaltG4 = grupo4_reclassificacao.reduce((acc, r) => acc + r.deficit, 0);
const valorFaltG4 = grupo4_reclassificacao.reduce((acc, r) => acc + r.valorDeficit, 0);

const totalNegativos = negativeProducts.length;
const taxaCobertura = totalNegativos > 0 ? ((grupo4_reclassificacao.length / totalNegativos) * 100).toFixed(1) + '%' : '100%';

const resumoAuditoria = {
  dataProcessamento: new Date().toISOString(),
  totalProdutosUnicos: products.length,
  totalRegistrosCSV: totalRegistros,
  metricas: {
    grupo1: {
      qtdItens: grupo1_positivos.length,
      pecasTotais: Math.round(totalPecasG1),
      valorCustoTotal: parseFloat(totalValorG1.toFixed(2))
    },
    grupo2: {
      qtdItens: grupo2_transferencias.length,
      qtdTransferenciasSugeridas: transferenciasRows.length,
      pecasTransferidas: Math.round(pecasTransf),
      valorTransferido: parseFloat(valorTransf.toFixed(2))
    },
    grupo3: {
      qtdItens: grupo3_criticos.length,
      pecasFaltantes: Math.round(pecasFaltG3),
      valorCustoFaltante: parseFloat(valorFaltG3.toFixed(2))
    },
    grupo4_reclassificacao: {
      qtdItens: grupo4_reclassificacao.length,
      pecasFaltantes: Math.round(pecasFaltG4),
      valorCustoFaltante: parseFloat(valorFaltG4.toFixed(2)),
      taxaCoberturaRede: taxaCobertura
    }
  }
};

fs.writeFileSync(path.join(WORKSPACE_DIR, 'resumo_auditoria.json'), JSON.stringify(resumoAuditoria, null, 2), 'utf8');
console.log('✅ resumo_auditoria.json gerado com sucesso!');

// 4. Escrever 1_saldo_positivo_puro.csv
const outG1 = [
  'Codigo;Descricao;EMB;NCM;Saldo_Loja_1;Saldo_Loja_2_Deposito;Saldo_Loja_3_CD;Saldo_Total;Custo_Unit;Preco_Unit;Valor_Estoque_Total',
  ...grupo1_positivos.map(p =>
    `"${p.codigo}";"${p.descricao.replace(/"/g, '""')}";"${p.emb}";"${p.ncm}";${formatNumberBR(p.saldoLoja1)};${formatNumberBR(p.saldoLoja2)};${formatNumberBR(p.saldoLoja3)};${formatNumberBR(p.saldoTotal)};${formatNumberBR(p.custoUnit)};${formatNumberBR(p.precoUnit)};${formatNumberBR(p.valorEstoqueTotal)}`
  )
].join('\r\n');
fs.writeFileSync(path.join(WORKSPACE_DIR, '1_saldo_positivo_puro.csv'), outG1, 'utf8');
console.log('✅ 1_saldo_positivo_puro.csv gravado com sucesso!');

// 5. Escrever 2_plano_transferencias_entre_lojas.csv
const outG2 = [
  'Codigo;Descricao;NCM;Loja_Origem;Loja_Destino;Qtd_Transferir;Custo_Unit;Valor_Transferencia;Saldo_Origem_Antes;Saldo_Origem_Depois;Saldo_Destino_Antes;Saldo_Destino_Depois',
  ...transferenciasRows.map(t =>
    `"${t.codigo}";"${t.descricao.replace(/"/g, '""')}";"${t.ncm}";"${t.origem}";"${t.destino}";${formatNumberBR(t.qtd)};${formatNumberBR(t.custoUnit)};${formatNumberBR(t.valorTotal)};${formatNumberBR(t.saldoOrigemAntes)};${formatNumberBR(t.saldoOrigemDepois)};${formatNumberBR(t.saldoDestinoAntes)};${formatNumberBR(t.saldoDestinoDepois)}`
  )
].join('\r\n');
fs.writeFileSync(path.join(WORKSPACE_DIR, '2_plano_transferencias_entre_lojas.csv'), outG2, 'utf8');
console.log('✅ 2_plano_transferencias_entre_lojas.csv gravado com sucesso!');

// 6. Escrever 3_itens_criticos_compra_reclassificacao.csv e alias
const outG3 = [
  'Codigo;Descricao;EMB;NCM;Saldo_Loja_1;Saldo_Loja_2_Deposito;Saldo_Loja_3_CD;Deficit_Total_Pecas;Custo_Unit;Preco_Unit;Valor_Total_Deficit;Motivo',
  ...grupo3_criticos.map(c =>
    `"${c.codigo}";"${c.descricao.replace(/"/g, '""')}";"${c.emb}";"${c.ncm}";${formatNumberBR(c.saldoLoja1)};${formatNumberBR(c.saldoLoja2)};${formatNumberBR(c.saldoLoja3)};${formatNumberBR(c.deficitPecas)};${formatNumberBR(c.custoUnit)};${formatNumberBR(c.precoUnit)};${formatNumberBR(c.valorTotal)};"${c.motivo}"`
  )
].join('\r\n');
fs.writeFileSync(path.join(WORKSPACE_DIR, '3_itens_criticos_compra_reclassificacao.csv'), outG3, 'utf8');
fs.writeFileSync(path.join(WORKSPACE_DIR, '3_itens_nao_reclassificaveis_compra.csv'), outG3, 'utf8');
console.log('✅ 3_itens_criticos_compra_reclassificacao.csv gravado com sucesso!');

// 7. Escrever 4_matriz_reclassificacao_ncm.csv
const outG4 = [
  'Codigo_Item_Negativo;Descricao_Item_Negativo;NCM;Saldo_Loja1;Saldo_Loja2_Deposito;Saldo_Loja3_CD;Deficit_Pecas;Status_Cobertura;Saldo_Total_Disponivel_NCM;Doador1_Codigo;Doador1_Descricao;Doador1_Saldo_Total;Doador1_Loja1;Doador1_Loja2;Doador1_Loja3;Doador2_Codigo;Doador2_Descricao;Doador2_Saldo_Total;Doador2_Loja1;Doador2_Loja2;Doador2_Loja3;Doador3_Codigo;Doador3_Descricao;Doador3_Saldo_Total;Doador3_Loja1;Doador3_Loja2;Doador3_Loja3',
  ...grupo4_reclassificacao.map(r =>
    `"${r.codigo}";"${r.descricao.replace(/"/g, '""')}";"${r.ncm}";${formatNumberBR(r.saldoLoja1)};${formatNumberBR(r.saldoLoja2)};${formatNumberBR(r.saldoLoja3)};${formatNumberBR(r.deficit)};"${r.status}";${formatNumberBR(r.saldoDisponivelNcm)};"${r.doador1.codigo}";"${r.doador1.descricao.replace(/"/g, '""')}";${formatNumberBR(r.doador1.saldo)};${formatNumberBR(r.doador1.saldoLoja1)};${formatNumberBR(r.doador1.saldoLoja2)};${formatNumberBR(r.doador1.saldoLoja3)};"${r.doador2.codigo}";"${r.doador2.descricao.replace(/"/g, '""')}";${formatNumberBR(r.doador2.saldo)};${formatNumberBR(r.doador2.saldoLoja1)};${formatNumberBR(r.doador2.saldoLoja2)};${formatNumberBR(r.doador2.saldoLoja3)};"${r.doador3.codigo}";"${r.doador3.descricao.replace(/"/g, '""')}";${formatNumberBR(r.doador3.saldo)};${formatNumberBR(r.doador3.saldoLoja1)};${formatNumberBR(r.doador3.saldoLoja2)};${formatNumberBR(r.doador3.saldoLoja3)}`
  )
].join('\r\n');
fs.writeFileSync(path.join(WORKSPACE_DIR, '4_matriz_reclassificacao_ncm.csv'), outG4, 'utf8');
console.log('✅ 4_matriz_reclassificacao_ncm.csv gravado com sucesso (com separação de estoque por loja)!');

// 8. Gerar arquivos de automação de transferências específicas (Loja 1 <-> Loja 3 CD)
const l1_to_l3 = [];
const l3_to_l1 = [];

for (const t of transferenciasRows) {
  const qtdFormatted = Number.isInteger(t.qtd) ? String(t.qtd) : String(t.qtd).replace('.', ',');
  if (t.origem.includes('Loja 1') && t.destino.includes('Loja 3')) {
    l1_to_l3.push({ codigo: t.codigo, descricao: t.descricao, qtd: qtdFormatted });
  }
  if (t.origem.includes('Loja 3') && t.destino.includes('Loja 1')) {
    l3_to_l1.push({ codigo: t.codigo, descricao: t.descricao, qtd: qtdFormatted });
  }
}

const outL1_L3 = ['Codigo;qtd', ...l1_to_l3.map(i => `${i.codigo};${i.qtd}`)].join('\r\n');
fs.writeFileSync(path.join(WORKSPACE_DIR, 'transferencia_Loja1_para_Loja3.csv'), outL1_L3, 'utf8');
fs.writeFileSync(path.join(WORKSPACE_DIR, 'transferencia_Loja1_para_Loja3.txt'), outL1_L3, 'utf8');

const outL3_L1 = ['Codigo;qtd', ...l3_to_l1.map(i => `${i.codigo};${i.qtd}`)].join('\r\n');
fs.writeFileSync(path.join(WORKSPACE_DIR, 'transferencia_Loja3_CD_para_Loja1.csv'), outL3_L1, 'utf8');
fs.writeFileSync(path.join(WORKSPACE_DIR, 'transferencia_Loja3_CD_para_Loja1.txt'), outL3_L1, 'utf8');

console.log(`✅ Arquivos de automação de transferências Loja 1 <-> Loja 3 atualizados (L1->L3: ${l1_to_l3.length} itens, L3->L1: ${l3_to_l1.length} itens)!`);

// 9. Gerar Planos de Compra (Filtro 3 e Pendentes)
async function generatePurchaseFiles() {
  console.log('⏳ Gerando arquivos de compras (CSV, TXT, Excel)...');

  // A. plano_compra_filtro3
  const p3Rows = grupo3_criticos.map(item => {
    const valVenda10 = item.precoUnit > 0 ? (item.precoUnit * 0.1) : (item.custoUnit > 0 ? item.custoUnit * 0.1 : 0.1);
    const qtdCompra = Math.max(5, Math.ceil(item.deficitPecas / 5) * 5);
    return {
      codigo: item.codigo,
      descricao: item.descricao,
      val10: parseFloat(valVenda10.toFixed(2)),
      ncm: item.ncm,
      emb: item.emb || 'UN',
      quantidade: qtdCompra
    };
  });

  const outP3_csv = [
    'Codigo;Descrição;10% do valor de venda;NCM;Unidade de medida {UN};Quantidade',
    ...p3Rows.map(r => `"${r.codigo}";"${r.descricao.replace(/"/g, '""')}";${formatNumberBR(r.val10)};"${r.ncm}";"${r.emb}";${r.quantidade}`)
  ].join('\r\n');
  fs.writeFileSync(path.join(WORKSPACE_DIR, 'plano_compra_filtro3.csv'), outP3_csv, 'utf8');

  // Excel plano_compra_filtro3.xlsx
  const wb3 = new ExcelJS.Workbook();
  const ws3 = wb3.addWorksheet('Plano de Compras');
  ws3.columns = [
    { header: 'Codigo', key: 'codigo', width: 12 },
    { header: 'Descrição', key: 'descricao', width: 45 },
    { header: '10% do valor de venda', key: 'val10', width: 22 },
    { header: 'NCM', key: 'ncm', width: 14 },
    { header: 'Unidade de medida {UN}', key: 'emb', width: 22 },
    { header: 'Quantidade', key: 'quantidade', width: 14 }
  ];
  p3Rows.forEach(r => ws3.addRow(r));
  await wb3.xlsx.writeFile(path.join(WORKSPACE_DIR, 'plano_compra_filtro3.xlsx'));

  // B. plano_compra_pendentes (Itens parciais do Filtro 4 + Filtro 3)
  const itensPendentesCompra = [
    ...grupo4_reclassificacao.filter(r => r.status === 'COBERTURA_PARCIAL').map(item => {
      const saldoFaltante = item.deficit - item.saldoDisponivelNcm;
      const valVenda10 = item.precoUnit > 0 ? (item.precoUnit * 0.1) : (item.custoUnit > 0 ? item.custoUnit * 0.1 : 0.1);
      const qtdCompra = Math.max(5, Math.ceil(saldoFaltante / 5) * 5);
      return {
        codigo: item.codigo,
        descricao: item.descricao,
        val10Formatted: `R$ ${formatNumberBR(valVenda10)}`,
        val10Num: parseFloat(valVenda10.toFixed(2)),
        ncm: item.ncm,
        emb: 'UN',
        quantidade: qtdCompra
      };
    }),
    ...p3Rows.map(r => ({
      codigo: r.codigo,
      descricao: r.descricao,
      val10Formatted: `R$ ${formatNumberBR(r.val10)}`,
      val10Num: r.val10,
      ncm: r.ncm,
      emb: r.emb,
      quantidade: r.quantidade
    }))
  ];

  const outPend_txt = [
    'Codigo\tDescrição\t10% do valor de venda\tNCM\tUnidade de medida {UN}\tQuantidade',
    ...itensPendentesCompra.map(r => `${r.codigo}\t${r.descricao}\t${r.val10Formatted}\t${r.ncm}\t${r.emb}\t${r.quantidade}`)
  ].join('\r\n');
  fs.writeFileSync(path.join(WORKSPACE_DIR, 'plano_compra_pendentes.txt'), outPend_txt, 'utf8');

  // Excel plano_compra_pendentes.xlsx
  const wbPend = new ExcelJS.Workbook();
  const wsPend = wbPend.addWorksheet('Pendentes de Compra');
  wsPend.columns = [
    { header: 'Codigo', key: 'codigo', width: 12 },
    { header: 'Descrição', key: 'descricao', width: 45 },
    { header: '10% do valor de venda', key: 'val10Num', width: 22 },
    { header: 'NCM', key: 'ncm', width: 14 },
    { header: 'Unidade de medida {UN}', key: 'emb', width: 22 },
    { header: 'Quantidade', key: 'quantidade', width: 14 }
  ];
  itensPendentesCompra.forEach(r => wsPend.addRow({
    codigo: r.codigo,
    descricao: r.descricao,
    val10Num: r.val10Num,
    ncm: r.ncm,
    emb: r.emb,
    quantidade: r.quantidade
  }));
  await wbPend.xlsx.writeFile(path.join(WORKSPACE_DIR, 'plano_compra_pendentes.xlsx'));

  // C. plano_compra_geral_64.xlsx (geral consolidado)
  const wbGeral = new ExcelJS.Workbook();
  const wsGeral = wbGeral.addWorksheet('Plano Compra Geral');
  wsGeral.columns = [
    { header: 'Codigo', key: 'codigo', width: 12 },
    { header: 'Descrição', key: 'descricao', width: 45 },
    { header: '10% do valor de venda', key: 'val10Num', width: 22 },
    { header: 'NCM', key: 'ncm', width: 14 },
    { header: 'Unidade de medida {UN}', key: 'emb', width: 22 },
    { header: 'Quantidade', key: 'quantidade', width: 14 }
  ];
  itensPendentesCompra.forEach(r => wsGeral.addRow({
    codigo: r.codigo,
    descricao: r.descricao,
    val10Num: r.val10Num,
    ncm: r.ncm,
    emb: r.emb,
    quantidade: r.quantidade
  }));
  await wbGeral.xlsx.writeFile(path.join(WORKSPACE_DIR, 'plano_compra_geral_64.xlsx'));

  console.log('✅ Planilhas Excel e arquivos de compras gerados com sucesso!');
}

generatePurchaseFiles().then(() => {
  console.log('🎉 PROCESSAMENTO COMPLETO CONCLUÍDO COM SUCESSO!');
}).catch(err => {
  console.error('❌ Erro ao gerar compras:', err);
});
