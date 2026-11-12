# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"Architect My Life" is a comprehensive web application for personal goal management, habit tracking, and self-reflection. It runs as an Express.js backend server with a mobile-friendly web front end, using EJS templating, vanilla JavaScript, a SQLite database, and Claude AI API integration.

## Technology Stack

- **Server**: Express.js (Node.js) serving both the API and the rendered pages
- **Frontend**: EJS templating with vanilla JavaScript (ES6+)
- **Database**: SQLite for local data storage
- **Styling**: Custom CSS with modern design patterns
- **Icons**: Flat Icons library
- **Charts**: Chart.js for data visualization
- **Date handling**: date-fns
- **AI Integration**: Anthropic Claude API (claude-3-5-sonnet-20241022)
- **Framework**: Digital Technologies Core application registry (local package at `../../../nooblyjs-core`)
- **Development**: Nodemon, ESLint, Prettier

## Development Commands

```bash
# Development (starts Express server with nodemon, watching ./backend)
npm run dev

# Production mode
npm start                     # Start the Express server

# Linting and formatting
npm run lint
npm run format

# Testing
npm test

# Utility
npm run kill                 # Kill processes on port 3100
```

## Project Structure

```
├── app.js                    # Express.js server entry point
├── package.json             # Dependencies and npm scripts
├── backend/                 # All server-side code
│   ├── components/          # Backend components
│   │   └── webdatabase.js   # SQLite database manager class
│   ├── routes/              # Express.js API routes
│   │   └── index.js         # REST API endpoints for all features
│   └── pages/               # EJS page route handlers
│       └── index.js         # Page routing and rendering logic
├── public/                  # All front-end code and static assets
│   ├── views/               # EJS templates and layouts (rendered, never served)
│   │   ├── layouts/
│   │   │   └── main.ejs     # Main layout template with sidebar
│   │   ├── pages/           # Individual page templates
│   │   │   ├── dashboard.ejs    # Dashboard view
│   │   │   ├── goals.ejs        # Goals management
│   │   │   ├── habits.ejs       # Habit tracking
│   │   │   ├── feelings.ejs     # Mood tracking
│   │   │   ├── focus-areas.ejs  # Focus area management
│   │   │   ├── reflection.ejs   # Morning/evening notes
│   │   │   ├── wisdom.ejs       # Wisdom library
│   │   │   ├── ai-guide.ejs     # AI chat interface
│   │   │   └── settings.ejs     # Application settings
│   │   └── partials/        # Reusable template components
│   │       ├── sidebar.ejs  # Navigation sidebar
│   │       ├── header.ejs   # Page headers
│   │       └── ai-chat.ejs  # AI chat widget
│   ├── js/                  # Client-side JavaScript modules
│   │   ├── components/      # Frontend component logic
│   │   │   ├── dashboard.js # Dashboard functionality
│   │   │   ├── goals.js     # Goals management UI
│   │   │   ├── habits.js    # Habit tracking UI
│   │   │   ├── feelings.js  # Mood tracking UI
│   │   │   ├── focus-areas.js # Focus areas UI
│   │   │   ├── wisdom.js    # Wisdom library UI
│   │   │   └── shared.js    # Shared utilities
│   │   ├── main.js          # Application initialization
│   │   └── icons.js         # Icon utilities
│   ├── css/                 # Stylesheets
│   └── images/              # Static images and icons
└── data/                    # SQLite database files
    └── web-database.db      # Auto-generated database
```

## Database Schema

The SQLite database includes 12 comprehensive tables:
- **goals**: Hierarchical goal storage (annual/monthly/weekly) with progress tracking, priorities, and focus area assignments
- **goal_notes**: Notes and learnings for each goal (general, what_worked, what_didnt_work)
- **focus_areas**: Life area categorization with monthly theme support
- **monthly_focus_assignments**: Monthly focus area assignments by year/month
- **habits**: Habit definitions with frequency, categories, and target streaks
- **habit_logs**: Daily habit completion tracking with notes
- **morning_notes**: Daily morning intention setting with mood/energy tracking
- **evening_reflections**: Daily evening gratitude and learning reflection
- **wisdom**: Quote and inspiration library with categorization and favorites
- **templates**: Default reflection templates for morning and evening
- **ai_chats**: AI conversation history with session management
- **moods**: Daily mood tracking (1-10 scale) for emotional well-being analytics

## Key Features Implemented

