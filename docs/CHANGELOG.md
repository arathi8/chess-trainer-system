# Changelog da documentação

Cada entrada registra uma sincronização desta pasta com o código. A mais recente fica no topo.

## 2026-11-11 — sincronizado até `a719b4c` (branch `feat/learn-repertoire`)

| Commit | Mudança no código | Documentos atualizados |
|---|---|---|
| `a719b4c` feat: add repertoire catalog and theory tree endpoints | Novo `repertoire_service` com catálogo (família → variante, cor sugerida) e árvore de teoria; `GET /api/repertoire/catalog` e `GET /api/repertoire/tree`; índice de aberturas virou `OpeningsIndex(named, book, lines)` | README, 01 (F15, testes), 02 (módulos, API, dependências), 04 (trie, índice tipado), 05 (A7), 06 (mapa, contratos), HTML |

Também nesta sincronização:

- Criado [07-modo-repertorio.md](07-modo-repertorio.md) com o plano aprovado do novo modo e a tabela de status por fase.
- Corrigida a menção ao provedor Ollama: a alteração local nunca foi commitada e não está mais no código (05, A5).
- [CLAUDE.md](../CLAUDE.md) passa a apontar para o trabalho em andamento.

## 2026-11-11 — sincronizado até `2ab6da0`

Commits cobertos: `5ceeb35`, `2247f0c`, `2ab6da0`.

| Commit | Mudança no código | Documentos atualizados |
|---|---|---|
| `5ceeb35` perf: preload the openings dataset when the server starts | `lifespan` do FastAPI dispara uma *thread* que indexa `openings.tsv` (~5 s) ao iniciar; `load_openings` passou de `@lru_cache` para cache global + `threading.Lock` (`build_openings_index` faz o trabalho) | 01 (F12), 02, 04, HTML |
| `2247f0c` feat: analyse the engine's moves during training games | Lances do motor são classificados em segundo plano assim que jogados (`analyseInBackground`); no fim, `analyseMoves` só reprocessa falhas; `requestEngineAnalysis(move)` deriva ply/cor do `Move` (corrige *closure* desatualizada) | 01 (F3, F4), 02, 03 (3.2, 3.3, 3.4), 04, 05 (P1, P2, P4), HTML |
| `2ab6da0` feat: split the game report into stats and the coach's narrative | Novo `POST /api/game-stats` (determinístico); `POST /api/game-report` recebe `stats` e devolve só `report`, com erros HTTP 400/502/500 (antes: `report_error` em HTTP 200); frontend com estados `stats` e `coach: CoachReport` e `ReportContext` para reenviar só a narrativa | 01 (F6, F14), 02 (API, modelo de dados), 03 (3.2, 3.4, 3.5), 04, 05 (C6, C9), HTML |

Também nesta sincronização: criados [06-guia-para-ia.md](06-guia-para-ia.md) e este changelog; quadro de sincronização adicionado ao [README.md](README.md); criado o [CLAUDE.md](../CLAUDE.md) na raiz, que aponta para o guia e é carregado automaticamente pelo Claude Code.

## 2026-11-11 — versão inicial, até `3d0bcf8`

Primeira versão da documentação, extraída da leitura do código: features, arquitetura, fluxos, design patterns e observações técnicas.
