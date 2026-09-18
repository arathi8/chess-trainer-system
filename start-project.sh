#!/bin/bash

echo "🚀 Chess Trainer System - Iniciando projeto..."
echo ""

# Cores para output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Verificar se Stockfish está instalado
if ! command -v stockfish &> /dev/null; then
    echo -e "${YELLOW}⚠️  Stockfish não encontrado. Por favor, instale o Stockfish:${NC}"
    echo "   Ubuntu/Debian: sudo apt-get install stockfish"
    echo "   Fedora: sudo dnf install stockfish"
    echo "   Arch: sudo pacman -S stockfish"
    exit 1
fi

echo -e "${GREEN}✓ Stockfish encontrado${NC}"
echo ""

# Iniciar backend em uma nova janela de terminal
echo -e "${BLUE}🔧 Iniciando backend...${NC}"
gnome-terminal -- bash -c "cd backend && source .venv/bin/activate && python chess_trainer_system_server.py; exec bash" 2>/dev/null || \
xterm -e "cd backend && source .venv/bin/activate && python chess_trainer_system_server.py" 2>/dev/null || \
konsole -e "cd backend && source .venv/bin/activate && python chess_trainer_system_server.py" 2>/dev/null || \
echo -e "${YELLOW}⚠️  Não foi possível abrir terminal automaticamente. Execute manualmente:${NC}"
echo "   cd backend && source .venv/bin/activate && python chess_trainer_system_server.py"

sleep 2

# Iniciar frontend em uma nova janela de terminal
echo -e "${BLUE}🎨 Iniciando frontend...${NC}"
gnome-terminal -- bash -c "cd frontend && npm run dev; exec bash" 2>/dev/null || \
xterm -e "cd frontend && npm run dev" 2>/dev/null || \
konsole -e "cd frontend && npm run dev" 2>/dev/null || \
echo -e "${YELLOW}⚠️  Não foi possível abrir terminal automaticamente. Execute manualmente:${NC}"
echo "   cd frontend && npm run dev"

echo ""
echo -e "${GREEN}✓ Projeto iniciado!${NC}"
echo ""
echo "📝 Acessos:"
echo "   Backend:  http://localhost:8000"
echo "   Frontend: http://localhost:5173"
echo ""
echo "Para parar os servidores, pressione Ctrl+C em cada terminal."
