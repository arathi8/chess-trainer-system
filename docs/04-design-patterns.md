# 04 — Design patterns

Padrões encontrados no código atual. Alguns são aplicados de forma explícita (com nome e intenção clara); outros aparecem de forma implícita ou parcial — isso está indicado na coluna **Grau**.

## 4.1 Padrões arquiteturais

| Padrão | Onde | Grau | Como aparece |
|---|---|---|---|
| **Cliente-servidor / SPA + API REST** | todo o sistema | explícito | SPA React consome API JSON do FastAPI; CORS restrito ao Vite |
| **Arquitetura em camadas** | backend | explícito | Rotas/DTOs (`server.py`) → serviços (`services/`) → infraestrutura (Stockfish, SDK OpenAI, TSV). As rotas não contêm regra de xadrez |
| **Backend sem estado (*stateless*)** | backend | explícito | Nenhuma sessão ou banco: o cliente envia FEN, análises acumuladas e credenciais em cada chamada. Facilita escalar e testar, mas joga a gestão de estado para o frontend |
| **Oráculo determinístico + narrador LLM** (*grounded generation*) | `engine_service`, `report_service`, `openings_service` → `llm_service` | explícito | Os fatos são calculados antes (motor, heurísticas, base de aberturas) e injetados no prompt com instrução para não inventar nada fora deles. É a mesma ideia do RAG: contexto estruturado recuperado/calculado + geração restrita a esse contexto |
| **Pipeline (*pipes and filters*)** em dois estágios | `POST /game-stats` → `POST /game-report` | explícito | `compute_game_stats` → `identify_opening` (estágio 1, devolvido ao cliente) → `generate_report_prompt` → `complete_prompt` (estágio 2); cada etapa recebe e enriquece um dicionário. O cliente transporta o resultado intermediário entre os estágios |
| **Renderização progressiva (resposta em duas fases)** | `/game-stats` + `/game-report`, estados `stats` e `coach` no frontend | explícito | A parte barata e determinística aparece primeiro; a parte lenta (LLM) chega depois e pode ser refeita isoladamente |
| **Núcleo funcional, casca imperativa** (*functional core, imperative shell*) | `report_service`, `openings_service`, `cp_to_win_percent`, `choose_*` | explícito | Funções puras sem I/O (testadas sem Stockfish); o I/O (processo do motor, HTTP da LLM) fica nas bordas (`get_move_analysis`, `LLMService.request`) |
| **Degradação graciosa** | `GameReport.tsx` | explícito | Falha da LLM não derruba o relatório: as estatísticas (vindas de outra requisição) continuam na tela e a UI oferece configurar/tentar de novo. Antes de `2ab6da0` isso era feito no backend com `report_error` em HTTP 200; agora é responsabilidade da UI |
| **Warm-up na inicialização** | `lifespan` + *thread* `openings-preload` | explícito | Trabalho caro e previsível (indexar aberturas) sai do caminho da primeira requisição e roda em segundo plano ao subir o servidor |

## 4.2 Padrões de projeto — backend

