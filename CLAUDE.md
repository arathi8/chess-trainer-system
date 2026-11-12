# Chess Trainer System

Treinador de xadrez web (MC857A, UNICAMP 2026/2): React + TypeScript (`frontend/`), FastAPI + Python (`backend/`), Stockfish local via UCI e LLM com chave do próprio usuário (BYOK).

## Antes de começar

1. Leia [docs/06-guia-para-ia.md](docs/06-guia-para-ia.md): contexto, invariantes, mapa de onde mexer, como rodar e testar, armadilhas.
2. Confira se a documentação está em dia: o último commit coberto está em [docs/README.md](docs/README.md). Rode `git log --oneline <commit>..HEAD`; se houver commits novos, leve isso em conta e, se a tarefa envolver a documentação, atualize `docs/` seguindo a seção 6.7 do guia.
3. **Trabalho em andamento:** modo **Aprender repertório** (branch `feat/learn-repertoire`). Plano, decisões e status por fase em [docs/07-modo-repertorio.md](docs/07-modo-repertorio.md); atualize a tabela de status ao concluir cada fase.
4. Para detalhes: [features](docs/01-features.md), [arquitetura e API](docs/02-arquitetura.md), [fluxos](docs/03-fluxos.md), [design patterns](docs/04-design-patterns.md), [débitos técnicos](docs/05-observacoes-tecnicas.md).

## Regras essenciais

- **Stockfish decide, LLM explica.** Avaliações, classificações e estatísticas são determinísticas e vão prontas no prompt; a LLM só traduz em linguagem didática e não pode inventar lances fora dos dados.
- **Backend sem estado** e **BYOK**: tudo vem na requisição; a chave da LLM nunca é lida do ambiente nem persistida.
- **Feedback oculto durante a partida de treino**; tudo aparece no fim. Estatísticas (`/api/game-stats`) aparecem antes da narrativa (`/api/game-report`).
- Mudanças em formatos de dados que cruzam frontend ↔ backend (`PositionAnalysis`, `stats`, códigos de classificação e de temas) precisam ser feitas dos dois lados.
- `frontend/src/components/GameBoard.tsx` serve aos modos `training` e `review` (PGN importado): teste os dois fluxos.

## Convenções

- Interface em português; código, comentários, prompts e commits em inglês.
- Commits: Conventional Commits (`feat:`, `fix:`, `perf:`, `refactor:`, `chore:`), imperativo, corpo explicando o porquê.
- Testes: `cd backend && python -m pytest tests -q` (precisa de `pytest` e `httpx`; testes com motor são pulados sem Stockfish).
- Frontend: `cd frontend && yarn dev` (Yarn, não npm).
