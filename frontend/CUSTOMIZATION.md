# Guia de Customização

Este guia mostra como personalizar o visual do Chess Trainer System.

## 🎨 Alterando a Paleta de Cores

Todas as cores estão definidas em variáveis CSS no arquivo `frontend/src/index.css`:

```css
:root { 
  --ink:#111311;        /* Fundo principal */
  --muted:#8e918c;      /* Texto secundário */
  --gold:#c99d52;       /* Acento primário */
  --gold-light:#e8c887; /* Acento secundário */
  --panel:#191c1a;      /* Fundo dos painéis */
  --panel-2:#202420;    /* Fundo secundário */
  --line:#303530;       /* Bordas */
  --cream:#f4f1e8;      /* Texto principal */
}
```

### Exemplos de Paletas Alternativas

#### Tema Azul Oceano
```css
:root { 
  --ink:#0a1628;
  --gold:#4a9eff;
  --gold-light:#7bb8ff;
  --panel:#0f1f3a;
  --cream:#e8f1ff;
}
```

#### Tema Roxo Místico
```css
:root { 
  --ink:#1a0d2e;
  --gold:#a855f7;
  --gold-light:#c084fc;
  --panel:#2d1b4e;
  --cream:#f3e8ff;
}
```

#### Tema Verde Clássico
```css
:root { 
  --ink:#0d1a0d;
  --gold:#86efac;
  --gold-light:#bbf7d0;
  --panel:#162c16;
  --cream:#ecfdf5;
}
```

## 🎯 Personalizando Badges de Movimentos

Localize as classes `.tag` no arquivo `frontend/src/index.css`:

```css
.tag.best{background:#5c8bb0;color:#fff}        /* Best Move ★ */
.tag.great{background:#95bb4a;color:#fff}       /* Great Move ! */
.tag.inaccuracy{background:#f0c15c;color:#222}  /* Inaccuracy ?! */
.tag.mistake{background:#e58f2a;color:#fff}     /* Mistake ? */
.tag.blunder{background:#ca3431;color:#fff}     /* Blunder ?? */
```

### Exemplo: Badges mais vibrantes
```css
.tag.best{background:#0ea5e9;color:#fff}
.tag.great{background:#22c55e;color:#fff}
.tag.inaccuracy{background:#f59e0b;color:#000}
.tag.mistake{background:#ef4444;color:#fff}
.tag.blunder{background:#dc2626;color:#fff}
```

## 🖼️ Customizando o Tabuleiro

### Cores das casas

No arquivo `frontend/src/index.css`, modifique:

```css
.sq.light{background:#e1c890;color:#eee8d7}  /* Casas claras */
.sq.dark{background:#98733d;color:#2b2115}   /* Casas escuras */
```

### Bordas do tabuleiro

```css
.chessboard-container{
  box-shadow:0 14px 35px #0008;
  border:7px solid #28281f;  /* ← Mude a cor aqui */
}
```

### Exemplo: Tabuleiro minimalista
```css
.sq.light{background:#ffffff;color:#333}
.sq.dark{background:#769656;color:#fff}

.chessboard-container{
  box-shadow:0 4px 12px rgba(0,0,0,0.3);
  border:2px solid #333;
}
```

## 📝 Alterando Textos

### Branding

No arquivo `frontend/src/ChessTrainerSystem.tsx`, localize:

```tsx
<span>chess<span className="gold">trainer</span></span>
```

Altere para o nome desejado:

```tsx
<span>meu<span className="gold">xadrez</span></span>
```

### Título da landing page

```tsx
<h1>Jogue melhor.<br /><em>Entenda</em> mais.</h1>
```

Customize para:

```tsx
<h1>Aprenda xadrez.<br /><em>Domine</em> o jogo.</h1>
```

## 🔧 Ajustando Layout

### Largura dos painéis laterais

No `frontend/src/index.css`:

```css
.game-layout{
  display:grid;
  grid-template-columns:270px minmax(500px,1fr) 330px;
  /*                     ↑ histórico  ↑ análise */
}
```

### Altura máxima do histórico

```css
.moves{
  padding:0 11px;
  max-height:calc(100vh - 400px);  /* ← Ajuste aqui */
  overflow-y:auto
}
```

## 🎭 Adicionando Animações

### Transição suave nos botões

Adicione ao `frontend/src/index.css`:

```css
button {
  cursor: pointer;
  transition: all 0.2s ease;  /* ← Nova linha */
}

.primary-action:hover {
  background: #f1d594;
  transform: translateY(-2px);  /* ← Efeito de "elevação" */
  box-shadow: 0 12px 30px #b78c4060;
}
```

### Animação de entrada nos badges

```css
.tag {
  font-size: 8px;
  padding: 2px 4px;
  border-radius: 3px;
  white-space: nowrap;
  animation: fadeIn 0.3s ease;  /* ← Nova linha */
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: scale(0.8);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
```

## 🌙 Modo Claro (Light Mode)

Para criar um tema claro, adicione estas variáveis:

```css
:root {
  --ink: #f5f5f5;
  --muted: #6b7280;
  --gold: #d97706;
  --gold-light: #f59e0b;
  --panel: #ffffff;
  --panel-2: #fafafa;
  --line: #e5e7eb;
  --cream: #1f2937;
}

.sq.light { background: #f0d9b5; color: #333; }
.sq.dark { background: #b58863; color: #fff; }
```

## 📱 Ajustes para Mobile

Os breakpoints já estão configurados, mas você pode ajustar:

```css
@media(max-width:780px){
  .hero h1{
    font-size: 48px;  /* ← Reduza se necessário */
    letter-spacing: -2px;
  }
  
  .game-layout{
    display: flex;
    flex-direction: column;
  }
}
```

## 🎨 Fontes Personalizadas

Para usar uma fonte customizada, adicione no `frontend/index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
```

Depois, no CSS:

```css
body { 
  font-family: 'Inter', Arial, Helvetica, sans-serif; 
}

.hero h1 em {
  font-family: 'Playfair Display', Georgia, serif;
}
```

## 🚀 Aplicando as mudanças

Após fazer qualquer alteração:

1. Salve o arquivo
2. O Vite recarregará automaticamente (hot reload)
3. Veja as mudanças instantaneamente no navegador

Não é necessário reiniciar o servidor de desenvolvimento!

## 💡 Dicas

- **Use variáveis CSS**: Facilita mudanças globais
- **Teste em múltiplos tamanhos**: Use as ferramentas do navegador (F12 → responsive mode)
- **Mantenha contraste**: Garanta legibilidade entre texto e fundo
- **Gradual é melhor**: Faça uma mudança por vez e teste