1. **Dashboard**: Overview with goal widgets, habit tracker, and progress summaries
2. **Goal Management**: Hierarchical goal system (annual → monthly → weekly) with unified interface
3. **Focus Areas**: Life area management with monthly focus assignments
4. **Habit Tracking**: Comprehensive habit management with streaks and analytics
5. **How You Feel**: Daily mood tracking with calendar view and trends
6. **Reflection System**: Morning notes and evening reflections with templates
7. **Wisdom Library**: Quote collection with categorization and favorites
8. **AI Guide**: Claude AI integration with chat interface and session management
9. **Settings**: Configuration for AI API keys and preferences
10. **Navigation**: Full sidebar navigation with keyboard shortcuts
11. **Database Integration**: Complete REST API with Express.js backend
12. **Modern UI**: Clean, custom CSS design with consistent styling patterns

## Development Notes

### Architecture Overview
- **Backend**: Express.js server handles all database operations and API requests
- **Frontend**: EJS templates with vanilla JavaScript for client-side interactions
- **Database**: SQLite with comprehensive schema supporting all features
- **Delivery**: A single Express process serves the API and the rendered pages; the client is a mobile-friendly PWA (`public/sw.js`, `public/site.webmanifest`)

### Express.js Backend (app.js)
- REST API endpoints in `backend/routes/index.js` for all CRUD operations
- Database management via `backend/components/webdatabase.js` class
- EJS page rendering via `backend/pages/index.js` route handlers
- Static asset serving from `public/` directory
- CORS enabled for development flexibility

### Frontend Architecture
- **Templates**: EJS layouts and partials in `public/views/` directory
- **Client Logic**: Modular JavaScript components in `public/js/components/`
- **API Communication**: Fetch-based API calls to Express endpoints
- **Styling**: Custom CSS with modern design patterns
- **Icons**: Flat Icons library for consistent iconography

### Database Layer
- SQLite database automatically initialized on first run
- Comprehensive 12-table schema supporting all application features
- Schema only — no seed or default data is inserted; a new database starts empty
- CRUD operations exposed via REST API
- Automatic relationship management (goal hierarchy, progress updates)

## Common Tasks

### Adding New Features
- **New Pages**: Add EJS template in `public/views/pages/`, route handler in `backend/pages/index.js`, and API endpoints in `backend/routes/index.js`
- **UI Components**: Create client-side JavaScript modules in `public/js/components/`
- **Database Changes**: Modify schema in `backend/components/webdatabase.js` createTables() method
- **API Endpoints**: Add REST endpoints in `backend/routes/index.js` following existing patterns
- **Navigation**: Update sidebar in `public/views/partials/sidebar.ejs`

### Development Patterns
- **Database Operations**: Use async/await with database.run(), database.get(), database.all()
- **API Responses**: Return JSON with consistent error handling
- **Client-Side**: Use fetch() for API calls, modern JavaScript ES6+ features
- **Styling**: Follow existing CSS patterns and utility classes
- **Icons**: Use Flat Icons with consistent sizing and styling
- **Date Formatting**: Use date-fns for consistent date handling

### File Organization
- **Templates**: EJS files in `public/views/` with layouts, pages, and partials
- **Client Logic**: JavaScript modules in `public/js/` with clear separation of concerns
- **Styles**: CSS files in `public/css/` with component-based organization
- **API Logic**: Express routes in `backend/routes/` and database operations in `backend/components/`

## AI Integration

The application includes comprehensive Claude AI integration:

### Features
- **Goal Setting Assistance**: Help breaking down complex goals into actionable steps
- **Progress Analysis**: AI-powered insights on progress patterns and trends
- **Motivational Support**: Personalized encouragement based on user data
- **Strategic Planning**: Recommendations for achieving goals and building habits
- **Chat Interface**: Conversational AI with persistent session history

### Technical Implementation
- **API Proxy**: Express.js proxy endpoint at `/api/claude` for secure API calls
- **Model**: claude-3-5-sonnet-20241022 with 1000 max tokens
- **Authentication**: User-provided API key stored securely and passed via headers
- **Session Management**: Chat history stored in `ai_chats` table with session IDs
- **Context Awareness**: AI can access user's goal and habit data for personalized responses
- **Error Handling**: Graceful degradation with user-friendly error messages

### Configuration
- Users configure their own Claude API key through the Settings page
- API key test endpoint at `/api/claude/test` for validation
- Session management for maintaining conversation context
- Chat history can be cleared per session or globally