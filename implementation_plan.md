# Roadmap & Plano de Implementação: Análise, Transferência e Reclassificação de Estoque

Este plano estabelece o roadmap completo para processamento, categorização e automação da análise dos **35.264 produtos** e **43.512 registros** da base `estoque new.csv` (Lojas 1 - Loja, 2 - Depósito e 3 - CD).

---

## 📊 Diagnóstico Inicial da Base de Dados

Após o processamento inicial do arquivo `estoque new.csv`, identificamos a seguinte distribuição:

| Categoria | Descrição | Quantidade de Itens | Ação Recomendada |
| :--- | :--- | :--- | :--- |
| **Filtro 1 (100% Positivo)** | Itens com saldo $\ge 0$ em todas as lojas (sem nenhum negativo) | **29.926 itens** | Manter como **Saldo Seguro** e usar como doador para reclassificação. |
| **Filtro 2 (Misto / Transferível)** | Positivo em uma loja e negativo em outra(s) | **1.719 itens** | Gerar **Sugestões de Transferência Interna** (ex: CD $\rightarrow$ Loja) para zerar os negativos sem custo. |
| **Filtro 3 (Negativo Total)** | Saldo $\le 0$ em todas as lojas (sem saldo positivo para transferir) | **3.619 itens** | Requer **Compra** ou **Reclassificação Fiscal por NCM**. |
| **Reclassificação (Filtro 4)** | Itens do Filtro 3 que possuem correspondentes com saldo positivo no Filtro 1 (mesmo NCM) | **3.595 de 3.619 itens** (99,3%) | Match automático por NCM e valor de custo/descrição para abater o saldo. |

---

## 🗺️ Roadmap de Execução

```mermaid
flowchart TD
    A[Arquivo CSV: estoque new.csv] --> B[Motor de Processamento & Regras de Estoque]
    B --> C1[Filtro 1: Saldo 100% Positivo]
    B --> C2[Filtro 2: Transferências entre Lojas]
    B --> C3[Filtro 3: Negativo Total]
    C3 --> D[Motor de Match NCM: Filtro 3 x Filtro 1]
    D --> E[Matriz de Reclassificação]
    C2 --> F[Plano de Movimentação Loja / Depósito / CD]
    B --> G[Dashboard Web Interativo & Exportador Excel/CSV]
```

### **Fase 1: Motor de Cálculo & Exportações Estruturadas (Imediato)**
* **Geração de arquivos CSV/Excel segmentados:**
  1. `1_saldo_positivo_puro.csv` (Itens sem problemas de saldo negativo).
  2. `2_plano_transferencias_internas.csv` (Tabela detalhada com: *Código, Descrição, Loja Origem, Loja Destino, Qtd a Transferir, Saldo Restante*).
  3. `3_itens_criticos_compra_reclassificacao.csv` (Itens sem saldo na rede).
  4. `4_sugestoes_reclassificacao_ncm.csv` (Cruzamento automático: Item Negativo $\leftrightarrow$ Item(ns) Doador(es) do mesmo NCM com saldo disponível).

### **Fase 2: Dashboard Web Operacional (Painel Visual e Interativo)**
* **Interface moderna (SPA Local):**
  * **Visão Geral:** Cards com totais de itens, volume financeiro de saldo negativo vs saldo positivo, índice de cobertura por NCM.
  * **Módulo de Transferências (Filtro 2):** Simulador visual onde o operador vê quanto cada loja precisa ceder ou receber para zerar os saldos negativos.
  * **Módulo de Reclassificação por NCM (Filtro 4):** Ao clicar em um item negativo, o painel lista os itens positivos do mesmo NCM, calculando a quantidade exata a compensar (1 para 1 ou por valor).
  * **Consulta em Tempo Real:** Botão integrado à API ERP para verificar se o saldo atual do produto já mudou no sistema.

### **Fase 3: Auditoria & Validação de Regras de Negócio**
* Validação de restrições fiscais (ex.: compatibilidade de NCM, alíquotas ou seções de produtos quando aplicável).
* Relatório consolidado para aprovação gerencial e contábil.

---

## 🔍 Regras de Compensação Propostas

1. **Regra de Transferência Interna (Filtro 2):**
   * Se Loja 1 tem saldo $-X$ e Loja 3 (CD) tem saldo $+Y$:
     * Quantidade a transferir: $\min(X, Y)$ da Loja 3 para Loja 1.
     * Prioridade de doação: CD (Loja 3) $\rightarrow$ Depósito (Loja 2) $\rightarrow$ Loja (Loja 1).
2. **Regra de Reclassificação por NCM (Filtro 4):**
   * Busca no Filtro 1 todos os produtos com exatamente o mesmo código NCM.
   * Ordena os doadores por:
     1. Similaridade na descrição do produto.
     2. Maior saldo disponível.
   * Simula a compensação do saldo até zerar a pendência do item negativo.

---

## 📋 Plano de Verificação

### Testes Automatizados & Validação de Dados:
* Garantir que a soma de todos os grupos seja exatamente igual aos 35.264 produtos da base.
* Verificar se nenhuma transferência gerada cria um saldo negativo na loja de origem.
* Conferir se todos os matches de reclassificação preservam 100% da igualdade de NCM.

### Verificação Manual:
* Abrir os relatórios gerados e validar itens de exemplo com os saldos do ERP.
* Testar a interface web interativa navegando pelos 4 filtros.
