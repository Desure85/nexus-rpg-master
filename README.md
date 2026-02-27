# Nexus RPG Engine

A modern, AI-powered Tabletop RPG platform designed for solo and group play.

## Features

- **AI Game Master**: Powered by Google Gemini or Local LLMs (Ollama, LM Studio).
- **Dynamic Dashboard**: Real-time tracking of characters, inventory, and game state.
- **Dice Roller**: Integrated 3D dice rolling with physics.
- **Lore Management**: Automatic lore generation and tracking.
- **Multiplayer Support**: Real-time updates for multiple players via WebSockets.

## Prerequisites

- **Node.js**: Version 18 or higher.
- **npm**: Version 9 or higher.
- **Google Gemini API Key**: Get one from [Google AI Studio](https://aistudio.google.com/).
- **(Optional) Local LLM**: Ollama or LM Studio for local AI processing.

## Installation

1.  **Clone the repository**:
    ```bash
    git clone <repository-url>
    cd nexus-rpg
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Configure Environment Variables**:
    Copy the example environment file:
    ```bash
    cp .env.example .env
    ```
    Open `.env` and add your Gemini API Key:
    ```env
    GEMINI_API_KEY=your_api_key_here
    ```

## Running Locally

1.  **Start the development server**:
    ```bash
    npm run dev
    ```

2.  **Open the application**:
    Visit `http://localhost:3000` in your browser.

## Running with Local LLM (Ollama / LM Studio)

1.  **Start your local model server**:
    - **Ollama**: `ollama serve` (default port 11434)
    - **LM Studio**: Start the local server (default port 1234)

2.  **Configure in App**:
    - Go to **Settings** -> **Model & Provider**.
    - Select **Local Model**.
    - Enter your model URL (e.g., `http://localhost:11434/v1` for Ollama).
    - Enter the model name (e.g., `llama3`).

## Running with Docker

1.  **Build the Docker image**:
    ```bash
    docker build -t nexus-rpg .
    ```

2.  **Run the container**:
    ```bash
    docker run -p 3000:3000 -v $(pwd)/game.db:/app/game.db nexus-rpg
    ```
    - The `-v` flag mounts the database file so your game data persists outside the container.

3.  **Accessing Local LLM (Ollama/LM Studio) from Docker**:
    - **Windows / Mac**: Use `host.docker.internal` instead of `localhost`.
      - Example: `http://host.docker.internal:11434/v1`
    - **Linux**: Add `--network="host"` to the `docker run` command and use `localhost`.
      - Example: `docker run --network="host" ...`

## Troubleshooting

- **Mixed Content Error**: If running the app on HTTPS (e.g., Cloud Run) and the model on HTTP (localhost), use `ngrok` to tunnel your local model:
  ```bash
  ngrok http 11434
  ```
  Use the provided HTTPS URL in the app settings.

- **Database Issues**: If you encounter database errors, delete the `game.db` file to reset the database:
  ```bash
  rm game.db
  npm run dev
  ```

## License

MIT
