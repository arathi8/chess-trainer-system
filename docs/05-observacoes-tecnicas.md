# 05 — Observações técnicas

Pontos encontrados durante a análise que valem considerar antes das próximas alterações. Nada aqui foi modificado; é um levantamento.

## 5.1 Alinhamento com o objetivo didático

| # | Observação | Onde | Impacto |
|---|---|---|---|
| D1 | O prompt do relatório pede explicitamente **"Write a post-game report in English"**, mas toda a interface está em português. O prompt de lance não define idioma (a resposta tende a seguir o inglês do prompt) | `generate_report_prompt`, `generate_prompt` | Alto para o público-alvo |
| D2 | O `SYSTEM_PROMPT` é genérico ("chess expert assistant"). Não define persona de professor, nível do aluno, tom, tamanho ou formato | [llm_service.py:7](../backend/services/llm_service.py#L7) | Médio — é a principal alavanca de didática |
| D3 | A explicação de lance recebe avaliação e linhas, mas **não** recebe os temas táticos (`error_tags`), a fase do jogo nem a abertura, que já são calculados para o relatório | `generate_prompt` vs. `report_service.error_tags` | Médio — a LLM tem menos fatos concretos para ancorar a explicação |
| D4 | Durante a partida de treino não há nenhum feedback; o aprendizado acontece só no fim. É uma decisão de produto consciente (avaliar o nível), mas o README ainda descreve "Avaliar lance" durante o jogo | [GameBoard.tsx](../frontend/src/components/GameBoard.tsx), [README.md](../README.md) | Documentação desatualizada |
| D5 | Lances de livro (teoria) que não coincidem com o 1º lance do Stockfish podem ser classificados como Good Move ou até Inaccuracy, sem marcação de "lance teórico" | `get_move_classification` | Baixo/médio |

## 5.2 Qualidade de código e manutenção

| # | Observação | Onde |
|---|---|---|
| C1 | `GameBoard.tsx` tem ~960 linhas e concentra tabuleiro, turnos, 5 tipos de chamada HTTP, fila de análise, montagem do relatório, modo revisão e UI do treinador. É o principal ponto de atrito para novas features | [GameBoard.tsx](../frontend/src/components/GameBoard.tsx) |
| C2 | Não há camada de API no frontend: `fetch` aparece espalhado, payloads montados à mão e `directPayload?: any` em `requestMoveEvaluation` | `api.ts` contém só a URL |
| C3 | Tipos duplicados entre arquivos (`MoveDetail`, `MoveRow`, `PlayerColor` em `App.tsx` e `GameBoard.tsx`, com campos diferentes: `winPercentLoss` vs. `delta`) | [App.tsx](../frontend/src/App.tsx), [GameBoard.tsx](../frontend/src/components/GameBoard.tsx) |
| C4 | `HomePage.tsx` não é usado em lugar nenhum | [HomePage.tsx](../frontend/src/components/HomePage.tsx) |
| C5 | Acoplamento por strings formatadas: o motor gera `"e2e4 (e4)"` e `"Mate in -3 moves"`, e o `report_service` desfaz isso com regex (`parse_uci_prefix`, `is_mate_for`). Campos estruturados (`best_move_uci`, `score_cp`, `mate_in`) eliminariam esse parsing | `stringfy_engine_analysis` ↔ `report_service` |
| C6 | `before_move_analysis`/`after_move_analysis` e agora `stats` (em `GameStatsResponse` e `GameReportRequest`) são `dict` sem esquema nos DTOs Pydantic. No frontend, `GameStats` é tipado em `GameReport.tsx` — o contrato existe só de um lado | [chess_trainer_system_server.py](../backend/chess_trainer_system_server.py) |
| C9 | `/game-report` confia nas estatísticas reenviadas pelo cliente; só detecta chaves ausentes (`KeyError` → 400). Valores incoerentes chegariam ao prompt sem validação | `game_report` |
| C7 | Logs via `print(..., file=sys.stderr)` em vez de `logging`; `get_move_analysis` engole exceções e retorna `None`, e a rota responde 400 genérico mesmo quando o problema é o binário do Stockfish | [engine_service.py](../backend/services/engine_service.py) |
| C8 | Mistura de idiomas: mensagens de erro do backend em PT e EN; código e comentários em EN | vários |

## 5.3 Dependências e ambiente

| # | Observação |
|---|---|
| A1 | `requests` (usado pela CLI) e `httpx` (exigido pelo `TestClient` nos testes) não estão em `requirements.txt` |
| A2 | `requirements.txt` não inclui `pytest` (nem há `requirements-dev.txt`) |
| A3 | A pasta `diagramas/` (não versionada) tem diagramas desatualizados: citam `/api/engine-feedback`, que não existe, e o `diagram_5_semantic_explain.png` é uma cópia do diagrama 4. Os diagramas desta pasta `docs/` os substituem |
| A4 | Existem arquivos não versionados na raiz: `package-lock.json` (o frontend usa Yarn) e `input/` (FENs, lances e PGNs de exemplo, diferente de `backend/inputs/` que a CLI lê) |
| A5 | Uma entrada de provedor Ollama chegou a existir como alteração local em `PROVIDER_DEFAULTS`, mas não foi commitada e não está mais no código: hoje só há Gemini e "Somente prompt" |
| A7 | O catálogo de repertório (`/api/repertoire/catalog`) tem ~220 KB, porque traz a linha de referência de todas as 1.306 variantes. Se pesar no carregamento da tela, dá para enviar só nomes e buscar detalhes sob demanda |
| A6 | URLs fixas: `API_BASE_URL = http://localhost:8000/api` no frontend e CORS só para `localhost:5173`. Não há variáveis de ambiente (`VITE_API_URL`) |

## 5.4 Desempenho e robustez

| # | Observação |
|---|---|
| P1 | Um processo do Stockfish é aberto e fechado a cada requisição. Em uma partida de 40 lances (treino ou PGN) são ~80 processos de análise e ~160 buscas de profundidade 20; no treino somam-se ~40 processos de `/engine-move`, com até 3 processos simultâneos |
| P2 | Cada `/engine-analysis` faz duas buscas (antes e depois). Como agora os lances dos dois lados são analisados (desde `2247f0c`, também durante o treino), a posição "depois" do meio-lance N é sempre a mesma "antes" do meio-lance N+1, e a busca "antes" da análise do lance do motor repete a que o `/engine-move` acabou de fazer na mesma posição. Um cache por FEN no backend reduziria quase pela metade o custo |
| P3 | Promoção sempre vira dama (`promotion: 'q'`), sem opção de subpromoção |
| P4 | Se uma análise falhar durante a partida, ela é logada no console e reprocessada uma vez no fim (`analyseMoves` só enfileira lances sem análise). Se falhar de novo, o relatório considera só os lances analisados (mostra "X de Y lances analisados") |
| P5 | Não há timeout explícito na busca do motor além da profundidade; o timeout da LLM é 60 s |

## 5.5 Segurança (contexto local)

- A chave de API passa pelo backend em cada requisição e não é persistida nem logada no servidor; no navegador fica em `sessionStorage`. Adequado para uso local; em deploy público exigiria HTTPS e cuidado com logs de requisição.
- `base_url` é livre: o backend fará requisições para qualquer URL informada pelo usuário (SSRF), irrelevante em uso local, relevante se o backend for exposto.
