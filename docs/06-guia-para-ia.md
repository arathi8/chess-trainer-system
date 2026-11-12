# 06 — Guia para assistentes de IA

Contexto condensado para uma sessão nova (Claude ou outra IA generativa) começar a trabalhar no projeto sem reler todo o código. Para detalhes, siga os links para os outros documentos.

> **Antes de confiar neste guia**, confira se o código mudou desde a última sincronização (commit registrado em [README.md](README.md)): `git log --oneline <commit>..HEAD`. Se houver commits novos, leia os diffs e atualize esta pasta seguindo a seção 6.7.

## 6.1 O que é o projeto (em 5 linhas)

- Treinador de xadrez web para a disciplina MC857A (UNICAMP, 2026/2). Frontend React + TypeScript, backend FastAPI + Python, Stockfish local via UCI, LLM via API compatível com OpenAI com chave do próprio usuário (BYOK).
- Dois pontos de entrada: **Novo jogo** (partida de treino contra o Stockfish) e **Carregar PGN** (análise de partida importada). Um terceiro, **Aprender repertório**, está em desenvolvimento na branch `feat/learn-repertoire` — plano e status em [07-modo-repertorio.md](07-modo-repertorio.md).
- Ao fim, o jogador recebe estatísticas determinísticas (precisão, classificação dos lances, fases, temas táticos, abertura, momentos-chave) e um relatório escrito pela LLM; pode também pedir a explicação de qualquer lance, seu ou do oponente.
- Interface em português; código, comentários, prompts e mensagens de commit em inglês.
- Não há banco de dados nem sessão: todo o estado vive no navegador.

## 6.2 Invariantes — não quebrar

1. **Stockfish decide, LLM explica.** Classificação, precisão, temas táticos e teoria são calculados de forma determinística e passados ao prompt. Nunca peça à LLM para avaliar uma posição sem dados do motor nem deixe a LLM decidir se um lance é bom.
2. **Prompts ancorados.** Os prompts proíbem citar lances ou linhas que não estejam nos dados. Ao mexer em prompts (`llm_service.generate_prompt`, `report_service.generate_report_prompt`), mantenha essa restrição.
3. **BYOK.** A chave da LLM vem só da requisição (`provider`, `api_key`, `model`, `base_url`); o servidor nunca lê chave de variável de ambiente nem a persiste. No navegador fica em `sessionStorage`.
4. **Backend sem estado.** Qualquer dado necessário a um endpoint precisa vir na requisição. Ex.: `/game-report` recebe de volta as `stats` geradas por `/game-stats`.
5. **Feedback oculto durante o treino.** Os lances são analisados enquanto se joga, mas badges e explicações só aparecem quando a partida termina.
6. **Estatísticas antes da narrativa.** `/game-stats` (rápido, sem LLM) e `/game-report` (LLM) são separados para que as estatísticas apareçam sem esperar a LLM e para que "Gerar novamente" refaça só a narrativa.
7. **O modo leniente nunca entrega a partida.** O motor só alivia dentro de `[GRACE_WIN_FLOOR, GRACE_WIN_CAP]` = [50%, 70%] de chance de vitória, nos primeiros 12 lances, e o relatório trata esses erros como reais (`lenient_plies`).
8. **Validação nos dois lados.** `chess.js` valida no cliente; `python-chess` revalida no servidor.

## 6.3 Mapa: onde mexer para…

