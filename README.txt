GUIA RÁPIDO
===========

Este script analisa uma posição de xadrez antes e depois de um lance usando o Stockfish.

1. Ative a virtualenv
----------------------

No Git Bash:

    source /c/UNICAMP/2026-2/MC857A/chess-trainer-system/.venv/Scripts/activate

No PowerShell:

    .\.venv\Scripts\Activate.ps1

2. Preencha os arquivos de entrada
-----------------------------------

O script usa três arquivos dentro da pasta `input`:

- input/fen.txt: posição do tabuleiro no formato FEN, em uma única linha.
- input/move.txt: lance do usuário no formato UCI, por exemplo: a7a5.
- input/prompt.txt: instrução para o treinador de xadrez.

3. Execute o script
-------------------

Na pasta do projeto:

    python chess_trainer_system_poc.py

O script imprime a análise no terminal e copia o prompt completo para a área de transferência.

4. Usar outros arquivos
-----------------------

Você pode informar arquivos diferentes pela linha de comando:

    python chess_trainer_system_poc.py --fen-file input/minha_fen.txt --move-file input/meu_lance.txt --prompt-file input/meu_prompt.txt

5. Configuração do Stockfish
----------------------------

No Windows, o script procura automaticamente por:

    stockfish/stockfish-windows-x86-64-avx2.exe

Também é possível informar outro executável.

No Git Bash:

    export STOCKFISH_PATH="C:/caminho/para/stockfish.exe"
    python chess_trainer_system_poc.py

No PowerShell:

    $env:STOCKFISH_PATH = "C:\caminho\para\stockfish.exe"
    python .\chess_trainer_system_poc.py

Em Linux, o script também procura o executável em:

    /usr/games/stockfish
