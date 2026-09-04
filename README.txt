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

O modo `files` usa três subpastas dentro de `input`:

- input/fen/: arquivos com posições no formato FEN, uma por arquivo.
- input/move/: arquivos com lances do usuário no formato UCI, um por arquivo.
- input/prompt/: arquivos com instruções para o treinador, uma por arquivo.

Os nomes dos arquivos podem ser quaisquer. Os arquivos das três pastas serão processados em ordem alfanumérica pelo nome.

3. Modo padrão: entrada e saída pelo terminal
-----------------------------

Ao executar sem argumentos, o programa solicita a FEN, o lance UCI e o prompt pelo terminal:

    python chess_trainer_system_poc.py

Esse modo também pode ser selecionado explicitamente:

    python chess_trainer_system_poc.py --mode interactive

O resultado é exibido no terminal e copiado para a área de transferência.

4. Modo alternativo: arquivos de entrada e saída
-------------------

Para ler os parâmetros de `input/` e salvar a análise em `output/analysis.txt`:

    python chess_trainer_system_poc.py --mode files

O modo `files` conta os arquivos de `fen/`. Essa quantidade define o número de execuções. Antes de começar, ele verifica se as três pastas possuem exatamente a mesma quantidade de arquivos. Caso contrário, exibe um erro e não inicia nenhuma análise.

Os arquivos são pareados pela ordem alfanumérica: o primeiro arquivo de `fen/` é usado com o primeiro de `move/` e o primeiro de `prompt/`, e assim por diante. Por exemplo, com três arquivos em cada pasta, serão feitas três execuções. Cada resultado é salvo separadamente como `output/analysis_001.txt`, `output/analysis_002.txt` e `output/analysis_003.txt`.

Use `--once` para executar somente a primeira análise:

    python chess_trainer_system_poc.py --mode interactive --once

5. Usar outro arquivo de saída
-----------------------

Você pode informar outro arquivo-base de saída pela linha de comando:

    python chess_trainer_system_poc.py --mode files --output-file output/minha_analise.txt

6. Arquivo de saída padrão
-------------------

Por padrão, o resultado é salvo em:

    output/analysis.txt

Para salvar em outro arquivo, use `--output-file`:

    python chess_trainer_system_poc.py --output-file output/resultado.txt

7. Configuração do Stockfish
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
