import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import threading
import time
import os
import sys

# Ensure process SSL variables don't conflict
os.environ.pop('SSL_CERT_FILE', None)
os.environ.pop('REQUESTS_CA_BUNDLE', None)

try:
    import pyautogui
    import pyperclip
    import keyboard
except ImportError:
    pass

class AutoClickerNFApp:
    def __init__(self, root):
        self.root = root
        self.root.title("🤖 Auto Clicker NF - Newshop / VarejoFácil")
        self.root.geometry("460x620")
        self.root.resizable(False, False)
        self.root.attributes("-topmost", True)
        self.root.configure(bg="#0f172a")

        # PyAutoGUI Safety settings
        pyautogui.FAILSAFE = True
        pyautogui.PAUSE = 0.05

        self.pos_codigo = None
        self.pos_qtd = None
        self.pos_adicionar = None

        self.items = []
        self.is_running = False
        self.is_paused = False

        self.setup_ui()
        self.register_global_hotkey()

    def setup_ui(self):
        # Header
        header = tk.Frame(self.root, bg="#1e293b", pady=10)
        header.pack(fill="x")
        lbl_title = tk.Label(header, text="🤖 Auto Clicker NF (Desktop)", font=("Segoe UI", 13, "bold"), fg="#10b981", bg="#1e293b")
        lbl_title.pack()
        lbl_sub = tk.Label(header, text="Automação Externa para VarejoFácil / Navegador", font=("Segoe UI", 8), fg="#94a3b8", bg="#1e293b")
        lbl_sub.pack()

        # Step 1: Calibração de Coordenadas
        step1_frame = tk.LabelFrame(self.root, text=" 1. Calibrar Posições dos Cliques na Tela ", font=("Segoe UI", 9, "bold"), fg="#38bdf8", bg="#0f172a", padx=10, pady=8)
        step1_frame.pack(fill="x", padx=12, pady=6)

        self.btn_pos_cod = tk.Button(step1_frame, text="📍 1. Gravar Posição do CÓDIGO", command=lambda: self.capture_pos("codigo"), bg="#1e293b", fg="#f8fafc", font=("Segoe UI", 8, "bold"), relief="groove", cursor="hand2")
        self.btn_pos_cod.grid(row=0, column=0, sticky="ew", padx=2, pady=3)

        self.lbl_pos_cod = tk.Label(step1_frame, text="Não gravado", font=("Segoe UI", 8), fg="#fb7185", bg="#0f172a")
        self.lbl_pos_cod.grid(row=0, column=1, sticky="w", padx=6)

        self.btn_pos_qtd = tk.Button(step1_frame, text="📍 2. Gravar Posição da QUANTIDADE", command=lambda: self.capture_pos("qtd"), bg="#1e293b", fg="#f8fafc", font=("Segoe UI", 8, "bold"), relief="groove", cursor="hand2")
        self.btn_pos_qtd.grid(row=1, column=0, sticky="ew", padx=2, pady=3)

        self.lbl_pos_qtd = tk.Label(step1_frame, text="Não gravado", font=("Segoe UI", 8), fg="#fb7185", bg="#0f172a")
        self.lbl_pos_qtd.grid(row=1, column=1, sticky="w", padx=6)

        self.btn_pos_add = tk.Button(step1_frame, text="📍 3. Gravar Botão ADICIONAR/PRÓXIMO", command=lambda: self.capture_pos("add"), bg="#1e293b", fg="#f8fafc", font=("Segoe UI", 8, "bold"), relief="groove", cursor="hand2")
        self.btn_pos_add.grid(row=2, column=0, sticky="ew", padx=2, pady=3)

        self.lbl_pos_add = tk.Label(step1_frame, text="Não gravado", font=("Segoe UI", 8), fg="#fb7185", bg="#0f172a")
        self.lbl_pos_add.grid(row=2, column=1, sticky="w", padx=6)

        step1_frame.grid_columnconfigure(0, weight=1)

        # Step 2: Carregar CSV / TXT
        step2_frame = tk.LabelFrame(self.root, text=" 2. Lista de Produtos (Codigo;qtd) ", font=("Segoe UI", 9, "bold"), fg="#38bdf8", bg="#0f172a", padx=10, pady=8)
        step2_frame.pack(fill="x", padx=12, pady=6)

        file_btns = tk.Frame(step2_frame, bg="#0f172a")
        file_btns.pack(fill="x", pady=2)

        btn_open_file = tk.Button(file_btns, text="📁 Abrir Arquivo CSV/TXT", command=self.load_file, bg="#334155", fg="#f8fafc", font=("Segoe UI", 8, "bold"), relief="flat", cursor="hand2")
        btn_open_file.pack(side="left", fill="x", expand=True, padx=2)

        btn_paste_clip = tk.Button(file_btns, text="📋 Colar da Área de Transf.", command=self.paste_clipboard, bg="#334155", fg="#f8fafc", font=("Segoe UI", 8, "bold"), relief="flat", cursor="hand2")
        btn_paste_clip.pack(side="left", fill="x", expand=True, padx=2)

        self.txt_preview = tk.Text(step2_frame, height=5, bg="#070a12", fg="#34d399", font=("Consolas", 8), relief="flat")
        self.txt_preview.pack(fill="x", pady=4)

        # Step 3: Configurações & Controles
        ctrl_frame = tk.Frame(self.root, bg="#0f172a", padx=12)
        ctrl_frame.pack(fill="x", pady=4)

        lbl_delay = tk.Label(ctrl_frame, text="Espera de Carregamento (segundos):", font=("Segoe UI", 8), fg="#cbd5e1", bg="#0f172a")
        lbl_delay.pack(side="left")

        self.spn_delay = ttk.Spinbox(ctrl_frame, from_=0.5, to=5.0, increment=0.2, width=5)
        self.spn_delay.set(1.4)
        self.spn_delay.pack(side="left", padx=6)

        # Progress
        prog_frame = tk.Frame(self.root, bg="#0f172a", padx=12)
        prog_frame.pack(fill="x", pady=4)

        self.lbl_progress = tk.Label(prog_frame, text="Status: Aguardando calibração e itens", font=("Segoe UI", 8), fg="#94a3b8", bg="#0f172a")
        self.lbl_progress.pack(anchor="w")

        self.progress_bar = ttk.Progressbar(prog_frame, orient="horizontal", mode="determinate")
        self.progress_bar.pack(fill="x", pady=2)

        # Action Buttons
        btn_frame = tk.Frame(self.root, bg="#0f172a", padx=12, pady=6)
        btn_frame.pack(fill="x", pady=6)

        self.btn_start = tk.Button(btn_frame, text="▶️ INICIAR AUTO CLICK", command=self.start_automation, bg="#10b981", fg="#ffffff", font=("Segoe UI", 10, "bold"), relief="flat", cursor="hand2", pady=8)
        self.btn_start.pack(fill="x", pady=2)

        sub_btns = tk.Frame(btn_frame, bg="#0f172a")
        sub_btns.pack(fill="x", pady=2)

        self.btn_pause = tk.Button(sub_btns, text="⏸️ Pausar", command=self.toggle_pause, bg="#f59e0b", fg="#ffffff", font=("Segoe UI", 8, "bold"), relief="flat", cursor="hand2", state="disabled")
        self.btn_pause.pack(side="left", fill="x", expand=True, padx=2)

        self.btn_stop = tk.Button(sub_btns, text="⏹️ Parar (ou aperte ESC)", command=self.stop_automation, bg="#ef4444", fg="#ffffff", font=("Segoe UI", 8, "bold"), relief="flat", cursor="hand2", state="disabled")
        self.btn_stop.pack(side="left", fill="x", expand=True, padx=2)

        lbl_esc_info = tk.Label(self.root, text="💡 Dica de Segurança: Aperte a tecla ESC ou mova o mouse para o canto da tela para cancelar imediatamente.", font=("Segoe UI", 7), fg="#64748b", bg="#0f172a", wraplength=440)
        lbl_esc_info.pack(pady=4)

    def register_global_hotkey(self):
        try:
            keyboard.add_hotkey('esc', self.stop_automation)
        except Exception:
            pass

    def capture_pos(self, field_type):
        self.root.attributes("-topmost", False)
        messagebox.showinfo("Calibrar Posição", f"Após clicar em OK, você terá 3 SEGUNDOS para posicionar o mouse em cima do campo correspondente no VarejoFácil!")
        self.root.update()
        time.sleep(3)
        x, y = pyautogui.position()
        self.root.attributes("-topmost", True)

        if field_type == "codigo":
            self.pos_codigo = (x, y)
            self.lbl_pos_cod.config(text=f"✓ X: {x}, Y: {y}", fg="#34d399")
        elif field_type == "qtd":
            self.pos_qtd = (x, y)
            self.lbl_pos_qtd.config(text=f"✓ X: {x}, Y: {y}", fg="#34d399")
        elif field_type == "add":
            self.pos_adicionar = (x, y)
            self.lbl_pos_add.config(text=f"✓ X: {x}, Y: {y}", fg="#34d399")

        self.lbl_progress.config(text=f"Posição {field_type.upper()} gravada com sucesso!", fg="#38bdf8")

    def load_file(self):
        file_path = filedialog.askopenfilename(filetypes=[("Arquivos CSV / TXT", "*.csv;*.txt"), ("Todos os Arquivos", "*.*")])
        if file_path:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            self.parse_content(content)

    def paste_clipboard(self):
        try:
            content = pyperclip.paste()
            self.parse_content(content)
        except Exception as e:
            messagebox.showerror("Erro", f"Não foi possível ler a área de transferência: {e}")

    def parse_content(self, text):
        lines = [l.strip() for l in text.splitlines() if ";" in l and not l.lower().startswith("codigo")]
        self.items = []
        for l in lines:
            parts = l.split(";")
            if len(parts) >= 2:
                cod = parts[0].strip()
                qtd = parts[1].strip()
                if cod and qtd:
                    self.items.append((cod, qtd))

        self.txt_preview.delete("1.0", tk.END)
        for cod, qtd in self.items[:30]:
            self.txt_preview.insert(tk.END, f"{cod};{qtd}\n")
        if len(self.items) > 30:
            self.txt_preview.insert(tk.END, f"... e mais {len(self.items) - 30} itens\n")

        self.lbl_progress.config(text=f"✓ {len(self.items)} itens carregados prontos para lançamento!", fg="#34d399")

    def toggle_pause(self):
        self.is_paused = not self.is_paused
        self.btn_pause.config(text="▶️ Continuar" if self.is_paused else "⏸️ Pausar")
        self.lbl_progress.config(text="⏸️ Pausado pelo operador" if self.is_paused else "Executando...", fg="#f59e0b" if self.is_paused else "#34d399")

    def stop_automation(self):
        self.is_running = False
        self.is_paused = False
        self.btn_start.config(state="normal")
        self.btn_pause.config(state="disabled", text="⏸️ Pausar")
        self.btn_stop.config(state="disabled")
        self.lbl_progress.config(text="⏹️ Automação interrompida.", fg="#ef4444")

    def start_automation(self):
        if not self.pos_codigo or not self.pos_qtd or not self.pos_adicionar:
            messagebox.showwarning("Atenção", "Por favor, grave as 3 posições de clique antes de iniciar!")
            return

        if not self.items:
            messagebox.showwarning("Atenção", "Carregue ou cole a lista de produtos primeiro!")
            return

        self.is_running = True
        self.is_paused = False
        self.btn_start.config(state="disabled")
        self.btn_pause.config(state="normal")
        self.btn_stop.config(state="normal")

        # Start thread
        thread = threading.Thread(target=self.run_loop, daemon=True)
        thread.start()

    def run_loop(self):
        delay = float(self.spn_delay.get())
        total = len(self.items)

        # 3 Seconds countdown
        for c in range(3, 0, -1):
            if not self.is_running:
                return
            self.lbl_progress.config(text=f"⏳ Iniciando em {c}s... FOQUE NA JANELA DA NOTA!", fg="#f59e0b")
            time.sleep(1)

        self.progress_bar["maximum"] = total

        for idx, (cod, qtd) in enumerate(self.items):
            if not self.is_running:
                break

            while self.is_paused:
                time.sleep(0.3)
                if not self.is_running:
                    break

            # Update UI
            pct = int(((idx + 1) / total) * 100)
            self.progress_bar["value"] = idx + 1
            self.lbl_progress.config(text=f"[{idx + 1}/{total} - {pct}%] Lançando Cód {cod} ({qtd} un)...", fg="#38bdf8")

            # 1. Clicar no campo CÓDIGO
            pyautogui.click(self.pos_codigo[0], self.pos_codigo[1])
            time.sleep(0.15)
            # Selecionar tudo e apagar se houver lixo
            pyautogui.hotkey('ctrl', 'a')
            pyautogui.press('backspace')
            # Digitar Código
            pyautogui.write(cod, interval=0.02)
            pyautogui.press('enter')

            # Espera carregar produto no VarejoFácil
            time.sleep(delay)

            if not self.is_running:
                break

            # 2. Clicar no campo QUANTIDADE
            pyautogui.click(self.pos_qtd[0], self.pos_qtd[1])
            time.sleep(0.15)
            pyautogui.hotkey('ctrl', 'a')
            pyautogui.press('backspace')
            pyautogui.write(str(qtd), interval=0.02)

            time.sleep(0.2)

            # 3. Clicar em ADICIONAR / PRÓXIMO
            pyautogui.click(self.pos_adicionar[0], self.pos_adicionar[1])

            # Espera gravar na grid
            time.sleep(delay)

        if self.is_running:
            self.lbl_progress.config(text="🎉 CONCLUÍDO! Todos os itens foram lançados!", fg="#10b981")
            self.btn_start.config(state="normal")
            self.btn_pause.config(state="disabled")
            self.btn_stop.config(state="disabled")
            messagebox.showinfo("Sucesso", f"🎉 Todos os {total} produtos foram lançados na Nota Fiscal!")
            self.is_running = False

if __name__ == "__main__":
    root = tk.Tk()
    app = AutoClickerNFApp(root)
    root.mainloop()
