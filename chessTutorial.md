# ♟️ Guia de Recursos e Referências: Sistema Treinador de Xadrez

## 📌 Notações e Padrões de Xadrez

* **[FEN (Forsyth-Edwards Notation)](https://en.wikipedia.org/wiki/Forsyth%E2%80%93Edwards_Notation)**
  * *Descrição:* Padrão textual conciso de uma única linha para registrar o estado exato de qualquer posição no tabuleiro (disposição das peças, vez de jogar, direitos de roque, casa de captura *en passant* e contadores de lances).
  
* **[PGN (Portable Game Notation)](https://en.wikipedia.org/wiki/Portable_Game_Notation)**
  * *Descrição:* Formato legível por humanos e computadores para registrar sequências completas de lances, variantes, comentários e metadados de partidas (evento, data, jogadores, resultado).

* **[UCI Protocol (Universal Chess Interface)](https://www.chessprogramming.org/UCI)**
  * *Descrição:* Protocolo de comunicação aberto e textual que padroniza o envio de comandos e o recebimento de análises entre interfaces gráficas/back-ends e engines de xadrez (como Stockfish).

---

## 🛠️ Bibliotecas e Ferramentas

* **[python-chess](https://python-chess.readthedocs.io/)**
  * *Descrição:* Biblioteca essencial em Python para manipulação do estado do jogo, validação de regras, geração de lances legais, leitura/escrita de arquivos FEN e PGN, e integração via subprocessos com engines UCI.

* **[Chessboard.js](https://chessboardjs.com/)**
  * *Descrição:* Biblioteca JavaScript leve e responsiva para renderização e controle interativo do tabuleiro de xadrez no front-end.

* **[Stockfish Engine](https://stockfishchess.org/)**
  * *Descrição:* Engine de xadrez *open-source* de alto desempenho utilizada para avaliar quantitativamente posições (pontuação em centipawns/mate) e calcular as melhores linhas táticas (PV - *Principal Variation*).
  * *instalar:* sudo apt install stockfish
  * [Using Stockfish in your own project ](https://official-stockfish.github.io/docs/stockfish-wiki/Developers.html#using-stockfish-in-your-own-project)

---

## 📊 Datasets e Bases Teóricas

* **[Lichess Open Database](https://database.lichess.org/)**
  * *Descrição:* Repositório público com bilhões de partidas avaliadas, bases de dados de puzzles classificados por temas táticos e dados estatísticos abertos.

* **[ChessEval Dataset (Hugging Face)](https://huggingface.co/datasets)**
  * *Descrição:* Coleções de posições avaliadas por engines e anotadas semanticamente, úteis para calibrar e fornecer contexto estruturado aos prompts do LLM.

* **[Chess Openings & ECO Codes (365Chess)](https://www.365chess.com/eco.php)**
  * *Descrição:* Catálogo estruturado da Enciclopédia de Aberturas de Xadrez (ECO), útil para mapear linhas teóricas e nomear aberturas jogadas nas partidas de treino.