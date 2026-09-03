import React, { useState, useRef } from "react";
import { Chess } from "chess.js";
import type { Square } from "chess.js";
import { Chessboard } from "react-chessboard";

const API_BASE_URL = "http://localhost:8000/api";

type PlayerColor = "white" | "black";

interface MoveRow {
    turnNumber: number;
    white: string;
    black: string;
}

interface EngineMoveResponse {
    engine_move_uci?: string;
}

interface AnalysisResponse {
    prompt?: string;
}

export default function ChessTrainerSystem(): React.ReactElement {
    const [game, setGame] = useState<Chess>(new Chess());
    const [userColor, setUserColor] = useState<PlayerColor | null>(null);
    const [moveHistory, setMoveHistory] = useState<MoveRow[]>([]);
    const [analysis, setAnalysis] = useState<string>("");
    const [loadingAnalysis, setLoadingAnalysis] = useState<boolean>(false);
    const [isEngineThinking, setIsEngineThinking] = useState<boolean>(false);

    const gameRef = useRef<Chess>(game);
    gameRef.current = game;

    const startGame = (choice: "white" | "black" | "random") => {
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

        if (selectedColor === "black") {
            requestEngineMove(newGame.fen());
        }
    };

    const requestEngineMove = async (currentFen: string): Promise<void> => {
        setIsEngineThinking(true);
        try {
            const response = await fetch(`${API_BASE_URL}/engine-move`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fen: currentFen })
            });
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
                    updateMoveHistory(move.san);
                }
            }
        } catch (err) {
            console.error("Engine error:", err);
        } finally {
            setIsEngineThinking(false);
        }
    };

    const updateMoveHistory = (newMoveSan: string): void => {
        setMoveHistory((prev) => {
            const nextHistory = [...prev];
            const lastRow = nextHistory[nextHistory.length - 1];

            if (!lastRow || (lastRow.white && lastRow.black)) {
                nextHistory.push({
                    turnNumber: nextHistory.length + 1,
                    white: newMoveSan,
                    black: ""
                });
            } else {
                nextHistory[nextHistory.length - 1] = {
                    ...lastRow,
                    black: newMoveSan
                };
            }

            return nextHistory;
        });
    };

    const onDrop = (sourceSquare: Square, targetSquare: Square): boolean => {
        const currentTurn: PlayerColor = game.turn() === "w" ? "white" : "black";
        if (currentTurn !== userColor || isEngineThinking || game.isGameOver()) {
            return false;
        }

        try {
            const gameCopy = new Chess(game.fen());
            const move = gameCopy.move({
                from: sourceSquare,
                to: targetSquare,
                promotion: "q"
            });

            if (!move) return false;

            setGame(gameCopy);
            updateMoveHistory(move.san);

            if (!gameCopy.isGameOver()) {
                requestEngineMove(gameCopy.fen());
            }
            return true;
        } catch {
            return false;
        }
    };

    const handleRequestAnalysis = async (): Promise<void> => {
        setLoadingAnalysis(true);
        try {
            const response = await fetch(`${API_BASE_URL}/analyze-move`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fen: game.fen(),
                    prompt: "The user want to uderstand the engine evaluation of this position, explain like a coach. If possible suggest theorical lines."
                })
            });
            const data: AnalysisResponse = await response.json();
            setAnalysis(data.prompt || "");
        } catch (err) {
            console.error("Analysis fail:", err);
            setAnalysis("Analysis fail");
        } finally {
            setLoadingAnalysis(false);
        }
    };

    return (
        <div style={{ padding: "20px", fontFamily: "sans-serif" }}>
            <div style={{ marginBottom: "20px", display: "flex", gap: "10px", alignItems: "center" }}>
                <strong>Play with:</strong>
                <button onClick={() => startGame("white")}>White</button>
                <button onClick={() => startGame("black")}>Black</button>
                <button onClick={() => startGame("random")}>Random</button>
                {userColor ? <span style={{ marginLeft: "15px" }}>Color : <b>{userColor}</b></span> : <span style={{ marginLeft: "15px" }}> Select a color to start a game</span>}
            </div>

            <div style={{ display: "flex", gap: "25px", alignItems: "flex-start" }}>
                {/* Histórico */}
                <div style={{
                    width: "220px",
                    height: "480px",
                    border: "1px solid #ccc",
                    borderRadius: "6px",
                    padding: "10px",
                    overflowY: "auto",
                    backgroundColor: "#f9f9f9"
                }}>
                    <h4 style={{ margin: "0 0 10px 0", borderBottom: "1px solid #ddd", paddingBottom: "5px" }}>
                        Moves
                    </h4>
                    <table style={{ width: "100%", fontSize: "14px", borderCollapse: "collapse" }}>
                        <tbody>
                            {moveHistory.map((item) => (
                                <tr key={item.turnNumber} style={{ lineHeight: "24px" }}>
                                    <td style={{ color: "#888", width: "30px" }}>{item.turnNumber}.</td>
                                    <td style={{ width: "80px", fontWeight: "bold" }}>{item.white}</td>
                                    <td style={{ width: "80px", fontWeight: "bold" }}>{item.black}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Tabuleiro */}
                <div style={{ width: "480px" }}>
                    <Chessboard
                        options={{
                            position: game.fen(),
                            boardOrientation: userColor || "white",
                            onPieceDrop: ({ sourceSquare, targetSquare }) => {
                                return onDrop(sourceSquare as Square, targetSquare as Square);
                            }
                        }}
                    />
                    {isEngineThinking && <p style={{ textAlign: "center", color: "#666" }}>Engine thinking...</p>}
                </div>

                {/* Análise */}
                <div style={{
                    flex: 1,
                    minWidth: "300px",
                    maxWidth: "420px",
                    height: "480px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px"
                }}>
                    <button
                        onClick={handleRequestAnalysis}
                        disabled={loadingAnalysis || !userColor}
                        style={{
                            padding: "10px",
                            backgroundColor: "#2e7d32",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: userColor ? "pointer" : "not-allowed"
                        }}
                    >
                        {loadingAnalysis ? "Processing with Stockfish..." : "Request Analysis"}
                    </button>

                    <div style={{
                        flex: 1,
                        backgroundColor: "#222",
                        color: "#eee",
                        padding: "12px",
                        borderRadius: "6px",
                        overflowY: "auto",
                        fontSize: "13px",
                        whiteSpace: "pre-wrap",
                        fontFamily: "monospace"
                    }}>
                        {analysis || "Click on Request Analysis"}
                    </div>
                </div>
            </div>
        </div>
    );
}