| Objetivo | Arquivo(s) | Função / símbolo |
|---|---|---|
| Mudar faixas de classificação (Blunder, Mistake…) | [engine_service.py](../backend/services/engine_service.py) | `get_move_classification`; badges em `BADGE_CONFIG` ([GameBoard.tsx](../frontend/src/components/GameBoard.tsx)) |
| Mudar força/comportamento do motor no treino | [engine_service.py](../backend/services/engine_service.py) | constantes `GRACE_*`, `VARIETY_*`, `TRAINING_MULTIPV`; `choose_lenient_move`, `choose_varied_move`, `get_engine_move` |
| Mudar fórmula de precisão, fases, temas táticos, momentos-chave | [report_service.py](../backend/services/report_service.py) | `move_accuracy`, `game_phase`, `error_tags`, `compute_game_stats`, `KEY_MOMENTS` |
| Mudar o texto/estrutura do relatório do treinador | [report_service.py](../backend/services/report_service.py) | `generate_report_prompt` (e `SYSTEM_PROMPT` em `llm_service.py`) |
| Mudar a explicação de um lance | [llm_service.py](../backend/services/llm_service.py) | `generate_prompt`, `format_analysis_block` |
| Adicionar provedor LLM | [llm_service.py](../backend/services/llm_service.py) | entrada em `PROVIDER_DEFAULTS` (o frontend lê o catálogo de `/api/llm-providers` automaticamente) |
| Mudar identificação de abertura | [openings_service.py](../backend/services/openings_service.py) | `identify_opening`, `book_moves_from`; dados em `backend/data/openings.tsv` |
| Regras do drill de repertório (resposta do oponente, cobertura, dica) | [drill.ts](../frontend/src/repertoire/drill.ts) | `pickOpponentMove`, `hintMove`, `classifyUserMove` |
| Tela de treino de repertório (fases, modal fora da teoria, resumo) | [RepertoireTrainer.tsx](../frontend/src/components/RepertoireTrainer.tsx) | `onDrop`, `advance`, `stayInTheory`, `leaveTheory`, `startLine` |
| Catálogo e árvore do modo repertório | [repertoire_service.py](../backend/services/repertoire_service.py) | `list_repertoire_catalog`, `build_repertoire_tree`, `belongs_to`, `side_of_last_move` |
| Novo endpoint | [chess_trainer_system_server.py](../backend/chess_trainer_system_server.py) | DTO Pydantic + rota; lógica num serviço, não na rota |
| Fluxo da partida, chamadas à API, fim de jogo | [GameBoard.tsx](../frontend/src/components/GameBoard.tsx) | `onDrop`, `requestEngineMove`, `requestEngineAnalysis`, `analyseInBackground`, `finishGame`, `analyseImportedGame`, `submitReport`, `requestGameStats`, `requestCoachReport`, `requestMoveEvaluation` |
| Exibição do relatório | [GameReport.tsx](../frontend/src/components/GameReport.tsx) | tipos `GameStats`, `CoachReport`; `TAG_LABELS`, `PHASE_LABELS`, `COUNT_ROWS` |
| Navegação entre telas | [App.tsx](../frontend/src/App.tsx) | estado `screen`, handlers `handle*` |
| Tema/cores | `frontend/src/index.css`, [CUSTOMIZATION.md](../frontend/CUSTOMIZATION.md) | variáveis CSS em `:root` |

**Contratos que cruzam a fronteira (mudar dos dois lados):**

- Formato de `PositionAnalysis` e `MoveAnalysis` (`engine_service.stringfy_engine_analysis` ↔ `report_service` faz *parse* por regex de `best_move` e `evaluation` ↔ tipos em `GameBoard.tsx`).
- Formato do nó da árvore de repertório (`repertoire_service.build_repertoire_tree` ↔ DTO `RepertoireNode` no servidor ↔ tipos do frontend do modo repertório).
- Formato de `stats` (`report_service.compute_game_stats` + `opening` ↔ `GameStats` em `GameReport.tsx` ↔ `generate_report_prompt`, que lê as chaves de volta).
- Códigos de classificação (`"Best Move"`, …) e de temas (`"hung_piece"`, …) ↔ tabelas de rótulos no frontend.

## 6.4 Como rodar e testar

```bash
# backend (porta 8000; Swagger em /docs)
cd backend
python -m venv .venv && .venv/Scripts/activate   # Linux/macOS: source .venv/bin/activate
# (pode já existir um .venv na RAIZ do repositório: nesse caso use ../.venv/Scripts/python.exe)
pip install -r requirements.txt
pip install pytest httpx requests                 # não estão no requirements.txt
python chess_trainer_system_server.py

# testes (testes com motor são pulados se o Stockfish não for encontrado)
cd backend && python -m pytest tests -q

# frontend (porta 5173)
cd frontend && yarn install && yarn dev
```

