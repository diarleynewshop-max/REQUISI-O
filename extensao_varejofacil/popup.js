// Toca um som de sucesso (3 notas) usando Web Audio API — sem arquivo externo
function playSuccessSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99]; // Dó - Mi - Sol (C5, E5, G5)
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      const start = ctx.currentTime + i * 0.18;
      const end = start + 0.35;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.4, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, end);
      osc.start(start);
      osc.stop(end);
    });
  } catch (e) {
    console.warn('Som de notificação não disponível:', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('ext-file');
  const dataInput = document.getElementById('ext-data');
  const btnStart = document.getElementById('ext-btn-start');
  const btnPause = document.getElementById('ext-btn-pause');
  const btnStop = document.getElementById('ext-btn-stop');
  const speedSelect = document.getElementById('ext-speed');

  const progContainer = document.getElementById('prog-container');
  const progText = document.getElementById('ext-prog-text');
  const progPct = document.getElementById('ext-prog-pct');
  const progFill = document.getElementById('ext-prog-fill');
  const statusDiv = document.getElementById('ext-status');

  // Carregamento de arquivo
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      dataInput.value = evt.target.result.trim();
      const count = evt.target.result.split('\n').filter(l => l.includes(';')).length - 1;
      statusDiv.innerText = `✓ ${count} itens carregados do arquivo!`;
    };
    reader.readAsText(file);
  });

  // Mensagens do content script
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'UPDATE_PROGRESS') {
      progContainer.style.display = 'block';
      const pct = Math.round((msg.current / msg.total) * 100);
      progText.innerText = `${msg.current} / ${msg.total}`;
      progPct.innerText = `${pct}%`;
      progFill.style.width = `${pct}%`;
      statusDiv.innerHTML = `Lançando: Cód <strong>${msg.codigo}</strong> (${msg.qtd} un${msg.valor ? ' · R$ ' + msg.valor : ''})...`;
    } else if (msg.action === 'COMPLETE_AUTOLOAD') {
      statusDiv.innerHTML = `🎉 <strong style="color:#10b981;">Concluído! ${msg.total} itens lançados.</strong>`;
      progFill.style.width = '100%';
      progPct.innerText = '100%';
      btnStart.disabled = false;
      btnPause.disabled = true;
      btnStop.disabled = true;
      btnPause.innerText = '⏸️ Pausar';
      playSuccessSound();
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.png',
        title: '✅ Auto Lançador NF - Concluído!',
        message: `Todos os ${msg.total} produtos foram lançados na nota fiscal com sucesso! 🎉`,
        priority: 2
      }).catch(() => {});
    } else if (msg.action === 'LOG_WARNING') {
      statusDiv.innerText = `⚠️ ${msg.msg}`;
    }
  });

  // Botão Iniciar
  btnStart.addEventListener('click', async () => {
    const raw = dataInput.value.trim();
    if (!raw) {
      alert('Carregue um arquivo ou cole a lista de produtos!');
      return;
    }

    const lines = raw.split(/\r?\n/).filter(l => l.includes(';') && !l.toLowerCase().startsWith('codigo'));
    if (lines.length === 0) {
      alert('Nenhum item válido no formato Codigo;QTD ou Codigo;QTD;Valor encontrado.');
      return;
    }

    // Suporta Codigo;QTD e Codigo;QTD;Valor
    const items = lines.map(l => {
      const parts = l.split(';');
      return {
        codigo: parts[0].trim(),
        qtd: (parts[1] || '1').trim(),
        valor: (parts[2] || '').trim()
      };
    });

    const delay = parseInt(speedSelect.value, 10) || 1400;

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      alert('Nenhuma aba ativa encontrada. Abra o VarejoFácil primeiro!');
      return;
    }

    const tab = tabs[0];
    if (!tab.url || !tab.url.includes('varejofacil')) {
      alert('A aba ativa não é o VarejoFácil. Abra a nota fiscal no VarejoFácil e tente novamente!');
      return;
    }

    btnStart.disabled = true;
    btnPause.disabled = false;
    btnStop.disabled = false;
    progContainer.style.display = 'block';
    statusDiv.innerText = '⏳ Conectando ao formulário da nota...';

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => ({
          hasForm: Boolean(
            document.getElementById('codigoDoProduto') ||
            document.getElementById('adicionaItemNaGrid') ||
            document.getElementById('adicionaProduto')
          ),
          url: window.location.href,
          frameId: window.frameElement ? (window.frameElement.id || 'iframe') : 'top'
        })
      });

      const formFrame = results.find(r => r.result && r.result.hasForm);

      if (!formFrame) {
        statusDiv.innerHTML = '⚠️ <span style="color:#ef4444;">Formulário de Item não encontrado!<br>Abra o modal de adicionar produto na nota e tente novamente.</span>';
        btnStart.disabled = false;
        btnPause.disabled = true;
        btnStop.disabled = true;
        return;
      }

      statusDiv.innerText = `✓ Formulário detectado! Iniciando lançamento de ${items.length} itens...`;

      await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [formFrame.frameId || 0], allFrames: formFrame.frameId === undefined },
        func: (items, delay) => {
          window._vfAutoItems = items;
          window._vfAutoDelay = delay;
          window._vfAutoRunning = true;
          window._vfAutoPaused = false;

          async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
          function isVisible(el) { return el && el.offsetParent !== null && !el.disabled; }

          async function run() {
            for (let i = 0; i < items.length; i++) {
              if (!window._vfAutoRunning) break;
              while (window._vfAutoPaused) {
                await sleep(300);
                if (!window._vfAutoRunning) break;
              }

              const { codigo, qtd, valor } = items[i];

              // Abre modal se necessário
              let campoCod = document.getElementById('codigoDoProduto');
              if (!campoCod || !isVisible(campoCod)) {
                const btnAdd = document.getElementById('adicionaProduto');
                if (btnAdd) { btnAdd.click(); await sleep(700); }
                campoCod = document.getElementById('codigoDoProduto');
              }
              if (!campoCod || !isVisible(campoCod)) { continue; }

              // 1. Código
              campoCod.focus();
              await sleep(80);
              campoCod.value = codigo;
              ['input', 'change'].forEach(e => campoCod.dispatchEvent(new Event(e, { bubbles: true })));
              campoCod.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, bubbles: true }));
              campoCod.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', code: 'Tab', keyCode: 9, bubbles: true }));

              await sleep(delay);

              // 2. Quantidade
              const campoQtd = document.getElementById('quantidade');
              if (campoQtd && isVisible(campoQtd)) {
                campoQtd.focus();
                await sleep(80);
                campoQtd.value = qtd;
                ['input', 'change'].forEach(e => campoQtd.dispatchEvent(new Event(e, { bubbles: true })));
                await sleep(200);
              }

              // 3. Valor (custo unitário) — campo #valorDaEmbalagem
              if (valor) {
                const campoValor = document.getElementById('valorDaEmbalagem');
                if (campoValor && isVisible(campoValor)) {
                  campoValor.focus();
                  await sleep(80);
                  campoValor.value = '';
                  campoValor.dispatchEvent(new Event('input', { bubbles: true }));
                  await sleep(40);
                  campoValor.value = valor;
                  ['input', 'change', 'blur'].forEach(e => campoValor.dispatchEvent(new Event(e, { bubbles: true })));
                  await sleep(200);
                }
              }

              // 4. Adicionar à grid
              const btnGrid = document.getElementById('adicionaItemNaGrid');
              if (btnGrid && isVisible(btnGrid)) {
                btnGrid.click();
                await sleep(delay);
              }

              // 5. Confirmar modal de aviso fiscal se aparecer
              const modalOk = document.querySelector('.modal-footer .btn-principal, .modal-footer button');
              if (modalOk && isVisible(modalOk)) { modalOk.click(); await sleep(400); }
            }
          }
          run();
          return `Lançamento de ${items.length} itens iniciado!`;
        },
        args: [items, delay]
      });

      statusDiv.innerText = `▶️ Lançando ${items.length} produtos...`;

    } catch (err) {
      console.error(err);
      statusDiv.innerHTML = `<span style="color:#ef4444;">Erro: ${err.message}</span>`;
      btnStart.disabled = false;
      btnPause.disabled = true;
      btnStop.disabled = true;
    }
  });

  // Pausar
  btnPause.addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id, allFrames: true },
        func: () => { window._vfAutoPaused = !window._vfAutoPaused; return window._vfAutoPaused; }
      }).then(results => {
        const paused = results.find(r => r.result !== undefined)?.result;
        btnPause.innerText = paused ? '▶️ Continuar' : '⏸️ Pausar';
        statusDiv.innerText = paused ? '⏸️ Pausado pelo operador' : 'Continuando...';
      });
    }
  });

  // Parar
  btnStop.addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id, allFrames: true },
        func: () => { window._vfAutoRunning = false; window._vfAutoPaused = false; }
      });
    }
    btnStart.disabled = false;
    btnPause.disabled = true;
    btnStop.disabled = true;
    btnPause.innerText = '⏸️ Pausar';
    statusDiv.innerHTML = '<span style="color:#ef4444;">⏹️ Cancelado pelo operador.</span>';
  });
});
