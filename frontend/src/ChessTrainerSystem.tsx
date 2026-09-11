import React, { useState, useRef } from "react";
import { Chess } from "chess.js";
import type { Square } from "chess.js";
import { Chessboard } from "react-chessboard";

const API_BASE_URL = "http://localhost:8000/api";

type PlayerColor = "white" | "black";

export type MoveClassification =
  | "Great Move (!)"
  | "Best Move"
  | "Inaccuracy"
  | "Mistake"
  | "Blunder";

export interface MoveDetail {
  san: string;
  classification?: MoveClassification;
}

export interface MoveRow {
  turnNumber: number;
  white: MoveDetail;
  black?: MoveDetail;
}

interface EngineMoveResponse {
  engine_move_uci?: string;
}

interface ClassificationResponse {
  move: string;
  classification: MoveClassification;
  win_percent_loss: number;
}

interface AnalysisResponse {
  prompt?: string;
}

// Visual configuration for evaluation badges
const BADGE_STYLES: Record<
  MoveClassification,
  { symbol: string; bg: string; color: string }
> = {
  "Great Move (!)": { symbol: "!", bg: "#5c8bb0", color: "#ffffff" },
  "Best Move":       { symbol: "★", bg: "#95bb4a", color: "#ffffff" },
  "Inaccuracy":      { symbol: "?!", bg: "#f0c15c", color: "#222222" },
  "Mistake":         { symbol: "?", bg: "#e58f2a", color: "#ffffff" },
  "Blunder":         { symbol: "??", bg: "#ca3431", color: "#ffffff" }
};

const MoveBadge: React.FC<{ classification?: MoveClassification }> = ({
  classification
}) => {
  if (!classification) return null;
  const config = BADGE_STYLES[classification];

  return (
    <span
      title={classification}
      style={{
        marginLeft: "6px",
        padding: "1px 5px",
        borderRadius: "4px",
        fontSize: "11px",
        fontWeight: "bold",
        backgroundColor: config.bg,
        color: config.color,
        display: "inline-block"
      }}
    >
      {config.symbol}
    </span>
  );
};