| Padrão (GoF ou afins) | Onde | Grau | Descrição |
|---|---|---|---|
| **Facade** | `generate_move_evaluation`, `generate_game_report`, `complete_prompt` ([llm_service.py](../backend/services/llm_service.py)); `get_move_analysis`, `get_engine_move` ([engine_service.py](../backend/services/engine_service.py)) | explícito | Uma chamada simples esconde a sequência: resolver provedor → montar prompt → instanciar cliente → chamar API; ou abrir processo UCI → analisar duas vezes → formatar → classificar |
| **Adapter / Gateway** | `LLMService` | explícito | Adapta provedores diferentes (Gemini hoje; qualquer outro compatível, como Ollama, só com configuração) a uma única interface (`request(prompt) -> str`) usando o protocolo comum da API OpenAI; troca de provedor = troca de `base_url`. `python-chess.engine` cumpre o mesmo papel para o protocolo UCI |
| **Strategy** | escolha do lance do motor (`engine.play` / `choose_lenient_move` / `choose_varied_move`); provedor LLM vs. "somente prompt"; instrução do prompt por `mover` | implícito | Algoritmos intercambiáveis selecionados em tempo de execução por flags (`training`, número do lance, `provider`, `mover`). Não há interface/classe por estratégia — a seleção é por `if` |
| **Registry / configuração por tabela** | `PROVIDER_DEFAULTS`, `TAG_DESCRIPTIONS`, constantes `GRACE_*`/`VARIETY_*` | explícito | Adicionar um provedor é adicionar uma entrada no dicionário; o catálogo exposto ao frontend (`get_provider_options`) é derivado dele |
| **Null Object (variante)** | provedor `prompt` (`format_prompt_only`) | explícito | Um "provedor" que não chama ninguém e devolve o próprio prompt, mantendo o mesmo contrato de resposta |
| **Builder (de prompt)** | `generate_prompt`, `generate_report_prompt`, `format_analysis_block`, `opening_lines` | implícito | O prompt é construído em partes (instrução, blocos de análise, estatísticas, abertura, momentos-chave, PGN) e montado no final |
| **DTO / Data Contract** | modelos Pydantic em [chess_trainer_system_server.py](../backend/chess_trainer_system_server.py) | explícito | Validação de entrada e formato de saída declarados; geram o Swagger em `/docs` |
| **Hierarquia de exceções + tradução de exceções** | `LLMError` ⊃ `LLMNotConfiguredError`; rotas | explícito | Erros de domínio são convertidos em HTTP na borda: `LLMNotConfiguredError`→400, `LLMError`→502, `ValueError` do motor→400, `KeyError` em `stats`→400, demais→500. `/move-evaluation` e `/game-report` seguem a mesma política |
| **Singleton thread-safe com inicialização única** | `load_openings` (`_openings` global + `threading.Lock`) | explícito | O TSV (~3,9 mil linhas) é indexado uma única vez; quem chega durante a construção espera no *lock* em vez de construir outra cópia. Substituiu o `@lru_cache` em `5ceeb35`, que não impedia duas construções simultâneas |
| **Árvore de prefixos (*trie*) / estrutura recursiva (*Composite*)** | `build_repertoire_tree` ([repertoire_service.py](../backend/services/repertoire_service.py)); DTO recursivo `RepertoireNode` | explícito | Linhas de abertura que compartilham o começo são fundidas num único caminho; cada nó tem a mesma forma que a raiz (`children: list[RepertoireNode]`), então o frontend percorre qualquer profundidade com o mesmo código |
| **Índice imutável tipado** | `OpeningsIndex` e `OpeningLine` (`NamedTuple`) em [openings_service.py](../backend/services/openings_service.py) | explícito | Um único parse do TSV alimenta vários consumidores (identificação de abertura e repertório) sem reler o arquivo; tuplas imutáveis são seguras para compartilhar entre *threads* |
| **Cadeia de fallback** (análoga a *Chain of Responsibility*) | `find_stockfish` | implícito | Tenta `STOCKFISH_PATH` → binários do projeto → `/usr/games` → `PATH`, parando no primeiro que existir |
| **Resource Acquisition / Context Manager** | `with SimpleEngine.popen_uci(...)` | explícito | Garante o encerramento do processo do Stockfish mesmo com exceção |
| **Injeção de dependência (pontual)** | `choose_varied_move(..., rng=None)` | explícito | O gerador aleatório pode ser injetado, tornando o sorteio testável de forma determinística |

## 4.3 Padrões de projeto — frontend

