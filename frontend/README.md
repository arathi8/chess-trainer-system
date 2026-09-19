# Chess Trainer System - Frontend Integrado

Este frontend foi adaptado para ter o visual elegante do "interface-de-xadrez" enquanto mantém todas as funcionalidades do backend do Chess Trainer System.

## 🎨 Características

- **Design premium**: Interface visual inspirada no projeto interface-de-xadrez com paleta de cores sofisticada (tons de dourado, verde escuro)
- **Integração completa com backend**: Todas as APIs do backend estão integradas
- **Análise em tempo real**: Classificação de movimentos (Best Move, Great Move, Inaccuracy, Mistake, Blunder)
- **Motor Stockfish**: Jogue contra o Stockfish com análise de posições

## 🚀 Como executar

### 1. Backend (Python + FastAPI)

```bash
cd backend

# Ativar ambiente virtual
source .venv/bin/activate

# Executar servidor
python chess_trainer_system_server.py
```

O servidor estará rodando em `http://localhost:8000`

### 2. Frontend (React + Vite)

```bash
cd frontend

# Instalar dependências (se ainda não instalou)
npm install

# Executar em modo desenvolvimento
npm run dev
```

O frontend estará disponível em `http://localhost:5173`

## 📋 Requisitos

### Backend

- Python 3.8+
- Stockfish instalado no sistema (geralmente em `/usr/games/stockfish` no Linux)
- Pacotes Python listados em `requirements.txt`

### Frontend

- Node.js 16+
- npm ou yarn

## 🎮 Como usar

1. **Tela inicial**: Escolha jogar com brancas ou pretas
2. **Durante o jogo**:
   - Arraste e solte as peças para fazer seus movimentos
   - O Stockfish responderá automaticamente
   - Cada movimento seu será classificado (★ Best Move, ! Great Move, ?! Inaccuracy, ? Mistake, ?? Blunder)
3. **Análise**: Clique em "Analisar posição" no painel direito para obter feedback detalhado sobre a posição atual

## 🔧 APIs utilizadas

- **POST /api/engine-move**: Obtém o melhor movimento do Stockfish
- **POST /api/evaluate-move**: Classifica um movimento jogado
- **POST /api/analyze-move**: Gera análise textual da posição

## 🎨 Paleta de cores

- **Fundo principal**: `#111311` (ink)
- **Dourado**: `#c99d52` e `#e8c887` (gold/gold-light)
- **Painéis**: `#181b19` e `#202420`
- **Texto**: `#f4f1e8` (cream)

## 📝 Estrutura de arquivos modificados

```
frontend/
├── src/
│   ├── App.tsx                    # Componente principal simplificado
│   ├── ChessTrainerSystem.tsx     # Novo componente integrado
│   ├── index.css                  # Estilos completos do design
│   └── App.css                    # Estilos específicos (mínimos)
```

## 🐛 Troubleshooting

**Backend não inicia**:

- Verifique se o Stockfish está instalado: `which stockfish`
- Verifique se todas as dependências Python estão instaladas

**Frontend não conecta ao backend**:

- Confirme que o backend está rodando em `localhost:8000`
- Verifique o console do navegador para erros de CORS

**Classificação de movimentos não aparece**:

- Aguarde alguns segundos após cada movimento (análise demora ~2-3 segundos)
- Verifique o console do navegador e logs do servidor
