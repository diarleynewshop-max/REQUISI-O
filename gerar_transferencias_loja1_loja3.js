const fs = require('fs');
const path = require('path');

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

const csvPath = path.join(__dirname, '2_plano_transferencias_entre_lojas.csv');
const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean);

const l1_to_l3 = [];
const l3_to_l1 = [];

for (let i = 1; i < lines.length; i++) {
  const parts = parseCSVLine(lines[i]);
  if (parts.length >= 6) {
    const codigo = parts[0].replace(/"/g, '').trim();
    const descricao = parts[1].replace(/"/g, '').trim();
    const origem = parts[3].replace(/"/g, '').trim();
    const destino = parts[4].replace(/"/g, '').trim();
    const qtdRaw = parts[5].replace(/"/g, '').trim();

    let clean = qtdRaw.replace(/\./g, '').replace(',', '.');
    let num = parseFloat(clean);
    if (isNaN(num)) continue;

    // Standard format (e.g. 10 or 10.5)
    const qtdFormatted = Number.isInteger(num) ? String(num) : String(num).replace('.', ',');

    if (origem.includes('Loja 1') && destino.includes('Loja 3')) {
      l1_to_l3.push({ codigo, descricao, qtd: qtdFormatted, num });
    }
    if (origem.includes('Loja 3') && destino.includes('Loja 1')) {
      l3_to_l1.push({ codigo, descricao, qtd: qtdFormatted, num });
    }
  }
}

// 1. Arquivo Loja 1 -> Loja 3 (CSV & TXT)
const out1_csv = ['Codigo;qtd', ...l1_to_l3.map(item => `${item.codigo};${item.qtd}`)].join('\r\n');
const out1_csv_path = path.join(__dirname, 'transferencia_Loja1_para_Loja3.csv');
const out1_txt_path = path.join(__dirname, 'transferencia_Loja1_para_Loja3.txt');
fs.writeFileSync(out1_csv_path, out1_csv, 'utf8');
fs.writeFileSync(out1_txt_path, out1_csv, 'utf8');

// 2. Arquivo Loja 3 -> Loja 1 (CSV & TXT) - Caso seja CD para Loja
const out2_csv = ['Codigo;qtd', ...l3_to_l1.map(item => `${item.codigo};${item.qtd}`)].join('\r\n');
const out2_csv_path = path.join(__dirname, 'transferencia_Loja3_CD_para_Loja1.csv');
const out2_txt_path = path.join(__dirname, 'transferencia_Loja3_CD_para_Loja1.txt');
fs.writeFileSync(out2_csv_path, out2_csv, 'utf8');
fs.writeFileSync(out2_txt_path, out2_csv, 'utf8');

console.log('=== GERAÇÃO CONCLUÍDA ===');
console.log(`1. Loja 1 (Loja) -> Loja 3 (CD): ${l1_to_l3.length} itens gerados em:`);
console.log(`   - ${out1_csv_path}`);
console.log(`   - ${out1_txt_path}`);
console.log(`2. Loja 3 (CD) -> Loja 1 (Loja): ${l3_to_l1.length} itens gerados em:`);
console.log(`   - ${out2_csv_path}`);
console.log(`   - ${out2_txt_path}`);
