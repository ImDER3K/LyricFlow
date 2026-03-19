<img width="280" height="380" alt="image" src="https://github.com/user-attachments/assets/48a64563-27b7-4435-b6c2-b190593d7c98" />


# 🎵 LyricFlow

*(English version below)*

## 🇪🇸 Español

### ¿Qué es LyricFlow?
LyricFlow es una aplicación web de sincronización de letras de canciones en tiempo real. Utiliza Inteligencia Artificial (Whisper de OpenAI) para transcribir el audio de videos de YouTube, obtener las letras oficiales y sincronizarlas de forma precisa mientras escuchas tu música favorita con una interfaz moderna y elegante.

### ✨ Características
- Búsqueda de canciones mediante la API de iTunes.
- Soporte para enlaces de YouTube: extrae el audio y sincroniza las letras con IA.
- Sincronización palabra por palabra con animaciones fluidas.
- Modo oscuro y diseño adaptable.
- Exportación de letras a formatos `.txt`, `.lrc` o como imágenes optimizadas para TikTok/Instagram.

### 🛠️ Requisitos
- **Python 3.10+** (para el backend de IA)
- **Navegador web moderno** (para el frontend)

### 🚀 Cómo empezar (Paso a paso)

Para aprovechar al máximo LyricFlow con las funciones de IA, necesitas ejecutar tanto el frontend como el backend.

**Paso 1: Iniciar el Frontend**
1. Abre la carpeta principal de `lyricflow`.
2. Puedes abrir el archivo `index.html` directamente en tu navegador, o si usas VS Code, utiliza la extensión **Live Server** para una mejor experiencia.

**Paso 2: Configurar e iniciar el Backend (Windows)**
1. Abre la carpeta `backend/`.
2. Existen dos formas de iniciar el servidor:
   - **Opción A (Recomendada):** Simplemente haz doble clic en el archivo `start.bat`. Este script instalará automáticamente las dependencias necesarias y creará los archivos de configuración.
   - **Opción B (Manual):**
     - Abre una terminal en la carpeta `backend/`.
     - Ejecuta `pip install -r requirements.txt`.
     - Copia el archivo `.env.example` y renómbralo a `.env`. (Opcional: agrega tu `GENIUS_API_TOKEN` en este archivo para mejorar la búsqueda de letras).
     - Ejecuta `uvicorn main:app --reload --port 8000`.
3. Una vez que el backend esté ejecutándose (verás "*LyricFlow backend ready*" en la consola), el indicador en la esquina superior derecha del frontend cambiará a **🟢 AI online**.

*Nota: La primera vez que uses un enlace de YouTube, LyricFlow descargará el modelo de IA base de Whisper (~150MB), lo que puede tardar un par de minutos. Las siguientes veces será mucho más rápido gracias a la caché incorporada.*

### 🤝 ¡Necesito ayuda!
Este es un **proyecto personal / portfolio** creado para practicar mis habilidades de desarrollo (Python, APIs, Inteligencia Artificial, Frontend). 
¡Aún hay mucho por mejorar! Si sabes programar y quieres ayudar a optimizar el código, mejorar la UI/UX, o arreglar algún bug, **¡los Pull Requests son más que bienvenidos!** Cualquier sugerencia o feedback es de gran ayuda.

---

## 🇺🇸 English

### What is LyricFlow?
LyricFlow is a real-time synchronized song lyrics web application. It uses Artificial Intelligence (OpenAI's Whisper) to transcribe audio from YouTube videos, fetch official lyrics, and synchronize them accurately while you listen to your favorite music in a modern and sleek interface.

### ✨ Features
- Song search using the iTunes API.
- YouTube link support: extracts audio and syncs lyrics using AI.
- Word-by-word synchronization with smooth animations.
- Dark mode and responsive design.
- Export lyrics to `.txt`, `.lrc` formats, or as optimized images for TikTok/Instagram.

### 🛠️ Requirements
- **Python 3.10+** (for the AI backend)
- **Modern Web Browser** (for the frontend)

### 🚀 Getting Started (Step-by-step)

To fully enjoy LyricFlow with its AI features, you need to run both the frontend and the backend.

**Step 1: Start the Frontend**
1. Open the main `lyricflow` folder.
2. You can open the `index.html` file directly in your browser, or if you use VS Code, use the **Live Server** extension for a better experience.

**Step 2: Setup and start the Backend (Windows)**
1. Open the `backend/` folder.
2. There are two ways to start the server:
   - **Option A (Recommended):** Simply double-click the `start.bat` file. This script will automatically install necessary dependencies and create configuration files.
   - **Option B (Manual):**
     - Open a terminal in the `backend/` folder.
     - Run `pip install -r requirements.txt`.
     - Copy the `.env.example` file and rename it to `.env`. (Optional: add your `GENIUS_API_TOKEN` to this file to improve lyrics search).
     - Run `uvicorn main:app --reload --port 8000`.
3. Once the backend is running (you'll see "*LyricFlow backend ready*" in the console), the indicator in the top right corner of the frontend will change to **🟢 AI online**.

*Note: The first time you use a YouTube link, LyricFlow will download the base Whisper AI model (~150MB), which may take a couple of minutes. Subsequent uses will be much faster thanks to the built-in cache.*

### 🤝 I need help!
This is a **personal / portfolio project** created to practice my development skills (Python, APIs, Artificial Intelligence, Frontend). 
There is still a lot of room for improvement! If you know how to code and want to help optimize the codebase, improve the UI/UX, or fix a bug, **Pull Requests are more than welcome!** Any suggestions or feedback are greatly appreciated.
