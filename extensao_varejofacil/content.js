// Content Script - Roda em TODOS os frames do VarejoFácil (incluindo legadoFrame)
// O frame que tem os campos reais é o que contém #codigoDoProduto

let isRunning = false;
let isPaused = false;
let isThisTheRightFrame = false;

// Verifica se este é o frame correto (o que contém o formulário do item)
function checkIfThisIsTheFormFrame() {
  return Boolean(
    document.getElementById('codigoDoProduto') ||
    document.getElementById('adicionaItemNaGrid') ||
    document.getElementById('adicionaProduto')
  );
}

// Notifica o popup que este frame tem os campos
if (checkIfThisIsTheFormFrame()) {
  isThisTheRightFrame = true;
  console.log('⚡ [Auto Lançador NF] Frame com formulário detectado:', window.location.href);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Ping para verificar se este frame tem os campos do formulário
  if (request.action === 'PING_FRAME') {
    const hasForm = checkIfThisIsTheFormFrame();
    sendResponse({ hasForm, url: window.location.href, frameId: sender.frameId });
    return true;
  }

  // Se este frame não tem os campos, ignora os comandos
  if (!checkIfThisIsTheFormFrame()) {
    return false;
  }

  if (request.action === 'START_AUTOLOAD') {
    console.log('⚡ [Auto Lançador NF] Iniciando lançamento de', request.items.length, 'itens...');
    startAutoLoad(request.items, request.delay || 1400);
    sendResponse({ started: true, frameUrl: window.location.href });
    return true;
  }

  if (request.action === 'PAUSE_AUTOLOAD') {
    isPaused = !isPaused;
    sendResponse({ isPaused });
    return true;
  }

  if (request.action === 'STOP_AUTOLOAD') {
    isRunning = false;
    isPaused = false;
    sendResponse({ stopped: true });
    return true;
  }
});

async function startAutoLoad(items, delay) {
  isRunning = true;
  isPaused = false;

  // Garante que a aba de Itens está ativa (se existir no frame principal)
  const abaItens = document.querySelector('#abaDeItens, [data-cy="aba-itens"]');
  if (abaItens) {
    abaItens.click();
    await sleep(600);
  }

  for (let i = 0; i < items.length; i++) {
    if (!isRunning) break;

    while (isPaused) {
      await sleep(300);
      if (!isRunning) break;
    }

    const { codigo, qtd, valor } = items[i];

    // Envia progresso para o popup
    chrome.runtime.sendMessage({
      action: 'UPDATE_PROGRESS',
      current: i + 1,
      total: items.length,
      codigo,
      qtd,
      valor
    }).catch(() => {});

    // 1. Se o modal de item estiver fechado, clica em "Adicionar" para abri-lo
    let campoCod = document.getElementById('codigoDoProduto');
    if (!campoCod || !isVisible(campoCod)) {
      const btnAdd = document.getElementById('adicionaProduto');
      if (btnAdd) {
        btnAdd.click();
        await sleep(600);
        campoCod = document.getElementById('codigoDoProduto');
      }
    }

    // 2. Verifica se o campo de código está disponível
    if (!campoCod || !isVisible(campoCod)) {
      console.warn('[Auto Lançador] Campo #codigoDoProduto não visível. Pulando item:', codigo);
      chrome.runtime.sendMessage({ action: 'LOG_WARNING', msg: `Campo não encontrado para cód ${codigo}` }).catch(() => {});
      continue;
    }

    // 3. Digita o Código do Produto
    campoCod.focus();
    await sleep(100);
    campoCod.value = '';
    campoCod.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(50);
    campoCod.value = codigo;
    campoCod.dispatchEvent(new Event('input', { bubbles: true }));
    campoCod.dispatchEvent(new Event('change', { bubbles: true }));
    // Simula Tab para disparar o lookup do VarejoFácil
    campoCod.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, bubbles: true }));
    campoCod.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', code: 'Tab', keyCode: 9, bubbles: true }));

    // Aguarda o VarejoFácil buscar os dados do produto via AJAX
    await sleep(delay);

    if (!isRunning) break;

    // 4. Digita a Quantidade
    const campoQtd = document.getElementById('quantidade');
    if (campoQtd && isVisible(campoQtd)) {
      campoQtd.focus();
      await sleep(100);
      campoQtd.value = '';
      campoQtd.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(50);
      campoQtd.value = qtd;
      campoQtd.dispatchEvent(new Event('input', { bubbles: true }));
      campoQtd.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(250);
    }

    // 5. Preenche Valor (custo unitário por embalagem) se informado no CSV
    if (valor) {
      const campoValor = document.getElementById('valorDaEmbalagem');
      if (campoValor && isVisible(campoValor)) {
        campoValor.focus();
        await sleep(80);
        campoValor.value = '';
        campoValor.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(40);
        campoValor.value = valor;
        ['input', 'change', 'blur'].forEach(ev => campoValor.dispatchEvent(new Event(ev, { bubbles: true })));
        await sleep(200);
      }
    }

    // 6. Clica em "Adicionar" (#adicionaItemNaGrid)
    const btnGrid = document.getElementById('adicionaItemNaGrid');
    if (btnGrid && isVisible(btnGrid)) {
      btnGrid.click();
      await sleep(delay);
    }

    // 7. Fecha qualquer Modal/Alert de confirmação que apareça (ex: aviso fiscal)
    const modalOk = document.querySelector('.modal-footer .btn-principal, .modal-footer .btn-success, .modal-footer button');
    if (modalOk && isVisible(modalOk)) {
      modalOk.click();
      await sleep(400);
    }
  }

  if (isRunning) {
    chrome.runtime.sendMessage({ action: 'COMPLETE_AUTOLOAD', total: items.length }).catch(() => {});
    isRunning = false;
    console.log('✅ [Auto Lançador NF] Lançamento concluído com sucesso!');
  }
}

function isVisible(el) {
  return el && el.offsetParent !== null && !el.disabled;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
