# 03 — Fluxos

## 3.1 Navegação entre telas

```mermaid
stateDiagram-v2
    [*] --> home
    home --> color_selection: Novo jogo
    home --> pgn_loader: Carregar PGN
    pgn_loader --> home: Voltar
    pgn_loader --> color_selection: PGN válido
    color_selection --> home: Cancelar
    color_selection --> game_training: cor escolhida (sem PGN)
    color_selection --> game_review: cor escolhida (com PGN)
    game_training --> color_selection: Novo jogo
    game_review --> color_selection: Novo jogo
    game_training --> home: logo
    game_review --> home: logo
    home --> repertoire_picker: Aprender repertório
    repertoire_picker --> home: fechar
    repertoire_picker --> repertoire: Começar treino (abertura + cor)
    repertoire --> repertoire_picker: Trocar abertura
    repertoire --> home: logo

    state "game (mode=training)" as game_training
    state "game (mode=review)" as game_review
```

## 3.2 Ciclo de vida da partida de treino

```mermaid
stateDiagram-v2
    [*] --> EmAndamento
    state EmAndamento {
        [*] --> VezDoUsuario
        VezDoUsuario --> MotorPensando: onDrop válido<br/>(+ análise do lance em 2º plano)
        MotorPensando --> VezDoUsuario: /engine-move<br/>(+ análise do lance do motor em 2º plano)
    }
    EmAndamento --> Encerrada: isGameOver() ou Encerrar partida
    state Encerrada {
        [*] --> AguardandoAnalises: Promise.allSettled(pendentes)
        AguardandoAnalises --> ReanalisandoFalhas: lances do usuário sem análise
        ReanalisandoFalhas --> CalculandoEstatisticas: /game-stats
        ReanalisandoFalhas --> ReanalisandoOponente: em paralelo, só falhas
        CalculandoEstatisticas --> EstatisticasNaTela
        EstatisticasNaTela --> GerandoNarrativa: /game-report
        GerandoNarrativa --> RelatorioCompleto
        GerandoNarrativa --> ErroNarrativa: LLM falhou / sem chave
        ErroNarrativa --> GerandoNarrativa: Gerar novamente
    }
```

Depois de encerrada, a partida aceita navegação no histórico e pedidos de explicação de lance (seção 3.6) a qualquer momento.

## 3.3 Novo jogo: um lance do usuário

Duas requisições independentes partem a cada lance do usuário: a resposta do motor (bloqueia o turno) e a classificação (segundo plano, não aparece na tela até o fim). Quando o lance do motor chega, ele também é classificado em segundo plano. As promessas pendentes ficam em `pendingAnalysesRef` (`analyseInBackground`) para o fim da partida esperar por elas.

```mermaid
sequenceDiagram
    autonumber
    actor U as Jogador
    participant GB as GameBoard
    participant API as FastAPI
    participant ES as engine_service
    participant SF as Stockfish

    U->>GB: arrasta peça (onDrop)
    GB->>GB: chess.js valida e aplica lance
    GB->>GB: recordMove (histórico)

    par Resposta do motor
        GB->>API: POST /engine-move {fen depois, training:true}
        API->>ES: get_engine_move
        ES->>SF: analyse(MultiPV=3, depth=20)
        SF-->>ES: 3 candidatos
        alt lance ≤ 12 e melhor lance > 70% Win%
            ES->>ES: choose_lenient_move (grace)
        else
            ES->>ES: choose_varied_move (sorteio entre quase-iguais)
        end
        ES-->>API: (uci, grace_applied)
        API-->>GB: {engine_move, grace_applied}
        GB->>GB: aplica lance; se grace, guarda ply em lenient_plies
        GB-->>U: tabuleiro atualizado
        GB-)API: POST /engine-analysis (lance do motor, 2º plano)
    and Classificação em segundo plano
        GB->>API: POST /engine-analysis {fen antes, move}
        API->>ES: get_move_analysis
        ES->>SF: analyse(posição antes)
        ES->>SF: analyse(posição depois)
        ES->>ES: cp → Win% → delta → classificação
        API-->>GB: MoveAnalysis
        GB->>GB: guarda em analysisByPly e no histórico (badge oculto)
    end
```

## 3.4 Fim da partida e relatório

```mermaid
sequenceDiagram
    autonumber
    participant GB as GameBoard
    participant API as FastAPI
    participant RS as report_service
    participant OS as openings_service
    participant LS as llm_service
    participant LLM as Provedor LLM

    GB->>GB: finishGame(termination)
    GB->>GB: aguarda análises pendentes (pendingAnalysesRef)
    GB->>API: analyseMoves(usuário) — reanalisa só os que falharam
    GB-)API: analyseMoves(oponente) — idem, em segundo plano (2 workers)

    Note over GB,OS: Etapa 1 — estatísticas (rápida, sem LLM)
    GB->>API: POST /game-stats {moves do usuário, pgn, total_user_moves}
    API->>RS: compute_game_stats(moves)
    RS->>RS: precisão, fases, error_tags, momentos-chave
    API->>OS: identify_opening(pgn, cor)
    OS->>OS: load_openings() (já pré-carregado na inicialização)
    API-->>GB: {stats}
    GB-->>GB: GameReport mostra estatísticas e badges
    GB->>GB: guarda ReportContext (stats, result, pgn, lenient_plies...)

    Note over GB,LLM: Etapa 2 — narrativa do treinador
    GB->>API: POST /game-report {stats, result, termination, pgn, lenient_plies, imported, BYOK}
    API->>LS: generate_game_report(stats, ...)
    LS->>RS: generate_report_prompt(stats)
    alt provider = "prompt"
        LS-->>API: prompt formatado
    else provedor LLM
        LS->>LLM: chat.completions(system + prompt)
        LLM-->>LS: Markdown
    end
    alt sucesso
        API-->>GB: {report}
    else sem chave / stats incompleto
        API-->>GB: HTTP 400 {detail}
    else erro do provedor
        API-->>GB: HTTP 502 {detail}
    end
    GB-->>GB: coach = {text} ou {error} + botões Configurar LLM / Gerar novamente
```