Stockfish: `STOCKFISH_PATH`, ou binário em `backend/stockfish/`, ou no `PATH`. Para usar o app sem chave de LLM, escolha o provedor **Somente prompt** em "Configurar LLM": as respostas mostram o prompt gerado.

## 6.5 Convenções observadas no repositório

- Commits no padrão *Conventional Commits*, em inglês e no imperativo: `feat:`, `fix:`, `perf:`, `refactor:`, `chore:`. Corpo explica o *porquê*. Commits feitos com ajuda do Claude terminam com `Co-Authored-By: Claude ...`.
- Branches: `feat/<nome>`; integração em `develop`; principal `main`.
- Textos de UI em português; identificadores, comentários, prompts e mensagens de log em inglês (exceção: algumas mensagens de erro de API ao usuário em português).
- Backend: funções puras sempre que possível, constantes de ajuste em MAIÚSCULAS no topo do módulo, testes em `backend/tests/` com análises sintéticas (sem motor) e `@needs_stockfish` para os que precisam do motor.
- Frontend: componentes funcionais com hooks; sem biblioteca de estado nem roteador; estado usado em código assíncrono fica em `useRef`.

## 6.6 Armadilhas conhecidas

- `GameBoard.tsx` (~960 linhas) concentra quase toda a lógica; mudanças ali afetam treino e PGN importado (`mode: 'training' | 'review'`). Teste os dois fluxos.
- React `StrictMode` executa efeitos duas vezes em desenvolvimento: efeitos de inicialização usam *refs* de guarda (`gameStartedRef`, `autoAnalysisStartedRef`).
- Não derive número do lance/cor do estado `moveHistory` dentro de callbacks assíncronos (ele pode estar desatualizado); use o objeto `Move` do `chess.js` ou a FEN (`plyFromFen`).
- Ply é 0-based: par = brancas. `turnNumber = floor(ply/2) + 1`.
- Avaliações em `PositionAnalysis.evaluation` são sempre do ponto de vista das brancas; `move_delta` é do ponto de vista de quem jogou.
- O relatório exige pelo menos 3 lances do usuário analisados (`MIN_MOVES_FOR_REPORT`).
- Cada chamada ao motor abre um processo do Stockfish (profundidade 20, ~1–2 s). Evite multiplicar chamadas.
- Relatório pede saída em inglês (débito conhecido, ver [05-observacoes-tecnicas.md](05-observacoes-tecnicas.md) D1).
- Lista completa de débitos: [05-observacoes-tecnicas.md](05-observacoes-tecnicas.md).

## 6.7 Como manter esta documentação atualizada

Ao sincronizar com novos commits:

1. `git log --oneline <último commit coberto>..HEAD` e `git diff <último commit coberto> HEAD` para ver o que mudou.
2. Atualize os arquivos afetados:
   - nova feature ou mudança de comportamento → [01-features.md](01-features.md)
   - endpoint, DTO, módulo, dependência → [02-arquitetura.md](02-arquitetura.md)
   - sequência de chamadas ou estados → [03-fluxos.md](03-fluxos.md)
   - padrão novo ou removido → [04-design-patterns.md](04-design-patterns.md)
   - débito resolvido ou novo → [05-observacoes-tecnicas.md](05-observacoes-tecnicas.md)
   - mapa, invariantes, armadilhas → este arquivo
   - diagramas → também em [arquitetura.html](arquitetura.html) (os blocos Mermaid estão duplicados em `<script type="text/plain">`)
3. Atualize o quadro de sincronização em [README.md](README.md) e o cabeçalho de [arquitetura.html](arquitetura.html). Se mudar alguma regra essencial ou convenção, ajuste também o [CLAUDE.md](../CLAUDE.md) da raiz.
4. Registre a sincronização em [CHANGELOG.md](CHANGELOG.md).

Escreva sempre a partir do código, não de suposições; cite o commit quando o comportamento mudou.