| Padrão | Onde | Grau | Descrição |
|---|---|---|---|
| **Máquina de estados finita (roteamento por estado)** | `screen` em [App.tsx](../frontend/src/App.tsx) | explícito | Tipo união `'home' \| 'pgn-loader' \| 'color-selection' \| 'game'` + renderização condicional no lugar de um roteador |
| **Container / Presentational** | `GameBoard` (container) vs. `GameReport`, `Modal`, `ColorSelector`, `LandingPage` (apresentação) | implícito | Componentes de apresentação recebem dados e callbacks por props; a lógica e o I/O estão concentrados no container |
| **Lifting state up + callbacks (inversão de controle)** | `llmConfig`, `userColor`, `onNewGame`, `onSelectColor`, `onPGNLoaded`… | explícito | Estado compartilhado vive no ancestral comum (`App`); filhos notificam por callbacks (comportamento de *Observer* via props) |
| **Composição (slot / *children*)** | `Modal` usado por `ColorSelector` e `LLMSettings` | explícito | Moldura comum, conteúdo injetado |
| **Atualização imutável / Prototype** | `cloneGame`, `setMoveHistory(prev => ...)` | explícito | O estado nunca é mutado: a partida é copiada (via PGN, para preservar o histórico) antes de aplicar o lance |
| **Ref para estado assíncrono ("latest ref")** | `gameRef`, `finishedRef`, `analysisByPlyRef`, `pendingAnalysesRef`, `lenientPliesRef`, `reportContextRef` | explícito | Valores lidos dentro de callbacks assíncronos ficam em `useRef` para evitar *stale closures*. Complemento: `requestEngineAnalysis(move)` deriva ply, número do lance e cor do próprio objeto `Move` do `chess.js`, em vez de depender de estado do React possivelmente desatualizado (correção de `2247f0c`) |
| **Fire-and-track** (disparar e rastrear promessas) | `analyseInBackground` + `pendingAnalysesRef` | explícito | Análises são disparadas sem bloquear o jogo, mas registradas num `Set` para que `finishGame` possa esperar por todas com `Promise.allSettled` |
| **Guarda de idempotência** | `gameStartedRef`, `autoAnalysisStartedRef` | explícito | Impede que o `StrictMode` (efeitos executados duas vezes em dev) dispare dois lances do motor ou duas análises |
| **Worker pool / produtor-consumidor com concorrência limitada** | `analyseMoves` (`IMPORT_ANALYSIS_CONCURRENCY = 2`) | explícito | Fila compartilhada consumida por N *workers* assíncronos, com callback de progresso. Só enfileira lances sem análise, por isso serve tanto para o PGN importado quanto para reprocessar falhas no fim do treino (*retry* idempotente) |
| **Tabelas de lookup para apresentação** | `BADGE_CONFIG`, `TAG_LABELS`, `PHASE_LABELS`, `COUNT_ROWS` | explícito | Mapeiam códigos do backend (em inglês) para rótulos e estilos em português |
| **Gateway de persistência** | `loadLLMConfig` / `saveLLMConfig` ([llmConfig.ts](../frontend/src/llmConfig.ts)) | explícito | Encapsula `sessionStorage` com tratamento de erro; o resto do app não sabe onde a configuração fica |
| **Configuração dirigida pelo servidor** (*server-driven UI*) | `fetchLLMProviders` → `LLMSettings` | explícito | O formulário (campos obrigatórios, placeholders, opção sem LLM) é montado a partir do catálogo enviado pelo backend |
| **Validação em duas camadas** | `chess.js` no cliente, `python-chess` no servidor | explícito | Feedback imediato no tabuleiro; o servidor revalida e não confia no cliente |

## 4.4 Onde os padrões poderiam evoluir

Sugestões para quando houver alterações nessas áreas (nenhuma foi aplicada):

- **Strategy explícita no motor** — transformar `normal`, `leniente` e `variado` em estratégias nomeadas facilitaria adicionar níveis de dificuldade ou modos de treino (ex.: "modo professor" que joga lances instrutivos).
- **Template Method / prompts versionados** — mover os textos dos prompts para templates separados do código facilita iterar no tom didático e trocar o idioma do relatório.
- **Custom hooks + camada de API no frontend** — extrair de `GameBoard` hooks como `useTrainingGame`, `useMoveAnalysis` e `useGameReport`, e um cliente `api.ts` tipado com uma função por endpoint.
- **Pool de processos do motor** — um *Object Pool* (ou instância única protegida por lock) de `SimpleEngine` evitaria abrir um processo do Stockfish por requisição.