"Gerar novamente" reenvia apenas a etapa 2 a partir do `ReportContext` guardado; as estatísticas não são recalculadas.

## 3.5 Carregar PGN

```mermaid
sequenceDiagram
    autonumber
    actor U as Jogador
    participant LP as LoadPGNPage
    participant App
    participant CS as ColorSelector
    participant GB as GameBoard (review)
    participant API as FastAPI

    U->>LP: cola texto ou envia arquivo
    LP->>LP: chess.js loadPgn (validação)
    LP->>App: onPGNLoaded(pgn)
    App->>CS: "Com quais peças você jogou?"
    U->>CS: escolhe lado
    CS->>App: onSelectColor
    App->>App: reconstrói MoveRow[] e cria Chess
    App->>GB: mode=review, gameFinished=true
    loop lances do usuário (fila, 2 workers)
        GB->>API: POST /engine-analysis
        API-->>GB: MoveAnalysis
        GB-->>U: "Analisando seus lances: X de Y"
    end
    GB-)API: lances do oponente em segundo plano
    GB->>API: POST /game-stats {moves do usuário, pgn}
    API-->>GB: {stats}
    GB->>API: POST /game-report {stats, imported:true, result do cabeçalho}
    API-->>GB: {report}
```

## 3.6 Explicação de um lance

```mermaid
sequenceDiagram
    autonumber
    actor U as Jogador
    participant GB as GameBoard
    participant API as FastAPI
    participant LS as llm_service
    participant LLM as Provedor LLM

    U->>GB: clica num lance do histórico
    GB->>GB: modo revisão, destaca lance
    U->>GB: "Avaliar lance selecionado"
    GB->>GB: monta move_analysis a partir do MoveDetail<br/>mover = user | opponent
    GB->>API: POST /move-evaluation {move_analysis, mover, BYOK}
    API->>LS: generate_move_evaluation
    LS->>LS: generate_prompt (instrução varia por mover)
    LS->>LLM: chat.completions
    LLM-->>LS: explicação
    API-->>GB: {evaluation}
    GB-->>U: Markdown no painel "Análise por lance"
```

## 3.7 Drill de repertório: lance do usuário

Tudo roda no navegador sobre a árvore carregada uma vez (`GET /api/repertoire/tree`); o backend só é chamado para avaliar um lance fora da teoria.

```mermaid
sequenceDiagram
    autonumber
    actor U as Jogador
    participant RT as RepertoireTrainer
    participant D as drill.ts
    participant API as FastAPI

    RT->>D: pickOpponentMove(nó, linhas concluídas)
    D-->>RT: resposta teórica (ponderada, prioriza linhas novas)
    U->>RT: arrasta peça
    RT->>D: classifyUserMove(nó, uci)
    alt lance teórico
        D-->>RT: theory + nó filho
        RT->>RT: avança; se fim de linha → line-complete
    else fora da teoria
        D-->>RT: off-book
        RT-->>U: modal "Sair da teoria?" + lances teóricos
        RT-)API: POST /engine-analysis (avaliação do lance)
        API-->>RT: classificação e avaliações
        alt Não
            U->>RT: seguir a teoria
            RT->>RT: desfaz, registra erro, dica (peça) → seta (lance)
        else Sim
            U->>RT: sair da teoria
            RT->>RT: mantém lance, registra desvio → playout
        end
    end
```

Depois da teoria (Sim no modal ou "Jogar a partir daqui" no fim da linha), a partida continua contra o Stockfish:

```mermaid
sequenceDiagram
    autonumber
    actor U as Jogador
    participant RT as RepertoireTrainer
    participant API as FastAPI

    opt vez do motor
        RT->>API: POST /engine-move {fen, training:true}
        API-->>RT: lance do Stockfish
    end
    loop até fim de jogo ou "Encerrar partida"
        U->>RT: lance
        RT-)API: POST /engine-analysis (2º plano)
        RT->>API: POST /engine-move
        API-->>RT: resposta
    end
    RT->>RT: aguarda análises pendentes
    RT->>API: POST /game-stats {lances do usuário fora da teoria, pgn}
    API-->>RT: precisão + contagens
```

## 3.8 Decisão do lance do motor

```mermaid
flowchart TD
    A["POST /engine-move"] --> B{"training?"}
    B -- não --> P["engine.play depth 20<br/>(lance mais forte)"]
    B -- sim --> C["analyse MultiPV=3, depth 20"]
    C --> D{"lance ≤ 12?"}
    D -- não --> V
    D -- sim --> E{"Win% do melhor lance > 70?"}
    E -- não --> V
    E -- sim --> F["candidatos com Win% ≥ 50"]
    F --> G{"algum ≤ 70?"}
    G -- sim --> H["joga o mais forte ≤ 70<br/>grace_applied = true"]
    G -- não --> I["joga o mais fraco dos sólidos<br/>grace_applied = true"]
    V{"melhor é mate a favor?"} -- sim --> M["joga o mate"]
    V -- não --> W["sorteia entre candidatos a até<br/>3,0 p.p. (lance ≤ 10) ou 1,5 p.p. do melhor"]
```

> Detalhe: se o lance leniente escolhido coincidir com o melhor, `grace_applied` fica `false` e o fluxo segue para a variedade.