export default function ChessTrainerSystem(): React.ReactElement {
  const [game, setGame] = useState<Chess>(new Chess());
  const [userColor, setUserColor] = useState<PlayerColor | null>(null);
  const [moveHistory, setMoveHistory] = useState<MoveRow[]>([]);
  const [analysis, setAnalysis] = useState<string>("");
  const [loadingAnalysis, setLoadingAnalysis] = useState<boolean>(false);
  const [isEngineThinking, setIsEngineThinking] = useState<boolean>(false);

  // Synchronous reference to track the latest board state across async operations
  const gameRef = useRef<Chess>(game);
  gameRef.current = game;

  // Resets game state and starts a new session
  const startGame = (choice: "white" | "black" | "random"): void => {
    let selectedColor: PlayerColor;
    if (choice === "random") {
      selectedColor = Math.random() < 0.5 ? "white" : "black";
    } else {
      selectedColor = choice;
    }

    const newGame = new Chess();
    setGame(newGame);
    setUserColor(selectedColor);
    setMoveHistory([]);
    setAnalysis("");

    // If the player chooses black, let the engine play the first white move
    if (selectedColor === "black") {
      requestEngineMove(newGame.fen());
    }
  };

  // Synchronously computes turnNumber and appends a new move in standard algebraic notation (SAN)
  const recordMove = (san: string): { turnNumber: number; isWhite: boolean } => {
    const lastRow = moveHistory[moveHistory.length - 1];
    const isNewTurn = !lastRow || Boolean(lastRow.white && lastRow.black);

    const turnNumber = isNewTurn ? moveHistory.length + 1 : lastRow.turnNumber;
    const isWhite = isNewTurn;

    setMoveHistory((prev) => {
      const nextHistory = [...prev];
      const row = nextHistory[nextHistory.length - 1];

      if (!row || (row.white && row.black)) {
        nextHistory.push({
          turnNumber: nextHistory.length + 1,
          white: { san }
        });
      } else {
        nextHistory[nextHistory.length - 1] = {
          ...row,
          black: { san }
        };
      }
      return nextHistory;
    });

    return { turnNumber, isWhite };
  };

  // Mutates the target move entry in the history state by searching for matching turnNumber
  const attachClassification = (
    turnNumber: number,
    isWhite: boolean,
    classification: MoveClassification
  ): void => {
    setMoveHistory((prev) =>
      prev.map((row) => {
        if (row.turnNumber !== turnNumber) return row;

        if (isWhite) {
          return {
            ...row,
            white: { ...row.white, classification }
          };
        } else if (row.black) {
          return {
            ...row,
            black: { ...row.black, classification }
          };
        }
        return row;
      })
    );
  };

  // Asynchronously requests Stockfish to evaluate and classify a player move
  const requestClassification = async (
    fenBefore: string,
    moveUci: string,
    turnNumber: number,
    isWhite: boolean
  ): Promise<void> => {
    try {
      const response = await fetch(`${API_BASE_URL}/evaluate-move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fen: fenBefore,
          move_uci: moveUci
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const data: ClassificationResponse = await response.json();

      if (data.classification) {
        attachClassification(turnNumber, isWhite, data.classification);
      }
    } catch (err) {
      console.error("Classification error:", err);
    }
  };

  // Asynchronously requests the engine's countermove from the backend
  const requestEngineMove = async (currentFen: string): Promise<void> => {
    setIsEngineThinking(true);
    try {
      const response = await fetch(`${API_BASE_URL}/engine-move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fen: currentFen })
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const data: EngineMoveResponse = await response.json();

      if (data.engine_move_uci) {
        const gameCopy = new Chess(gameRef.current.fen());
        const move = gameCopy.move({
          from: data.engine_move_uci.slice(0, 2) as Square,
          to: data.engine_move_uci.slice(2, 4) as Square,
          promotion: (data.engine_move_uci[4] || "q") as "n" | "b" | "r" | "q"
        });

        if (move) {
          setGame(gameCopy);
          recordMove(move.san);
        }
      }
    } catch (err) {
      console.error("Engine move error:", err);
    } finally {
      setIsEngineThinking(false);
    }
  };

  // Handles drag-and-drop actions on the board
  const onDrop = (sourceSquare: Square, targetSquare: Square): boolean => {
    const currentTurn: PlayerColor = game.turn() === "w" ? "white" : "black";
    if (currentTurn !== userColor || isEngineThinking || game.isGameOver()) {
      return false;
    }

    // Capture board snapshot and side prior to executing the move
    const fenBefore = game.fen();
    const isWhite = game.turn() === "w";

    try {
      const gameCopy = new Chess(game.fen());
      const move = gameCopy.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: "q"
      });

      if (!move) return false;

      // Update board state
      setGame(gameCopy);

      // Synchronously compute stable turnNumber and register notation
      const { turnNumber } = recordMove(move.san);

      // Dispatch classification request using the exact turnNumber
      const moveUci = `${sourceSquare}${targetSquare}${move.promotion || ""}`;
      requestClassification(fenBefore, moveUci, turnNumber, isWhite);

      // Trigger engine response if game is ongoing
      if (!gameCopy.isGameOver()) {
        requestEngineMove(gameCopy.fen());
      }

      return true;
    } catch (err) {
      console.error("Invalid move attempt:", err);
      return false;
    }
  };

  // Requests coach-level prompt generation from the backend
  const handleRequestAnalysis = async (): Promise<void> => {
    setLoadingAnalysis(true);
    try {
      const response = await fetch(`${API_BASE_URL}/analyze-move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fen: game.fen(),
          prompt:
            "The user wants to understand the engine evaluation of this position. Explain like a coach. If possible, suggest theoretical lines."
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const data: AnalysisResponse = await response.json();
      setAnalysis(data.prompt || "No analysis returned.");
    } catch (err) {
      console.error("Analysis request failure:", err);
      setAnalysis("Analysis request failed. Check your server connection.");
    } finally {
      setLoadingAnalysis(false);
    }
  };

  return (
    <div style={{ padding: "20px", fontFamily: "sans-serif" }}>
      {/* Top Controls: Player Color Selection */}
      <div
        style={{
          marginBottom: "20px",
          display: "flex",
          gap: "10px",
          alignItems: "center"
        }}
      >
        <strong>Play with:</strong>
        <button onClick={() => startGame("white")}>White</button>
        <button onClick={() => startGame("black")}>Black</button>
        <button onClick={() => startGame("random")}>Random</button>
        {userColor ? (
          <span style={{ marginLeft: "15px" }}>
            Playing as: <b>{userColor}</b>
          </span>
        ) : (
          <span style={{ marginLeft: "15px", color: "#666" }}>
            Select a color to start a game
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: "25px", alignItems: "flex-start" }}>
        {/* Left Container: Move History Table */}
        <div
          style={{
            width: "240px",
            height: "480px",
            border: "1px solid #ccc",
            borderRadius: "6px",
            padding: "10px",
            overflowY: "auto",
            backgroundColor: "#f9f9f9"
          }}
        >
          <h4
            style={{
              margin: "0 0 10px 0",
              borderBottom: "1px solid #ddd",
              paddingBottom: "5px"
            }}
          >
            Moves
          </h4>
          <table
            style={{
              width: "100%",
              fontSize: "14px",
              borderCollapse: "collapse"
            }}
          >
            <tbody>
              {moveHistory.map((item) => (
                <tr key={item.turnNumber} style={{ lineHeight: "26px" }}>
                  <td style={{ color: "#888", width: "25px" }}>
                    {item.turnNumber}.
                  </td>
                  <td style={{ width: "95px", fontWeight: "bold" }}>
                    <span>{item.white.san}</span>
                    <MoveBadge classification={item.white.classification} />
                  </td>
                  <td style={{ width: "95px", fontWeight: "bold" }}>
                    {item.black && (
                      <>
                        <span>{item.black.san}</span>
                        <MoveBadge classification={item.black.classification} />
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Center Container: Chessboard */}
        <div style={{ width: "480px" }}>
          <Chessboard
            options={{
              position: game.fen(),
              boardOrientation: userColor || "white",
              onPieceDrop: ({ sourceSquare, targetSquare }) => {
                if (!sourceSquare || !targetSquare) return false;
                return onDrop(sourceSquare as Square, targetSquare as Square);
              }
            }}
          />
          {isEngineThinking && (
            <p style={{ textAlign: "center", color: "#666", marginTop: "8px" }}>
              Engine thinking...
            </p>
          )}
        </div>

        {/* Right Container: Coach Analysis Output */}
        <div
          style={{
            flex: 1,
            minWidth: "300px",
            maxWidth: "420px",
            height: "480px",
            display: "flex",
            flexDirection: "column",
            gap: "10px"
          }}
        >
          <button
            onClick={handleRequestAnalysis}
            disabled={loadingAnalysis || !userColor}
            style={{
              padding: "10px",
              backgroundColor: userColor ? "#2e7d32" : "#999",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: userColor ? "pointer" : "not-allowed"
            }}
          >
            {loadingAnalysis ? "Processing with Stockfish..." : "Request Analysis"}
          </button>

          <div
            style={{
              flex: 1,
              backgroundColor: "#222",
              color: "#eee",
              padding: "12px",
              borderRadius: "6px",
              overflowY: "auto",
              fontSize: "13px",
              whiteSpace: "pre-wrap",
              fontFamily: "monospace"
            }}
          >
            {analysis || "Click 'Request Analysis' to inspect the current position."}
          </div>
        </div>
      </div>
    </div>
  );
}