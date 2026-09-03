# ♟️ Chess Trainer System (Sistema Treinador de Xadrez)

Sistema de treino e análise semântica de xadrez desenvolvido para o projeto **MC857A – IC UNICAMP (2026.2)**. 

Esta versão mínima integra uma interface SPA em **React (TypeScript)** com um backend em **FastAPI (Python)** conectado ao binário do **Stockfish**. O usuário escolhe a cor inicial (Brancas, Pretas ou Aleatório), joga contra a engine com regras validadas localmente e solicita a avaliação do treinador da posição atual diretamente no painel lateral.

---

## 📋 Pré-requisitos

* **Node.js** (v18+) e gerenciador de pacotes **Yarn**
* **Python 3.10+**
* **Stockfish Engine** instalado no sistema operacional:
  * **Ubuntu/Debian:**
    ```bash
    sudo apt-get update && sudo apt-get install -y stockfish xclip
    ```
  * **macOS (Homebrew):**
    ```bash
    brew install stockfish
    ```
  * **Windows:** Baixe o binário compilado e adicione-o ao `PATH` do sistema.

## 🚀 Como Executar

```bash
# Entre no diretório do backend
cd backend

# Crie e ative o ambiente virtual
python3 -m venv .venv
source .venv/bin/activate       # No Windows: .venv\Scripts\activate

# Atualize o instalador e instale os pacotes necessários
pip install --upgrade pip
pip install -r requirements.txt

# Inicie o servidor FastAPI
uvicorn server:app --reload --port 8000

# Entre no diretório do front-end
cd frontend

# Instale as dependências via Yarn
yarn install

# Inicie o servidor de desenvolvimento
yarn dev
```

## 🎮 Como Usar a Aplicação

Selecione a opção desejada na barra superior: White, Black ou Random.

A cada movimento seu, o backend calculará a resposta da máquina e devolverá o lance no tabuleiro.

Clique em "Request Analysis" para enviar o FEN da posição atual ao Stockfish (profundidade 20) e exibir o prompt formatado com as variantes e o score da posição. 