import React from "react";

interface HomePageProps {
  onNewGame: () => void;
  onLoadGame: () => void;
}

export default function HomePage({ onNewGame, onLoadGame }: HomePageProps): React.ReactElement {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      fontFamily: "system-ui, -apple-system, sans-serif"
    }}>
      <div style={{
        textAlign: "center",
        color: "white",
        marginBottom: "60px"
      }}>
        <h1 style={{
          fontSize: "4rem",
          margin: "0 0 10px 0",
          fontWeight: "700",
          textShadow: "2px 2px 4px rgba(0,0,0,0.3)"
        }}>
          ♟️ Chess Trainer
        </h1>
        <p style={{
          fontSize: "1.3rem",
          opacity: 0.9,
          margin: 0
        }}>
          Treine xadrez com feedback inteligente
        </p>
      </div>

      <div style={{
        display: "flex",
        gap: "30px",
        flexWrap: "wrap",
        justifyContent: "center"
      }}>
        <button
          onClick={onNewGame}
          style={{
            padding: "30px 50px",
            fontSize: "1.5rem",
            fontWeight: "600",
            color: "white",
            background: "linear-gradient(135deg, #11998e 0%, #38ef7d 100%)",
            border: "none",
            borderRadius: "15px",
            cursor: "pointer",
            boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
            transition: "transform 0.2s, box-shadow 0.2s",
            minWidth: "250px"
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-5px)";
            e.currentTarget.style.boxShadow = "0 15px 40px rgba(0,0,0,0.4)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = "0 10px 30px rgba(0,0,0,0.3)";
          }}
        >
          🎮 Nova Partida
        </button>

        <button
          onClick={onLoadGame}
          style={{
            padding: "30px 50px",
            fontSize: "1.5rem",
            fontWeight: "600",
            color: "white",
            background: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
            border: "none",
            borderRadius: "15px",
            cursor: "pointer",
            boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
            transition: "transform 0.2s, box-shadow 0.2s",
            minWidth: "250px"
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-5px)";
            e.currentTarget.style.boxShadow = "0 15px 40px rgba(0,0,0,0.4)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = "0 10px 30px rgba(0,0,0,0.3)";
          }}
        >
          📂 Carregar Partida
        </button>
      </div>
    </div>
  );
}
