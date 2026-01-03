# Task Recorder

Sistema para grabar tareas de un humano en el navegador y generar documentación estructurada (Summary, Instructions, Know-How) compatible con Digital Workers.

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                    Chrome Extension                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   Popup     │  │  Content    │  │    Background           │ │
│  │   UI        │◄─┤  Script     │──┤    Service Worker       │ │
│  └─────────────┘  └─────────────┘  └───────────┬─────────────┘ │
└────────────────────────────────────────────────┼────────────────┘
                                                 │
                                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Backend (Fastify)                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   Routes    │──┤  Processor  │──┤   LLM Pipeline          │ │
│  │   /tasks    │  │  Metrics    │  │  Chunker→Analyzer→Gen   │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Requisitos

- Node.js 20+
- pnpm 8+
- API Key de Anthropic (Claude) o OpenAI

## Instalación

```bash
# Instalar dependencias
pnpm install

# Copiar archivo de entorno
cp backend/.env.example backend/.env

# Editar backend/.env con tu API key
```

## Desarrollo

```bash
# Iniciar backend en modo desarrollo
pnpm dev:backend

# Build de la extensión
pnpm build:extension
```

## Cargar Extensión en Chrome

1. Navega a `chrome://extensions/`
2. Activa "Modo desarrollador"
3. Click "Cargar extensión descomprimida"
4. Selecciona la carpeta `extension/dist`

## Uso

1. Asegúrate de que el backend está corriendo (`pnpm dev:backend`)
2. Click en el icono de la extensión en Chrome
3. Click "Start Recording"
4. Realiza la tarea que quieres documentar
5. Click "Stop Recording"
6. Espera a que se genere la documentación
7. Copia el Markdown resultante

## Output Generado

El sistema genera un documento Markdown con 3 secciones:

### 1. Summary
Objetivo y alcance de la tarea.

### 2. Instructions
Pasos operativos para replicar la tarea.

### 3. Know-How
Conocimiento experto extraído:
- Criterios de decisión
- Señales de éxito/fallo
- Corner cases
- Heurísticas del experto

## Pipeline de LLM

El sistema usa un pipeline de 3 prompts especializados:

1. **Chunker**: Segmenta acciones en fases semánticas
2. **Analyzer**: Extrae know-how de los patrones detectados
3. **Generator**: Genera el Markdown final

## Configuración LLM

El sistema soporta Claude y OpenAI. Configura en `backend/.env`:

```bash
# Para usar Claude (recomendado)
LLM_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-...

# Para usar OpenAI
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

## Estructura del Proyecto

```
task-recorder/
├── extension/           # Chrome Extension
│   ├── src/
│   │   ├── content.ts   # Captura eventos DOM
│   │   ├── popup.ts     # UI del popup
│   │   └── background.ts# Service worker
│   └── manifest.json
├── backend/             # API Fastify
│   ├── src/
│   │   ├── routes/      # Endpoints REST
│   │   ├── services/    # Processor, LLM, Generator
│   │   └── prompts/     # Sistema de prompts
│   └── .env
└── shared/              # Tipos compartidos
    └── types.ts
```

## API Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/tasks` | Crear nueva sesión |
| POST | `/tasks/:id/actions` | Añadir acciones |
| POST | `/tasks/:id/stop` | Finalizar y generar |
| GET | `/tasks/:id` | Obtener estado |
| GET | `/health` | Health check |

## Licencia

MIT

